import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';

import type {
  IssueUnblockedDurationBucket,
  IssueUnblockedProjectRole,
  ProductAnalyticsProjectRole,
  ProductAnalyticsProjectStatus,
} from '@rivet/event-contracts';

import { workerConfig } from '../../config/worker.config';

const ALERT_COOLDOWN_MS = 5 * 60_000;
const HTTP_TIMEOUT_MS = 2_000;
const POSTHOG_CAPTURE_URL = 'https://us.i.posthog.com/capture/';

export type WorkerProductEvent =
  | {
      distinctId: string;
      name: 'workspace_created';
      properties: { acquisitionSource: 'direct'; workspaceId: string };
    }
  | {
      distinctId: string;
      name: 'member_invited';
      properties: { currentMemberCount: number; workspaceId: string };
    }
  | {
      distinctId: string;
      name: 'issue_created';
      properties: {
        hasAssignee: boolean;
        hasMention: boolean;
        workspaceId: string;
      };
    }
  | {
      distinctId: string;
      name: 'issue_property_changed';
      properties: { propertyTypes: string[]; workspaceId: string };
    }
  | {
      distinctId: string;
      name: 'issue_completed';
      properties: { workspaceId: string };
    }
  | {
      distinctId: string;
      name: 'comment_created';
      properties: { hasMention: boolean; workspaceId: string };
    }
  | {
      distinctId: string;
      name: 'issue_unblocked';
      properties: {
        blockedProjectRole: IssueUnblockedProjectRole | null;
        blockingDurationBucket: IssueUnblockedDurationBucket;
        blockingProjectRole: IssueUnblockedProjectRole | null;
        workspaceId: string;
      };
    }
  | {
      distinctId: string;
      name: 'api_handoff_created';
      properties: { downstreamIssueCount: number; isFollowUp: boolean; workspaceId: string };
    }
  | {
      distinctId: string;
      name: 'project_created';
      properties: {
        hasTargetDate: boolean;
        roleCount: number;
        roles: ProductAnalyticsProjectRole[];
        workspaceId: string;
      };
    }
  | {
      distinctId: string;
      name: 'project_status_changed';
      properties: {
        fromStatus: ProductAnalyticsProjectStatus;
        progress: number;
        toStatus: ProductAnalyticsProjectStatus;
        workspaceId: string;
      };
    };

export type WorkerAlert = {
  errorCode: string;
  jobId: string;
  type:
    | 'LINKED_FILE_BINARY_MISSING'
    | 'MAINTENANCE_STEP_FAILED'
    | 'OUTBOX_BACKLOG_DELAYED'
    | 'OUTBOX_PERMANENTLY_FAILED';
};

const ALERT_DETAILS: Record<
  WorkerAlert['type'],
  { check: string; severity: '높음' | '보통'; title: string }
> = {
  LINKED_FILE_BINARY_MISSING: {
    check: 'DB 파일 메타데이터와 FILE_STORAGE_ROOT 백업을 확인하세요.',
    severity: '높음',
    title: '연결 파일 바이너리 누락',
  },
  MAINTENANCE_STEP_FAILED: {
    check: 'maintenance 구조화 로그의 step과 최근 성공 시각을 확인하세요.',
    severity: '보통',
    title: '정기 maintenance 카테고리 실패',
  },
  OUTBOX_BACKLOG_DELAYED: {
    check: 'outbox_oldest_pending_seconds와 워커 polling 상태를 확인하세요.',
    severity: '높음',
    title: 'Outbox 처리 지연',
  },
  OUTBOX_PERMANENTLY_FAILED: {
    check: 'Outbox event ID와 정제 오류 코드를 확인한 뒤 운영자 승인으로 재시도하세요.',
    severity: '높음',
    title: 'Outbox 영구 실패',
  },
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

function safeJobId(value: string): string {
  return /^[A-Za-z0-9_-]{1,150}$/.test(value) ? value : 'unknown_job';
}

@Injectable()
export class ObservabilityService {
  private readonly alertSentAt = new Map<string, number>();

  constructor(
    @Inject(workerConfig.KEY) private readonly config: ConfigType<typeof workerConfig>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ObservabilityService.name);
  }

  capture(event: WorkerProductEvent): void {
    if (this.config.environment !== 'production' || !this.config.observability.posthogApiKey) {
      return;
    }

    void this.postPostHog(event.name, event.distinctId, event.properties);
  }

  captureException(error: unknown, jobId: string): void {
    if (this.config.environment !== 'production' || !this.config.observability.posthogApiKey) {
      return;
    }

    const sanitizedJobId = safeJobId(jobId);
    const errorName = safeErrorName(error);
    void this.postPostHog('$exception', sanitizedJobId, {
      ...postHogExceptionProperties(errorName, sanitizedStack(error)),
      jobId: sanitizedJobId,
    });
  }

  alert(alert: WorkerAlert): void {
    const webhookUrl = this.config.observability.slackAlertWebhookUrl;
    if (this.config.environment !== 'production' || !webhookUrl) return;

    const errorCode = safeCode(alert.errorCode);
    const key = `${alert.type}:${errorCode}`;
    const now = Date.now();
    if (now - (this.alertSentAt.get(key) ?? 0) < ALERT_COOLDOWN_MS) return;
    this.alertSentAt.set(key, now);

    const detail = ALERT_DETAILS[alert.type];
    const lines = [
      `[Rivet][${this.config.environment}][${detail.severity}] ${detail.title}`,
      `발생시각=${new Date(now).toISOString()}`,
      `releaseId=${this.config.releaseId}`,
      `errorCode=${errorCode}`,
      `jobId=${safeJobId(alert.jobId)}`,
      `확인절차=${detail.check}`,
    ];
    void this.postSlack(webhookUrl, alert.type, lines.join('\n'), alert.jobId);
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

  private async postSlack(
    webhookUrl: string,
    alertType: WorkerAlert['type'],
    text: string,
    jobId: string,
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
        const sanitizedJobId = safeJobId(jobId);
        void this.postPostHog('$exception', sanitizedJobId, {
          alertType,
          ...postHogExceptionProperties('SlackAlertDeliveryError', null, true),
          jobId: sanitizedJobId,
        });
      }
    }
  }
}
