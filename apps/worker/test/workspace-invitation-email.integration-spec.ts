import { randomBytes, randomUUID } from 'node:crypto';

import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { LoggerModule } from 'nestjs-pino';

import { MembershipRole, MembershipStatus, TokenPurpose } from '@rivet/database';
import {
  WORKSPACE_INVITATION_REQUESTED,
  type WorkspaceInvitationEmailOutboxPayload,
} from '@rivet/event-contracts';

import { DatabaseModule } from '../src/common/database/database.module';
import { DatabaseService } from '../src/common/database/database.service';
import { ObservabilityService } from '../src/common/observability/observability.service';
import { workerConfig } from '../src/config/worker.config';
import { EmailDeliveryService } from '../src/modules/email/email-delivery.service';
import { EmailSenderService } from '../src/modules/email/email-sender.service';
import { AccountEmailHandler } from '../src/modules/outbox/handlers/account-email.handler';
import { ApiHandoffNotificationHandler } from '../src/modules/outbox/handlers/api-handoff-notification.handler';
import { IssueCollaborationNotificationHandler } from '../src/modules/outbox/handlers/issue-collaboration-notification.handler';
import { ResourcePurgeHandler } from '../src/modules/outbox/handlers/resource-purge.handler';
import { WorkspaceInvitationEmailHandler } from '../src/modules/outbox/handlers/workspace-invitation-email.handler';
import { OutboxService } from '../src/modules/outbox/outbox.service';
import type { ClaimedOutboxEvent } from '../src/modules/outbox/outbox.types';
import { OutboxProcessorService } from '../src/modules/outbox/outbox-processor.service';
import { WebPushDeliveryService } from '../src/modules/web-push/web-push-delivery.service';
import { claimIsolatedOutboxEvent, ISOLATED_OUTBOX_AVAILABLE_AT } from './outbox-test-helpers';

