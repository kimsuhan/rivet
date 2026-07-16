import type { ConfigType } from '@nestjs/config';
import type { PinoLogger } from 'nestjs-pino';

import { workerConfig } from '../../config/worker.config';
import { ObservabilityService } from './observability.service';

const productionConfig: ConfigType<typeof workerConfig> = {
  database: {
    connectionTimeoutMs: 5_000,
    idleTimeoutMs: 10_000,
    poolMax: 5,
    url: 'postgresql://localhost/rivet',
  },
  email: {
    allowedRecipients: [],
    apiKey: 'resend-secret',
    from: 'rivet@example.test',
    oneTimeTokenHmacKey: 'token-key-that-is-at-least-32-bytes-long',
  },
  environment: 'production',
  fileStorageRoot: '/tmp/rivet-files',
  observability: {
    posthogApiKey: 'phc_test12345678',
    slackAlertWebhookUrl: 'https://hooks.slack.com/services/team/channel/secret',
  },
  rateLimitHmacKey: 'rate-key-that-is-at-least-32-bytes-long',
  releaseId: 'release-test',
  webOrigin: 'https://rivet.example.com',
  webPush: { privateKey: null, publicKey: null, subject: null },
};

function flushRequests(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('Worker ObservabilityService', () => {
  const warn = jest.fn();
  const logger = { setContext: jest.fn(), warn } as unknown as PinoLogger;
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('does not call external services when observability is disabled', () => {
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
      name: 'comment_created',
      properties: { hasMention: false, workspaceId: 'workspace-id' },
    });
    service.alert({
      errorCode: 'OUTBOX_MAX_ATTEMPTS_REACHED',
      jobId: 'job_id',
      type: 'OUTBOX_PERMANENTLY_FAILED',
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends only the typed worker product properties', async () => {
    const service = new ObservabilityService(productionConfig, logger);

    service.capture({
      distinctId: 'membership-id',
      name: 'issue_property_changed',
      properties: { propertyTypes: ['PRIORITY'], workspaceId: 'workspace-id' },
    });
    await flushRequests();

    const request = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body)) as { properties: Record<string, unknown> };
    expect(body.properties).toEqual({
      distinct_id: 'membership-id',
      environment: 'production',
      propertyTypes: ['PRIORITY'],
      releaseId: 'release-test',
      workspaceId: 'workspace-id',
    });
  });

  it('sanitizes and deduplicates Slack alerts', async () => {
    const service = new ObservabilityService(productionConfig, logger);
    const alert = {
      errorCode: 'bad\nsecret',
      jobId: 'bad\njob',
      type: 'MAINTENANCE_STEP_FAILED' as const,
    };

    service.alert(alert);
    service.alert(alert);
    await flushRequests();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body)) as { text: string };
    expect(body.text).toContain('[Rivet][production][보통] 정기 maintenance 카테고리 실패');
    expect(body.text).toContain('errorCode=UNKNOWN_ERROR');
    expect(body.text).toContain('jobId=unknown_job');
    expect(body.text).not.toContain('bad\nsecret');
  });

  it('records a sanitized Slack delivery failure in PostHog without retrying Slack', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('Slack provider response secret'))
      .mockResolvedValueOnce({ ok: true } as Response);
    const service = new ObservabilityService(productionConfig, logger);

    service.alert({
      errorCode: 'MAINTENANCE_STEP_FAILED',
      jobId: 'bad\njob',
      type: 'MAINTENANCE_STEP_FAILED',
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
        alertType: 'MAINTENANCE_STEP_FAILED',
        distinct_id: 'unknown_job',
        environment: 'production',
        errorName: 'SlackAlertDeliveryError',
        jobId: 'unknown_job',
        releaseId: 'release-test',
        sanitizedStack: null,
      },
    });
    expect(warn).toHaveBeenCalledWith(
      {
        alertType: 'MAINTENANCE_STEP_FAILED',
        errorCode: 'SLACK_ALERT_DELIVERY_FAILED',
      },
      'Slack 경고 전송 실패',
    );
    expect(serialized).not.toContain('bad\njob');
    expect(serialized).not.toContain('hooks.slack.com');
    expect(serialized).not.toContain('Slack provider response secret');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Slack provider response secret');
  });

  it('isolates provider failures and removes exception messages', async () => {
    fetchMock.mockRejectedValue(new Error('provider response secret'));
    const service = new ObservabilityService(productionConfig, logger);
    const error = new Error('sensitive issue title');
    error.stack = `Error: sensitive issue title\n    at worker (${process.cwd()}/src/worker.ts:1:1)`;

    expect(() => service.captureException(error, 'job_safe')).not.toThrow();
    await flushRequests();

    const serialized = String(fetchMock.mock.calls[0]?.[1]?.body);
    const body = JSON.parse(serialized) as { properties: Record<string, unknown> };
    expect(body.properties).toEqual({
      $exception_level: 'error',
      $exception_list: [
        {
          mechanism: { handled: true, synthetic: false, type: 'generic' },
          type: 'Error',
          value: 'Error',
        },
      ],
      distinct_id: 'job_safe',
      environment: 'production',
      errorName: 'Error',
      jobId: 'job_safe',
      releaseId: 'release-test',
      sanitizedStack: '    at worker ($APP_ROOT/src/worker.ts:1:1)',
    });
    expect(serialized).not.toContain('sensitive issue title');
    expect(warn).toHaveBeenCalledWith(
      { errorCode: 'POSTHOG_DELIVERY_FAILED', event: '$exception' },
      'PostHog 전송 실패',
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('provider response secret');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('phc_test12345678');
  });
});
