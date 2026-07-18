import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { LoggerModule } from 'nestjs-pino';

import { ISSUE_CREATED } from '@rivet/event-contracts';

import { DatabaseModule } from '../src/common/database/database.module';
import { DatabaseService } from '../src/common/database/database.service';
import { ObservabilityService } from '../src/common/observability/observability.service';
import { workerConfig } from '../src/config/worker.config';
import { AccountEmailHandler } from '../src/modules/outbox/handlers/account-email.handler';
import { ApiHandoffNotificationHandler } from '../src/modules/outbox/handlers/api-handoff-notification.handler';
import { IssueCollaborationNotificationHandler } from '../src/modules/outbox/handlers/issue-collaboration-notification.handler';
import { ResourcePurgeHandler } from '../src/modules/outbox/handlers/resource-purge.handler';
import { WorkspaceInvitationEmailHandler } from '../src/modules/outbox/handlers/workspace-invitation-email.handler';
import { OutboxService } from '../src/modules/outbox/outbox.service';
import { OutboxProcessorService } from '../src/modules/outbox/outbox-processor.service';
import { WebPushDeliveryService } from '../src/modules/web-push/web-push-delivery.service';
import { claimIsolatedOutboxEvent, createTransactionalOutbox } from './outbox-test-helpers';

