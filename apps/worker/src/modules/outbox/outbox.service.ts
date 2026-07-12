import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../../common/database/database.service';
import type { ClaimedOutboxEvent } from './outbox.types';

const CLAIM_BATCH_SIZE = 50;
const MAX_ATTEMPTS = 7;

export type OutboxMetrics = {
  failedCount: number;
  oldestPendingSeconds: number;
  pendingCount: number;
};

@Injectable()
export class OutboxService {
  constructor(private readonly database: DatabaseService) {}

  async claimBatch(workerId: string): Promise<ClaimedOutboxEvent[]> {
    return this.database.client.$queryRaw<ClaimedOutboxEvent[]>`
      WITH candidates AS (
        SELECT "id"
        FROM "outbox_events"
        WHERE "processed_at" IS NULL
          AND "canceled_at" IS NULL
          AND "attempt_count" < ${MAX_ATTEMPTS}
          AND "available_at" <= NOW()
          AND ("next_attempt_at" IS NULL OR "next_attempt_at" <= NOW())
          AND ("locked_at" IS NULL OR "locked_at" < NOW() - INTERVAL '5 minutes')
        ORDER BY COALESCE("next_attempt_at", "available_at"), "available_at", "id"
        FOR UPDATE SKIP LOCKED
        LIMIT ${CLAIM_BATCH_SIZE}
      )
      UPDATE "outbox_events" AS event
      SET "locked_by" = ${workerId},
          "locked_at" = NOW(),
          "attempt_count" = event."attempt_count" + 1
      FROM candidates
      WHERE event."id" = candidates."id"
      RETURNING event."id",
                event."workspace_id" AS "workspaceId",
                event."event_type" AS "eventType",
                event."aggregate_type" AS "aggregateType",
                event."aggregate_id" AS "aggregateId",
                event."actor_membership_id" AS "actorMembershipId",
                event."payload",
                event."available_at" AS "availableAt",
                event."attempt_count" AS "attemptCount",
                event."created_at" AS "createdAt"
    `;
  }

  async metrics(): Promise<OutboxMetrics> {
    const [metrics] = await this.database.client.$queryRaw<
      Array<{
        failedCount: number;
        oldestPendingSeconds: number;
        pendingCount: number;
      }>
    >`
      SELECT
        COUNT(*) FILTER (
          WHERE "processed_at" IS NULL
            AND "canceled_at" IS NULL
            AND "attempt_count" < ${MAX_ATTEMPTS}
            AND "available_at" <= NOW()
            AND ("next_attempt_at" IS NULL OR "next_attempt_at" <= NOW())
            AND ("locked_at" IS NULL OR "locked_at" < NOW() - INTERVAL '5 minutes')
        )::int AS "pendingCount",
        COALESCE(
          EXTRACT(EPOCH FROM NOW() - MIN("available_at") FILTER (
            WHERE "processed_at" IS NULL
              AND "canceled_at" IS NULL
              AND "attempt_count" < ${MAX_ATTEMPTS}
              AND "available_at" <= NOW()
              AND ("next_attempt_at" IS NULL OR "next_attempt_at" <= NOW())
              AND ("locked_at" IS NULL OR "locked_at" < NOW() - INTERVAL '5 minutes')
          )),
          0
        )::double precision AS "oldestPendingSeconds",
        COUNT(*) FILTER (
          WHERE "processed_at" IS NULL
            AND "canceled_at" IS NULL
            AND "attempt_count" >= ${MAX_ATTEMPTS}
        )::int AS "failedCount"
      FROM "outbox_events"
    `;

    return metrics ?? { failedCount: 0, oldestPendingSeconds: 0, pendingCount: 0 };
  }

  async renewLock(eventId: string, workerId: string): Promise<boolean> {
    const count = await this.database.client.$executeRaw`
      UPDATE "outbox_events"
      SET "locked_at" = NOW()
      WHERE "id" = ${eventId}::uuid
        AND "locked_by" = ${workerId}
        AND "processed_at" IS NULL
        AND "canceled_at" IS NULL
    `;

    return count === 1;
  }

  async complete(eventId: string, workerId: string): Promise<boolean> {
    const count = await this.database.client.$executeRaw`
      UPDATE "outbox_events"
      SET "last_error_code" = NULL,
          "locked_at" = NULL,
          "locked_by" = NULL,
          "processed_at" = NOW()
      WHERE "id" = ${eventId}::uuid
        AND "locked_by" = ${workerId}
        AND "processed_at" IS NULL
        AND "canceled_at" IS NULL
    `;

    return count === 1;
  }

  async cancel(eventId: string, workerId: string, errorCode: string): Promise<boolean> {
    const count = await this.database.client.$executeRaw`
      UPDATE "outbox_events"
      SET "canceled_at" = NOW(),
          "last_error_code" = ${errorCode},
          "locked_at" = NULL,
          "locked_by" = NULL,
          "next_attempt_at" = NULL
      WHERE "id" = ${eventId}::uuid
        AND "locked_by" = ${workerId}
        AND "processed_at" IS NULL
        AND "canceled_at" IS NULL
    `;

    return count === 1;
  }

  async failPermanently(eventId: string, workerId: string, errorCode: string): Promise<boolean> {
    const count = await this.database.client.$executeRaw`
      UPDATE "outbox_events"
      SET "attempt_count" = ${MAX_ATTEMPTS},
          "last_error_code" = ${errorCode},
          "locked_at" = NULL,
          "locked_by" = NULL,
          "next_attempt_at" = NULL
      WHERE "id" = ${eventId}::uuid
        AND "locked_by" = ${workerId}
        AND "processed_at" IS NULL
        AND "canceled_at" IS NULL
    `;

    return count === 1;
  }

  async scheduleRetry(
    eventId: string,
    workerId: string,
    retryDelayMs: number,
    errorCode: string,
  ): Promise<boolean> {
    const count = await this.database.client.$executeRaw`
      UPDATE "outbox_events"
      SET "last_error_code" = ${errorCode},
          "locked_at" = NULL,
          "locked_by" = NULL,
          "next_attempt_at" = NOW() + (${retryDelayMs}::double precision * INTERVAL '1 millisecond')
      WHERE "id" = ${eventId}::uuid
        AND "locked_by" = ${workerId}
        AND "processed_at" IS NULL
        AND "canceled_at" IS NULL
    `;

    return count === 1;
  }
}
