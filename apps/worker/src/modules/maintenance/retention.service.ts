import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { DatabaseService } from '../../common/database/database.service';
import { ObservabilityService } from '../../common/observability/observability.service';

const BATCH_SIZE = 100;

type DeletedRow = { id: string };

export type RetentionCleanupResult = {
  deactivatedPushSubscriptions: number;
  deletedEmailDeliveries: number;
  deletedExportAudits: number;
  deletedFeedback: number;
  deletedOutboxEvents: number;
  deletedRateLimitBuckets: number;
  deletedSessions: number;
  deletedTokens: number;
  failedSteps: number;
};

type CounterKey = Exclude<keyof RetentionCleanupResult, 'failedSteps'>;

@Injectable()
export class RetentionService {
  constructor(
    private readonly database: DatabaseService,
    private readonly observability: ObservabilityService,
    private readonly logger: PinoLogger,
  ) {}

  async cleanup(jobId: string): Promise<RetentionCleanupResult> {
    const result: RetentionCleanupResult = {
      deactivatedPushSubscriptions: 0,
      deletedEmailDeliveries: 0,
      deletedExportAudits: 0,
      deletedFeedback: 0,
      deletedOutboxEvents: 0,
      deletedRateLimitBuckets: 0,
      deletedSessions: 0,
      deletedTokens: 0,
      failedSteps: 0,
    };
    const steps: Array<{
      counter: CounterKey;
      deleteBatch: () => Promise<DeletedRow[]>;
      name: string;
    }> = [
      {
        counter: 'deletedEmailDeliveries',
        deleteBatch: () => this.deleteEmailDeliveryBatch(),
        name: 'email_delivery',
      },
      {
        counter: 'deletedTokens',
        deleteBatch: () => this.deleteTokenBatch(),
        name: 'one_time_token',
      },
      {
        counter: 'deactivatedPushSubscriptions',
        deleteBatch: () => this.deactivateExpiredSessionSubscriptionBatch(),
        name: 'web_push_subscription',
      },
      {
        counter: 'deletedSessions',
        deleteBatch: () => this.deleteSessionBatch(),
        name: 'session',
      },
      {
        counter: 'deletedRateLimitBuckets',
        deleteBatch: () => this.deleteRateLimitBatch(),
        name: 'auth_rate_limit',
      },
      {
        counter: 'deletedExportAudits',
        deleteBatch: () => this.deleteExportAuditBatch(),
        name: 'export_audit',
      },
      {
        counter: 'deletedFeedback',
        deleteBatch: () => this.deleteFeedbackBatch(),
        name: 'product_feedback',
      },
      {
        counter: 'deletedOutboxEvents',
        deleteBatch: () => this.deleteOutboxBatch(),
        name: 'outbox',
      },
    ];

    for (const step of steps) {
      try {
        result[step.counter] = await this.deleteInBatches(step.deleteBatch);
      } catch {
        result.failedSteps += 1;
        this.logger.warn(
          { errorCode: 'RETENTION_CLEANUP_STEP_FAILED', jobId, step: step.name },
          '보존 데이터 정리 단계 실패',
        );
        this.observability.alert({
          errorCode: 'RETENTION_CLEANUP_STEP_FAILED',
          jobId,
          type: 'MAINTENANCE_STEP_FAILED',
        });
      }
    }

    return result;
  }

  private async deleteInBatches(deleteBatch: () => Promise<DeletedRow[]>): Promise<number> {
    let deleted = 0;

    while (true) {
      const rows = await deleteBatch();
      deleted += rows.length;
      if (rows.length < BATCH_SIZE) return deleted;
    }
  }

  private deleteEmailDeliveryBatch(): Promise<DeletedRow[]> {
    return this.database.client.$queryRaw<DeletedRow[]>`
      WITH candidates AS (
        SELECT "id"
        FROM "email_deliveries"
        WHERE ("sent_at" IS NOT NULL OR "failed_at" IS NOT NULL)
          AND "updated_at" < NOW() - INTERVAL '30 days'
        ORDER BY "updated_at", "id"
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM "email_deliveries" AS target
      USING candidates
      WHERE target."id" = candidates."id"
      RETURNING target."id"
    `;
  }

  private deleteFeedbackBatch(): Promise<DeletedRow[]> {
    return this.database.client.$queryRaw<DeletedRow[]>`
      WITH candidates AS (
        SELECT "id"
        FROM "product_feedback"
        WHERE "retention_expires_at" < NOW()
        ORDER BY "retention_expires_at", "id"
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM "product_feedback" AS target
      USING candidates
      WHERE target."id" = candidates."id"
      RETURNING target."id"
    `;
  }

  private deleteTokenBatch(): Promise<DeletedRow[]> {
    return this.database.client.$queryRaw<DeletedRow[]>`
      WITH candidates AS (
        SELECT "id"
        FROM "one_time_tokens"
        WHERE LEAST(
          "expires_at",
          COALESCE("used_at", 'infinity'::timestamptz),
          COALESCE("revoked_at", 'infinity'::timestamptz)
        ) < NOW() - INTERVAL '30 days'
        ORDER BY LEAST(
          "expires_at",
          COALESCE("used_at", 'infinity'::timestamptz),
          COALESCE("revoked_at", 'infinity'::timestamptz)
        ), "id"
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM "one_time_tokens" AS target
      USING candidates
      WHERE target."id" = candidates."id"
      RETURNING target."id"
    `;
  }

