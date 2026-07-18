import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';

import type { ProductEvent } from '@rivet/event-contracts';
import { validateProductEvent } from '@rivet/event-contracts';

import { apiConfig } from '../../config/api.config';

const ALERT_COOLDOWN_MS = 5 * 60_000;
const HTTP_TIMEOUT_MS = 2_000;
const POSTHOG_CAPTURE_URL = 'https://us.i.posthog.com/capture/';

type ApiAlert = {
  errorCode: string;
  requestId?: string;
  type: 'POSTGRES_LISTENER_DISCONNECTED';
};

function safeErrorName(error: unknown): string {
  if (error instanceof Error && /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/.test(error.name)) {
    return error.name;
  }
  return 'UnknownError';
}

function sanitizedStack(error: unknown): string | null {
  if (!(error instanceof Error) || !error.stack) return null;

  const root = process.cwd();
  const frames = error.stack
    .split('\n')
    .slice(1)
    .filter((line) => /^\s*at\s/.test(line))
    .slice(0, 10)
    .map((line) => line.replaceAll(root, '$APP_ROOT').replaceAll('file://', ''));

  return frames.length > 0 ? frames.join('\n').slice(0, 4_000) : null;
}

function postHogExceptionProperties(errorName: string, stack: string | null, synthetic = false) {
  return {
    $exception_level: 'error',
    $exception_list: [
      {
        mechanism: { handled: true, synthetic, type: 'generic' },
        type: errorName,
        value: errorName,
      },
    ],
    errorName,
    sanitizedStack: stack,
  };
}

function safeCode(value: string): string {
  return /^[A-Z][A-Z0-9_]{0,99}$/.test(value) ? value : 'UNKNOWN_ERROR';
}

function safeRequestId(value: string): string {
  return /^[A-Za-z0-9_-]{1,150}$/.test(value) ? value : 'unknown_request';
}

@Injectable()
export class ObservabilityService {
  private readonly alertSentAt = new Map<string, number>();

  constructor(
    @Inject(apiConfig.KEY) private readonly config: ConfigType<typeof apiConfig>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ObservabilityService.name);
  }

  capture(event: ProductEvent): void {
    const validatedEvent = this.validateProductEvent(event);
    if (!validatedEvent) return;
    if (this.config.environment !== 'production' || !this.config.observability.posthogApiKey) {
      return;
    }

    void this.postProductEvent(validatedEvent);
  }

  captureMany(events: ProductEvent[]): void {
    const validatedEvents = events
      .map((event) => this.validateProductEvent(event))
      .filter((event): event is ProductEvent => event !== null);
    if (
      validatedEvents.length === 0 ||
      this.config.environment !== 'production' ||
      !this.config.observability.posthogApiKey
    ) {
      return;
    }

    void this.postProductEvents(validatedEvents);
  }

  isProductAnalyticsEnabled(): boolean {
    return this.config.environment === 'production' && !!this.config.observability.posthogApiKey;
  }

  captureException(error: unknown, requestId: string): void {
    if (this.config.environment !== 'production' || !this.config.observability.posthogApiKey) {
      return;
    }

    const sanitizedRequestId = safeRequestId(requestId);
    const errorName = safeErrorName(error);
    void this.postPostHog('$exception', sanitizedRequestId, {
      ...postHogExceptionProperties(errorName, sanitizedStack(error)),
      requestId: sanitizedRequestId,
    });
  }

  alert(alert: ApiAlert): void {
    const webhookUrl = this.config.observability.slackAlertWebhookUrl;
    if (this.config.environment !== 'production' || !webhookUrl) {
      return;
    }

    const errorCode = safeCode(alert.errorCode);
    const key = `${alert.type}:${errorCode}`;
    const now = Date.now();
    if (now - (this.alertSentAt.get(key) ?? 0) < ALERT_COOLDOWN_MS) return;
    this.alertSentAt.set(key, now);

    const lines = [
      `[Rivet][${this.config.environment}][높음] PostgreSQL listener 30초 이상 단절`,
      `발생시각=${new Date(now).toISOString()}`,
      `releaseId=${this.config.releaseId}`,
      `errorCode=${errorCode}`,
      alert.requestId ? `requestId=${safeRequestId(alert.requestId)}` : 'jobId=postgres_listener',
      '확인절차=API readiness와 PostgreSQL 연결 상태를 확인하세요.',
    ];
    void this.postSlack(
      webhookUrl,
      alert.type,
      lines.join('\n'),
      alert.requestId ?? 'postgres_listener',
    );
  }

  private async postPostHog(
    event: string,
    distinctId: string,
    properties: Record<string, unknown>,
  ): Promise<void> {
    try {
      const response = await fetch(POSTHOG_CAPTURE_URL, {
        body: JSON.stringify({
          api_key: this.config.observability.posthogApiKey,
          event,
          properties: {
            distinct_id: distinctId,
            environment: this.config.environment,
            releaseId: this.config.releaseId,
            ...properties,
          },
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error('POSTHOG_REQUEST_FAILED');
    } catch {
      this.logger.warn({ errorCode: 'POSTHOG_DELIVERY_FAILED', event }, 'PostHog 전송 실패');
    }
  }

  private async postProductEvent(event: ProductEvent): Promise<void> {
    try {
      const response = await fetch(POSTHOG_CAPTURE_URL, {
        body: JSON.stringify({
          api_key: this.config.observability.posthogApiKey,
          event: event.name,
          properties: {
            distinct_id: event.membershipId,
            environment: this.config.environment,
            eventId: event.eventId,
            membershipId: event.membershipId,
            payloadVersion: event.payloadVersion,
            releaseId: this.config.releaseId,
            workspaceId: event.workspaceId,
            ...event.properties,
          },
          timestamp: event.occurredAt,
          uuid: event.eventId,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error('POSTHOG_REQUEST_FAILED');
    } catch {
      this.logger.warn(
        { errorCode: 'POSTHOG_DELIVERY_FAILED', event: event.name },
        'PostHog 전송 실패',
      );
    }
  }

  private async postProductEvents(events: ProductEvent[]): Promise<void> {
    for (const event of events) {
      await this.postProductEvent(event);
    }
  }

  private async postSlack(
    webhookUrl: string,
    alertType: ApiAlert['type'],
    text: string,
    requestId: string,
  ): Promise<void> {
    try {
      const response = await fetch(webhookUrl, {
        body: JSON.stringify({ text }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error('SLACK_REQUEST_FAILED');
    } catch {
      this.logger.warn(
        { alertType, errorCode: 'SLACK_ALERT_DELIVERY_FAILED' },
        'Slack 경고 전송 실패',
      );

      if (this.config.observability.posthogApiKey) {
        const sanitizedRequestId = safeRequestId(requestId);
        void this.postPostHog('$exception', sanitizedRequestId, {
          alertType,
          ...postHogExceptionProperties('SlackAlertDeliveryError', null, true),
          requestId: sanitizedRequestId,
        });
      }
    }
  }

  private validateProductEvent(event: ProductEvent): ProductEvent | null {
    const validation = validateProductEvent(event);
    if (validation.success) return validation.event;

    this.logger.warn(
      {
        errorCode: 'PRODUCT_EVENT_REJECTED',
        eventName: typeof event.name === 'string' ? event.name : 'unknown',
      },
      '제품 이벤트 계약 거부',
    );
    return null;
  }
}
