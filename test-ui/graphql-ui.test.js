// Browser test of the GraphQL request tab with the real webview CSP.
// The page talks to a small stand-in for the extension host that uses the real
// request engine (out/core) and a local GraphQL server.
// Run: npm run compile && node test-ui/graphql-ui.test.js   (needs Playwright + Chromium installed)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const assert = require('assert/strict');
const { buildSchema, graphql } = require('graphql');
const { sendRequest } = require('../out/core/http');
const { resolveRequest } = require('../out/core/variables');
const { blankRequest } = require('../out/types');

let playwright;
try { playwright = require('playwright'); } catch { playwright = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }

const root = path.join(__dirname, '..');
const panelSrc = fs.readFileSync(path.join(root, 'src/views/requestPanel.ts'), 'utf8');
const BODY = panelSrc.match(/const REQUEST_BODY = \/\* html \*\/ `([\s\S]*?)`;/)[1];

const schema = buildSchema(`
  "A country"
  type Country { code: ID!  name: String!  capital: String  continent: Continent! }
  type Continent { code: ID!  name: String! }
  type Query {
    "Look up one country by its code"
    country(code: ID!): Country
    countries: [Country!]!
    boom: String
  }`);
const data = [{ code: 'IN', name: 'India', capital: 'New Delhi', continent: { code: 'AS', name: 'Asia' } },
              { code: 'GB', name: 'United Kingdom', capital: 'London', continent: { code: 'EU', name: 'Europe' } }];
const rootValue = { country: ({ code }) => data.find(c => c.code === code) || null, countries: () => data, boom: () => { throw new Error('Something broke'); } };

const opts = { timeoutMs: 5000, followRedirects: true, rejectUnauthorized: true };

(async () => {
  // GraphQL API
  const api = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => raw += c);
    req.on('end', async () => {
      const p = JSON.parse(raw || '{}');
      const r = await graphql({ schema, source: p.query, rootValue, variableValues: p.variables, operationName: p.operationName });
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r));
    });
  });
  await new Promise(r => api.listen(0, '127.0.0.1', r));
  const apiUrl = `http://127.0.0.1:${api.address().port}/graphql`;

  // Static server for the webview page + media, with the same CSP shape as pageHtml()
  const nonce = 'TESTNONCE123';
  let origin = '';
  const web = http.createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${origin} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${origin}/media/style.css"></head>
