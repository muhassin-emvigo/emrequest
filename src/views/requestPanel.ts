import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { Store } from '../storage';
import { ApiRequest, blankRequest, newId } from '../types';
import { sendRequest, prepareRequest } from '../core/http';
import { envToMap, resolveRequest } from '../core/variables';
import { pageHtml } from './webviewUtil';

/** One editor tab per request. Re-opening the same request focuses the existing tab. */
export class RequestPanel {
  private static panels = new Map<string, RequestPanel>();

  private abort?: AbortController;
  private request: ApiRequest;
  private collectionId?: string;

  static open(ctx: vscode.ExtensionContext, store: Store, request: ApiRequest, collectionId?: string) {
    const existing = RequestPanel.panels.get(request.id);
    if (existing) { existing.panel.reveal(); return; }
    new RequestPanel(ctx, store, JSON.parse(JSON.stringify(request)), collectionId);
  }

  /** Keep an open tab in step when the request is renamed from the sidebar. */
  static notifyRenamed(requestId: string, name: string) {
    const p = RequestPanel.panels.get(requestId);
    if (!p) { return; }
    p.request = { ...p.request, name };
    p.panel.title = p.title();
    p.panel.webview.postMessage({ type: 'renamed', name });
  }

  static refreshEnvironments(store: Store) {
    for (const p of RequestPanel.panels.values()) { p.postEnvs(store); }
  }

  private readonly panel: vscode.WebviewPanel;

