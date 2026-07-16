import { randomBytes, randomUUID } from 'node:crypto';

import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { LoggerModule } from 'nestjs-pino';

import { MembershipRole, MembershipStatus, TokenPurpose } from '@rivet/database';
import {
  type AccountEmailEventType,
  type AccountEmailOutboxPayload,
  AUTH_EMAIL_VERIFICATION_REQUESTED,
  AUTH_PASSWORD_RESET_REQUESTED,
} from '@rivet/event-contracts';

import { DatabaseModule } from '../src/common/database/database.module';
import { DatabaseService } from '../src/common/database/database.service';
import { ObservabilityService } from '../src/common/observability/observability.service';
import { workerConfig } from '../src/config/worker.config';
import { EmailDeliveryError } from '../src/modules/email/email-delivery.error';
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

describe('account email integration', () => {
  const emailSender = { send: jest.fn() };
  const outboxEventIds: string[] = [];
  const tokenIds: string[] = [];
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  let accountEmailHandler: AccountEmailHandler;
  let context: INestApplicationContext;
  let database: DatabaseService;
  let processor: OutboxProcessorService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [workerConfig] }),
        LoggerModule.forRoot({ pinoHttp: { enabled: false } }),
        DatabaseModule,
      ],
      providers: [
        AccountEmailHandler,
        { provide: ApiHandoffNotificationHandler, useValue: { handle: jest.fn() } },
        { provide: IssueCollaborationNotificationHandler, useValue: {} },
        ResourcePurgeHandler,
        EmailDeliveryService,
        { provide: EmailSenderService, useValue: emailSender },
        { provide: WorkspaceInvitationEmailHandler, useValue: { handle: jest.fn() } },
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
    accountEmailHandler = context.get(AccountEmailHandler);
    database = context.get(DatabaseService);
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
    await database.client.workspaceMembership.deleteMany({ where: { userId: { in: userIds } } });
    await database.client.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await database.client.user.deleteMany({ where: { id: { in: userIds } } });
    outboxEventIds.length = 0;
    tokenIds.length = 0;
    userIds.length = 0;
    workspaceIds.length = 0;
  });

  afterAll(async () => {
    await context.close();
  });

  async function createUser(isVerified = false): Promise<string> {
    const id = randomUUID();
    userIds.push(id);
    await database.client.user.create({
      data: {
        displayName: '이메일 테스트 사용자',
        email: `m1-worker-${id}@example.test`,
        emailVerifiedAt: isVerified ? new Date() : null,
        id,
        normalizedEmail: `m1-worker-${id}@example.test`,
        passwordHash: 'test-password-hash',
      },
    });
    return id;
  }

  async function createActiveMembership(userId: string): Promise<string> {
    const workspaceId = randomUUID();
    const membershipId = randomUUID();
    workspaceIds.push(workspaceId);
    await database.client.$transaction(async (transaction) => {
      await transaction.workspace.create({
        data: {
          createdByUserId: userId,
          id: workspaceId,
          name: '이메일 테스트 워크스페이스',
          normalizedSlug: `email-${workspaceId}`,
          slug: `email-${workspaceId}`,
        },
      });
      await transaction.workspaceMembership.create({
        data: { id: membershipId, role: MembershipRole.ADMIN, userId, workspaceId },
      });
    });
    return membershipId;
  }

  async function createEvent(
    userId: string,
    eventType: AccountEmailEventType,
    purpose: TokenPurpose,
    options: { createToken?: boolean } = {},
  ): Promise<{ id: string; payload: AccountEmailOutboxPayload }> {
    const tokenId = randomUUID();
    const id = randomUUID();
    tokenIds.push(tokenId);
    outboxEventIds.push(id);

    if (options.createToken !== false) {
      await database.client.oneTimeToken.create({
        data: {
          expiresAt: new Date('2099-01-01T00:00:00.000Z'),
          id: tokenId,
          purpose,
          tokenHash: randomBytes(32),
          userId,
        },
      });
    }

    const payload = { schemaVersion: 1 as const, tokenId, userId };
    await database.client.outboxEvent.create({
      data: {
        aggregateId: userId,
        aggregateType: 'USER',
        availableAt: ISOLATED_OUTBOX_AVAILABLE_AT,
        eventType,
        id,
        payload,
      },
    });
    return { id, payload };
  }

  async function processEvent(eventId: string, workerId: string): Promise<ClaimedOutboxEvent> {
    const claimed = await claimIsolatedOutboxEvent(database, eventId, workerId);

    await processor.processBatch([claimed], workerId);
    return claimed;
  }

  it('reuses a sent delivery without sending the same event twice', async () => {
    const userId = await createUser();
    const event = await createEvent(
      userId,
      AUTH_EMAIL_VERIFICATION_REQUESTED,
      TokenPurpose.EMAIL_VERIFICATION,
    );
    const claimed = await processEvent(event.id, 'email-success-worker');

    await accountEmailHandler.handle(claimed, AUTH_EMAIL_VERIFICATION_REQUESTED, event.payload);

    expect(emailSender.send).toHaveBeenCalledTimes(1);
    await expect(
      database.client.emailDelivery.findUniqueOrThrow({ where: { outboxEventId: event.id } }),
    ).resolves.toMatchObject({
      failedAt: null,
      lastErrorCode: null,
      recipientEmail: `m1-worker-${userId}@example.test`,
      sentAt: expect.any(Date),
    });
  });

  it('sends a password reset for a verified user before workspace onboarding', async () => {
    const userId = await createUser(true);
    const event = await createEvent(
      userId,
      AUTH_PASSWORD_RESET_REQUESTED,
      TokenPurpose.PASSWORD_RESET,
    );

    await processEvent(event.id, 'password-reset-worker');

    expect(emailSender.send).toHaveBeenCalledWith(
      expect.objectContaining({
        outboxEventId: event.id,
        recipient: `m1-worker-${userId}@example.test`,
        subject: '[Rivet] 비밀번호를 재설정해 주세요',
      }),
    );
  });

  it('cancels a password reset for an inactive membership', async () => {
    const userId = await createUser(true);
    const membershipId = await createActiveMembership(userId);
    await database.client.workspaceMembership.update({
      data: { deactivatedAt: new Date(), status: MembershipStatus.INACTIVE },
      where: { id: membershipId },
    });
    const event = await createEvent(
      userId,
      AUTH_PASSWORD_RESET_REQUESTED,
      TokenPurpose.PASSWORD_RESET,
    );

    await processEvent(event.id, 'inactive-membership-worker');

    await expect(
      database.client.outboxEvent.findUniqueOrThrow({ where: { id: event.id } }),
    ).resolves.toMatchObject({
      canceledAt: expect.any(Date),
      lastErrorCode: 'EMAIL_TOKEN_INACTIVE',
      processedAt: null,
    });
    expect(emailSender.send).not.toHaveBeenCalled();
  });

  it('cancels an event whose token is no longer active', async () => {
    const userId = await createUser();
    const event = await createEvent(
      userId,
      AUTH_EMAIL_VERIFICATION_REQUESTED,
      TokenPurpose.EMAIL_VERIFICATION,
      { createToken: false },
    );

    await processEvent(event.id, 'inactive-token-worker');

    await expect(
      database.client.outboxEvent.findUniqueOrThrow({ where: { id: event.id } }),
    ).resolves.toMatchObject({
      canceledAt: expect.any(Date),
      lastErrorCode: 'EMAIL_TOKEN_INACTIVE',
      processedAt: null,
    });
    expect(emailSender.send).not.toHaveBeenCalled();
  });

  it('records and cancels a blocked development recipient', async () => {
    const userId = await createUser();
    const event = await createEvent(
      userId,
      AUTH_EMAIL_VERIFICATION_REQUESTED,
      TokenPurpose.EMAIL_VERIFICATION,
    );
    emailSender.send.mockRejectedValue(new EmailDeliveryError('DEV_RECIPIENT_BLOCKED', false));

    await processEvent(event.id, 'allowlist-worker');

    await expect(
      database.client.outboxEvent.findUniqueOrThrow({ where: { id: event.id } }),
    ).resolves.toMatchObject({
      canceledAt: expect.any(Date),
      lastErrorCode: 'DEV_RECIPIENT_BLOCKED',
      processedAt: null,
    });
    await expect(
      database.client.emailDelivery.findUniqueOrThrow({ where: { outboxEventId: event.id } }),
    ).resolves.toMatchObject({
      failedAt: expect.any(Date),
      lastErrorCode: 'DEV_RECIPIENT_BLOCKED',
      sentAt: null,
    });
  });

  it('schedules a sanitized retry for a transient provider failure', async () => {
    const userId = await createUser();
    const event = await createEvent(
      userId,
      AUTH_EMAIL_VERIFICATION_REQUESTED,
      TokenPurpose.EMAIL_VERIFICATION,
    );
    emailSender.send.mockRejectedValue(new EmailDeliveryError('EMAIL_PROVIDER_UNAVAILABLE', true));

    await processEvent(event.id, 'retry-worker');

    const outboxEvent = await database.client.outboxEvent.findUniqueOrThrow({
      where: { id: event.id },
    });
    expect(outboxEvent).toMatchObject({
      attemptCount: 1,
      canceledAt: null,
      lastErrorCode: 'EMAIL_PROVIDER_UNAVAILABLE',
      processedAt: null,
    });
    expect(outboxEvent.nextAttemptAt).not.toBeNull();
    await expect(
      database.client.emailDelivery.findUniqueOrThrow({ where: { outboxEventId: event.id } }),
    ).resolves.toMatchObject({
      failedAt: null,
      lastErrorCode: 'EMAIL_PROVIDER_UNAVAILABLE',
      sentAt: null,
    });
  });

  it('permanently fails a non-retryable provider rejection', async () => {
    const userId = await createUser();
    const event = await createEvent(
      userId,
      AUTH_EMAIL_VERIFICATION_REQUESTED,
      TokenPurpose.EMAIL_VERIFICATION,
    );
    emailSender.send.mockRejectedValue(new EmailDeliveryError('EMAIL_PROVIDER_REJECTED', false));

    await processEvent(event.id, 'rejected-worker');

    await expect(
      database.client.outboxEvent.findUniqueOrThrow({ where: { id: event.id } }),
    ).resolves.toMatchObject({
      attemptCount: 7,
      canceledAt: null,
      lastErrorCode: 'EMAIL_PROVIDER_REJECTED',
      nextAttemptAt: null,
      processedAt: null,
    });
    await expect(
      database.client.emailDelivery.findUniqueOrThrow({ where: { outboxEventId: event.id } }),
    ).resolves.toMatchObject({
      failedAt: expect.any(Date),
      lastErrorCode: 'EMAIL_PROVIDER_REJECTED',
      sentAt: null,
    });
  });
});
