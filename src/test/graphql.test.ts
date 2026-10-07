import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'http';
import { AddressInfo } from 'net';
import { buildSchema, graphql as runGraphql, getIntrospectionQuery, buildClientSchema, printSchema } from 'graphql';
import { prepareRequest, sendRequest, graphqlPayload } from '../core/http';
import { resolveRequest } from '../core/variables';
import { parseCurl } from '../core/curl';
import { blankRequest } from '../types';

const opts = { timeoutMs: 3000, followRedirects: true, rejectUnauthorized: true };

const gqlReq = (query: string, variables = '', extra: any = {}) =>
  blankRequest({ method: 'POST', url: 'http://api.test/graphql', bodyType: 'graphql', graphql: { query, variables, operationName: '' }, ...extra });

// ---------- request building ----------
test('POST sends {query, variables, operationName} as JSON', () => {
  const p = prepareRequest(gqlReq('query One($id: ID!) { user(id: $id) { name } }', '{"id": 7}', {
    graphql: { query: 'query One($id: ID!) { user(id: $id) { name } }', variables: '{"id": 7}', operationName: 'One' },
  }));
  assert.equal(p.method, 'POST');
  assert.equal(p.headers['Content-Type'], 'application/json');
  assert.match(p.headers['Accept'], /graphql-response\+json/);
  assert.deepEqual(JSON.parse(p.body!.toString()), { query: 'query One($id: ID!) { user(id: $id) { name } }', variables: { id: 7 }, operationName: 'One' });
});

test('empty variables are left out', () => {
  const p = prepareRequest(gqlReq('{ hello }', '   '));
  assert.deepEqual(JSON.parse(p.body!.toString()), { query: '{ hello }' });
});

test('GET puts query and variables in the URL, no body', () => {
  const p = prepareRequest(gqlReq('{ user(id: $id) { name } }', '{"id":1}', { method: 'GET' }));
  const u = new URL(p.url);
  assert.equal(p.body, undefined);
  assert.equal(u.searchParams.get('query'), '{ user(id: $id) { name } }');
  assert.equal(u.searchParams.get('variables'), '{"id":1}');
});

test('bad variables give a clear error', () => {
  assert.throws(() => graphqlPayload(gqlReq('{ a }', '{ id: 1 }')), /not valid JSON/);
  assert.throws(() => graphqlPayload(gqlReq('{ a }', '[1,2]')), /must be a JSON object/);
  assert.throws(() => graphqlPayload(gqlReq('   ')), /query is empty/);
});

test('user Content-Type header still wins', () => {
  const p = prepareRequest(gqlReq('{ a }', '', { headers: [{ key: 'content-type', value: 'application/graphql+json', enabled: true }] }));
  assert.equal(p.headers['content-type'], 'application/graphql+json');
  assert.equal(p.headers['Content-Type'], undefined);
});

test('env variables are filled inside query and variables', () => {
  const r = resolveRequest(gqlReq('{ user(id: "{{uid}}") { name } }', '{"token": "{{token}}"}'), { uid: '42', token: 'abc' });
  assert.equal(r.graphql!.query, '{ user(id: "42") { name } }');
  assert.equal(r.graphql!.variables, '{"token": "abc"}');
});

test('old saved requests without graphql field still work', () => {
  const r = resolveRequest(blankRequest({ url: 'http://a' }), {});
  assert.equal(r.graphql, undefined);
  assert.doesNotThrow(() => prepareRequest(r));
});

// ---------- cURL ----------
test('cURL with a GraphQL JSON body opens as GraphQL', () => {
  const r = parseCurl(`curl 'https://api.test/graphql' -H 'content-type: application/json' --data-raw '{"query":"query Q($c: ID!) { country(code: $c) { name } }","variables":{"c":"IN"},"operationName":"Q"}'`);
  assert.equal(r.method, 'POST');
  assert.equal(r.bodyType, 'graphql');
  assert.equal(r.graphql!.query, 'query Q($c: ID!) { country(code: $c) { name } }');
  assert.deepEqual(JSON.parse(r.graphql!.variables), { c: 'IN' });
  assert.equal(r.graphql!.operationName, 'Q');
  assert.equal(r.headers.length, 0);
});

test('a normal JSON body with other keys stays JSON', () => {
  const r = parseCurl(`curl https://x.io -H 'Content-Type: application/json' -d '{"query":"shoes","page":2}'`);
  assert.equal(r.bodyType, 'json');
});

