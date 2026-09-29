import { ApiRequest, Environment, KeyValue } from '../types';

/** Replace {{name}} with values from the variable map. Unknown names are left as-is. */
export function substitute(text: string, vars: Record<string, string>): string {
  if (!text) { return text; }
  return text.replace(/\{\{\s*([\w.\-]+)\s*\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : match
  );
}

export function envToMap(env?: Environment): Record<string, string> {
  const map: Record<string, string> = {};
  env?.variables.filter(v => v.enabled && v.key).forEach(v => { map[v.key] = v.value; });
  return map;
}

function subList(list: KeyValue[], vars: Record<string, string>): KeyValue[] {
  return list.map(kv => ({ ...kv, key: substitute(kv.key, vars), value: substitute(kv.value, vars) }));
}

/** Returns a copy of the request with every text field resolved against the variables. */
export function resolveRequest(req: ApiRequest, vars: Record<string, string>): ApiRequest {
  const a = req.auth;
  return {
    ...req,
    url: substitute(req.url, vars),
    params: subList(req.params, vars),
    headers: subList(req.headers, vars),
    body: substitute(req.body, vars),
    formBody: subList(req.formBody, vars),
    auth: {
      ...a,
      token: substitute(a.token ?? '', vars),
      username: substitute(a.username ?? '', vars),
      password: substitute(a.password ?? '', vars),
      apiKeyName: substitute(a.apiKeyName ?? '', vars),
      apiKeyValue: substitute(a.apiKeyValue ?? '', vars),
    },
  };
}