describe('outbox integration', () => {
  let context: INestApplicationContext;
  let database: DatabaseService;
  let outbox: OutboxService;
  let processor: OutboxProcessorService;
  const capture = jest.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [workerConfig] }),
        LoggerModule.forRoot({ pinoHttp: { enabled: false } }),
        DatabaseModule,
      ],
      providers: [
        { provide: AccountEmailHandler, useValue: { handle: jest.fn() } },
        { provide: ApiHandoffNotificationHandler, useValue: { handle: jest.fn() } },
        {
          provide: IssueCollaborationNotificationHandler,
          useValue: { handleIssueCreated: jest.fn() },
        },
        ResourcePurgeHandler,
        { provide: WorkspaceInvitationEmailHandler, useValue: { handle: jest.fn() } },
        {
          provide: WebPushDeliveryService,
          useValue: { deliverNotifications: jest.fn(), deliverTest: jest.fn() },
        },
        OutboxProcessorService,
        OutboxService,
        {
          provide: ObservabilityService,
          useValue: { alert: jest.fn(), capture, captureException: jest.fn() },
        },
      ],
    }).compile();
    context = module;
    await context.init();
    database = context.get(DatabaseService);
    outbox = context.get(OutboxService);
    processor = context.get(OutboxProcessorService);
  });

  beforeEach(async () => {
    capture.mockClear();
    await database.client.outboxEvent.deleteMany({
      where: { eventType: { startsWith: 'M0_TEST_' } },
    });
  });

  it('keeps the same product event identity across PostgreSQL Outbox reprocessing', async () => {
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const membershipId = randomUUID();
    const issueId = randomUUID();
    const eventId = randomUUID();
    try {
      await database.client.user.create({
        data: {
          displayName: 'A5 outbox integration',
          email: `a5-outbox-${userId}@example.com`,
          emailVerifiedAt: new Date(),
          id: userId,
          normalizedEmail: `a5-outbox-${userId}@example.com`,
          passwordHash: 'not-used-by-test',
        },
      });
      await database.client.workspace.create({
        data: {
          createdByUserId: userId,
          id: workspaceId,
          name: 'A5 Outbox',
          normalizedSlug: `a5-outbox-${userId}`,
          slug: `a5-outbox-${userId}`,
        },
      });
      await database.client.workspaceMembership.create({
        data: { id: membershipId, role: 'ADMIN', userId, workspaceId },
      });
      await database.client.outboxEvent.create({
        data: {
          actorMembershipId: membershipId,
          aggregateId: issueId,
          aggregateType: 'ISSUE',
          eventType: ISSUE_CREATED,
          id: eventId,
          payload: { issueId, mentionedMembershipIds: [], schemaVersion: 1 },
          workspaceId,
        },
      });

      const first = await claimIsolatedOutboxEvent(database, eventId, 'a5-outbox-first');
      await processor.processBatch([first], 'a5-outbox-first');
      await database.client.$executeRaw`
        UPDATE "outbox_events"
        SET "processed_at" = NULL,
            "locked_at" = NULL,
            "locked_by" = NULL,
            "available_at" = NOW() - INTERVAL '1 second'
        WHERE "id" = ${eventId}::uuid
      `;
      const second = await claimIsolatedOutboxEvent(database, eventId, 'a5-outbox-second');
      await processor.processBatch([second], 'a5-outbox-second');

      const productEvents = capture.mock.calls
        .map(([event]) => event)
        .filter((event) => event.name === 'issue_created');
      expect(productEvents).toHaveLength(2);
      expect(productEvents[1].eventId).toBe(productEvents[0].eventId);
      expect(productEvents[0].properties).toEqual({ hasMention: false, issueId });
    } finally {
      await database.client.outboxEvent.deleteMany({ where: { id: eventId } });
      await database.client.workspaceMembership.deleteMany({ where: { id: membershipId } });
      await database.client.workspace.deleteMany({ where: { id: workspaceId } });
      await database.client.user.deleteMany({ where: { id: userId } });
    }
  });

  afterAll(async () => {
    await database.client.outboxEvent.deleteMany({
      where: { eventType: { startsWith: 'M0_TEST_' } },
    });
    await context.close();

    if (process.env.FILE_STORAGE_ROOT) {
      await rm(process.env.FILE_STORAGE_ROOT, { force: true, recursive: true });
    }
  });

  it('claims only due events and increments the attempt atomically', async () => {
    const dueEventId = randomUUID();
    const futureEventId = randomUUID();
    const failedEventId = randomUUID();

    const claimed = await database.client.$transaction(async (transaction) => {
      const transactionalOutbox = createTransactionalOutbox(transaction);

      await transaction.outboxEvent.createMany({
        data: [
          {
            aggregateId: randomUUID(),
            aggregateType: 'ACCOUNT',
            eventType: 'M0_TEST_DUE',
            id: dueEventId,
            payload: { schemaVersion: 1 },
          },
          {
            aggregateId: randomUUID(),
            aggregateType: 'ACCOUNT',
            eventType: 'M0_TEST_FUTURE',
            id: futureEventId,
            payload: { schemaVersion: 1 },
          },
          {
            aggregateId: randomUUID(),
            aggregateType: 'ACCOUNT',
            attemptCount: 7,
            eventType: 'M0_TEST_FAILED',
            id: failedEventId,
            nextAttemptAt: null,
            payload: { schemaVersion: 1 },
          },
        ],
      });
      await transaction.$executeRaw`
        UPDATE "outbox_events"
        SET "available_at" = CASE
          WHEN "id" = ${futureEventId}::uuid THEN NOW() + INTERVAL '1 hour'
          ELSE NOW() - INTERVAL '1 second'
        END
        WHERE "id" IN (${dueEventId}::uuid, ${futureEventId}::uuid, ${failedEventId}::uuid)
      `;

      return transactionalOutbox.claimBatch('worker-test');
    });
    const claimedIds = claimed.map((event) => event.id);

    expect(claimed).toContainEqual(expect.objectContaining({ attemptCount: 1, id: dueEventId }));
    expect(claimedIds).not.toContain(futureEventId);
    expect(claimedIds).not.toContain(failedEventId);
  });

  it('counts only currently claimable events as pending', async () => {
    const dueEventId = randomUUID();
    const futureEventId = randomUUID();
    const lockedEventId = randomUUID();
    const retryWaitEventId = randomUUID();

    const { baseline, metrics } = await database.client.$transaction(
      async (transaction) => {
        const transactionalOutbox = createTransactionalOutbox(transaction);
        const baseline = await transactionalOutbox.metrics();

        await transaction.outboxEvent.createMany({
          data: [
            {
              aggregateId: randomUUID(),
              aggregateType: 'ACCOUNT',
              eventType: 'M0_TEST_METRICS_DUE',
              id: dueEventId,
              payload: { schemaVersion: 1 },
            },
            {
              aggregateId: randomUUID(),
              aggregateType: 'ACCOUNT',
              eventType: 'M0_TEST_METRICS_FUTURE',
              id: futureEventId,
              payload: { schemaVersion: 1 },
            },
            {
              aggregateId: randomUUID(),
              aggregateType: 'ACCOUNT',
              eventType: 'M0_TEST_METRICS_LOCKED',
              id: lockedEventId,
              payload: { schemaVersion: 1 },
            },
            {
              aggregateId: randomUUID(),
              aggregateType: 'ACCOUNT',
              eventType: 'M0_TEST_METRICS_RETRY_WAIT',
              id: retryWaitEventId,
              payload: { schemaVersion: 1 },
            },
          ],
        });
        await transaction.$executeRaw`
          UPDATE "outbox_events"
          SET "available_at" = NOW() - INTERVAL '1 second'
          WHERE "id" IN (
            ${dueEventId}::uuid,
            ${futureEventId}::uuid,
            ${lockedEventId}::uuid,
            ${retryWaitEventId}::uuid
          )
        `;
        await transaction.$executeRaw`
          UPDATE "outbox_events"
          SET "available_at" = NOW() + INTERVAL '1 hour'
          WHERE "id" = ${futureEventId}::uuid
        `;
        await transaction.$executeRaw`
          UPDATE "outbox_events"
          SET "locked_at" = NOW(), "locked_by" = 'active-worker'
          WHERE "id" = ${lockedEventId}::uuid
        `;
        await transaction.$executeRaw`
          UPDATE "outbox_events"
          SET "next_attempt_at" = NOW() + INTERVAL '1 hour'
          WHERE "id" = ${retryWaitEventId}::uuid
        `;

        const metrics = await transactionalOutbox.metrics();
        await transaction.outboxEvent.deleteMany({
          where: { eventType: { startsWith: 'M0_TEST_METRICS_' } },
        });
        return { baseline, metrics };
      },
      { isolationLevel: 'RepeatableRead' },
    );

    expect(metrics.pendingCount).toBe(baseline.pendingCount + 1);
  });

  it('recovers an expired lock without taking an active lock', async () => {
    const expiredEventId = randomUUID();
    const activeEventId = randomUUID();

    const claimed = await database.client.$transaction(async (transaction) => {
      const transactionalOutbox = createTransactionalOutbox(transaction);

      await transaction.outboxEvent.createMany({
        data: [
          {
            aggregateId: randomUUID(),
            aggregateType: 'ACCOUNT',
            eventType: 'M0_TEST_EXPIRED_LOCK',
            id: expiredEventId,
            payload: { schemaVersion: 1 },
          },
          {
            aggregateId: randomUUID(),
            aggregateType: 'ACCOUNT',
            eventType: 'M0_TEST_ACTIVE_LOCK',
            id: activeEventId,
            payload: { schemaVersion: 1 },
          },
        ],
      });
      await transaction.$executeRaw`
        UPDATE "outbox_events"
        SET "available_at" = NOW() - INTERVAL '1 second',
            "locked_at" = CASE
              WHEN "id" = ${expiredEventId}::uuid THEN NOW() - INTERVAL '6 minutes'
              ELSE NOW()
            END,
            "locked_by" = CASE
              WHEN "id" = ${expiredEventId}::uuid THEN 'stopped-worker'
              ELSE 'active-worker'
            END
        WHERE "id" IN (${expiredEventId}::uuid, ${activeEventId}::uuid)
      `;

      return transactionalOutbox.claimBatch('recovery-worker');
    });
    const claimedIds = claimed.map((event) => event.id);

    expect(claimedIds).toContain(expiredEventId);
    expect(claimedIds).not.toContain(activeEventId);
  });

  it('uses the database clock for lock, completion, and retry timestamps', async () => {
    const completedEventId = randomUUID();
    const retryEventId = randomUUID();

    await database.client.outboxEvent.createMany({
      data: [
        {
          aggregateId: randomUUID(),
          aggregateType: 'ACCOUNT',
          eventType: 'M0_TEST_DATABASE_CLOCK_COMPLETED',
          id: completedEventId,
          lockedAt: new Date(),
          lockedBy: 'clock-worker',
          payload: { schemaVersion: 1 },
        },
        {
          aggregateId: randomUUID(),
          aggregateType: 'ACCOUNT',
          eventType: 'M0_TEST_DATABASE_CLOCK_RETRY',
          id: retryEventId,
          lockedAt: new Date(),
          lockedBy: 'clock-worker',
          payload: { schemaVersion: 1 },
        },
      ],
    });
    await database.client.$executeRaw`
      UPDATE "outbox_events"
      SET "locked_at" = NOW() - INTERVAL '1 minute',
          "locked_by" = 'clock-worker'
      WHERE "id" IN (${completedEventId}::uuid, ${retryEventId}::uuid)
    `;

    await expect(outbox.renewLock(completedEventId, 'clock-worker')).resolves.toBe(true);
    await expect(outbox.complete(completedEventId, 'clock-worker')).resolves.toBe(true);
    await expect(
      outbox.scheduleRetry(retryEventId, 'clock-worker', 30_000, 'M0_TEST_RETRY'),
    ).resolves.toBe(true);

    const [timestamps] = await database.client.$queryRaw<Array<{ completedDriftMs: number }>>`
      SELECT round(abs(EXTRACT(EPOCH FROM ("processed_at" - NOW()))) * 1000)::integer AS "completedDriftMs"
      FROM "outbox_events"
      WHERE "id" = ${completedEventId}::uuid
    `;
    const [retryTimestamp] = await database.client.$queryRaw<Array<{ retryDelayMs: number }>>`
      SELECT round(EXTRACT(EPOCH FROM ("next_attempt_at" - NOW())) * 1000)::integer AS "retryDelayMs"
      FROM "outbox_events"
      WHERE "id" = ${retryEventId}::uuid
    `;

    expect(timestamps?.completedDriftMs).toBeLessThan(2_000);
    expect(retryTimestamp?.retryDelayMs).toBeGreaterThan(28_000);
    expect(retryTimestamp?.retryDelayMs).toBeLessThanOrEqual(30_000);
  });

  it('does not overwrite a cancellation that wins the result race', async () => {
    const eventId = randomUUID();

    await database.client.outboxEvent.create({
      data: {
        aggregateId: randomUUID(),
        aggregateType: 'ACCOUNT',
        eventType: 'M0_TEST_CANCELED_RACE',
        id: eventId,
        lockedAt: new Date(),
        lockedBy: 'race-worker',
        payload: { schemaVersion: 1 },
      },
    });
    await database.client.$executeRaw`
      UPDATE "outbox_events"
      SET "canceled_at" = NOW(),
          "locked_at" = NOW(),
          "locked_by" = 'race-worker'
      WHERE "id" = ${eventId}::uuid
    `;

    await expect(outbox.complete(eventId, 'race-worker')).resolves.toBe(false);
    await expect(outbox.cancel(eventId, 'race-worker', 'M0_TEST_CANCELED')).resolves.toBe(false);
    await expect(outbox.failPermanently(eventId, 'race-worker', 'M0_TEST_FAILED')).resolves.toBe(
      false,
    );
    await expect(
      outbox.scheduleRetry(eventId, 'race-worker', 30_000, 'M0_TEST_RETRY'),
    ).resolves.toBe(false);

    const event = await database.client.outboxEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(event).toMatchObject({
      attemptCount: 0,
      lastErrorCode: null,
      nextAttemptAt: null,
      processedAt: null,
    });
    expect(event.canceledAt).not.toBeNull();
  });

  it('isolates an unsupported event as a permanent failure', async () => {
    const eventId = randomUUID();
    const claimed = await database.client.$transaction(async (transaction) => {
      const transactionalOutbox = createTransactionalOutbox(transaction);

      await transaction.outboxEvent.create({
        data: {
          aggregateId: randomUUID(),
          aggregateType: 'ACCOUNT',
          eventType: 'M0_TEST_UNSUPPORTED',
          id: eventId,
          payload: { schemaVersion: 1 },
        },
      });
      await transaction.$executeRaw`
        UPDATE "outbox_events"
        SET "available_at" = NOW() - INTERVAL '1 second'
        WHERE "id" = ${eventId}::uuid
      `;

      return transactionalOutbox.claimBatch('processor-worker');
    });

    await processor.processBatch(
      claimed.filter((candidate) => candidate.id === eventId),
      'processor-worker',
    );

    const failed = await database.client.outboxEvent.findUniqueOrThrow({
      where: { id: eventId },
    });
    expect(failed).toMatchObject({
      attemptCount: 7,
      lastErrorCode: 'OUTBOX_EVENT_TYPE_UNSUPPORTED',
      lockedAt: null,
      lockedBy: null,
      nextAttemptAt: null,
      processedAt: null,
    });
  });
});