  private constructor(private readonly ctx: vscode.ExtensionContext, private readonly store: Store, request: ApiRequest, collectionId?: string) {
    this.request = request;
    this.collectionId = collectionId;
    this.panel = vscode.window.createWebviewPanel('emrequest.request', this.title(), vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, 'media')],
    });
    this.panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'icon.svg');
    this.panel.webview.html = pageHtml(this.panel.webview, ctx.extensionUri, 'request.js', REQUEST_BODY,
      { 'graphql-editor': 'graphql-editor.js' });
    RequestPanel.panels.set(request.id, this);

    this.panel.onDidDispose(() => { this.abort?.abort(); RequestPanel.panels.delete(this.request.id); });
    this.panel.webview.onDidReceiveMessage(m => this.onMessage(m));
  }

  private title() { return `${this.request.method} ${this.request.name}`; }

  private postEnvs(store: Store) {
    this.panel.webview.postMessage({
      type: 'envs',
      envs: store.getEnvironments().map(e => ({ id: e.id, name: e.name })),
      activeEnvId: store.getActiveEnvironmentId() ?? '',
    });
  }

  private async onMessage(m: any) {
    switch (m.type) {
      case 'ready':
        this.panel.webview.postMessage({ type: 'load', request: this.request, collectionName: this.collectionName() });
        this.postEnvs(this.store);
        break;
      case 'changed':
        this.request = { ...m.request, id: this.request.id };
        this.panel.title = this.title();
        break;
      case 'setEnv':
        await this.store.setActiveEnvironment(m.id || undefined);
        break;
      case 'send':
        this.request = { ...m.request, id: this.request.id };
        await this.send();
        break;
      case 'cancel':
        this.abort?.abort();
        break;
      case 'save':
        this.request = { ...m.request, id: this.request.id };
        await this.save(false);
        break;
      case 'saveAs':
        this.request = { ...m.request, id: this.request.id };
        await this.save(true);
        break;
      case 'copyCurl':
        this.request = { ...m.request, id: this.request.id };
        await this.copyCurl();
        break;
      case 'fetchSchema':
        await this.fetchSchema(m.request, m.introspectionQuery);
        break;
      case 'getCachedSchema':
        await this.postCachedSchema(m.request);
        break;
      case 'loadSchemaFile':
        await this.loadSchemaFile(m.request);
        break;
      case 'clearSchema': {
        const key = this.schemaKey(m.request);
        if (key) { try { await vscode.workspace.fs.delete(this.schemaFile(key)); } catch { /* not cached */ } }
        this.panel.webview.postMessage({ type: 'schema', schema: null });
        break;
      }
      case 'openInEditor': {
        const doc = await vscode.workspace.openTextDocument({ content: m.content, language: m.language || 'plaintext' });
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
        break;
      }
    }
  }

  private collectionName(): string | undefined {
    return this.store.getCollections().find(c => c.id === this.collectionId)?.name;
  }

  private cfg() {
    const c = vscode.workspace.getConfiguration('emrequest');
    return {
      timeoutMs: c.get<number>('timeoutMs', 30000),
      historyLimit: c.get<number>('historyLimit', 100),
      followRedirects: c.get<boolean>('followRedirects', true),
      rejectUnauthorized: c.get<boolean>('rejectUnauthorized', true),
    };
  }

  private async send() {
    this.abort?.abort();
    this.abort = new AbortController();
    const cfg = this.cfg();
    const resolved = resolveRequest(this.request, envToMap(this.store.getActiveEnvironment()));
    this.panel.webview.postMessage({ type: 'sending' });
    const response = await sendRequest(resolved, { ...cfg, signal: this.abort.signal });
    this.panel.webview.postMessage({ type: 'response', response });
    await this.store.addHistory({
      id: newId(),
      request: { ...this.request, id: newId() }, // history keeps a snapshot, not a link
      status: response.status || undefined,
      timeMs: response.timeMs,
      sentAt: Date.now(),
    }, cfg.historyLimit);
  }

  private async save(forcePick: boolean) {
    let colId = forcePick ? undefined : this.collectionId;
    if (!colId || !this.store.getCollections().some(c => c.id === colId)) {
      colId = await pickCollection(this.store);
      if (!colId) { return; }
    }
    if (forcePick) {
      const name = await vscode.window.showInputBox({ prompt: 'Request name', value: this.request.name });
      if (!name) { return; }
      // Save As creates a copy with a new id; this tab now edits the copy
      RequestPanel.panels.delete(this.request.id);
      this.request = { ...this.request, id: newId(), name };
      RequestPanel.panels.set(this.request.id, this);
    }
    await this.store.saveRequest(colId, this.request);
    this.collectionId = colId;
    this.panel.title = this.title();
    this.panel.webview.postMessage({ type: 'saved', collectionName: this.collectionName(), name: this.request.name });
  }

  // ---------- GraphQL schema: download, cache per endpoint, load from file ----------

  /** Cache key = the endpoint after {{env}} values are filled in, without the query string. */
  private schemaKey(req: ApiRequest): string | undefined {
    try {
      const url = resolveRequest(req, envToMap(this.store.getActiveEnvironment())).url.trim();
      const u = new URL(/^https?:\/\//i.test(url) ? url : 'http://' + url);
      return `${u.origin}${u.pathname}`;
    } catch { return undefined; }
  }

  private schemaFile(key: string): vscode.Uri {
    const hash = crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
    return vscode.Uri.joinPath(this.ctx.globalStorageUri, 'graphql-schemas', `${hash}.json`);
  }

  private async saveSchema(key: string, text: string, source: 'endpoint' | 'file', name?: string) {
    const record = { endpoint: key, savedAt: Date.now(), source, name, text };
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.ctx.globalStorageUri, 'graphql-schemas'));
    await vscode.workspace.fs.writeFile(this.schemaFile(key), Buffer.from(JSON.stringify(record), 'utf8'));
    return record;
  }

  private async postCachedSchema(req: ApiRequest) {
    const key = this.schemaKey(req);
    if (!key) { this.panel.webview.postMessage({ type: 'schema', schema: null }); return; }
    try {
      const raw = await vscode.workspace.fs.readFile(this.schemaFile(key));
      this.panel.webview.postMessage({ type: 'schema', schema: JSON.parse(Buffer.from(raw).toString('utf8')), cached: true });
    } catch {
      this.panel.webview.postMessage({ type: 'schema', schema: null, endpoint: key });
    }
  }

  /** Sends the standard schema (introspection) query with this request's own URL, headers and auth. */
  private async fetchSchema(req: ApiRequest, introspectionQuery: string) {
    const key = this.schemaKey(req);
    if (!key) { this.panel.webview.postMessage({ type: 'schemaError', error: 'Enter a valid endpoint URL first.' }); return; }
    const probe = resolveRequest({
      ...blankRequest(),
      ...req,
      method: 'POST',
      bodyType: 'graphql',
      graphql: { query: introspectionQuery, variables: '', operationName: 'IntrospectionQuery' },
    }, envToMap(this.store.getActiveEnvironment()));
    const res = await sendRequest(probe, this.cfg());
    if (res.error) { this.panel.webview.postMessage({ type: 'schemaError', error: res.error }); return; }
    if (res.status < 200 || res.status >= 300) {
      this.panel.webview.postMessage({ type: 'schemaError', error: `The server answered ${res.status} ${res.statusText}. It may need auth headers, or it may not allow schema downloads.` });
      return;
    }
    let body: any;
    try { body = JSON.parse(res.body); } catch { body = undefined; }
    if (!body?.data?.__schema) {
      const reason = body?.errors?.[0]?.message;
      this.panel.webview.postMessage({
        type: 'schemaError',
        error: reason
          ? `The server refused the schema request: ${reason}. Many live APIs switch this off; use "Load file" with a schema file instead.`
          : 'The response is not a GraphQL schema. Check the endpoint URL.',
      });
      return;
    }
    const record = await this.saveSchema(key, res.body, 'endpoint');
    this.panel.webview.postMessage({ type: 'schema', schema: record });
  }

  private async loadSchemaFile(req: ApiRequest) {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: 'Use this schema',
      filters: { 'GraphQL schema': ['graphql', 'graphqls', 'gql', 'json'], 'All files': ['*'] },
    });
    if (!picked?.[0]) { return; }
    const text = Buffer.from(await vscode.workspace.fs.readFile(picked[0])).toString('utf8');
    const name = picked[0].path.split('/').pop();
    const key = this.schemaKey(req);
    const record = key
      ? await this.saveSchema(key, text, 'file', name)
      : { endpoint: '', savedAt: Date.now(), source: 'file', name, text };
    this.panel.webview.postMessage({ type: 'schema', schema: record });
  }

  private async copyCurl() {
    try {
      const resolved = resolveRequest(this.request, envToMap(this.store.getActiveEnvironment()));
      const p = prepareRequest(resolved);
      const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
      const parts = [`curl -X ${p.method} ${q(p.url)}`];
      for (const [k, v] of Object.entries(p.headers)) {
        if (k === 'Content-Length' || k === 'User-Agent') { continue; }
        parts.push(`-H ${q(`${k}: ${v}`)}`);
      }
      if (p.body) { parts.push(`--data-raw ${q(p.body.toString('utf8'))}`); }
      await vscode.env.clipboard.writeText(parts.join(' \\\n  '));
      vscode.window.showInformationMessage('cURL command copied to clipboard.');
    } catch (e: any) {
      vscode.window.showErrorMessage(`Could not build cURL: ${e.message}`);
    }
  }
}

