import { type ExecutionContext, HttpStatus } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Reflector } from '@nestjs/core';

import { apiConfig } from '../../config/api.config';
import type { AuthSessionContext } from './auth-session.service';
import { AuthSessionService } from './auth-session.service';
import type { RequestWithAuthentication } from './authenticated-request';
import { SessionAuthGuard } from './session-auth.guard';

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

const activeSession = {
  membership: {
    id: 'membership-id',
    role: 'ADMIN',
    status: 'ACTIVE',
    workspaceId: 'workspace-id',
  },
  sessionId: 'session-id',
  user: {
    avatarFileId: null,
    displayName: '리벳 사용자',
    email: 'user@example.com',
    emailVerifiedAt: new Date('2026-07-11T00:00:00.000Z'),
    id: 'user-id',
  },
  workspace: {
    id: 'workspace-id',
    name: '리벳',
    slug: 'rivet',
    version: 1,
  },
} as const satisfies AuthSessionContext;

function createContext(request: RequestWithAuthentication): ExecutionContext {
  return {
    getClass: () => class TestController {},
    getHandler: () => () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function createRequest(cookie?: string): RequestWithAuthentication {
  return {
    headers: cookie ? { cookie } : {},
  } as RequestWithAuthentication;
}

describe('SessionAuthGuard', () => {
  const getAllAndOverride = jest.fn();
  const resolve = jest.fn();
  const guard = new SessionAuthGuard(
    { getAllAndOverride } as unknown as Reflector,
    { resolve } as unknown as AuthSessionService,
    config,
  );

  beforeEach(() => {
    getAllAndOverride.mockReset().mockReturnValue(false);
    resolve.mockReset();
  });

  it('allows a public endpoint without reading a session', async () => {
    getAllAndOverride.mockReturnValue(true);

    await expect(guard.canActivate(createContext(createRequest()))).resolves.toBe(true);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('rejects a missing or invalid session with the same public error', async () => {
    await expect(guard.canActivate(createContext(createRequest()))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'SESSION_REQUIRED' }),
      status: HttpStatus.UNAUTHORIZED,
    });

    resolve.mockResolvedValue(null);
    await expect(
      guard.canActivate(createContext(createRequest('rivet_session=invalid-session'))),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'SESSION_REQUIRED' }),
      status: HttpStatus.UNAUTHORIZED,
    });
    expect(resolve).toHaveBeenCalledWith('invalid-session');
  });

  it('rejects an unverified user after resolving the session', async () => {
    resolve.mockResolvedValue({
      ...activeSession,
      user: { ...activeSession.user, emailVerifiedAt: null },
    });

    await expect(
      guard.canActivate(createContext(createRequest('rivet_session=session-token'))),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'EMAIL_NOT_VERIFIED' }),
      status: HttpStatus.FORBIDDEN,
    });
  });

  it('rejects an inactive workspace membership', async () => {
    resolve.mockResolvedValue({
      ...activeSession,
      membership: { ...activeSession.membership, status: 'INACTIVE' },
    });

    await expect(
      guard.canActivate(createContext(createRequest('rivet_session=session-token'))),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'MEMBERSHIP_INACTIVE' }),
      status: HttpStatus.FORBIDDEN,
    });
  });

  it('attaches the verified active session and its opaque token to the request', async () => {
    resolve.mockResolvedValue(activeSession);
    const request = createRequest('theme=dark; rivet_session=session-token');

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(request.authentication).toEqual({
      session: activeSession,
      sessionToken: 'session-token',
    });
  });
});
