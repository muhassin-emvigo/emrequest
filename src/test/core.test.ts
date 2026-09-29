import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'http';
import { AddressInfo } from 'net';
import { parseCurl, tokenize } from '../core/curl';
import { resolveRequest, substitute } from '../core/variables';
import { prepareRequest, sendRequest } from '../core/http';
import { blankRequest } from '../types';

const opts = { timeoutMs: 3000, followRedirects: true, rejectUnauthorized: true };

// ---------- variables ----------
test('substitute replaces known vars and keeps unknown', () => {
  assert.equal(substitute('{{baseUrl}}/u/{{ id }}?x={{missing}}', { baseUrl: 'http://a', id: '7' }), 'http://a/u/7?x={{missing}}');
});

test('resolveRequest resolves url, headers, body and auth', () => {
  const r = resolveRequest(blankRequest({
    url: '{{host}}/x', headers: [{ key: 'X-T', value: '{{t}}', enabled: true }], body: '{"a":"{{t}}"}',
    auth: { type: 'bearer', token: '{{t}}' },
  }), { host: 'http://h', t: 'abc' });
  assert.equal(r.url, 'http://h/x');
  assert.equal(r.headers[0].value, 'abc');
  assert.equal(r.body, '{"a":"abc"}');
  assert.equal(r.auth.token, 'abc');
});

// ---------- curl ----------
test('tokenize handles quotes and line continuations', () => {
  assert.deepEqual(tokenize(`curl -H "A: b c" \\\n  'it''s' $'x\\ny'`), ['curl', '-H', 'A: b c', 'its', 'x\ny']);
});

test('parseCurl: POST JSON with headers and bearer', () => {
  const r = parseCurl(`curl -X POST 'https://api.test.com/users?page=2&q=a%20b' -H 'Content-Type: application/json' -H 'Authorization: Bearer tok123' -H 'X-Trace: 1' --data-raw '{"name":"Ada"}'`);
  assert.equal(r.method, 'POST');
  assert.equal(r.url, 'https://api.test.com/users');
  assert.deepEqual(r.params.map(p => [p.key, p.value]), [['page', '2'], ['q', 'a b']]);
  assert.equal(r.bodyType, 'json');
  assert.deepEqual(JSON.parse(r.body), { name: 'Ada' });
  assert.equal(r.auth.type, 'bearer');
  assert.equal(r.auth.token, 'tok123');
  assert.deepEqual(r.headers.map(h => h.key), ['X-Trace']);
});

test('parseCurl: -d implies POST form, -u basic auth, glued -XPUT', () => {
  const a = parseCurl(`curl https://x.io/login -d user=ada -d pass=secret -u admin:pw`);
  assert.equal(a.method, 'POST');
  assert.equal(a.bodyType, 'form');
  assert.deepEqual(a.formBody.map(f => [f.key, f.value]), [['user', 'ada'], ['pass', 'secret']]);
  assert.deepEqual([a.auth.type, a.auth.username, a.auth.password], ['basic', 'admin', 'pw']);
  const b = parseCurl(`curl -XPUT --url=https://x.io/a -L -k --compressed`);
  assert.equal(b.method, 'PUT');
  assert.equal(b.url, 'https://x.io/a');
});

test('parseCurl: Chrome "Copy as cURL (bash)" style', () => {
  const r = parseCurl(`curl 'https://site.com/api/v1/items' \\
  -H 'accept: application/json' \\
  -H 'cookie: sid=abc' \\
  --data-raw $'{"a":"it\\'s"}'`);
  assert.equal(r.method, 'POST');
  assert.equal(r.bodyType, 'json');
  assert.deepEqual(JSON.parse(r.body), { a: "it's" });
  assert.ok(r.headers.some(h => h.key === 'cookie' && h.value === 'sid=abc'));
});

test('parseCurl throws without URL', () => {
  assert.throws(() => parseCurl('curl -X GET'), /No URL/);
});

// ---------- prepare ----------
test('prepareRequest: params, api key in query, user header overrides default', () => {
  const p = prepareRequest(blankRequest({
    method: 'POST', url: 'example.com/a',
    params: [{ key: 'q', value: 'x y', enabled: true }, { key: 'off', value: '1', enabled: false }],
    headers: [{ key: 'content-type', value: 'application/vnd.api+json', enabled: true }],
    bodyType: 'json', body: '{}',
    auth: { type: 'apikey', apiKeyName: 'key', apiKeyValue: 'K1', apiKeyIn: 'query' },
  }));
  assert.equal(p.url, 'http://example.com/a?q=x+y&key=K1');
  assert.equal(p.headers['content-type'], 'application/vnd.api+json');
  assert.equal(p.headers['Content-Type'], undefined);
  assert.equal(p.headers['Content-Length'], '2');
});

test('prepareRequest: GET never sends a body', () => {
  const p = prepareRequest(blankRequest({ method: 'GET', url: 'http://a', bodyType: 'json', body: '{"x":1}' }));
  assert.equal(p.body, undefined);
});

// ---------- real HTTP round-trip ----------
test('sendRequest against a local server (echo, redirect, timeout, connection error)', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/echo?from=redirect' }); res.end(); return; }
    if (req.url === '/slow') { setTimeout(() => res.end('late'), 2000); return; }
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      res.writeHead(201, { 'Content-Type': 'application/json', 'X-Custom': 'yes' });
      res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body }));
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    // 1. POST with vars, basic auth, json body
    const req = resolveRequest(blankRequest({
      method: 'POST', url: '{{base}}/echo', params: [{ key: 'id', value: '{{id}}', enabled: true }],
      bodyType: 'json', body: '{"n":{{id}}}', auth: { type: 'basic', username: 'u', password: 'p' },
    }), { base, id: '42' });
    const res = await sendRequest(req, opts);
    assert.equal(res.status, 201);
    assert.equal(res.headers['x-custom'], 'yes');
    const echo = JSON.parse(res.body);
    assert.equal(echo.method, 'POST');
    assert.equal(echo.url, '/echo?id=42');
    assert.equal(echo.body, '{"n":42}');
    assert.equal(echo.headers['content-type'], 'application/json');
    assert.equal(echo.headers.authorization, 'Basic ' + Buffer.from('u:p').toString('base64'));
    assert.ok(res.sizeBytes > 0 && res.timeMs >= 0);

    // 2. redirect is followed
    const r2 = await sendRequest(blankRequest({ url: base + '/redirect' }), opts);
    assert.equal(r2.status, 201);
    assert.equal(JSON.parse(r2.body).url, '/echo?from=redirect');
    assert.ok(r2.finalUrl.endsWith('/echo?from=redirect'));

    // 3. redirect not followed when disabled
    const r3 = await sendRequest(blankRequest({ url: base + '/redirect' }), { ...opts, followRedirects: false });
    assert.equal(r3.status, 302);

    // 4. timeout
    const r4 = await sendRequest(blankRequest({ url: base + '/slow' }), { ...opts, timeoutMs: 300 });
    assert.equal(r4.status, 0);
    assert.match(r4.error!, /timed out/);

    // 5. cancel
    const ac = new AbortController();
    const p5 = sendRequest(blankRequest({ url: base + '/slow' }), { ...opts, signal: ac.signal });
    setTimeout(() => ac.abort(), 100);
    const r5 = await p5;
    assert.equal(r5.error, 'Request cancelled');
  } finally {
    server.close();
  }

  // 6. connection refused
  const r6 = await sendRequest(blankRequest({ url: 'http://127.0.0.1:1/' }), opts);
  assert.equal(r6.status, 0);
  assert.match(r6.error!, /ECONNREFUSED/);
});
