// Extension-side test of schema download, cache, forget and refusal, with a stand-in for the VS Code API.
const Module = require('module');
const fs = require('fs'); const os = require('os'); const path = require('path'); const http = require('http');
const assert = require('assert/strict');
const { buildSchema, graphql, getIntrospectionQuery, NoSchemaIntrospectionCustomRule, validate, parse, execute } = require('graphql');

const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'emreq-'));
const posted = []; let onMsg;
class EE { constructor() { this.l = []; } get event() { return f => { this.l.push(f); return { dispose() {} }; }; } fire(x) { this.l.forEach(f => f(x)); } }
const Uri = { joinPath: (u, ...p) => ({ fsPath: path.join(u.fsPath, ...p), path: path.join(u.fsPath, ...p) }), file: p => ({ fsPath: p, path: p }) };
let openDialogResult;
const vscode = {
  EventEmitter: EE, Uri, ViewColumn: { Active: 1, Beside: 2 },
  workspace: {
    getConfiguration: () => ({ get: (k, d) => d }),
    fs: {
      createDirectory: async u => fs.mkdirSync(u.fsPath, { recursive: true }),
      writeFile: async (u, b) => fs.writeFileSync(u.fsPath, b),
      readFile: async u => fs.readFileSync(u.fsPath),
      delete: async u => fs.unlinkSync(u.fsPath),
    },
  },
  window: {
    createWebviewPanel: () => ({
      webview: { html: '', cspSource: 'vscode-resource:', asWebviewUri: u => u.fsPath, postMessage: m => { posted.push(m); return Promise.resolve(true); }, onDidReceiveMessage: f => { onMsg = f; } },
      onDidDispose: () => {}, reveal() {}, title: '',
    }),
    showOpenDialog: async () => openDialogResult,
  },
};
const orig = Module._load; Module._load = function (r, ...a) { return r === 'vscode' ? vscode : orig.call(this, r, ...a); };
const { RequestPanel } = require('../out/views/requestPanel');
const { Store } = require('../out/storage');
const { blankRequest } = require('../out/types');

const schema = buildSchema('type Query { hello: String  country(code: ID!): String }');
(async () => {
  let introspectionAllowed = true;
  const api = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => raw += c);
    req.on('end', async () => {
      const p = JSON.parse(raw);
      if (req.headers.authorization !== 'Bearer t0k') { res.writeHead(401); res.end('{}'); return; }
      const doc = parse(p.query);
      const errs = validate(schema, doc, introspectionAllowed ? undefined : [NoSchemaIntrospectionCustomRule]);
      const out = errs.length ? { errors: errs.map(e => ({ message: e.message })) } : await execute({ schema, document: doc, rootValue: { hello: () => 'hi' } });
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out));
    });
  });
  await new Promise(r => api.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${api.address().port}/graphql`;

  const mem = new Map();
  const store = new Store({ get: (k, d) => mem.has(k) ? mem.get(k) : d, update: async (k, v) => mem.set(k, v) });
  await store.saveEnvironment({ id: 'e', name: 'Local', variables: [{ key: 'gql', value: url, enabled: true }, { key: 'tok', value: 't0k', enabled: true }] });
  await store.setActiveEnvironment('e');
  const ctx = { extensionUri: Uri.file('/ext'), globalStorageUri: Uri.file(storage) };
  RequestPanel.open(ctx, store, blankRequest({ id: 'r1' }));
  const req = blankRequest({ id: 'r1', method: 'POST', url: '{{gql}}?x=1', bodyType: 'graphql', graphql: { query: '{ hello }', variables: '' }, auth: { type: 'bearer', token: '{{tok}}' } });
  const last = () => posted.at(-1);

  await onMsg({ type: 'getCachedSchema', request: req });
  assert.equal(last().type, 'schema'); assert.equal(last().schema, null);
  console.log('✓ nothing cached at first');

  await onMsg({ type: 'fetchSchema', request: req, introspectionQuery: getIntrospectionQuery() });
  assert.equal(last().type, 'schema', JSON.stringify(last()));
  assert.equal(last().schema.endpoint, url);
  assert.ok(JSON.parse(last().schema.text).data.__schema);
  console.log('✓ schema fetched with the request\'s own auth + env values; cache key drops the query string:', last().schema.endpoint);

  await onMsg({ type: 'getCachedSchema', request: { ...req, url: url } });
  assert.equal(last().schema.source, 'endpoint');
  assert.equal(fs.readdirSync(path.join(storage, 'graphql-schemas')).length, 1);
  console.log('✓ cached schema comes back for the same endpoint');

  await onMsg({ type: 'fetchSchema', request: { ...req, auth: { type: 'none' } }, introspectionQuery: getIntrospectionQuery() });
  assert.equal(last().type, 'schemaError'); assert.match(last().error, /401/);
  console.log('✓ missing auth → clear message:', last().error);

  introspectionAllowed = false;
  await onMsg({ type: 'fetchSchema', request: req, introspectionQuery: getIntrospectionQuery() });
  assert.equal(last().type, 'schemaError'); assert.match(last().error, /refused the schema request/); assert.match(last().error, /Load file/);
  console.log('✓ introspection switched off → clear message:', last().error.slice(0, 90) + '…');

  const sdl = path.join(storage, 'my.graphql'); fs.writeFileSync(sdl, 'type Query { fromFile: Int }');
  openDialogResult = [Uri.file(sdl)];
  await onMsg({ type: 'loadSchemaFile', request: req });
  assert.equal(last().schema.source, 'file'); assert.equal(last().schema.name, 'my.graphql'); assert.match(last().schema.text, /fromFile/);
  await onMsg({ type: 'getCachedSchema', request: req });
  assert.equal(last().schema.name, 'my.graphql');
  console.log('✓ schema file loads and replaces the cached one for this endpoint');

  await onMsg({ type: 'clearSchema', request: req });
  await onMsg({ type: 'getCachedSchema', request: req });
  assert.equal(last().schema, null);
  console.log('✓ Forget removes the cached schema');

  await onMsg({ type: 'send', request: req });
  const resp = posted.find(m => m.type === 'response');
  assert.deepEqual(JSON.parse(resp.response.body), { data: { hello: 'hi' } });
  assert.equal(store.getHistory()[0].request.bodyType, 'graphql');
  assert.equal(store.getHistory()[0].request.graphql.query, '{ hello }');
  console.log('✓ Send works and History keeps the GraphQL query');

  api.close(); fs.rmSync(storage, { recursive: true });
  console.log('ALL HOST CHECKS PASSED');
})().catch(e => { console.error('✗', e); process.exit(1); });
