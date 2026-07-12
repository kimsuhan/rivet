import type { ConfigType } from '@nestjs/config';
import type { Request, Response } from 'express';

import { apiConfig } from '../../config/api.config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import type { AuthenticatedRequestContext } from './authenticated-request';

const config: ConfigType<typeof apiConfig> = {
  database: {
    connectionTimeoutMs: 5_000,
    idleTimeoutMs: 10_000,
    poolMax: 10,
    url: 'postgresql://localhost/rivet',
  },
  environment: 'test',
  fileStorageRoot: '/tmp/rivet-files',
  observability: { posthogApiKey: null, slackAlertWebhookUrl: null },
  port: 4_000,
  releaseId: 'test',
  security: {
    csrfHmacKey: 'csrf-key-that-is-at-least-32-bytes-long',
    oneTimeTokenHmacKey: 'token-key-that-is-at-least-32-bytes-long',
    rateLimitHmacKey: 'rate-key-that-is-at-least-32-bytes-long',
  },
  webOrigin: 'http://localhost:3000',
};

describe('AuthController', () => {
  const authenticatedResponse = {
    authenticated: true as const,
    csrfToken: 'csrf-token',
    membership: null,
    onboardingStep: 'CREATE_WORKSPACE' as const,
    user: {
      avatarFileId: null,
      displayName: '리벳 사용자',
      email: 'user@example.com',
      id: 'user-id',
    },
    workspace: null,
  };
  const auth = {
    confirmPasswordReset: jest.fn(),
    getMe: jest.fn(),
    getSession: jest.fn(),
    login: jest.fn(),
    logout: jest.fn(),
  };
  const request = {
    headers: {},
    ip: '127.0.0.1',
    socket: {},
  } as unknown as Request;
  const response = {
    clearCookie: jest.fn(),
    cookie: jest.fn(),
  } as unknown as Response;
  const controller = new AuthController(auth as unknown as AuthService, config);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sets the opaque login cookie to the server-provided absolute expiry', async () => {
    const absoluteExpiresAt = new Date('2026-08-10T00:00:00.000Z');
    auth.login.mockResolvedValue({
      absoluteExpiresAt,
      response: authenticatedResponse,
      token: 'session-token',
    });

    await expect(
      controller.login(
        { email: 'user@example.com', password: 'a sufficiently long phrase' },
        request,
        response,
      ),
    ).resolves.toBe(authenticatedResponse);
    expect(response.cookie).toHaveBeenCalledWith(
      'rivet_session',
      'session-token',
      expect.objectContaining({ expires: absoluteExpiresAt, httpOnly: true, sameSite: 'lax' }),
    );
  });

  it('returns optional session state from the cookie without requiring authentication', async () => {
    const requestWithCookie = {
      ...request,
      headers: { cookie: 'rivet_session=session-token' },
    } as Request;
    auth.getSession.mockResolvedValue(authenticatedResponse);

    await expect(controller.getSession(requestWithCookie)).resolves.toBe(authenticatedResponse);
    expect(auth.getSession).toHaveBeenCalledWith('session-token');
  });

  it('revokes the guarded session and clears the cookie on logout', async () => {
    const authentication = {
      session: { sessionId: 'session-id' },
      sessionToken: 'session-token',
    } as AuthenticatedRequestContext;
    auth.logout.mockResolvedValue(undefined);

    await expect(controller.logout(authentication, response)).resolves.toBeUndefined();
    expect(auth.logout).toHaveBeenCalledWith('session-id');
    expect(response.clearCookie).toHaveBeenCalledWith(
      'rivet_session',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
    );
  });

  it('clears any existing session cookie only after a successful password reset', async () => {
    auth.confirmPasswordReset.mockResolvedValue({ reset: true });

    await expect(
      controller.confirmPasswordReset(
        { password: 'a sufficiently long phrase', token: 'token' },
        request,
        response,
      ),
    ).resolves.toEqual({ reset: true });
    expect(response.clearCookie).toHaveBeenCalledTimes(1);
  });
});
