import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PassThrough } from 'node:stream';

import type { ConfigType } from '@nestjs/config';
import pinoHttp, { type Options } from 'pino-http';

import type { apiConfig } from '../../config/api.config';
import type { AuthSessionContext } from '../../modules/auth/auth-session.service';
import { createLoggerOptions } from './pino-http.options';

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
  releaseId: 'release-test',
  security: {
    csrfHmacKey: 'csrf-key-that-is-at-least-32-bytes-long',
    oneTimeTokenHmacKey: 'token-key-that-is-at-least-32-bytes-long',
    rateLimitHmacKey: 'rate-key-that-is-at-least-32-bytes-long',
  },
  webOrigin: 'http://localhost:3000',
};

const session = {
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
    email: 'private@example.com',
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

function loggerOptions(): Options {
  const options = createLoggerOptions(config).pinoHttp;
  if (!options || Array.isArray(options) || 'write' in options) {
    throw new Error('Pino HTTP 옵션을 준비하지 못했습니다.');
  }
  return options;
}

function response(statusCode = 200): ServerResponse {
  return { setHeader: jest.fn(), statusCode } as unknown as ServerResponse;
}

describe('createLoggerOptions', () => {
  it('creates a request ID and exposes only non-secret log metadata to Nginx', () => {
    const options = loggerOptions();
    const currentResponse = response();
    if (!options.genReqId || typeof options.timestamp !== 'function') {
      throw new Error('Pino 요청 ID 또는 timestamp 설정이 없습니다.');
    }

    const requestId = options.genReqId({} as IncomingMessage, currentResponse);

    expect(requestId).toEqual(expect.stringMatching(/^req_[0-9a-f-]{36}$/u));
    expect(currentResponse.setHeader).toHaveBeenCalledWith('X-Request-ID', requestId);
    expect(currentResponse.setHeader).toHaveBeenCalledWith('X-Rivet-Environment', 'test');
    expect(currentResponse.setHeader).toHaveBeenCalledWith('X-Rivet-Release-Id', 'release-test');
    expect(options.timestamp()).toEqual(
      expect.stringMatching(/^,"timestamp":"\d{4}-\d{2}-\d{2}T.*Z"$/u),
    );
  });

  it('logs a queryless route template and authenticated internal identifiers on completion', () => {
    const options = loggerOptions();
    if (!options.customProps || !options.customSuccessObject) {
      throw new Error('Pino 완료 로그 설정이 없습니다.');
    }
    const request = {
      authentication: { session, sessionToken: 'secret-session-token' },
      headers: { cookie: 'secret-cookie', 'x-forwarded-for': '203.0.113.10' },
      id: 'req_safe',
      method: 'GET',
      originalUrl: '/api/v1/issues/WEB-1?token=secret-token',
      route: { path: '/api/v1/issues/:issueRef' },
      url: '/api/v1/issues/WEB-1?token=secret-token',
    } as unknown as IncomingMessage;
    const currentResponse = response(200);

    const completed = {
      ...options.customProps(request, currentResponse),
      ...options.customSuccessObject(request, currentResponse, { responseTime: 17 }),
    };

    expect(completed).toEqual({
      duration: 17,
      environment: 'test',
      membershipId: 'membership-id',
      method: 'GET',
      path: '/api/v1/issues/:issueRef',
      releaseId: 'release-test',
      requestId: 'req_safe',
      status: 200,
      workspaceId: 'workspace-id',
    });
    expect(JSON.stringify(completed)).not.toMatch(
      /private@example\.com|203\.0\.113\.10|secret-cookie|secret-token/u,
    );
  });

  it('replaces an unmatched sensitive path and keeps error details to the exception name', () => {
    const options = loggerOptions();
    if (!options.customErrorObject || !options.customProps) {
      throw new Error('Pino 오류 완료 로그 설정이 없습니다.');
    }
    const request = {
      id: 'req_error',
      method: 'POST',
      url: '/missing/private@example.com/secret-token?next=secret-token',
    } as unknown as IncomingMessage;
    const currentResponse = response(500);

    const completed = {
      ...options.customProps(request, currentResponse),
      ...options.customErrorObject(
        request,
        currentResponse,
        new Error('private@example.com secret-token'),
        { responseTime: 23 },
      ),
    };

    expect(completed).toEqual({
      duration: 23,
      environment: 'test',
      errorName: 'Error',
      method: 'POST',
      path: 'UNMATCHED_ROUTE',
      releaseId: 'release-test',
      requestId: 'req_error',
      status: 500,
    });
    expect(JSON.stringify(completed)).not.toMatch(/private@example\.com|secret-token/u);
  });

  it('reads authentication added after the logging middleware before emitting the response log', () => {
    const output = new PassThrough();
    let line = '';
    output.on('data', (chunk: Buffer) => {
      line += chunk.toString('utf8');
    });
    const logger = pinoHttp(loggerOptions(), output);
    const request = {
      headers: {},
      method: 'GET',
      originalUrl: '/api/v1/issues/WEB-1?query=private@example.com',
      socket: {},
      url: '/api/v1/issues/WEB-1?query=private@example.com',
    } as unknown as IncomingMessage;
    const currentResponse = Object.assign(new EventEmitter(), {
      setHeader: jest.fn(),
      statusCode: 200,
    }) as unknown as ServerResponse;

    logger(request, currentResponse);
    Object.assign(request, {
      authentication: { session, sessionToken: 'secret-session-token' },
      route: { path: '/api/v1/issues/:issueRef' },
    });
    currentResponse.emit('finish');

    expect(JSON.parse(line) as unknown).toMatchObject({
      environment: 'test',
      membershipId: 'membership-id',
      method: 'GET',
      path: '/api/v1/issues/:issueRef',
      releaseId: 'release-test',
      status: 200,
      workspaceId: 'workspace-id',
    });
    expect(line).not.toMatch(/private@example\.com|secret-session-token/u);
  });
});
