import { createHmac } from 'node:crypto';

import { HttpStatus } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { DatabaseService } from '../../common/database/database.service';
import { apiConfig } from '../../config/api.config';
import { AUTH_RATE_LIMITS, AuthRateLimitService } from './auth-rate-limit.service';

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

describe('AuthRateLimitService', () => {
  const queryRaw = jest.fn();
  const executeRaw = jest.fn();
  const service = new AuthRateLimitService(
    { client: { $executeRaw: executeRaw, $queryRaw: queryRaw } } as unknown as DatabaseService,
    config,
  );
  const rule = AUTH_RATE_LIMITS.loginEmail;
  const key = 'user@example.com';
  const keyHash = createHmac('sha256', config.security.rateLimitHmacKey)
    .update(`${rule.scope}:${key}`)
    .digest();

  beforeEach(() => {
    queryRaw.mockReset();
    executeRaw.mockReset();
  });

  it('checks a bucket with bound scope and HMAC key parameters', async () => {
    queryRaw.mockResolvedValue([]);

    await expect(service.assertNotBlocked(rule, key)).resolves.toBeUndefined();
    expect(queryRaw.mock.calls[0]?.slice(1)).toEqual([rule.scope, keyHash]);
  });

  it('exposes the remaining wait for the HTTP Retry-After response', async () => {
    queryRaw.mockResolvedValue([{ retryAfterSeconds: 37 }]);

    await expect(service.assertNotBlocked(rule, key)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'RATE_LIMITED' }),
      retryAfterSeconds: 37,
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
  });

  it('atomically consumes multiple attempts using only bound values and the HMAC key', async () => {
    const amount = 2;
    queryRaw.mockResolvedValue([{ attemptCount: rule.limit, retryAfterSeconds: null }]);

    await expect(service.consume(rule, key, amount)).resolves.toBeUndefined();
    expect(queryRaw.mock.calls[0]?.slice(1)).toEqual([
      rule.windowSeconds,
      rule.scope,
      keyHash,
      amount,
      rule.windowSeconds * 2,
      amount,
      amount,
      rule.limit,
      rule.windowSeconds,
      rule.windowSeconds * 2,
    ]);
  });

  it('rejects an invalid consume amount before accessing the database', async () => {
    await expect(service.consume(rule, key, 0)).rejects.toThrow(RangeError);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('rejects an over-limit consume result with its remaining wait', async () => {
    queryRaw.mockResolvedValue([{ attemptCount: rule.limit + 1, retryAfterSeconds: 12 }]);

    await expect(service.consume(rule, key)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'RATE_LIMITED' }),
      retryAfterSeconds: 12,
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
  });

  it('fails closed when an atomic consume returns no result', async () => {
    queryRaw.mockResolvedValue([]);

    await expect(service.consume(rule, key)).rejects.toThrow('인증 속도 제한 결과');
  });

  it('clears every account bucket using bound scope and HMAC key parameters', async () => {
    executeRaw.mockResolvedValue(2);

    await expect(service.clear(rule, key)).resolves.toBeUndefined();
    expect(executeRaw.mock.calls[0]?.slice(1)).toEqual([rule.scope, keyHash]);
  });
});
