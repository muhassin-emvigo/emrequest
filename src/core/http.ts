import * as http from 'http';
import * as https from 'https';
import { ApiRequest, ApiResponse } from '../types';

export interface SendOptions {
  timeoutMs: number;
  followRedirects: boolean;
  rejectUnauthorized: boolean;
  signal?: AbortSignal;
}

export interface PreparedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: Buffer;
}

/** Turn an ApiRequest (already variable-resolved) into the raw method / URL / headers / body. */
export function prepareRequest(req: ApiRequest): PreparedRequest {
  let raw = req.url.trim();
  if (!raw) { throw new Error('URL is empty'); }
  if (!/^https?:\/\//i.test(raw)) { raw = 'http://' + raw; }
  const url = new URL(raw);

  for (const p of req.params) {
    if (p.enabled && p.key) { url.searchParams.append(p.key, p.value); }
  }

  const headers: Record<string, string> = {};
  const setHeader = (k: string, v: string) => {
    // case-insensitive replace so user headers win over defaults
    for (const existing of Object.keys(headers)) {
      if (existing.toLowerCase() === k.toLowerCase()) { delete headers[existing]; }
    }
    headers[k] = v;
  };

  headers['User-Agent'] = 'emRequest/0.2';
  headers['Accept'] = '*/*';

  const auth = req.auth;
  if (auth.type === 'bearer' && auth.token) {
    setHeader('Authorization', `Bearer ${auth.token}`);
  } else if (auth.type === 'basic' && (auth.username || auth.password)) {
    const encoded = Buffer.from(`${auth.username ?? ''}:${auth.password ?? ''}`).toString('base64');
    setHeader('Authorization', `Basic ${encoded}`);
  } else if (auth.type === 'apikey' && auth.apiKeyName) {
    if (auth.apiKeyIn === 'query') {
      url.searchParams.append(auth.apiKeyName, auth.apiKeyValue ?? '');
    } else {
      setHeader(auth.apiKeyName, auth.apiKeyValue ?? '');
    }
  }

  let body: Buffer | undefined;
  const canHaveBody = !['GET', 'HEAD'].includes(req.method);
  if (req.bodyType === 'graphql') {
    const g = graphqlPayload(req);
    setHeader('Accept', 'application/graphql-response+json, application/json');
    if (canHaveBody) {
      body = Buffer.from(JSON.stringify(g), 'utf8');
      setHeader('Content-Type', 'application/json');
    } else {
      // GraphQL over GET: query, variables and operationName travel in the URL
      url.searchParams.set('query', g.query);
      if (g.variables !== undefined) { url.searchParams.set('variables', JSON.stringify(g.variables)); }
      if (g.operationName) { url.searchParams.set('operationName', g.operationName); }
    }
  } else if (canHaveBody) {
    switch (req.bodyType) {
      case 'json':
        body = Buffer.from(req.body, 'utf8');
        setHeader('Content-Type', 'application/json');
        break;
      case 'xml':
        body = Buffer.from(req.body, 'utf8');
        setHeader('Content-Type', 'application/xml');
        break;
      case 'text':
        body = Buffer.from(req.body, 'utf8');
        setHeader('Content-Type', 'text/plain');
        break;
      case 'form': {
        const form = new URLSearchParams();
        req.formBody.filter(f => f.enabled && f.key).forEach(f => form.append(f.key, f.value));
        body = Buffer.from(form.toString(), 'utf8');
        setHeader('Content-Type', 'application/x-www-form-urlencoded');
        break;
      }
    }
  }

  // user-defined headers override everything above
  for (const h of req.headers) {
    if (h.enabled && h.key) { setHeader(h.key, h.value); }
  }
  if (body) { setHeader('Content-Length', String(body.length)); }

  return { method: req.method, url: url.toString(), headers, body };
}

export interface GraphqlPayload {
  query: string;
  variables?: unknown;
  operationName?: string;
}

/** Build the standard GraphQL request object. Throws a readable error for bad variables JSON. */
export function graphqlPayload(req: ApiRequest): GraphqlPayload {
  const g = req.graphql ?? { query: '', variables: '' };
  if (!g.query.trim()) { throw new Error('GraphQL query is empty'); }
  const out: GraphqlPayload = { query: g.query };
  const vars = (g.variables ?? '').trim();
  if (vars) {
    try {
      out.variables = JSON.parse(vars);
    } catch (e: any) {
      throw new Error(`GraphQL variables are not valid JSON: ${e.message}`);
    }
    if (out.variables === null || typeof out.variables !== 'object' || Array.isArray(out.variables)) {
      throw new Error('GraphQL variables must be a JSON object, like { "id": 1 }');
    }
  }
  if (g.operationName?.trim()) { out.operationName = g.operationName.trim(); }
  return out;
}

function once(prep: PreparedRequest, opts: SendOptions): Promise<{ res: http.IncomingMessage; data: Buffer }> {
  return new Promise((resolve, reject) => {
    const u = new URL(prep.url);
    const lib = u.protocol === 'https:' ? https : http;
    const r = lib.request(u, {
      method: prep.method,
      headers: prep.headers,
      rejectUnauthorized: opts.rejectUnauthorized,
      signal: opts.signal,
    } as https.RequestOptions, res => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ res, data: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    r.setTimeout(opts.timeoutMs, () => r.destroy(new Error(`Request timed out after ${opts.timeoutMs} ms`)));
    r.on('error', reject);
    if (prep.body) { r.write(prep.body); }
    r.end();
  });
}

export async function sendRequest(req: ApiRequest, opts: SendOptions): Promise<ApiResponse> {
  const start = Date.now();
  let prep: PreparedRequest;
  try {
    prep = prepareRequest(req);
  } catch (e) {
    return errorResponse(e, start, req.url);
  }

  try {
    let hops = 0;
    for (;;) {
      const { res, data } = await once(prep, opts);
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (opts.followRedirects && location && [301, 302, 303, 307, 308].includes(status) && hops < 10) {
        hops++;
        const next = new URL(location, prep.url).toString();
        const keepBody = status === 307 || status === 308;
        const headers = { ...prep.headers };
        if (!keepBody) {
          delete headers['Content-Type']; delete headers['Content-Length'];
        }
        prep = {
          method: keepBody ? prep.method : (prep.method === 'HEAD' ? 'HEAD' : 'GET'),
          url: next,
          headers,
          body: keepBody ? prep.body : undefined,
        };
        continue;
      }
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers)) {
        if (v !== undefined) { headers[k] = Array.isArray(v) ? v.join(', ') : v; }
      }
      return {
        status,
        statusText: res.statusMessage ?? '',
        headers,
        body: data.toString('utf8'),
        timeMs: Date.now() - start,
        sizeBytes: data.length,
        finalUrl: prep.url,
      };
    }
  } catch (e) {
    return errorResponse(e, start, prep.url);
  }
}

function errorResponse(e: unknown, start: number, url: string): ApiResponse {
  const err = e as NodeJS.ErrnoException;
  const msg = err?.name === 'AbortError' ? 'Request cancelled' : (err?.code ? `${err.code}: ${err.message}` : String(err?.message ?? e));
  return { status: 0, statusText: 'Error', headers: {}, body: '', timeMs: Date.now() - start, sizeBytes: 0, finalUrl: url, error: msg };
}
