import type { Prisma } from '@rivet/database';

import type { DatabaseService } from '../src/common/database/database.service';
import { OutboxService } from '../src/modules/outbox/outbox.service';
import type { ClaimedOutboxEvent } from '../src/modules/outbox/outbox.types';

export const ISOLATED_OUTBOX_AVAILABLE_AT = new Date('2099-01-01T00:00:00.000Z');

export function createTransactionalOutbox(transaction: Prisma.TransactionClient): OutboxService {
  return new OutboxService({ client: transaction } as DatabaseService);
}

export async function claimIsolatedOutboxEvent(
  database: DatabaseService,
  eventId: string,
  workerId: string,
): Promise<ClaimedOutboxEvent> {
  return database.client.$transaction(async (transaction) => {
    const [claimed] = await transaction.$queryRaw<ClaimedOutboxEvent[]>`
      UPDATE "outbox_events"
      SET "available_at" = NOW() - INTERVAL '1 second',
          "locked_by" = ${workerId},
          "locked_at" = NOW(),
          "attempt_count" = "attempt_count" + 1
      WHERE "id" = ${eventId}::uuid
        AND "processed_at" IS NULL
        AND "canceled_at" IS NULL
        AND "next_attempt_at" IS NULL
        AND "locked_at" IS NULL
      RETURNING "id",
                "workspace_id" AS "workspaceId",
                "event_type" AS "eventType",
                "aggregate_type" AS "aggregateType",
                "aggregate_id" AS "aggregateId",
                "actor_membership_id" AS "actorMembershipId",
                "payload",
                "available_at" AS "availableAt",
                "attempt_count" AS "attemptCount",
                "created_at" AS "createdAt"
    `;

    if (!claimed) {
      throw new Error(`격리된 테스트 Outbox 이벤트를 claim하지 못했습니다: ${eventId}`);
    }

    return claimed;
  });
}
