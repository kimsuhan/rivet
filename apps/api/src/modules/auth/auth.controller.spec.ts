import type { ConfigType } from '@nestjs/config';
import type { Request, Response } from 'express';

import { apiConfig } from '../../config/api.config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthAccountTokenService } from './auth-account-token.service';
import { AuthProfileService } from './auth-profile.service';
import type { AuthenticatedRequestContext } from './authentication.context';

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
  webPush: { vapidPublicKey: null },
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
  const accountTokens = {
    confirmPasswordReset: jest.fn(),
  };
  const auth = {
    getSession: jest.fn(),
    login: jest.fn(),
    logout: jest.fn(),
    signUp: jest.fn(),
  };
  const profile = { get: jest.fn(), update: jest.fn() };
  const request = {
    headers: {},
    ip: '127.0.0.1',
    socket: {},
  } as unknown as Request;
  const response = {
    clearCookie: jest.fn(),
    cookie: jest.fn(),
  } as unknown as Response;
  const controller = new AuthController(
    accountTokens as unknown as AuthAccountTokenService,
    auth as unknown as AuthService,
    profile as unknown as AuthProfileService,
    config,
  );

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
    expect(auth.login).toHaveBeenCalledWith(
      { email: 'user@example.com', password: 'a sufficiently long phrase' },
      '127.0.0.1',
      null,
    );
    expect(response.cookie).toHaveBeenCalledWith(
      'rivet_session',
      'session-token',
      expect.objectContaining({ expires: absoluteExpiresAt, httpOnly: true, sameSite: 'lax' }),
    );
  });

  it('returns optional session state from the cookie without requiring authentication', async () => {
    const requestWithCookie = {
      ...request,
      headers: { cookie: 'rivet_session=session-token; rivet_invite_flow=continuation-token' },
    } as Request;
    auth.getSession.mockResolvedValue(authenticatedResponse);

    await expect(controller.getSession(requestWithCookie)).resolves.toBe(authenticatedResponse);
    expect(auth.getSession).toHaveBeenCalledWith('session-token', 'continuation-token');
  });

  it('forwards the invitation continuation when signing up', async () => {
    const invitationRequest = {
      ...request,
      headers: { cookie: 'rivet_invite_flow=continuation-token' },
    } as Request;
    auth.signUp.mockResolvedValue({ accepted: true, emailMasked: 'us***@example.com' });

    await controller.signUp(
      {
        displayName: '리벳 사용자',
        email: 'user@example.com',
        password: 'a sufficiently long phrase',
      },
      invitationRequest,
    );

    expect(auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'user@example.com' }),
      '127.0.0.1',
      'continuation-token',
    );
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

  it('updates the guarded current user profile', async () => {
    const authentication = {
      session: { user: { id: 'user-id' } },
      sessionToken: 'session-token',
    } as AuthenticatedRequestContext;
    const updatedUser = { ...authenticatedResponse.user, displayName: '새 이름' };
    profile.update.mockResolvedValue(updatedUser);

    await expect(controller.updateMe(authentication, { displayName: '새 이름' })).resolves.toBe(
      updatedUser,
    );
    expect(profile.update).toHaveBeenCalledWith(authentication.session, { displayName: '새 이름' });
  });

  it('clears any existing session cookie only after a successful password reset', async () => {
    accountTokens.confirmPasswordReset.mockResolvedValue({ reset: true });

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
