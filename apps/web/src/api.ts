export type ApiErrorCategory = 'network' | 'validation' | 'revision-conflict' | 'storage-unavailable' | 'release-mismatch' | 'access-denied' | 'not-found' | 'unexpected';

export class ApiError extends Error {
  readonly status: number;
  readonly kind: 'network' | 'response';
  readonly category: ApiErrorCategory;

  constructor(message: string, status: number, kind: 'network' | 'response', category: ApiErrorCategory = kind === 'network' ? 'network' : 'unexpected') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.kind = kind;
    this.category = category;
  }
}

interface ApiOptions extends RequestInit {
  retry?: 'never' | 'idempotent' | 'operation-id';
}

function category(status: number, message: string): ApiErrorCategory {
  if (status === 400 || status === 413 || status === 422) return 'validation';
  if (status === 403) return 'access-denied';
  if (status === 404) return 'not-found';
  if (status === 409 && /release|source|sales extract/i.test(message)) return 'release-mismatch';
  if (status === 409) return 'revision-conflict';
  if (status >= 500) return 'storage-unavailable';
  return 'unexpected';
}

export async function api<Value>(url: string, options?: ApiOptions): Promise<Value> {
  const { retry, ...request } = options ?? {};
  const method = (request.method ?? 'GET').toUpperCase();
  const mayRetry = retry === 'operation-id' || retry === 'idempotent' || (retry === undefined && ['GET', 'HEAD'].includes(method));
  let attempt = 0;
  let response: Response;
  for (;;) {
    try {
      response = await fetch(url, request);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      if (mayRetry && attempt++ === 0) continue;
      throw new ApiError('Unable to reach the local service. Check that Fieldwork is running.', 0, 'network');
    }
    if (!(mayRetry && attempt++ === 0 && response.status >= 500)) break;
  }

  const body = await response.text();
  if (!response.ok) {
    let message = 'The local service could not complete the request.';
    try {
      const failure = JSON.parse(body) as { error?: unknown; message?: unknown };
      if (typeof failure.error === 'string') message = failure.error;
      else if (typeof failure.message === 'string') message = failure.message;
    } catch {
      // Error responses from proxies or damaged services may not contain JSON.
    }
    throw new ApiError(message, response.status, 'response', category(response.status, message));
  }

  try {
    return JSON.parse(body) as Value;
  } catch {
    throw new ApiError('The local service returned an invalid response. Reload records and try again.', response.status, 'response', 'unexpected');
  }
}