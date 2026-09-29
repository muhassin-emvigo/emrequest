import * as vscode from 'vscode';
import { Store } from '../storage';
import { ApiRequest, newId } from '../types';
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
    this.panel.webview.html = pageHtml(this.panel.webview, ctx.extensionUri, 'request.js', REQUEST_BODY);
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
        <span class="spacer"></span>
        <button id="format" class="secondary small">Format JSON</button>
      </div>
      <textarea id="body" class="code" spellcheck="false" placeholder='{ "hello": "world" }'></textarea>
      <div id="formBody" class="hidden"></div>
      <p id="bodyNote" class="muted hidden">GET and HEAD requests are sent without a body.</p>
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
      <pre id="respBody" class="code hidden"></pre>
    </div>
    <div class="tab-body hidden" data-group="res" data-tab="rheaders"><table id="respHeaders" class="kv-static"></table></div>
  </section>
</div>
`;
