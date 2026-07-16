import type { ConfigType } from '@nestjs/config';
import type { PinoLogger } from 'nestjs-pino';

import { apiConfig } from '../../config/api.config';
import { ObservabilityService } from './observability.service';

const productionConfig: ConfigType<typeof apiConfig> = {
  database: {
    connectionTimeoutMs: 5_000,
    idleTimeoutMs: 10_000,
    poolMax: 10,
    url: 'postgresql://localhost/rivet',
  },
  environment: 'production',
  fileStorageRoot: '/tmp/rivet-files',
  observability: {
    posthogApiKey: 'phc_test12345678',
    slackAlertWebhookUrl: 'https://hooks.slack.com/services/team/channel/secret',
  },
  port: 4_000,
  releaseId: 'release-test',
  security: {
    csrfHmacKey: 'csrf-key-that-is-at-least-32-bytes-long',
    oneTimeTokenHmacKey: 'token-key-that-is-at-least-32-bytes-long',
    rateLimitHmacKey: 'rate-key-that-is-at-least-32-bytes-long',
  },
  webOrigin: 'https://rivet.example.com',
  webPush: { vapidPublicKey: null },
};

function flushRequests(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('API ObservabilityService', () => {
  const warn = jest.fn();
  const logger = { setContext: jest.fn(), warn } as unknown as PinoLogger;
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  let timeout: jest.SpiedFunction<typeof AbortSignal.timeout>;

  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);
    timeout = jest.spyOn(AbortSignal, 'timeout');
  });

  afterEach(() => {
    fetchMock.mockRestore();
    timeout.mockRestore();
  });

  it('does not call external services when analytics is explicitly disabled', () => {
    const service = new ObservabilityService(
      {
        ...productionConfig,
        environment: 'test',
        observability: { posthogApiKey: null, slackAlertWebhookUrl: null },
      },
      logger,
    );

    service.capture({
      distinctId: 'membership-id',
      name: 'search_performed',
      properties: { resultCount: 1, searchType: 'TITLE', workspaceId: 'workspace-id' },
    });
    service.alert({
      errorCode: 'POSTGRES_LISTENER_DISCONNECTED',
      type: 'POSTGRES_LISTENER_DISCONNECTED',
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends only the typed product properties with a short timeout', async () => {
    const service = new ObservabilityService(productionConfig, logger);

    service.capture({
      distinctId: 'membership-id',
      name: 'search_performed',
      properties: { resultCount: 2, searchType: 'IDENTIFIER', workspaceId: 'workspace-id' },
    });
    await flushRequests();

    const request = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body)) as {
      api_key: string;
      event: string;
      properties: Record<string, unknown>;
    };
    expect(body).toEqual({
      api_key: 'phc_test12345678',
      event: 'search_performed',
      properties: {
        distinct_id: 'membership-id',
        environment: 'production',
        releaseId: 'release-test',
        resultCount: 2,
        searchType: 'IDENTIFIER',
        workspaceId: 'workspace-id',
      },
    });
    expect(timeout).toHaveBeenCalledWith(2_000);
  });

  it('removes the exception message and limits exception metadata', async () => {
    const service = new ObservabilityService(productionConfig, logger);
    const error = new Error('sensitive issue title');
    error.stack = `Error: sensitive issue title\n    at handler (${process.cwd()}/src/handler.ts:1:1)`;

    service.captureException(error, 'req_safe');
    await flushRequests();

    const request = fetchMock.mock.calls[0]?.[1];
    const serialized = String(request?.body);
    const body = JSON.parse(serialized) as { properties: Record<string, unknown> };
    expect(serialized).not.toContain('sensitive issue title');
    expect(body.properties).toEqual({
      $exception_level: 'error',
      $exception_list: [
        {
          mechanism: { handled: true, synthetic: false, type: 'generic' },
          type: 'Error',
          value: 'Error',
        },
      ],
      distinct_id: 'req_safe',
      environment: 'production',
      errorName: 'Error',
      releaseId: 'release-test',
      requestId: 'req_safe',
      sanitizedStack: '    at handler ($APP_ROOT/src/handler.ts:1:1)',
    });
  });

  it('sanitizes an untrusted request ID in both exception fields', async () => {
    const service = new ObservabilityService(productionConfig, logger);

    service.captureException(new Error('safe to omit'), 'req\nsecret=request-body');
    await flushRequests();

    const serialized = String(fetchMock.mock.calls[0]?.[1]?.body);
    const body = JSON.parse(serialized) as { properties: Record<string, unknown> };
    expect(body.properties).toEqual(
      expect.objectContaining({
        distinct_id: 'unknown_request',
        requestId: 'unknown_request',
      }),
    );
    expect(serialized).not.toContain('secret=request-body');
  });

  it('deduplicates Slack alerts and keeps the message on the operational allowlist', async () => {
    const service = new ObservabilityService(productionConfig, logger);
    const alert = {
      errorCode: 'POSTGRES_LISTENER_DISCONNECTED',
      type: 'POSTGRES_LISTENER_DISCONNECTED' as const,
    };

    service.alert(alert);
    service.alert(alert);
    await flushRequests();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body)) as { text: string };
    expect(body.text.split('\n')).toEqual([
      '[Rivet][production][높음] PostgreSQL listener 30초 이상 단절',
      expect.stringMatching(/^발생시각=\d{4}-\d{2}-\d{2}T/),
      'releaseId=release-test',
      'errorCode=POSTGRES_LISTENER_DISCONNECTED',
      'jobId=postgres_listener',
      '확인절차=API readiness와 PostgreSQL 연결 상태를 확인하세요.',
    ]);
  });

  it('records a sanitized Slack delivery failure in PostHog without retrying Slack', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('Slack provider response secret'))
      .mockResolvedValueOnce({ ok: true } as Response);
    const service = new ObservabilityService(productionConfig, logger);

    service.alert({
      errorCode: 'POSTGRES_LISTENER_DISCONNECTED',
      requestId: 'bad\nrequest',
      type: 'POSTGRES_LISTENER_DISCONNECTED',
    });
    await flushRequests();
    await flushRequests();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://hooks.slack.com/services/team/channel/secret',
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://us.i.posthog.com/capture/');
    const serialized = String(fetchMock.mock.calls[1]?.[1]?.body);
    const body = JSON.parse(serialized) as {
      event: string;
      properties: Record<string, unknown>;
    };
    expect(body).toEqual({
      api_key: 'phc_test12345678',
      event: '$exception',
      properties: {
        $exception_level: 'error',
        $exception_list: [
          {
            mechanism: { handled: true, synthetic: true, type: 'generic' },
            type: 'SlackAlertDeliveryError',
            value: 'SlackAlertDeliveryError',
          },
        ],
        alertType: 'POSTGRES_LISTENER_DISCONNECTED',
        distinct_id: 'unknown_request',
        environment: 'production',
        errorName: 'SlackAlertDeliveryError',
        releaseId: 'release-test',
        requestId: 'unknown_request',
        sanitizedStack: null,
      },
    });
    expect(warn).toHaveBeenCalledWith(
      {
        alertType: 'POSTGRES_LISTENER_DISCONNECTED',
        errorCode: 'SLACK_ALERT_DELIVERY_FAILED',
      },
      'Slack 경고 전송 실패',
    );
    expect(serialized).not.toContain('bad\\nrequest');
    expect(serialized).not.toContain('hooks.slack.com');
    expect(serialized).not.toContain('Slack provider response secret');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Slack provider response secret');
  });

  it('isolates external delivery failures from the caller and logs no secret values', async () => {
    fetchMock.mockRejectedValue(new Error('provider body with secret'));
    const service = new ObservabilityService(productionConfig, logger);

    expect(() =>
      service.capture({
        distinctId: 'membership-id',
        name: 'inbox_opened',
        properties: { unreadCount: 3, workspaceId: 'workspace-id' },
      }),
    ).not.toThrow();
    await flushRequests();

    expect(warn).toHaveBeenCalledWith(
      { errorCode: 'POSTHOG_DELIVERY_FAILED', event: 'inbox_opened' },
      'PostHog 전송 실패',
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('phc_test12345678');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('provider body with secret');
  });
});
