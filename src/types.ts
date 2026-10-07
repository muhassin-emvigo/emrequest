export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface KeyValue {
  key: string;
  value: string;
  enabled: boolean;
}

export type BodyType = 'none' | 'json' | 'text' | 'form' | 'xml' | 'graphql';

/** GraphQL body. Sent as JSON on POST, or as URL parameters when the method is GET. */
export interface GraphqlBody {
  query: string;
  /** JSON text, so the user can type {{env}} variables and half-finished JSON without losing it */
  variables: string;
  operationName?: string;
}

export type AuthType = 'none' | 'bearer' | 'basic' | 'apikey';

export interface AuthConfig {
  type: AuthType;
  token?: string;
  username?: string;
  password?: string;
  apiKeyName?: string;
  apiKeyValue?: string;
  apiKeyIn?: 'header' | 'query';
}

export interface ApiRequest {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  bodyType: BodyType;
  body: string;
  formBody: KeyValue[];
  auth: AuthConfig;
  /** Only present for GraphQL requests; older saved requests simply don't have it */
  graphql?: GraphqlBody;
}

export interface ApiResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  timeMs: number;
  sizeBytes: number;
  finalUrl: string;
  error?: string;
}

export interface Collection {
  id: string;
  name: string;
  requests: ApiRequest[];
}

export interface HistoryItem {
  id: string;
  request: ApiRequest;
  status?: number;
  timeMs?: number;
  sentAt: number;
}

export interface Environment {
  id: string;
  name: string;
  variables: KeyValue[];
}

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function blankRequest(partial: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id: newId(),
    name: 'New Request',
    method: 'GET',
    url: '',
    params: [],
    headers: [],
    bodyType: 'none',
    body: '',
    formBody: [],
    auth: { type: 'none' },
    ...partial,
  };
}
