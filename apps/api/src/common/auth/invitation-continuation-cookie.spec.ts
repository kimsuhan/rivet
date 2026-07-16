import type { Response } from 'express';

import {
  clearInvitationContinuationCookie,
  readInvitationContinuationCookie,
  setInvitationContinuationCookie,
} from './invitation-continuation-cookie';

describe('invitation continuation cookie', () => {
  it('reads only the cookie selected by the web origin security policy', () => {
    const request = {
      headers: {
        cookie:
          'rivet_invite_flow=local-token; __Host-rivet_invite_flow=secure-token; theme=dark',
      },
    };

    expect(
      readInvitationContinuationCookie(request, {
        environment: 'development',
        webOrigin: 'http://localhost:3000',
      }),
    ).toBe('local-token');
    expect(
      readInvitationContinuationCookie(request, {
        environment: 'production',
        webOrigin: 'https://rivet.example.com',
      }),
    ).toBe('secure-token');
  });

  it.each([
    {
      config: { environment: 'production' as const, webOrigin: 'https://rivet.example.com' },
      name: '__Host-rivet_invite_flow',
      secure: true,
    },
    {
      config: { environment: 'development' as const, webOrigin: 'http://localhost:3000' },
      name: 'rivet_invite_flow',
      secure: false,
    },
  ])('sets and clears the $name cookie with matching attributes', ({ config, name, secure }) => {
    const response = {
      clearCookie: jest.fn(),
      cookie: jest.fn(),
    } as unknown as Response;
    const expires = new Date('2026-07-23T00:00:00.000Z');

    setInvitationContinuationCookie(response, config, 'continuation-token', expires);
    clearInvitationContinuationCookie(response, config);

    expect(response.cookie).toHaveBeenCalledWith(name, 'continuation-token', {
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
