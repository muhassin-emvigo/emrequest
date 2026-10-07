import { ApiRequest, AuthConfig, blankRequest, HttpMethod, KeyValue } from '../types';

/** Split a shell command into arguments, honouring '...', "...", $'...' and backslash escapes. */
export function tokenize(input: string): string[] {
  const s = input.replace(/\\\r?\n/g, ' ').replace(/\^\r?\n/g, ' '); // bash & Windows cmd line continuations
  const out: string[] = [];
  let cur = '';
  let inToken = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      if (inToken) { out.push(cur); cur = ''; inToken = false; }
      i++; continue;
    }
    inToken = true;
    if (c === "'") {
      const end = s.indexOf("'", i + 1);
      cur += s.slice(i + 1, end === -1 ? s.length : end);
      i = end === -1 ? s.length : end + 1;
    } else if (c === '$' && s[i + 1] === "'") {
      i += 2;
      while (i < s.length && s[i] !== "'") {
        if (s[i] === '\\' && i + 1 < s.length) {
          const n = s[i + 1];
          cur += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'r' ? '\r' : n;
          i += 2;
        } else { cur += s[i++]; }
      }
      i++;
    } else if (c === '"') {
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && i + 1 < s.length && '"\\$`'.includes(s[i + 1])) { cur += s[i + 1]; i += 2; }
        else { cur += s[i++]; }
      }
      i++;
    } else if (c === '\\' && i + 1 < s.length) {
      cur += s[i + 1]; i += 2;
    } else {
      cur += c; i++;
    }
  }
  if (inToken) { out.push(cur); }
  return out;
}

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/** Parse a cURL command into an ApiRequest. Throws if no URL is found. */
export function parseCurl(command: string): ApiRequest {
  const args = tokenize(command.trim());
  if (args[0]?.toLowerCase() === 'curl') { args.shift(); }

  let method: string | undefined;
  let url = '';
  const headers: KeyValue[] = [];
  const dataParts: string[] = [];
  const formParts: KeyValue[] = [];
  let auth: AuthConfig = { type: 'none' };
  let forceGet = false;

  const takesValue = new Set(['-X', '--request', '-H', '--header', '-d', '--data', '--data-raw', '--data-binary',
    '--data-ascii', '--data-urlencode', '--json', '-u', '--user', '--url', '-A', '--user-agent', '-b', '--cookie',
    '-e', '--referer', '-F', '--form', '--form-string', '-o', '--output', '-m', '--max-time', '--connect-timeout',
    '-x', '--proxy', '-w', '--write-out', '--cert', '--key', '--cacert', '-T', '--upload-file']);

  for (let i = 0; i < args.length; i++) {
    let a = args[i];
    let val: string | undefined;

    // --opt=value form
    const eq = a.startsWith('--') ? a.indexOf('=') : -1;
    if (eq > 0) { val = a.slice(eq + 1); a = a.slice(0, eq); }
    // -XPOST / -H'x: y' glued short options
    else if (/^-[XHdubAeF]./.test(a)) { val = a.slice(2); a = a.slice(0, 2); }

    if (takesValue.has(a) && val === undefined) { val = args[++i] ?? ''; }

    switch (a) {
      case '-X': case '--request': method = (val ?? '').toUpperCase(); break;
      case '-H': case '--header': {
        const idx = (val ?? '').indexOf(':');
        if (idx > 0) {
          const key = val!.slice(0, idx).trim();
          const value = val!.slice(idx + 1).trim();
          const bearer = /^bearer\s+(.+)$/i.exec(value);
          if (key.toLowerCase() === 'authorization' && bearer) {
            auth = { type: 'bearer', token: bearer[1] };
          } else {
            headers.push({ key, value, enabled: true });
          }
        }
        break;
      }
      case '-d': case '--data': case '--data-raw': case '--data-binary': case '--data-ascii':
        dataParts.push(val ?? ''); break;
      case '--data-urlencode': {
        const v = val ?? '';
        const e = v.indexOf('=');
        dataParts.push(e >= 0 ? `${v.slice(0, e)}=${encodeURIComponent(v.slice(e + 1))}` : encodeURIComponent(v));
        break;
      }
      case '--json':
        dataParts.push(val ?? '');
        if (!headers.some(h => h.key.toLowerCase() === 'content-type')) {
          headers.push({ key: 'Content-Type', value: 'application/json', enabled: true });
        }
        break;
      case '-F': case '--form': case '--form-string': {
        const v = val ?? '';
        const e = v.indexOf('=');
        if (e > 0) { formParts.push({ key: v.slice(0, e), value: v.slice(e + 1), enabled: true }); }
        break;
      }
      case '-u': case '--user': {
        const v = val ?? '';
        const c = v.indexOf(':');
        auth = { type: 'basic', username: c >= 0 ? v.slice(0, c) : v, password: c >= 0 ? v.slice(c + 1) : '' };
        break;
      }
      case '--url': url = val ?? ''; break;
      case '-A': case '--user-agent': headers.push({ key: 'User-Agent', value: val ?? '', enabled: true }); break;
      case '-b': case '--cookie': headers.push({ key: 'Cookie', value: val ?? '', enabled: true }); break;
      case '-e': case '--referer': headers.push({ key: 'Referer', value: val ?? '', enabled: true }); break;
      case '-G': case '--get': forceGet = true; break;
      case '-I': case '--head': method = 'HEAD'; break;
      default:
        if (!a.startsWith('-') && !url) { url = a; }
        // other flags (-L, -k, -s, -v, --compressed...) are ignored
    }
  }

  if (!url) { throw new Error('No URL found in the cURL command'); }

  const req = blankRequest();
  // Split query string into params so they are editable
  const qIdx = url.indexOf('?');
  if (qIdx >= 0) {
    const qs = new URLSearchParams(url.slice(qIdx + 1));
    qs.forEach((value, key) => req.params.push({ key, value, enabled: true }));
    url = url.slice(0, qIdx);
  }
  req.url = url;
  req.auth = auth;

  const body = dataParts.join('&');
  if (forceGet && body) {
    new URLSearchParams(body).forEach((value, key) => req.params.push({ key, value, enabled: true }));
  } else if (formParts.length) {
    req.bodyType = 'form';
    req.formBody = formParts;
  } else if (body) {
    const ctIdx = headers.findIndex(h => h.key.toLowerCase() === 'content-type');
    const ct = ctIdx >= 0 ? headers[ctIdx].value.toLowerCase() : '';
    const trimmed = body.trim();
    let parsed: any;
    try { parsed = JSON.parse(trimmed); } catch { parsed = undefined; }
    if ((ct.includes('json') || ct.includes('graphql') || !ct) && isGraphqlPayload(parsed)) {
      req.bodyType = 'graphql';
      req.graphql = {
        query: parsed.query,
        variables: parsed.variables && typeof parsed.variables === 'object' ? JSON.stringify(parsed.variables, null, 2) : '',
        operationName: typeof parsed.operationName === 'string' ? parsed.operationName : '',
      };
    } else if (ct.includes('json') || (!ct && /^[\[{]/.test(trimmed))) {
      req.bodyType = 'json';
      req.body = parsed !== undefined ? JSON.stringify(parsed, null, 2) : body;
    } else if (ct.includes('xml')) {
      req.bodyType = 'xml'; req.body = body;
    } else if (!ct || ct.includes('x-www-form-urlencoded')) {
      req.bodyType = 'form';
      new URLSearchParams(body).forEach((value, key) => req.formBody.push({ key, value, enabled: true }));
    } else {
      req.bodyType = 'text'; req.body = body;
    }
    // Content-Type is set automatically from the body type, avoid duplicates
    if (ctIdx >= 0 && req.bodyType !== 'text') { headers.splice(ctIdx, 1); }
  }
  req.headers = headers;

  const m = (method ?? (forceGet ? 'GET' : (body || formParts.length ? 'POST' : 'GET'))) as HttpMethod;
  req.method = METHODS.includes(m) ? m : 'GET';

  // GraphQL over GET: ?query={...}&variables={...}&operationName=X
  const qp = req.params.find(p => p.key === 'query');
  if (req.method === 'GET' && req.bodyType === 'none' && qp && /^\s*(\{|query\b|mutation\b)/.test(qp.value)) {
    const take = (k: string) => {
      const i = req.params.findIndex(p => p.key === k);
      return i >= 0 ? req.params.splice(i, 1)[0].value : '';
    };
    const query = take('query');
    let variables = take('variables');
    try { if (variables) { variables = JSON.stringify(JSON.parse(variables), null, 2); } } catch { /* keep as typed */ }
    req.bodyType = 'graphql';
    req.graphql = { query, variables, operationName: take('operationName') };
  }
  try { req.name = `${req.method} ${new URL(/^https?:/i.test(url) ? url : 'http://' + url).pathname}`; } catch { req.name = `${req.method} ${url}`; }
  return req;
}

function isGraphqlPayload(v: any): v is { query: string; variables?: unknown; operationName?: string } {
  return !!v && typeof v === 'object' && !Array.isArray(v) && typeof v.query === 'string'
    && Object.keys(v).every(k => ['query', 'variables', 'operationName', 'extensions'].includes(k));
}