  private deactivateExpiredSessionSubscriptionBatch(): Promise<DeletedRow[]> {
    return this.database.client.$queryRaw<DeletedRow[]>`
      WITH candidates AS (
        SELECT subscription."id"
        FROM "web_push_subscriptions" AS subscription
        INNER JOIN "sessions" AS session
          ON session."id" = subscription."session_id"
        WHERE subscription."status" = 'ACTIVE'
          AND (
            session."revoked_at" IS NOT NULL
            OR session."idle_expires_at" <= NOW()
            OR session."absolute_expires_at" <= NOW()
          )
        ORDER BY LEAST(
          session."idle_expires_at",
          session."absolute_expires_at",
          COALESCE(session."revoked_at", 'infinity'::timestamptz)
        ), subscription."id"
        LIMIT ${BATCH_SIZE}
        FOR UPDATE OF subscription SKIP LOCKED
      )
      UPDATE "web_push_subscriptions" AS target
      SET "auth" = NULL,
          "disabled_at" = NOW(),
          "endpoint" = NULL,
          "last_error_code" = 'WEB_PUSH_SESSION_INACTIVE',
          "last_failed_at" = NOW(),
          "p256dh" = NULL,
          "status" = 'EXPIRED',
          "updated_at" = NOW()
      FROM candidates
      WHERE target."id" = candidates."id"
      RETURNING target."id"
    `;
  }

  private deleteSessionBatch(): Promise<DeletedRow[]> {
    return this.database.client.$queryRaw<DeletedRow[]>`
      WITH candidates AS (
        SELECT session."id"
        FROM "sessions" AS session
        WHERE LEAST(
          session."idle_expires_at",
          session."absolute_expires_at",
          COALESCE(session."revoked_at", 'infinity'::timestamptz)
        ) < NOW() - INTERVAL '30 days'
          AND NOT EXISTS (
            SELECT 1
            FROM "web_push_subscriptions" AS subscription
            WHERE subscription."session_id" = session."id"
              AND subscription."status" = 'ACTIVE'
          )
        ORDER BY LEAST(
          session."idle_expires_at",
          session."absolute_expires_at",
          COALESCE(session."revoked_at", 'infinity'::timestamptz)
        ), session."id"
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM "sessions" AS target
      USING candidates
      WHERE target."id" = candidates."id"
      RETURNING target."id"
    `;
  }

  private deleteRateLimitBatch(): Promise<DeletedRow[]> {
    return this.database.client.$queryRaw<DeletedRow[]>`
      WITH candidates AS (
        SELECT "id"
        FROM "auth_rate_limit_buckets"
        WHERE "expires_at" < NOW()
        ORDER BY "expires_at", "id"
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM "auth_rate_limit_buckets" AS target
      USING candidates
      WHERE target."id" = candidates."id"
      RETURNING target."id"
    `;
  }

  private deleteExportAuditBatch(): Promise<DeletedRow[]> {
    return this.database.client.$queryRaw<DeletedRow[]>`
      WITH candidates AS (
        SELECT "id"
        FROM "export_audits"
        WHERE ("completed_at" IS NOT NULL OR "failed_at" IS NOT NULL)
          AND GREATEST(
            COALESCE("completed_at", '-infinity'::timestamptz),
            COALESCE("failed_at", '-infinity'::timestamptz),
            COALESCE("downloaded_at", '-infinity'::timestamptz)
          ) < NOW() - INTERVAL '30 days'
        ORDER BY GREATEST(
          COALESCE("completed_at", '-infinity'::timestamptz),
          COALESCE("failed_at", '-infinity'::timestamptz),
          COALESCE("downloaded_at", '-infinity'::timestamptz)
        ), "id"
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM "export_audits" AS target
      USING candidates
      WHERE target."id" = candidates."id"
      RETURNING target."id"
    `;
  }

  private deleteOutboxBatch(): Promise<DeletedRow[]> {
    return this.database.client.$queryRaw<DeletedRow[]>`
      WITH candidates AS (
        SELECT event."id"
        FROM "outbox_events" AS event
        WHERE (event."processed_at" IS NOT NULL OR event."canceled_at" IS NOT NULL)
          AND GREATEST(
            COALESCE(event."processed_at", '-infinity'::timestamptz),
            COALESCE(event."canceled_at", '-infinity'::timestamptz)
          ) < NOW() - INTERVAL '30 days'
          AND NOT EXISTS (
            SELECT 1
            FROM "email_deliveries" AS delivery
            WHERE delivery."outbox_event_id" = event."id"
          )
        ORDER BY GREATEST(
          COALESCE(event."processed_at", '-infinity'::timestamptz),
          COALESCE(event."canceled_at", '-infinity'::timestamptz)
        ), event."id"
        LIMIT ${BATCH_SIZE}
        FOR UPDATE OF event SKIP LOCKED
      )
      DELETE FROM "outbox_events" AS target
      USING candidates
      WHERE target."id" = candidates."id"
      RETURNING target."id"
    `;
  }
}
