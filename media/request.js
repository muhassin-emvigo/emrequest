(function () {
  const vscode = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  setupTabs();

  let req = null;            // current request model (url holds the base, without query string)
  let lastResponse = null;

  // ---------- helpers ----------
  const safeDecode = s => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; } };

  function splitUrl(full) {
    const i = full.indexOf('?');
    if (i < 0) return { base: full, params: [] };
    const params = full.slice(i + 1).split('&').filter(Boolean).map(pair => {
      const e = pair.indexOf('=');
      return { key: safeDecode(e < 0 ? pair : pair.slice(0, e)), value: e < 0 ? '' : safeDecode(pair.slice(e + 1)), enabled: true };
    });
    return { base: full.slice(0, i), params };
  }

  function displayUrl() {
    const q = req.params.filter(p => p.enabled && p.key).map(p => p.value === '' ? p.key : `${p.key}=${p.value}`).join('&');
    return q ? `${req.url}?${q}` : req.url;
  }

  let changeTimer;
  function changed() {
    updateCounts();
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => vscode.postMessage({ type: 'changed', request: collect() }), 250);
  }

  function collect() {
    req.method = $('method').value;
    req.name = $('name').value || 'Untitled';
    req.params = paramsTable.getRows();
    req.headers = headersTable.getRows();
    req.formBody = formTable.getRows();
    req.body = $('body').value;
    req.bodyType = document.querySelector('input[name="bodyType"]:checked')?.value || 'none';
    if (req.bodyType === 'graphql' || req.graphql) {
      const ops = currentOperations();
      req.graphql = {
        query: gqlQueryText(),
        variables: $('gqlVars').value,
        operationName: ops.length > 1 ? $('gqlOp').value : '',
      };
    }
    req.auth = {
      type: $('authType').value,
      token: $('token').value,
      username: $('username').value,
      password: $('password').value,
      apiKeyName: $('apiKeyName').value,
      apiKeyValue: $('apiKeyValue').value,
      apiKeyIn: $('apiKeyIn').value,
    };
    return JSON.parse(JSON.stringify(req));
  }

  function updateCounts() {
    const c = (id, n) => { $(id).textContent = n ? String(n) : ''; };
    c('c-params', paramsTable.getRows().filter(r => r.enabled).length);
    c('c-headers', headersTable.getRows().filter(r => r.enabled).length);
  }

  function setMethodColor() {
    $('method').dataset.m = $('method').value;
    const isGql = (document.querySelector('input[name="bodyType"]:checked')?.value) === 'graphql';
    $('bodyNote').classList.toggle('hidden', isGql || !['GET', 'HEAD'].includes($('method').value));
    $('gqlNote').classList.toggle('hidden', !(isGql && $('method').value === 'GET'));
  }

  function showAuth() {
    const t = $('authType').value;
    ['bearer', 'basic', 'apikey'].forEach(x => $('auth-' + x).classList.toggle('hidden', x !== t));
  }

  function showBody() {
    const t = document.querySelector('input[name="bodyType"]:checked')?.value || 'none';
    $('body').classList.toggle('hidden', t === 'none' || t === 'form' || t === 'graphql');
    $('formBody').classList.toggle('hidden', t !== 'form');
    $('format').classList.toggle('hidden', t !== 'json');
    $('gqlPane').classList.toggle('hidden', t !== 'graphql');
    $('schemaTabBtn').classList.toggle('hidden', t !== 'graphql');
    // leaving GraphQL while the Schema tab is open → go back to Body
    if (t !== 'graphql' && !document.querySelector('.tab-body[data-tab="schema"]').classList.contains('hidden')) {
      document.querySelector('nav.tabs[data-group="req"] button[data-tab="body"]').click();
    }
    setMethodColor();
    if (t === 'graphql') {
      loadGraphqlEditor();
      requestCachedSchema();
    }
  }

  // ---------- tables ----------
  const paramsTable = new KVTable($('params'), {
    keyPlaceholder: 'parameter', valuePlaceholder: 'value',
    onChange: () => { req.params = paramsTable.getRows(); $('url').value = displayUrl(); changed(); },
  });
  const headersTable = new KVTable($('headers'), { keyPlaceholder: 'header', valuePlaceholder: 'value', onChange: changed });
  const formTable = new KVTable($('formBody'), { keyPlaceholder: 'field', valuePlaceholder: 'value', onChange: changed });

  // ---------- load ----------
  function load(r) {
    req = r;
    $('method').value = r.method;
    $('name').value = r.name;
    paramsTable.setRows(r.params);
    headersTable.setRows(r.headers);
    formTable.setRows(r.formBody);
    $('url').value = displayUrl();
    $('body').value = r.body || '';
    const bt = document.querySelector(`input[name="bodyType"][value="${r.bodyType || 'none'}"]`);
    if (bt) bt.checked = true;
    const a = r.auth || { type: 'none' };
    $('authType').value = a.type;
    $('token').value = a.token || '';
    $('username').value = a.username || '';
    $('password').value = a.password || '';
    $('apiKeyName').value = a.apiKeyName || '';
    $('apiKeyValue').value = a.apiKeyValue || '';
    $('apiKeyIn').value = a.apiKeyIn || 'header';
    gql.pendingQuery = r.graphql?.query || '';
    gql.pendingOp = r.graphql?.operationName || '';
    if (gql.editor) gql.editor.setValue(gql.pendingQuery);
    $('gqlVars').value = r.graphql?.variables || '';
    refreshOperations();
    setMethodColor(); showAuth(); showBody(); updateCounts();
    $('url').focus();
  }

  // ---------- events ----------
  $('url').addEventListener('input', () => {
    const { base, params } = splitUrl($('url').value);
    const disabled = req.params.filter(p => !p.enabled);
    req.url = base;
    req.params = [...params, ...disabled];
    paramsTable.setRows(req.params);
    changed();
    // a new endpoint may have its own saved schema
    clearTimeout(gql.urlTimer);
    gql.urlTimer = setTimeout(requestCachedSchema, 600);
  });
  $('url').addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
  $('method').addEventListener('change', () => { setMethodColor(); changed(); });
  $('name').addEventListener('input', changed);
  $('authType').addEventListener('change', () => { showAuth(); changed(); });
  ['token', 'username', 'password', 'apiKeyName', 'apiKeyValue'].forEach(id => $(id).addEventListener('input', changed));
  $('apiKeyIn').addEventListener('change', changed);
  document.querySelectorAll('input[name="bodyType"]').forEach(r => r.addEventListener('change', () => {
    if (r.value === 'graphql') {
      // GraphQL is almost always POST; GET stays possible by switching back
      if (['GET', 'HEAD'].includes($('method').value)) $('method').value = 'POST';
      if (!gqlQueryText().trim()) {
        gql.pendingQuery = 'query {\n  \n}';
        if (gql.editor) gql.editor.setValue(gql.pendingQuery);
      }
    }
    showBody();
    // auto add a JSON skeleton the first time
    if (r.value === 'json' && !$('body').value.trim()) $('body').value = '{\n  \n}';
    changed();
  }));
  $('body').addEventListener('input', changed);
  $('body').addEventListener('keydown', e => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const t = e.target, s = t.selectionStart;
      t.value = t.value.slice(0, s) + '  ' + t.value.slice(t.selectionEnd);
      t.selectionStart = t.selectionEnd = s + 2;
      changed();
    }
  });
  $('format').addEventListener('click', () => {
    try { $('body').value = JSON.stringify(JSON.parse($('body').value), null, 2); changed(); }
    catch (e) { flash('Invalid JSON: ' + e.message, true); }
  });

  $('send').addEventListener('click', send);
  $('cancel').addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
  $('save').addEventListener('click', () => vscode.postMessage({ type: 'save', request: collect() }));
  $('saveAs').addEventListener('click', () => vscode.postMessage({ type: 'saveAs', request: collect() }));
  $('curl').addEventListener('click', () => vscode.postMessage({ type: 'copyCurl', request: collect() }));
  $('env').addEventListener('change', () => vscode.postMessage({ type: 'setEnv', id: $('env').value }));

  document.addEventListener('keydown', e => {
    if (e.defaultPrevented) return; // already handled inside the GraphQL editor
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); send(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); vscode.postMessage({ type: 'save', request: collect() }); }
  });

  $('copyResp').addEventListener('click', () => {
    if (!lastResponse) return;
    navigator.clipboard.writeText(prettyBody(lastResponse).text).then(() => flash('Copied'));
  });
  $('openResp').addEventListener('click', () => {
    if (!lastResponse) return;
    const p = prettyBody(lastResponse);
    vscode.postMessage({ type: 'openInEditor', content: p.text, language: p.lang });
  });

  function send() {
    if (!$('url').value.trim()) { flash('Enter a URL first', true); return; }
    vscode.postMessage({ type: 'send', request: collect() });
  }

  function flash(msg, isErr) {
    const el = $('savedIn');
    const prev = el.dataset.base || '';
    el.textContent = msg;
    el.classList.toggle('err', !!isErr);
    setTimeout(() => { el.textContent = prev; el.classList.remove('err'); }, 2500);
  }

  // ---------- response ----------
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function prettyBody(res) {
    const ct = (res.headers['content-type'] || '').toLowerCase();
    const raw = res.body || '';
    if (ct.includes('json') || /^\s*[\[{]/.test(raw)) {
      try { return { text: JSON.stringify(JSON.parse(raw), null, 2), lang: 'json' }; } catch { /* not JSON */ }
    }
    if (ct.includes('html')) return { text: raw, lang: 'html' };
    if (ct.includes('xml')) return { text: raw, lang: 'xml' };
    return { text: raw, lang: 'plaintext' };
  }

  function highlightJson(text) {
    return escapeHtml(text).replace(
      /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(\.\d+)?([eE][+-]?\d+)?)/g,
      m => {
        let cls = 'j-num';
        if (m.startsWith('"')) cls = m.trimEnd().endsWith(':') ? 'j-key' : 'j-str';
        else if (m === 'true' || m === 'false') cls = 'j-bool';
        else if (m === 'null') cls = 'j-null';
        return `<span class="${cls}">${m}</span>`;
      });
  }

  function formatSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  function showSending() {
    $('placeholder').classList.add('hidden');
    $('error').classList.add('hidden');
    $('respBody').classList.add('hidden');
    $('loading').classList.remove('hidden');
    $('gqlErrors').classList.add('hidden');
    $('send').disabled = true;
  }

  function showResponse(res) {
    lastResponse = res;
    $('loading').classList.add('hidden');
    $('send').disabled = false;
    const st = $('status');
    if (res.error) {
      st.textContent = 'Error';
      st.className = 'badge s-err';
      $('time').textContent = res.timeMs + ' ms';
      $('size').textContent = '';
      $('error').textContent = res.error;
      $('error').classList.remove('hidden');
      $('respBody').classList.add('hidden');
      $('gqlErrors').classList.add('hidden');
      $('respHeaders').replaceChildren();
      $('c-rheaders').textContent = '';
      return;
    }
    st.textContent = `${res.status} ${res.statusText}`;
    st.className = 'badge s-' + String(res.status)[0];
    $('time').textContent = res.timeMs + ' ms';
    $('size').textContent = formatSize(res.sizeBytes);

    const p = prettyBody(res);
    const pre = $('respBody');
    if (p.lang === 'json') pre.innerHTML = highlightJson(p.text);
    else pre.textContent = p.text || '(empty body)';
    pre.classList.remove('hidden');
    showGraphqlErrors(res);

    const table = $('respHeaders');
    table.replaceChildren();
    Object.entries(res.headers).forEach(([k, v]) => {
      const tr = document.createElement('tr');
      const a = document.createElement('td'); a.textContent = k;
      const b = document.createElement('td'); b.textContent = v;
      tr.append(a, b); table.appendChild(tr);
    });
    $('c-rheaders').textContent = String(Object.keys(res.headers).length);
  }

  // ---------- GraphQL ----------
  const gql = {
    editor: null,        // set once the editor bundle has loaded
    explorer: null,
    loading: null,       // promise while the bundle loads
    pendingQuery: '',    // query text kept until the editor exists
    pendingOp: '',
    pendingRecord: undefined,
    schemaRecord: null,
    urlTimer: 0,
    opTimer: 0,
  };

  function gqlQueryText() { return gql.editor ? gql.editor.getValue() : gql.pendingQuery; }

  function parseOperationNames(q) {
    if (window.EmGraphQL) return window.EmGraphQL.operationNames(q);
    const out = []; const re = /\b(query|mutation|subscription)\s+([_A-Za-z][_0-9A-Za-z]*)/g; let m;
    while ((m = re.exec(q))) out.push(m[2]);
    return out;
  }
  function currentOperations() { return parseOperationNames(gqlQueryText()); }

  /** Show the operation picker only when the query holds more than one named operation. */
  function refreshOperations() {
    const names = currentOperations();
    const sel = $('gqlOp');
    const keep = sel.value || gql.pendingOp;
    sel.replaceChildren(...names.map(n => { const o = document.createElement('option'); o.value = n; o.textContent = n; return o; }));
    if (names.includes(keep)) sel.value = keep;
    $('opWrap').classList.toggle('hidden', names.length < 2);
  }

  function loadGraphqlEditor() {
    if (gql.loading) return gql.loading;
    gql.loading = new Promise((resolve, reject) => {
      if (window.EmGraphQL) { resolve(); return; }
      const s = document.createElement('script');
      s.nonce = document.body.dataset.nonce;
      s.src = document.body.dataset.graphqlEditor;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('editor failed to load'));
      document.body.appendChild(s);
    }).then(() => {
      const G = window.EmGraphQL;
      $('gqlQuery').replaceChildren();
      gql.editor = G.createEditor({
        parent: $('gqlQuery'),
        doc: gql.pendingQuery,
        nonce: document.body.dataset.nonce,
        onChange: () => { clearTimeout(gql.opTimer); gql.opTimer = setTimeout(refreshOperations, 300); changed(); },
        onShowInDocs: (typeName) => { if (typeName) { openSchemaTab(); gql.explorer.show(typeName); } },
        onRun: send,
      });
      gql.explorer = G.createExplorer($('explorer'), {
        onInsert: text => {
          document.querySelector('nav.tabs[data-group="req"] button[data-tab="body"]').click();
          gql.editor.insertAtCursor(text);
        },
      });
      refreshOperations();
      if (gql.pendingRecord !== undefined) { const r = gql.pendingRecord; gql.pendingRecord = undefined; applySchemaRecord(r); }
    }).catch(() => {
      // Fallback: a plain text box, so GraphQL still works without autocomplete
      const ta = document.createElement('textarea');
      ta.className = 'code gql-fallback'; ta.spellcheck = false; ta.value = gql.pendingQuery;
      ta.addEventListener('input', () => { refreshOperations(); changed(); });
      $('gqlQuery').replaceChildren(ta);
      gql.editor = {
        getValue: () => ta.value, setValue: v => { ta.value = v; }, setSchema() {}, focus: () => ta.focus(),
        insertAtCursor: t => { const p = ta.selectionStart; ta.value = ta.value.slice(0, p) + t + ta.value.slice(ta.selectionEnd); },
        format() { throw new Error('Formatting needs the GraphQL editor, which could not load'); },
      };
      setSchemaStatus('Editor could not load; autocomplete is off', true);
    });
    return gql.loading;
  }

  function openSchemaTab() {
    document.querySelector('nav.tabs[data-group="req"] button[data-tab="schema"]').click();
  }

  function requestCachedSchema() {
    if (!req || !req.url) { applySchemaRecord(null); return; }
    vscode.postMessage({ type: 'getCachedSchema', request: collect() });
  }

  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    return Math.floor(s / 86400) + ' days ago';
  }

  function setSchemaStatus(text, isErr) {
    $('schemaStatus').textContent = text;
    $('schemaStatus').classList.toggle('err', !!isErr);
    $('schemaInfo').textContent = text;
    $('schemaInfo').classList.toggle('err', !!isErr);
  }

  function applySchemaRecord(record) {
    if (!window.EmGraphQL || !gql.editor || !gql.explorer) { gql.pendingRecord = record; return; }
    $('schemaError').classList.add('hidden');
    gql.schemaRecord = record;
    if (!record) {
      gql.editor.setSchema(null);
      gql.explorer.setSchema(null);
      setSchemaStatus('No schema · autocomplete off');
      return;
    }
    try {
      const schema = window.EmGraphQL.schemaFromText(record.text);
      gql.editor.setSchema(schema);
      gql.explorer.setSchema(schema);
      const from = record.source === 'file' ? `from ${record.name || 'file'}` : 'from endpoint';
      const count = Object.keys(schema.getTypeMap()).filter(n => !n.startsWith('__')).length;
      setSchemaStatus(`Schema ${from} · ${count} types · ${timeAgo(record.savedAt)}`);
    } catch (e) {
      gql.editor.setSchema(null);
      gql.explorer.setSchema(null);
      showSchemaError(e.message);
    }
  }

  function showSchemaError(msg) {
    $('schemaError').textContent = msg;
    $('schemaError').classList.remove('hidden');
    setSchemaStatus('Schema not loaded', true);
    [$('gqlFetchSchema'), $('schemaFetch2')].forEach(b => { b.disabled = false; });
  }

  function fetchSchema() {
    if (!$('url').value.trim()) { flash('Enter the GraphQL endpoint URL first', true); return; }
    loadGraphqlEditor().then(() => {
      if (!window.EmGraphQL) { showSchemaError('The GraphQL editor could not load, so the schema cannot be read.'); return; }
      setSchemaStatus('Fetching schema…');
      [$('gqlFetchSchema'), $('schemaFetch2')].forEach(b => { b.disabled = true; });
      vscode.postMessage({ type: 'fetchSchema', request: collect(), introspectionQuery: window.EmGraphQL.introspectionQuery });
    });
  }

  $('gqlFetchSchema').addEventListener('click', fetchSchema);
  $('schemaFetch2').addEventListener('click', fetchSchema);
  $('schemaFile').addEventListener('click', () => vscode.postMessage({ type: 'loadSchemaFile', request: collect() }));
  $('schemaClear').addEventListener('click', () => vscode.postMessage({ type: 'clearSchema', request: collect() }));
  $('gqlOp').addEventListener('change', changed);
  $('gqlVars').addEventListener('input', changed);
  $('gqlFormat').addEventListener('click', () => {
    if (!gql.editor) return;
    try { gql.editor.format(); changed(); }
    catch (e) { flash('Cannot format: ' + e.message, true); }
  });
  window.addEventListener('message', e => {
    if (e.data && e.data.type === 'schema') [$('gqlFetchSchema'), $('schemaFetch2')].forEach(b => { b.disabled = false; });
  });

  /** GraphQL servers report failures inside a 200 OK response, so surface them clearly. */
  function showGraphqlErrors(res) {
    const box = $('gqlErrors');
    let body;
    try { body = JSON.parse(res.body); } catch { body = null; }
    const errors = body && Array.isArray(body.errors) ? body.errors.filter(x => x && typeof x.message === 'string') : [];
    if (!errors.length) { box.classList.add('hidden'); return; }
    const st = $('status');
    st.textContent += ` · ${errors.length} GraphQL error${errors.length > 1 ? 's' : ''}`;
    st.className = 'badge s-err';
    const head = document.createElement('div');
    head.className = 'gql-errors-head';
    head.textContent = body.data ? `GraphQL errors (${errors.length}) · partial data returned` : `GraphQL errors (${errors.length})`;
    const list = document.createElement('ul');
    errors.forEach(er => {
      const li = document.createElement('li');
      li.textContent = er.message;
      const where = [];
      if (Array.isArray(er.path)) where.push('at ' + er.path.join('.'));
      if (Array.isArray(er.locations) && er.locations[0]) where.push(`line ${er.locations[0].line}, col ${er.locations[0].column}`);
      if (where.length) { const sm = document.createElement('span'); sm.className = 'muted'; sm.textContent = '  ' + where.join(' · '); li.appendChild(sm); }
      list.appendChild(li);
    });
    box.replaceChildren(head, list);
    box.classList.remove('hidden');
  }

  // ---------- messages from extension ----------
  window.addEventListener('message', e => {
    const m = e.data;
    switch (m.type) {
      case 'load':
        load(m.request);
        setSavedIn(m.collectionName);
        break;
      case 'envs': {
        const sel = $('env');
        sel.replaceChildren();
        const none = document.createElement('option');
        none.value = ''; none.textContent = 'No environment';
        sel.appendChild(none);
        m.envs.forEach(env => {
          const o = document.createElement('option');
          o.value = env.id; o.textContent = env.name;
          sel.appendChild(o);
        });
        sel.value = m.activeEnvId;
        // the endpoint may use {{env}} values, so its saved schema may differ
        if (req && req.bodyType === 'graphql') requestCachedSchema();
        break;
      }
      case 'schema': applySchemaRecord(m.schema); break;
      case 'schemaError': showSchemaError(m.error); break;
      case 'sending': showSending(); break;
      case 'response': showResponse(m.response); break;
      case 'renamed':
        $('name').value = m.name;
        req.name = m.name;
        break;
      case 'saved':
        setSavedIn(m.collectionName);
        $('name').value = m.name;
        flash('Saved ✓');
        break;
    }
  });

  function setSavedIn(name) {
    const text = name ? `in ${name}` : 'unsaved';
    $('savedIn').dataset.base = text;
    $('savedIn').textContent = text;
  }

  vscode.postMessage({ type: 'ready' });
})();
