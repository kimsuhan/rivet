import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, rivetFetch, setCsrfToken } from './fetcher';

afterEach(() => {
  setCsrfToken(null);
  vi.unstubAllGlobals();
});

describe('rivetFetch', () => {
  it('sends credentials and the current CSRF token for a mutation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    setCsrfToken('csrf-token');

    await rivetFetch('/api/v1/example', { method: 'POST' });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.credentials).toBe('include');
    expect(new Headers(request.headers).get('X-CSRF-Token')).toBe('csrf-token');
  });

  it('throws the structured API error without exposing response internals', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 'FORBIDDEN' }), {
          headers: {
            'Content-Type': 'application/json',
            'X-Request-ID': 'req_test',
          },
          status: 403,
        }),
      ),
    );

    await expect(rivetFetch('/api/v1/example', { method: 'GET' })).rejects.toEqual(
      new ApiError(403, { code: 'FORBIDDEN' }, 'req_test'),
    );
  });

  it('preserves a positive Retry-After delta in seconds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 'RATE_LIMITED' }), {
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '12',
            'X-Request-ID': 'req_limited',
          },
          status: 429,
        }),
      ),
    );

    await expect(rivetFetch('/api/v1/example', { method: 'POST' })).rejects.toEqual(
      new ApiError(429, { code: 'RATE_LIMITED' }, 'req_limited', 12),
    );
  });

  it.each(['0', '-1', '1.5', 'tomorrow'])(
    'ignores an invalid Retry-After value: %s',
    async (value) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ code: 'RATE_LIMITED' }), {
            headers: { 'Content-Type': 'application/json', 'Retry-After': value },
            status: 429,
          }),
        ),
      );

      await expect(rivetFetch('/api/v1/example', { method: 'POST' })).rejects.toMatchObject({
        retryAfterSeconds: null,
      });
    },
  );
});