<body data-nonce="${nonce}" data-graphql-editor="${origin}/media/graphql-editor.js">${BODY}
<script nonce="${nonce}">window.acquireVsCodeApi = () => ({ postMessage: m => window.__toHost(m) });</script>
<script nonce="${nonce}" src="${origin}/media/kv.js"></script>
<script nonce="${nonce}" src="${origin}/media/request.js"></script></body></html>`);
      return;
    }
    const f = path.join(root, decodeURIComponent(req.url));
    if (!f.startsWith(path.join(root, 'media')) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : 'text/javascript' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => web.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${web.address().port}`;

  const browser = await playwright.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const problems = [];
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });

  const sent = [];
  const post = m => page.evaluate(x => window.postMessage(x, '*'), m);
  const env = { gql: apiUrl };
  await page.exposeFunction('__toHost', async m => {
    switch (m.type) {
      case 'ready':
        await post({ type: 'load', request: blankRequest({ id: 'r1', name: 'Countries', url: '{{gql}}' }), collectionName: 'Demo' });
        await post({ type: 'envs', envs: [{ id: 'e1', name: 'Local' }], activeEnvId: 'e1' });
        break;
      case 'getCachedSchema': await post({ type: 'schema', schema: null }); break;
      case 'fetchSchema': {
        const probe = resolveRequest({ ...m.request, method: 'POST', bodyType: 'graphql', graphql: { query: m.introspectionQuery, variables: '' } }, env);
        const r = await sendRequest(probe, opts);
        await post({ type: 'schema', schema: { endpoint: apiUrl, savedAt: Date.now(), source: 'endpoint', text: r.body } });
        break;
      }
      case 'send': {
        sent.push(m.request);
        await post({ type: 'sending' });
        const r = await sendRequest(resolveRequest(m.request, env), opts);
        await post({ type: 'response', response: r });
        break;
      }
    }
  });
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });

  await page.goto(origin + '/');
  await page.waitForFunction(() => document.getElementById('url').value.length > 0);

  const step = (n) => console.log('✓ ' + n);
  const editorText = () => page.evaluate(() => document.querySelector('.cm-content').innerText);
  const setQuery = async (q) => {
    await page.click('.cm-content');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Delete');
    await page.evaluate(q => { const v = document.querySelector('.cm-content').cmView?.view; }, q);
    await page.keyboard.insertText(q);
  };

  // 1. pick GraphQL
  await page.click('button[data-tab="body"]');
  await page.check('input[value="graphql"]');
  await page.waitForSelector('.cm-editor');
  assert.equal(await page.inputValue('#method'), 'POST');
  assert.ok(await page.isVisible('#schemaTabBtn'));
  assert.match(await page.textContent('#schemaStatus'), /No schema/);
  step('GraphQL body type loads the editor and switches to POST');

  // 2. fetch schema
  await page.click('#gqlFetchSchema');
  await page.waitForFunction(() => /Schema from endpoint/.test(document.getElementById('schemaStatus').textContent));
  step('Fetch schema: ' + await page.textContent('#schemaStatus'));

  // 3. autocomplete
  await setQuery('query {\n  coun');
  await page.waitForSelector('.cm-tooltip-autocomplete', { timeout: 4000 });
  const sugg = await page.textContent('.cm-tooltip-autocomplete');
  assert.match(sugg, /country/); assert.match(sugg, /countries/);
  step('Autocomplete suggests: ' + sugg.replace(/\s+/g, ' ').slice(0, 80));
  await page.keyboard.press('Escape');

  // 4. lint underline for an unknown field
  await setQuery('{ nope }');
  await page.waitForSelector('.cm-lintRange-error', { timeout: 4000 });
  step('Unknown field is underlined');

  // 5. format
  await setQuery('query{country(code:"IN"){name capital}}');
  await page.click('#gqlFormat');
  const formatted = await editorText();
  assert.match(formatted, /^\{\n\s+country\(code: "IN"\) \{\n\s+name\n\s+capital/);
  step('Format tidies the query');

  // 6. two operations + variables + send
  await setQuery('query A { countries { code } }\nquery B($c: ID!) { country(code: $c) { name continent { name } } }');
  await page.waitForFunction(() => !document.getElementById('opWrap').classList.contains('hidden'));
  assert.deepEqual(await page.$$eval('#gqlOp option', o => o.map(x => x.value)), ['A', 'B']);
  await page.selectOption('#gqlOp', 'B');
  await page.fill('#gqlVars', '{ "c": "GB" }');
  await page.click('#send');
  await page.waitForFunction(() => /200/.test(document.getElementById('status').textContent));
  const resp = JSON.parse(await page.textContent('#respBody'));
  assert.deepEqual(resp, { data: { country: { name: 'United Kingdom', continent: { name: 'Europe' } } } });
  const last = sent.at(-1);
  assert.equal(last.bodyType, 'graphql'); assert.equal(last.graphql.operationName, 'B'); assert.equal(last.graphql.variables, '{ "c": "GB" }');
  assert.ok(await page.isHidden('#gqlErrors'));
  step('Operation picker + variables + Send: ' + JSON.stringify(resp));

  // 7. GraphQL errors on 200
  await setQuery('{ boom }');
  await page.click('#send');
  await page.waitForSelector('#gqlErrors:not(.hidden)');
  assert.match(await page.textContent('#gqlErrors'), /Something broke/);
  assert.match(await page.textContent('#status'), /200 OK · 1 GraphQL error/);
  step('Errors on 200 shown: ' + await page.textContent('#status'));
  await page.screenshot({ path: path.join(__dirname, 'shot-errors.png') });

  // 8. Ctrl/Cmd+Enter inside the editor sends exactly once
  const before = sent.length;
  await setQuery('{ countries { code } }');
  await page.click('.cm-content');
  await page.keyboard.press('ControlOrMeta+Enter');
  await page.waitForFunction(n => window.__sentCount === undefined || true, before);
  await page.waitForTimeout(600);
  assert.equal(sent.length, before + 1);
  assert.equal(await editorText(), '{ countries { code } }');
  step('Ctrl/Cmd+Enter in the editor sends once and adds no new line');

  // 9. schema explorer
  await page.click('#schemaTabBtn');
  await page.waitForSelector('.gx-fname');
  const fields = await page.$$eval('.gx-typebox .gx-fname', e => e.map(x => x.textContent));
  assert.deepEqual(fields, ['country', 'countries', 'boom']);
  assert.match(await page.textContent('.explorer'), /Look up one country by its code/);
  await page.screenshot({ path: path.join(__dirname, 'shot-explorer.png') });
  await page.click('.gx-type:has-text("Country")');
  assert.deepEqual(await page.$$eval('.gx-typebox .gx-fname', e => e.map(x => x.textContent)), ['code', 'name', 'capital', 'continent']);
  await page.click('.gx-back');
  await page.fill('.gx-search', 'capi');
  await page.waitForFunction(() => /capital/.test(document.querySelector('.explorer').textContent));
  step('Explorer lists fields, opens types, searches');
  await page.fill('.gx-search', '');
  // insert a field into an empty query
  await page.click('button[data-tab="body"]');
  await setQuery('');
  await page.click('#schemaTabBtn');
  await page.click('.gx-field:has(.gx-fname:text-is("countries")) .gx-add');
  assert.ok(await page.isVisible('.cm-editor'));
  assert.match(await editorText(), /countries \{/);
  step('"+" inserts the field into the query and returns to Body');

  // 10. switching away hides the Schema tab
  await page.check('input[value="json"]');
  assert.ok(await page.isHidden('#schemaTabBtn'));
  assert.ok(await page.isHidden('#gqlPane'));
  await page.check('input[value="graphql"]');
  assert.match(await editorText(), /countries/);
  step('Switching body type keeps the GraphQL query');

  const csp = await page.evaluate(() => window.__csp);
  assert.deepEqual(csp, [], 'CSP violations: ' + csp.join(', '));
  assert.deepEqual(problems, []);
  step('No CSP violations, no page errors');

  // dark-ish screenshot of the main view
  await page.click('button[data-tab="body"]');
  await setQuery('query B($c: ID!) {\n  country(code: $c) {\n    name\n    capital\n    continent { name }\n  }\n}');
  await page.click('#send');
  await page.waitForFunction(() => /200 OK$/.test(document.getElementById('status').textContent.trim()));
  await page.screenshot({ path: path.join(__dirname, 'shot-main.png') });

  await browser.close(); api.close(); web.close();
  console.log('ALL UI CHECKS PASSED');
})().catch(e => { console.error('✗ ' + (e.stack || e)); process.exit(1); });
