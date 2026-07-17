import { type ExecutionContext, HttpStatus } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Reflector } from '@nestjs/core';

import { apiConfig } from '../../config/api.config';
import { createCsrfToken } from './auth-token.crypto';
import { CsrfGuard } from './csrf.guard';

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

function createContext(options: {
  csrfToken?: string | undefined;
  method: string;
  sessionToken?: string | undefined;
}): ExecutionContext {
  const authentication = options.sessionToken
    ? { session: {}, sessionToken: options.sessionToken }
    : undefined;

  return {
    getClass: () => class TestController {},
    getHandler: () => () => undefined,
    switchToHttp: () => ({
      getRequest: () => ({
        authentication,
        get: (name: string) =>
          name.toLowerCase() === 'x-csrf-token' ? options.csrfToken : undefined,
        method: options.method,
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('CsrfGuard', () => {
  const getAllAndOverride = jest.fn();
  const guard = new CsrfGuard({ getAllAndOverride } as unknown as Reflector, config);

  beforeEach(() => {
    getAllAndOverride.mockReset().mockReturnValue(false);
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('allows the safe %s method without a token', (method) => {
    expect(guard.canActivate(createContext({ method }))).toBe(true);
  });

  it('allows a public state-changing endpoint without a session token', () => {
    getAllAndOverride.mockReturnValue(true);

    expect(guard.canActivate(createContext({ method: 'POST' }))).toBe(true);
  });

  it('accepts only the CSRF token bound to the active session', () => {
    const sessionToken = 'active-session-token';
    const csrfToken = createCsrfToken(sessionToken, config.security.csrfHmacKey);

    expect(guard.canActivate(createContext({ csrfToken, method: 'POST', sessionToken }))).toBe(
      true,
    );
  });

  it.each([
    { label: 'missing token', sessionToken: 'active-session-token' },
    { csrfToken: 'wrong-token', label: 'malformed token', sessionToken: 'active-session-token' },
    {
      csrfToken: createCsrfToken('another-session', config.security.csrfHmacKey),
      label: 'another session token',
      sessionToken: 'active-session-token',
    },
    {
      csrfToken: createCsrfToken('active-session-token', config.security.csrfHmacKey),
      label: 'missing authentication',
    },
  ])('rejects a state-changing request with $label', ({ csrfToken, sessionToken }) => {
    expect(() =>
      guard.canActivate(createContext({ csrfToken, method: 'POST', sessionToken })),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'CSRF_INVALID' }),
        status: HttpStatus.FORBIDDEN,
      }),
    );
  });
});