describe('workspace invitation email integration', () => {
  const emailSender = { send: jest.fn() };
  const invitationIds: string[] = [];
  const outboxEventIds: string[] = [];
  const tokenIds: string[] = [];
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  let context: INestApplicationContext;
  let database: DatabaseService;
  let handler: WorkspaceInvitationEmailHandler;
  let processor: OutboxProcessorService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [workerConfig] }),
        LoggerModule.forRoot({ pinoHttp: { enabled: false } }),
        DatabaseModule,
      ],
      providers: [
        EmailDeliveryService,
        { provide: EmailSenderService, useValue: emailSender },
        { provide: AccountEmailHandler, useValue: { handle: jest.fn() } },
        { provide: ApiHandoffNotificationHandler, useValue: { handle: jest.fn() } },
        { provide: IssueCollaborationNotificationHandler, useValue: {} },
        ResourcePurgeHandler,
        WorkspaceInvitationEmailHandler,
        {
          provide: WebPushDeliveryService,
          useValue: { deliverNotifications: jest.fn(), deliverTest: jest.fn() },
        },
        OutboxProcessorService,
        OutboxService,
        {
          provide: ObservabilityService,
          useValue: { alert: jest.fn(), capture: jest.fn(), captureException: jest.fn() },
        },
      ],
    }).compile();
    context = module;
    await context.init();
    database = context.get(DatabaseService);
    handler = context.get(WorkspaceInvitationEmailHandler);
    processor = context.get(OutboxProcessorService);
  });

  beforeEach(() => {
    emailSender.send.mockReset().mockResolvedValue({ providerMessageId: randomUUID() });
  });

  afterEach(async () => {
    await database.client.emailDelivery.deleteMany({
      where: { outboxEventId: { in: outboxEventIds } },
    });
    await database.client.outboxEvent.deleteMany({ where: { id: { in: outboxEventIds } } });
    await database.client.oneTimeToken.deleteMany({ where: { id: { in: tokenIds } } });
    await database.client.workspaceInvitation.deleteMany({
      where: { id: { in: invitationIds } },
    });
    await database.client.workspaceMembership.deleteMany({ where: { userId: { in: userIds } } });
    await database.client.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await database.client.user.deleteMany({ where: { id: { in: userIds } } });
    invitationIds.length = 0;
    outboxEventIds.length = 0;
    tokenIds.length = 0;
    userIds.length = 0;
    workspaceIds.length = 0;
  });

  afterAll(async () => {
    await context.close();
  });

  async function createFixture(
    options: {
      invitationState?: 'ACCEPTED' | 'CANCELED' | 'EXPIRED' | 'PENDING';
      inviterStatus?: MembershipStatus;
      tokenActive?: boolean;
    } = {},
  ): Promise<{
    eventId: string;
    payload: WorkspaceInvitationEmailOutboxPayload;
  }> {
    const inviterUserId = randomUUID();
    const inviterMembershipId = randomUUID();
    const workspaceId = randomUUID();
    const invitationId = randomUUID();
    const tokenId = randomUUID();
    const eventId = randomUUID();
    const invitationState = options.invitationState ?? 'PENDING';
    const createdAt =
      invitationState === 'EXPIRED'
        ? new Date('2026-06-01T00:00:00.000Z')
        : new Date('2026-07-11T00:00:00.000Z');
    const expiresAt =
      invitationState === 'EXPIRED'
        ? new Date('2026-06-08T00:00:00.000Z')
        : new Date('2099-01-01T00:00:00.000Z');
    let acceptedByUserId: string | undefined;

    userIds.push(inviterUserId);
    workspaceIds.push(workspaceId);
    invitationIds.push(invitationId);
    tokenIds.push(tokenId);
    outboxEventIds.push(eventId);

    await database.client.user.create({
      data: {
        displayName: '초대 관리자 <테스트>',
        email: `m2-inviter-${inviterUserId}@example.test`,
        emailVerifiedAt: new Date(),
        id: inviterUserId,
        normalizedEmail: `m2-inviter-${inviterUserId}@example.test`,
        passwordHash: 'test-password-hash',
      },
    });
    await database.client.$transaction(async (transaction) => {
      await transaction.workspace.create({
        data: {
          createdByUserId: inviterUserId,
          id: workspaceId,
          name: 'M2 초대 & 워크스페이스',
          normalizedSlug: `invite-${workspaceId}`,
          slug: `invite-${workspaceId}`,
        },
      });
      await transaction.workspaceMembership.create({
        data: {
          deactivatedAt: options.inviterStatus === MembershipStatus.INACTIVE ? new Date() : null,
          id: inviterMembershipId,
          role: MembershipRole.ADMIN,
          status: options.inviterStatus ?? MembershipStatus.ACTIVE,
          userId: inviterUserId,
          workspaceId,
        },
      });
    });

    if (invitationState === 'ACCEPTED') {
      acceptedByUserId = randomUUID();
      userIds.push(acceptedByUserId);
      await database.client.user.create({
        data: {
          displayName: '초대 수락 사용자',
          email: `m2-acceptor-${acceptedByUserId}@example.test`,
          emailVerifiedAt: new Date(),
          id: acceptedByUserId,
          normalizedEmail: `m2-acceptor-${acceptedByUserId}@example.test`,
          passwordHash: 'test-password-hash',
        },
      });
    }

    await database.client.workspaceInvitation.create({
      data: {
        acceptedAt: invitationState === 'ACCEPTED' ? new Date('2026-07-11T01:00:00.000Z') : null,
        acceptedByUserId: acceptedByUserId ?? null,
        canceledAt: invitationState === 'CANCELED' ? new Date('2026-07-11T01:00:00.000Z') : null,
        createdAt,
        email: `m2-invitee-${invitationId}@example.test`,
        expiresAt,
        id: invitationId,
        invitedByMembershipId: inviterMembershipId,
        normalizedEmail: `m2-invitee-${invitationId}@example.test`,
        workspaceId,
      },
    });
    await database.client.oneTimeToken.create({
      data: {
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
        id: tokenId,
        invitationId,
        purpose: TokenPurpose.WORKSPACE_INVITATION,
        revokedAt: options.tokenActive === false ? new Date() : null,
        tokenHash: randomBytes(32),
      },
    });

    const payload = {
      currentMemberCount: 1,
      invitationId,
      schemaVersion: 1 as const,
      tokenId,
    };
    await database.client.outboxEvent.create({
      data: {
        actorMembershipId: inviterMembershipId,
        aggregateId: invitationId,
        aggregateType: 'WORKSPACE_INVITATION',
        availableAt: ISOLATED_OUTBOX_AVAILABLE_AT,
        eventType: WORKSPACE_INVITATION_REQUESTED,
        id: eventId,
        payload,
        workspaceId,
      },
    });

    return { eventId, payload };
  }

  async function processEvent(eventId: string, workerId: string): Promise<ClaimedOutboxEvent> {
    const claimed = await claimIsolatedOutboxEvent(database, eventId, workerId);

    await processor.processBatch([claimed], workerId);
    return claimed;
  }

  it('sends an idempotent workspace invitation to the invitation address', async () => {
    const fixture = await createFixture();
    const claimed = await processEvent(fixture.eventId, 'invitation-success-worker');

    await handler.handle(claimed, fixture.payload);

    expect(emailSender.send).toHaveBeenCalledTimes(1);
    expect(emailSender.send).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining('M2 초대 &amp; 워크스페이스'),
        outboxEventId: fixture.eventId,
        recipient: `m2-invitee-${fixture.payload.invitationId}@example.test`,
        subject: '[Rivet] 워크스페이스 초대를 확인해 주세요',
        text: expect.stringMatching(/\/invite#token=/),
      }),
    );
    await expect(
      database.client.emailDelivery.findUniqueOrThrow({
        where: { outboxEventId: fixture.eventId },
      }),
    ).resolves.toMatchObject({
      recipientEmail: `m2-invitee-${fixture.payload.invitationId}@example.test`,
      sentAt: expect.any(Date),
      templateType: 'WORKSPACE_INVITATION',
    });
  });

  it('permanently rejects an event workspace that does not match the invitation', async () => {
    const fixture = await createFixture();
    const claimed = await claimIsolatedOutboxEvent(
      database,
      fixture.eventId,
      'invitation-workspace-worker',
    );

    await expect(
      handler.handle({ ...claimed, workspaceId: randomUUID() }, fixture.payload),
    ).rejects.toMatchObject({ code: 'OUTBOX_EVENT_CONTRACT_INVALID' });
    expect(emailSender.send).not.toHaveBeenCalled();
  });

  it.each([
    ['accepted invitation', { invitationState: 'ACCEPTED' as const }],
    ['canceled invitation', { invitationState: 'CANCELED' as const }],
    ['expired invitation', { invitationState: 'EXPIRED' as const }],
    ['inactive token', { tokenActive: false }],
    ['inactive inviter', { inviterStatus: MembershipStatus.INACTIVE }],
  ])('cancels an %s before sending', async (_name, options) => {
    const fixture = await createFixture(options);

    await processEvent(fixture.eventId, `invitation-cancel-${fixture.eventId}`);

    await expect(
      database.client.outboxEvent.findUniqueOrThrow({ where: { id: fixture.eventId } }),
    ).resolves.toMatchObject({
      canceledAt: expect.any(Date),
      lastErrorCode: 'EMAIL_TOKEN_INACTIVE',
      processedAt: null,
    });
    expect(emailSender.send).not.toHaveBeenCalled();
    await expect(
      database.client.emailDelivery.findUnique({ where: { outboxEventId: fixture.eventId } }),
    ).resolves.toBeNull();
  });
});
