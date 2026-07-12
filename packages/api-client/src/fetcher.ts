const CSRF_STORAGE_KEY = 'rivet.csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export class ApiError<ErrorBody = unknown> extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorBody,
    readonly requestId: string | null,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(`API request failed with status ${status}`);
    this.name = ApiError.name;
  }
}

function parseRetryAfterSeconds(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }

  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : null;
}

export type ErrorType<ErrorBody> = ApiError<ErrorBody>;
export type BodyType<BodyData> = BodyData;

export function setCsrfToken(token: string | null): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (token) {
    window.sessionStorage.setItem(CSRF_STORAGE_KEY, token);
  } else {
    window.sessionStorage.removeItem(CSRF_STORAGE_KEY);
  }
}

function getCsrfToken(): string | null {
  return typeof window === 'undefined' ? null : window.sessionStorage.getItem(CSRF_STORAGE_KEY);
}

async function parseResponse(response: Response): Promise<unknown> {
  if ([204, 205, 304].includes(response.status) || !response.body) {
    return undefined;
  }

  return response.headers.get('content-type')?.includes('application/json')
    ? response.json()
    : response.blob();
}

export async function rivetFetch<T>(url: string, options: RequestInit): Promise<T> {
  const headers = new Headers(options.headers);
  const method = options.method?.toUpperCase() ?? 'GET';
  const csrfToken = getCsrfToken();

  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  if (!SAFE_METHODS.has(method) && csrfToken && !headers.has('X-CSRF-Token')) {
    headers.set('X-CSRF-Token', csrfToken);
  }

  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers,
  });
  const body = await parseResponse(response);

  if (!response.ok) {
    throw new ApiError(
      response.status,
      body,
      response.headers.get('X-Request-ID'),
      parseRetryAfterSeconds(response.headers.get('Retry-After')),
    );
  }

  return body as T;
}
