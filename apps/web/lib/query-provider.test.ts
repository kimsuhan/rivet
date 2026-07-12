import { describe, expect, it } from 'vitest';

import { ApiError } from '@rivet/api-client';

import { getSessionRequiredRedirect } from './query-provider';

describe('getSessionRequiredRedirect', () => {
  it('preserves the current path and search for an expired session', () => {
    expect(
      getSessionRequiredRedirect(new ApiError(401, { code: 'SESSION_REQUIRED' }, 'req_session'), {
        pathname: '/projects/active',
        search: '?view=board&mine=true',
      }),
    ).toBe('/login?returnTo=%2Fprojects%2Factive%3Fview%3Dboard%26mine%3Dtrue');
  });

  it.each([
    new ApiError(401, { code: 'INVALID_CREDENTIALS' }, 'req_login'),
    new ApiError(403, { code: 'SESSION_REQUIRED' }, 'req_forbidden'),
    new ApiError(401, null, 'req_empty'),
    new Error('network failure'),
  ])('does not redirect a non-session error: %s', (error) => {
    expect(getSessionRequiredRedirect(error, { pathname: '/login', search: '' })).toBeNull();
  });

  it.each([
    [{ pathname: '//evil.example', search: '' }],
    [{ pathname: '/\\evil.example', search: '' }],
    [{ pathname: '/projects', search: 'redirect=evil' }],
  ])('drops an unsafe return path: %s', (location) => {
    expect(
      getSessionRequiredRedirect(
        new ApiError(401, { code: 'SESSION_REQUIRED' }, 'req_session'),
        location,
      ),
    ).toBe('/login');
  });
});
