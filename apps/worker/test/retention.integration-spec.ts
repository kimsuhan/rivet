import { randomBytes, randomUUID } from 'node:crypto';

import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';

import { EmailTemplateType, ExportType, MembershipRole, TokenPurpose } from '@rivet/database';

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
  let activeTokenId: string;
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
        activeTokenId: activeToken.id,
        completedAuditId: completedAudit.id,
        expiredBucketId: expiredBucket.id,
        expiredSessionId: expiredSession.id,
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
    activeTokenId = fixture.activeTokenId;
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
        database.client.oneTimeToken.findUnique({ where: { id: activeTokenId } }),
        database.client.outboxEvent.findUnique({ where: { id: failedOutboxId } }),
        database.client.outboxEvent.findUnique({ where: { id: recentOutboxId } }),
        database.client.exportAudit.findUnique({ where: { id: unfinishedAuditId } }),
      ]),
    ).resolves.toEqual([
      expect.objectContaining({ id: activeSessionId }),
      expect.objectContaining({ id: activeTokenId }),
      expect.objectContaining({ id: failedOutboxId }),
      expect.objectContaining({ id: recentOutboxId }),
      expect.objectContaining({ id: unfinishedAuditId }),
    ]);

    await expect(service.cleanup(`retention-${runId}-again`)).resolves.toEqual({
      deletedEmailDeliveries: 0,
      deletedExportAudits: 0,
      deletedOutboxEvents: 0,
      deletedRateLimitBuckets: 0,
      deletedSessions: 0,
      deletedTokens: 0,
      failedSteps: 0,
    });
  });
});