export async function pickCollection(store: Store): Promise<string | undefined> {
  const NEW = '$(new-folder) New collection…';
  const items = [...store.getCollections().map(c => ({ label: c.name, id: c.id })), { label: NEW, id: '' }];
  const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Save to which collection?' });
  if (!pick) { return undefined; }
  if (pick.id) { return pick.id; }
  const name = await vscode.window.showInputBox({ prompt: 'Collection name', placeHolder: 'e.g. Payments API' });
  if (!name) { return undefined; }
  return (await store.addCollection(name)).id;
}

const REQUEST_BODY = /* html */ `
<div class="topbar">
  <select id="method" class="method">
    <option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option>
    <option>DELETE</option><option>HEAD</option><option>OPTIONS</option>
  </select>
  <input id="url" class="url" type="text" placeholder="https://api.example.com/users or {{baseUrl}}/users" spellcheck="false">
  <button id="send" class="primary">Send</button>
</div>
<div class="subbar">
  <input id="name" class="name" type="text" title="Request name" spellcheck="false">
  <span id="savedIn" class="muted"></span>
  <span class="spacer"></span>
  <label class="muted">Env
    <select id="env"></select>
  </label>
  <button id="save">Save</button>
  <button id="saveAs" class="secondary">Save As</button>
  <button id="curl" class="secondary" title="Copy as cURL">cURL</button>
</div>
<div class="split">
  <section class="pane">
    <nav class="tabs" data-group="req">
      <button data-tab="params" class="active">Query <span class="count" id="c-params"></span></button>
      <button data-tab="headers">Headers <span class="count" id="c-headers"></span></button>
      <button data-tab="auth">Auth</button>
      <button data-tab="body">Body</button>
      <button data-tab="schema" id="schemaTabBtn" class="hidden">Schema</button>
    </nav>
    <div class="tab-body" data-group="req" data-tab="params"><div id="params"></div></div>
    <div class="tab-body hidden" data-group="req" data-tab="headers"><div id="headers"></div></div>
    <div class="tab-body hidden" data-group="req" data-tab="auth">
      <label class="field">Type
        <select id="authType">
          <option value="none">No Auth</option>
          <option value="bearer">Bearer Token</option>
          <option value="basic">Basic Auth</option>
          <option value="apikey">API Key</option>
        </select>
      </label>
      <div id="auth-bearer" class="auth-box hidden">
        <label class="field">Token <input id="token" type="text" placeholder="{{token}}" spellcheck="false"></label>
      </div>
      <div id="auth-basic" class="auth-box hidden">
        <label class="field">Username <input id="username" type="text" spellcheck="false"></label>
        <label class="field">Password <input id="password" type="password"></label>
      </div>
      <div id="auth-apikey" class="auth-box hidden">
        <label class="field">Key name <input id="apiKeyName" type="text" placeholder="X-API-Key" spellcheck="false"></label>
        <label class="field">Value <input id="apiKeyValue" type="text" spellcheck="false"></label>
        <label class="field">Add to
          <select id="apiKeyIn"><option value="header">Header</option><option value="query">Query params</option></select>
        </label>
      </div>
    </div>
    <div class="tab-body hidden" data-group="req" data-tab="body">
      <div class="radio-row" id="bodyTypes">
        <label><input type="radio" name="bodyType" value="none"> None</label>
        <label><input type="radio" name="bodyType" value="json"> JSON</label>
        <label><input type="radio" name="bodyType" value="xml"> XML</label>
        <label><input type="radio" name="bodyType" value="text"> Text</label>
        <label><input type="radio" name="bodyType" value="form"> Form (urlencoded)</label>
        <label><input type="radio" name="bodyType" value="graphql"> GraphQL</label>
        <span class="spacer"></span>
        <button id="format" class="secondary small">Format JSON</button>
      </div>
      <textarea id="body" class="code" spellcheck="false" placeholder='{ "hello": "world" }'></textarea>
      <div id="formBody" class="hidden"></div>
      <div id="gqlPane" class="gql hidden">
        <div class="gql-toolbar">
          <label class="muted" id="opWrap">Operation <select id="gqlOp"></select></label>
          <span class="spacer"></span>
          <span id="schemaStatus" class="muted small"></span>
          <button id="gqlFetchSchema" class="secondary small" title="Download the schema from this endpoint">Fetch schema</button>
          <button id="gqlFormat" class="secondary small">Format</button>
        </div>
        <div id="gqlQuery" class="gql-query"><div class="empty small" id="gqlLoading">Loading GraphQL editor…</div></div>
        <label class="gql-vars-label muted" for="gqlVars">Variables (JSON)</label>
        <textarea id="gqlVars" class="code gql-vars" spellcheck="false" placeholder='{ "id": "1" }'></textarea>
        <p id="gqlNote" class="muted small hidden">GET sends the query and variables in the URL. Switch to POST for large queries.</p>
      </div>
      <p id="bodyNote" class="muted hidden">GET and HEAD requests are sent without a body.</p>
    </div>
    <div class="tab-body hidden" data-group="req" data-tab="schema">
      <div class="gql-toolbar">
        <span id="schemaInfo" class="muted small"></span>
        <span class="spacer"></span>
        <button id="schemaFetch2" class="secondary small">Fetch schema</button>
        <button id="schemaFile" class="secondary small" title="Open a .graphql (SDL) or introspection .json file">Load file</button>
        <button id="schemaClear" class="secondary small">Forget</button>
      </div>
      <div id="schemaError" class="error small hidden"></div>
      <div id="explorer" class="explorer"></div>
    </div>
  </section>
  <section class="pane response">
    <div class="status-row">
      <span id="status" class="badge">—</span>
      <span id="time" class="muted"></span>
      <span id="size" class="muted"></span>
      <span class="spacer"></span>
      <button id="copyResp" class="secondary small">Copy</button>
      <button id="openResp" class="secondary small">Open in editor</button>
    </div>
    <nav class="tabs" data-group="res">
      <button data-tab="rbody" class="active">Response</button>
      <button data-tab="rheaders">Headers <span class="count" id="c-rheaders"></span></button>
    </nav>
    <div class="tab-body" data-group="res" data-tab="rbody">
      <div id="placeholder" class="empty">Press <b>Send</b> (or Ctrl/Cmd + Enter) to see the response here.</div>
      <div id="loading" class="empty hidden"><span class="spinner"></span> Sending… <button id="cancel" class="secondary small">Cancel</button></div>
      <div id="error" class="error hidden"></div>
      <div id="gqlErrors" class="gql-errors hidden"></div>
      <pre id="respBody" class="code hidden"></pre>
    </div>
    <div class="tab-body hidden" data-group="res" data-tab="rheaders"><table id="respHeaders" class="kv-static"></table></div>
  </section>
</div>
`;
