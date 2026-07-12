import type { Response } from 'express';

import {
  clearSessionCookie,
  getSessionCookiePolicy,
  readSessionCookie,
  setSessionCookie,
} from './session-cookie';

describe('session cookie', () => {
  it('uses a secure __Host cookie for HTTPS and a local cookie only for HTTP', () => {
    expect(
      getSessionCookiePolicy({ environment: 'production', webOrigin: 'https://rivet.example.com' }),
    ).toEqual({ name: '__Host-rivet_session', secure: true });
    expect(
      getSessionCookiePolicy({ environment: 'development', webOrigin: 'http://localhost:3000' }),
    ).toEqual({ name: 'rivet_session', secure: false });
  });

  it('reads only the configured session cookie', () => {
    const request = {
      headers: { cookie: 'theme=dark; rivet_session=session-token; ignored=value' },
    };

    expect(
      readSessionCookie(request, {
        environment: 'development',
        webOrigin: 'http://localhost:3000',
      }),
    ).toBe('session-token');
    expect(
      readSessionCookie(request, {
        environment: 'production',
        webOrigin: 'https://rivet.example.com',
      }),
    ).toBeNull();
  });

  it.each([
    {
      config: { environment: 'production' as const, webOrigin: 'https://rivet.example.com' },
      name: '__Host-rivet_session',
      secure: true,
    },
    {
      config: { environment: 'development' as const, webOrigin: 'http://localhost:3000' },
      name: 'rivet_session',
      secure: false,
    },
  ])('sets and clears the $name cookie with matching attributes', ({ config, name, secure }) => {
    const response = {
      clearCookie: jest.fn(),
      cookie: jest.fn(),
    } as unknown as Response;
    const expires = new Date('2026-08-10T00:00:00.000Z');

    setSessionCookie(response, config, 'session-token', expires);
    clearSessionCookie(response, config);

    expect(response.cookie).toHaveBeenCalledWith(name, 'session-token', {
      expires,
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure,
    });
    expect(response.clearCookie).toHaveBeenCalledWith(name, {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure,
    });
  });
});
