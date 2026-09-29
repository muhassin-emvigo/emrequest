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
    $('bodyNote').classList.toggle('hidden', !['GET', 'HEAD'].includes($('method').value));
  }

  function showAuth() {
    const t = $('authType').value;
    ['bearer', 'basic', 'apikey'].forEach(x => $('auth-' + x).classList.toggle('hidden', x !== t));
  }

  function showBody() {
    const t = document.querySelector('input[name="bodyType"]:checked')?.value || 'none';
    $('body').classList.toggle('hidden', t === 'none' || t === 'form');
    $('formBody').classList.toggle('hidden', t !== 'form');
    $('format').classList.toggle('hidden', t !== 'json');
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
  });
  $('url').addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
  $('method').addEventListener('change', () => { setMethodColor(); changed(); });
  $('name').addEventListener('input', changed);
  $('authType').addEventListener('change', () => { showAuth(); changed(); });
  ['token', 'username', 'password', 'apiKeyName', 'apiKeyValue'].forEach(id => $(id).addEventListener('input', changed));
  $('apiKeyIn').addEventListener('change', changed);
  document.querySelectorAll('input[name="bodyType"]').forEach(r => r.addEventListener('change', () => {
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
        break;
      }
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
