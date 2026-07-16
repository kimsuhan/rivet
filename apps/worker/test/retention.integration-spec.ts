import { randomBytes, randomUUID } from 'node:crypto';

import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';

import {
  EmailTemplateType,
  ExportType,
  MembershipRole,
  TokenPurpose,
  WebPushBrowser,
  WebPushSubscriptionStatus,
} from '@rivet/database';

import { DatabaseModule } from '../src/common/database/database.module';
import { DatabaseService } from '../src/common/database/database.service';
import { ObservabilityService } from '../src/common/observability/observability.service';
import { workerConfig } from '../src/config/worker.config';
import { RetentionService } from '../src/modules/maintenance/retention.service';

describe('retention cleanup integration', () => {
  const runId = randomUUID().slice(0, 8);
  const old = new Date('2025-01-01T00:00:00.000Z');
  const beforeOld = new Date('2024-12-31T00:00:00.000Z');
  const future = new Date('2099-01-01T00:00:00.000Z');
  const outboxIds: string[] = [];
  const rateLimitIds: string[] = [];
  let context: INestApplicationContext;
  let database: DatabaseService;
  let service: RetentionService;
  let userId: string;
  let workspaceId: string;
  let membershipId: string;
  let failedOutboxId: string;
  let recentOutboxId: string;
  let activeSessionId: string;
  let activeSubscriptionId: string;
  let activeTokenId: string;
  let expiredSessionId: string;
  let expiredSubscriptionId: string;
  let unfinishedAuditId: string;
  let fixtureReady = false;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, load: [workerConfig] }), DatabaseModule],
      providers: [
        RetentionService,
        {
          provide: ObservabilityService,
          useValue: { alert: jest.fn() },
        },
        {
          provide: PinoLogger,
          useValue: { warn: jest.fn() },
        },
      ],
    }).compile();
    context = module;
    await context.init();
    database = context.get(DatabaseService);
    service = context.get(RetentionService);

    const fixture = await database.client.$transaction(async (transaction) => {
      const user = await transaction.user.create({
        data: {
          displayName: '보존 정리 관리자',
          email: `m7.retention.${runId}@example.com`,
          normalizedEmail: `m7.retention.${runId}@example.com`,
          passwordHash: '$argon2id$retention-fixture',
        },
      });
      const workspace = await transaction.workspace.create({
        data: {
          createdByUserId: user.id,
          name: '보존 정리 워크스페이스',
          normalizedSlug: `m7-retention-${runId}`,
          slug: `m7-retention-${runId}`,
        },
      });
      const membership = await transaction.workspaceMembership.create({
        data: { role: MembershipRole.ADMIN, userId: user.id, workspaceId: workspace.id },
      });

      const [expiredSession, activeSession] = await Promise.all([
        transaction.session.create({
          data: {
            absoluteExpiresAt: old,
            createdAt: beforeOld,
            idleExpiresAt: old,
            lastSeenAt: old,
            tokenHash: randomBytes(32),
            userId: user.id,
          },
        }),
        transaction.session.create({
          data: {
            absoluteExpiresAt: future,
            idleExpiresAt: future,
            lastSeenAt: new Date(),
            tokenHash: randomBytes(32),
            userId: user.id,
          },
        }),
      ]);
      const [expiredToken, activeToken] = await Promise.all([
        transaction.oneTimeToken.create({
          data: {
            expiresAt: old,
            createdAt: beforeOld,
            purpose: TokenPurpose.EMAIL_VERIFICATION,
            tokenHash: randomBytes(32),
            usedAt: old,
            userId: user.id,
          },
        }),
        transaction.oneTimeToken.create({
          data: {
            expiresAt: future,
            purpose: TokenPurpose.EMAIL_VERIFICATION,
            tokenHash: randomBytes(32),
            userId: user.id,
          },
        }),
      ]);
      const [expiredSubscription, activeSubscription] = await Promise.all([
        transaction.webPushSubscription.create({
          data: {
            auth: 'expired-auth',
            browser: WebPushBrowser.CHROME,
            endpoint: `https://push.example.test/expired-${runId}`,
            endpointHash: randomBytes(32).toString('hex'),
            membershipId: membership.id,
            p256dh: 'expired-p256dh',
            sessionId: expiredSession.id,
            workspaceId: workspace.id,
          },
        }),
        transaction.webPushSubscription.create({
          data: {
            auth: 'active-auth',
            browser: WebPushBrowser.FIREFOX,
            endpoint: `https://push.example.test/active-${runId}`,
            endpointHash: randomBytes(32).toString('hex'),
            membershipId: membership.id,
            p256dh: 'active-p256dh',
            sessionId: activeSession.id,
            workspaceId: workspace.id,
          },
        }),
      ]);
      const [expiredBucket, activeBucket] = await Promise.all([
        transaction.authRateLimitBucket.create({
          data: {
            expiresAt: old,
            keyHash: randomBytes(32),
            scope: `retention-expired-${runId}`,
            windowStartedAt: beforeOld,
          },
        }),
        transaction.authRateLimitBucket.create({
          data: {
            expiresAt: future,
            keyHash: randomBytes(32),
            scope: `retention-active-${runId}`,
            windowStartedAt: new Date(),
          },
        }),
      ]);

      const createOutbox = (data: {
        canceledAt?: Date;
        lastErrorCode?: string;
        processedAt?: Date;
      }) =>
        transaction.outboxEvent.create({
          data: {
            actorMembershipId: membership.id,
            aggregateId: randomUUID(),
            aggregateType: 'RETENTION_TEST',
            attemptCount: data.lastErrorCode ? 10 : 0,
            availableAt: old,
            createdAt: old,
            eventType: 'RETENTION_TEST',
            payload: { schemaVersion: 1 },
            ...(data.canceledAt ? { canceledAt: data.canceledAt } : {}),
            ...(data.lastErrorCode ? { lastErrorCode: data.lastErrorCode } : {}),
            ...(data.processedAt ? { processedAt: data.processedAt } : {}),
            workspaceId: workspace.id,
          },
        });
      const [processed, canceled, failed, recent, emailOutbox] = await Promise.all([
        createOutbox({ processedAt: old }),
        createOutbox({ canceledAt: old }),
        createOutbox({ lastErrorCode: 'EXPECTED_FAILED_EVENT' }),
        createOutbox({ processedAt: new Date() }),
        createOutbox({ processedAt: old }),
      ]);
      await transaction.emailDelivery.create({
        data: {
          outboxEventId: emailOutbox.id,
          createdAt: old,
          providerMessageId: randomUUID(),
          recipientEmail: `m7.retention.${runId}@example.com`,
          sentAt: old,
          templateType: EmailTemplateType.EMAIL_VERIFICATION,
          updatedAt: old,
        },
      });
      const [completedAudit, unfinishedAudit] = await Promise.all([
        transaction.exportAudit.create({
          data: {
            completedAt: old,
            itemCount: 1,
            requestedAt: old,
            requestedByMembershipId: membership.id,
            type: ExportType.ISSUES,
            workspaceId: workspace.id,
          },
        }),
        transaction.exportAudit.create({
          data: {
            requestedAt: old,
            requestedByMembershipId: membership.id,
            type: ExportType.PROJECTS,
            workspaceId: workspace.id,
          },
        }),
      ]);

      return {
        activeSessionId: activeSession.id,
        activeSubscriptionId: activeSubscription.id,
        activeTokenId: activeToken.id,
        completedAuditId: completedAudit.id,
        expiredBucketId: expiredBucket.id,
        expiredSessionId: expiredSession.id,
        expiredSubscriptionId: expiredSubscription.id,
        expiredTokenId: expiredToken.id,
        failedOutboxId: failed.id,
        membershipId: membership.id,
        outboxIds: [processed.id, canceled.id, failed.id, recent.id, emailOutbox.id],
        rateLimitIds: [expiredBucket.id, activeBucket.id],
        recentOutboxId: recent.id,
        unfinishedAuditId: unfinishedAudit.id,
        userId: user.id,
        workspaceId: workspace.id,
      };
    });

    userId = fixture.userId;
    workspaceId = fixture.workspaceId;
    membershipId = fixture.membershipId;
    failedOutboxId = fixture.failedOutboxId;
    recentOutboxId = fixture.recentOutboxId;
    activeSessionId = fixture.activeSessionId;
    activeSubscriptionId = fixture.activeSubscriptionId;
    activeTokenId = fixture.activeTokenId;
    expiredSessionId = fixture.expiredSessionId;
    expiredSubscriptionId = fixture.expiredSubscriptionId;
    unfinishedAuditId = fixture.unfinishedAuditId;
    outboxIds.push(...fixture.outboxIds);
    rateLimitIds.push(...fixture.rateLimitIds);
    fixtureReady = true;
  });

  afterAll(async () => {
    if (database && fixtureReady) {
      await database.client.exportAudit.deleteMany({ where: { workspaceId } });
      await database.client.emailDelivery.deleteMany({
        where: { outboxEventId: { in: outboxIds } },
      });
      await database.client.outboxEvent.deleteMany({ where: { id: { in: outboxIds } } });
      await database.client.authRateLimitBucket.deleteMany({ where: { id: { in: rateLimitIds } } });
      await database.client.webPushSubscription.deleteMany({ where: { workspaceId } });
      await database.client.session.deleteMany({ where: { userId } });
      await database.client.oneTimeToken.deleteMany({ where: { userId } });
      await database.client.workspaceMembership.deleteMany({ where: { id: membershipId } });
      await database.client.workspace.deleteMany({ where: { id: workspaceId } });
      await database.client.user.deleteMany({ where: { id: userId } });
    }
    await context?.close();
  });

  it('deletes only expired terminal rows and is idempotent', async () => {
    await expect(service.cleanup(`retention-${runId}`)).resolves.toEqual({
      deactivatedPushSubscriptions: 1,
      deletedEmailDeliveries: 1,
      deletedExportAudits: 1,
      deletedOutboxEvents: 3,
      deletedRateLimitBuckets: 1,
      deletedSessions: 1,
      deletedTokens: 1,
      failedSteps: 0,
    });

    await expect(
      Promise.all([
        database.client.session.findUnique({ where: { id: activeSessionId } }),
        database.client.session.findUnique({ where: { id: expiredSessionId } }),
        database.client.webPushSubscription.findUnique({ where: { id: activeSubscriptionId } }),
        database.client.webPushSubscription.findUnique({ where: { id: expiredSubscriptionId } }),
        database.client.oneTimeToken.findUnique({ where: { id: activeTokenId } }),
        database.client.outboxEvent.findUnique({ where: { id: failedOutboxId } }),
        database.client.outboxEvent.findUnique({ where: { id: recentOutboxId } }),
        database.client.exportAudit.findUnique({ where: { id: unfinishedAuditId } }),
      ]),
    ).resolves.toEqual([
      expect.objectContaining({ id: activeSessionId }),
      null,
      expect.objectContaining({
        id: activeSubscriptionId,
        sessionId: activeSessionId,
        status: WebPushSubscriptionStatus.ACTIVE,
      }),
      expect.objectContaining({
        auth: null,
        endpoint: null,
        id: expiredSubscriptionId,
        lastErrorCode: 'WEB_PUSH_SESSION_INACTIVE',
        p256dh: null,
        sessionId: null,
        status: WebPushSubscriptionStatus.EXPIRED,
      }),
      expect.objectContaining({ id: activeTokenId }),
      expect.objectContaining({ id: failedOutboxId }),
      expect.objectContaining({ id: recentOutboxId }),
      expect.objectContaining({ id: unfinishedAuditId }),
    ]);

    await expect(service.cleanup(`retention-${runId}-again`)).resolves.toEqual({
      deactivatedPushSubscriptions: 0,
      deletedEmailDeliveries: 0,
      deletedExportAudits: 0,
      deletedOutboxEvents: 0,
      deletedRateLimitBuckets: 0,
      deletedSessions: 0,
      deletedTokens: 0,
      failedSteps: 0,
    });
  });

  it('keeps an expired session until its locked active push subscription can be cleaned', async () => {
    const lockedSession = await database.client.session.create({
      data: {
        absoluteExpiresAt: old,
        createdAt: beforeOld,
        idleExpiresAt: old,
        lastSeenAt: old,
        tokenHash: randomBytes(32),
        userId,
      },
    });
    const lockedSubscription = await database.client.webPushSubscription.create({
      data: {
        auth: 'locked-auth',
        browser: WebPushBrowser.CHROME,
        endpoint: `https://push.example.test/locked-${runId}`,
        endpointHash: randomBytes(32).toString('hex'),
        membershipId,
        p256dh: 'locked-p256dh',
        sessionId: lockedSession.id,
        workspaceId,
      },
    });
    let notifyLockAcquired: () => void = () => undefined;
    let releaseLock: () => void = () => undefined;
    const lockAcquired = new Promise<void>((resolve) => {
      notifyLockAcquired = resolve;
    });
    const lockReleased = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const lockTransaction = database.client.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id"
        FROM "web_push_subscriptions"
        WHERE "id" = ${lockedSubscription.id}::uuid
        FOR UPDATE
      `;
      notifyLockAcquired();
      await lockReleased;
    });
    await lockAcquired;

    const cleanup = service.cleanup(`retention-${runId}-locked`);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        cleanup,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error('잠긴 활성 Push 구독 때문에 세션 정리가 대기했습니다.')),
            2_000,
          );
        }),
      ]);
      expect(result.deactivatedPushSubscriptions).toBe(0);
      expect(result.deletedSessions).toBe(0);
      await expect(
        Promise.all([
          database.client.session.findUnique({ where: { id: lockedSession.id } }),
          database.client.webPushSubscription.findUnique({
            where: { id: lockedSubscription.id },
          }),
        ]),
      ).resolves.toEqual([
        expect.objectContaining({ id: lockedSession.id }),
        expect.objectContaining({
          id: lockedSubscription.id,
          sessionId: lockedSession.id,
          status: WebPushSubscriptionStatus.ACTIVE,
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
      releaseLock();
      await lockTransaction;
      await cleanup.catch(() => undefined);
    }

    const recovered = await service.cleanup(`retention-${runId}-locked-recovered`);
    expect(recovered.deactivatedPushSubscriptions).toBe(1);
    expect(recovered.deletedSessions).toBe(1);
    await expect(
      Promise.all([
        database.client.session.findUnique({ where: { id: lockedSession.id } }),
        database.client.webPushSubscription.findUnique({ where: { id: lockedSubscription.id } }),
      ]),
    ).resolves.toEqual([
      null,
      expect.objectContaining({
        auth: null,
        endpoint: null,
        id: lockedSubscription.id,
        p256dh: null,
        sessionId: null,
        status: WebPushSubscriptionStatus.EXPIRED,
      }),
    ]);
  });
});