test('cURL GraphQL over GET is recognised', () => {
  const r = parseCurl(`curl 'https://api.test/graphql?query=%7B%20hello%20%7D&variables=%7B%22a%22%3A1%7D&foo=bar'`);
  assert.equal(r.bodyType, 'graphql');
  assert.equal(r.graphql!.query, '{ hello }');
  assert.deepEqual(JSON.parse(r.graphql!.variables), { a: 1 });
  assert.deepEqual(r.params.map(p => p.key), ['foo']);
});

test('copy-as-cURL output parses back to the same GraphQL request', () => {
  const original = gqlReq('query Q { a }', '{"x":1}');
  const p = prepareRequest(original);
  const curl = `curl -X ${p.method} '${p.url}' -H 'Content-Type: application/json' --data-raw '${p.body!.toString()}'`;
  const back = parseCurl(curl);
  assert.equal(back.bodyType, 'graphql');
  assert.equal(back.graphql!.query, 'query Q { a }');
  assert.deepEqual(JSON.parse(back.graphql!.variables), { x: 1 });
});

// ---------- real round trip against a local GraphQL server ----------
const schema = buildSchema(`
  "A country"
  type Country { code: ID!  name: String!  capital: String }
  type Query {
    "Look up one country by its code"
    country(code: ID!): Country
    countries: [Country!]!
    boom: String
  }
`);
const countries = [{ code: 'IN', name: 'India', capital: 'New Delhi' }, { code: 'GB', name: 'United Kingdom', capital: 'London' }];
const root = {
  country: ({ code }: { code: string }) => countries.find(c => c.code === code) ?? null,
  countries: () => countries,
  boom: () => { throw new Error('Something broke'); },
};

test('send GraphQL to a local server: data, errors on 200, GET, introspection', async () => {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => raw += c);
    req.on('end', async () => {
      let p: any;
      if (req.method === 'GET') {
        const u = new URL(req.url!, 'http://x');
        p = { query: u.searchParams.get('query'), variables: JSON.parse(u.searchParams.get('variables') || 'null'), operationName: u.searchParams.get('operationName') };
      } else { p = JSON.parse(raw); }
      const result = await runGraphql({ schema, source: p.query, rootValue: root, variableValues: p.variables, operationName: p.operationName });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/graphql`;
  try {
    // 1. query with variables + env var in URL
    const req = resolveRequest(blankRequest({
      method: 'POST', url: '{{gql}}', bodyType: 'graphql',
      graphql: { query: 'query One($c: ID!) { country(code: $c) { name capital } }', variables: '{"c": "{{code}}"}' },
    }), { gql: url, code: 'IN' });
    const r1 = await sendRequest(req, opts);
    assert.equal(r1.status, 200);
    assert.deepEqual(JSON.parse(r1.body), { data: { country: { name: 'India', capital: 'New Delhi' } } });

    // 2. errors arrive with HTTP 200
    const r2 = await sendRequest(blankRequest({ method: 'POST', url, bodyType: 'graphql', graphql: { query: '{ boom }', variables: '' } }), opts);
    assert.equal(r2.status, 200);
    const b2 = JSON.parse(r2.body);
    assert.equal(b2.errors[0].message, 'Something broke');

    // 3. two operations, pick one by name
    const two = 'query A { countries { code } } query B { country(code: "GB") { name } }';
    const r3 = await sendRequest(blankRequest({ method: 'POST', url, bodyType: 'graphql', graphql: { query: two, variables: '', operationName: 'B' } }), opts);
    assert.deepEqual(JSON.parse(r3.body).data, { country: { name: 'United Kingdom' } });

    // 4. GET
    const r4 = await sendRequest(blankRequest({ method: 'GET', url, bodyType: 'graphql', graphql: { query: 'query($c: ID!) { country(code: $c) { code } }', variables: '{"c":"GB"}' } }), opts);
    assert.deepEqual(JSON.parse(r4.body).data, { country: { code: 'GB' } });

    // 5. schema download (introspection) through the normal request path, then rebuilt like the editor does
    const r5 = await sendRequest(blankRequest({ method: 'POST', url, bodyType: 'graphql', graphql: { query: getIntrospectionQuery(), variables: '' } }), opts);
    const client = buildClientSchema(JSON.parse(r5.body).data);
    assert.match(printSchema(client), /country\(code: ID!\): Country/);
    assert.equal(client.getQueryType()!.getFields().country.description, 'Look up one country by its code');
  } finally {
    server.close();
  }
});
