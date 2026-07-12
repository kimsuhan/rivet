import { randomUUID } from 'node:crypto';

import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { LoggerModule } from 'nestjs-pino';
import { Client } from 'pg';

import {
  IssueType,
  MembershipRole,
  MembershipStatus,
  NotificationType,
  Prisma,
  StateCategory,
} from '@rivet/database';
import {
  COMMENT_CREATED,
  COMMENT_MENTIONS_ADDED,
  ISSUE_CHANGED,
  ISSUE_CREATED,
  type IssueChangedOutboxPayload,
  type IssueCreatedOutboxPayload,
} from '@rivet/event-contracts';

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
import type { ClaimedOutboxEvent } from '../src/modules/outbox/outbox.types';
import { OutboxProcessorService } from '../src/modules/outbox/outbox-processor.service';

type WorkspaceFixture = {
  actorMembershipId: string;
  assigneeMembershipId: string;
  foreignMembershipId: string;
  inactiveMembershipId: string;
  issueId: string;
  lateSubscriberMembershipId: string;
  mentionedMembershipId: string;
  subscriberMembershipId: string;
  workspaceId: string;
};

const WORKER_ID = 'm6-notification-worker-test';

describe('issue collaboration notification integration', () => {
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  let context: INestApplicationContext;
  let database: DatabaseService;
  let handler: IssueCollaborationNotificationHandler;
  let processor: OutboxProcessorService;

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
        IssueCollaborationNotificationHandler,
        ResourcePurgeHandler,
        { provide: WorkspaceInvitationEmailHandler, useValue: { handle: jest.fn() } },
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
    handler = context.get(IssueCollaborationNotificationHandler);
    processor = context.get(OutboxProcessorService);
  });

  afterEach(async () => {
    if (workspaceIds.length === 0) return;

    await database.client.notification.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    });
    await database.client.mention.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    });
    await database.client.comment.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    });
    await database.client.outboxEvent.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    });
    await database.client.activityEvent.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    });
    await database.client.issueSubscription.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    });
    await database.client.issueLabel.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    });
    await database.client.issue.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    });
    await database.client.workflowState.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    });
    await database.client.teamMember.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    });
    await database.client.team.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    });
    await database.client.workspaceMembership.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    });
    await database.client.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await database.client.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
    workspaceIds.length = 0;
  });

  afterAll(async () => {
    await context.close();
  });

  async function createUser(displayName: string): Promise<string> {
    const id = randomUUID();
    const email = `${id}@example.test`;
    userIds.push(id);
    await database.client.user.create({
      data: {
        displayName,
        email,
        id,
        normalizedEmail: email,
        passwordHash: '$argon2id$m6-worker-test',
      },
    });
    return id;
  }

  async function createWorkspaceFixture(): Promise<WorkspaceFixture> {
    const actorUserId = await createUser('M6 행위자');
    const mentionedUserId = await createUser('M6 멘션 수신자');
    const assigneeUserId = await createUser('M6 담당 수신자');
    const subscriberUserId = await createUser('M6 구독 수신자');
    const lateSubscriberUserId = await createUser('M6 후발 구독자');
    const inactiveUserId = await createUser('M6 비활성 수신자');
    const foreignUserId = await createUser('M6 외부 수신자');
    const workspaceId = randomUUID();
    const foreignWorkspaceId = randomUUID();
    const actorMembershipId = randomUUID();
    const mentionedMembershipId = randomUUID();
    const assigneeMembershipId = randomUUID();
    const subscriberMembershipId = randomUUID();
    const lateSubscriberMembershipId = randomUUID();
    const inactiveMembershipId = randomUUID();
    const foreignMembershipId = randomUUID();
    const teamId = randomUUID();
    const stateId = randomUUID();
    const issueId = randomUUID();
    workspaceIds.push(workspaceId, foreignWorkspaceId);

    await database.client.$transaction(async (transaction) => {
      await transaction.workspace.createMany({
        data: [
          {
            createdByUserId: actorUserId,
            id: workspaceId,
            name: 'M6 알림 워크스페이스',
            normalizedSlug: `m6-${workspaceId}`,
            slug: `m6-${workspaceId}`,
          },
          {
            createdByUserId: foreignUserId,
            id: foreignWorkspaceId,
            name: 'M6 외부 워크스페이스',
            normalizedSlug: `m6-foreign-${foreignWorkspaceId}`,
            slug: `m6-foreign-${foreignWorkspaceId}`,
          },
        ],
      });
      await transaction.workspaceMembership.createMany({
        data: [
          {
            id: actorMembershipId,
            role: MembershipRole.ADMIN,
            userId: actorUserId,
            workspaceId,
          },
          {
            id: mentionedMembershipId,
            role: MembershipRole.MEMBER,
            userId: mentionedUserId,
            workspaceId,
          },
          {
            id: assigneeMembershipId,
            role: MembershipRole.MEMBER,
            userId: assigneeUserId,
            workspaceId,
          },
          {
            id: subscriberMembershipId,
            role: MembershipRole.MEMBER,
            userId: subscriberUserId,
            workspaceId,
          },
          {
            id: lateSubscriberMembershipId,
            role: MembershipRole.MEMBER,
            userId: lateSubscriberUserId,
            workspaceId,
          },
          {
            deactivatedAt: new Date(),
            id: inactiveMembershipId,
            role: MembershipRole.MEMBER,
            status: MembershipStatus.INACTIVE,
            userId: inactiveUserId,
            workspaceId,
          },
          {
            id: foreignMembershipId,
            role: MembershipRole.ADMIN,
            userId: foreignUserId,
            workspaceId: foreignWorkspaceId,
          },
        ],
      });
      await transaction.team.create({
        data: {
          id: teamId,
          key: 'MNTF',
          name: 'M6 알림 팀',
          normalizedName: 'm6 알림 팀',
          workspaceId,
        },
      });
      await transaction.teamMember.create({
        data: { membershipId: actorMembershipId, teamId, workspaceId },
      });
      await transaction.workflowState.create({
        data: {
          category: StateCategory.UNSTARTED,
          id: stateId,
          isDefault: true,
          name: '할 일',
          normalizedName: '할 일',
          position: 0,
          teamId,
          workspaceId,
        },
      });
      await transaction.issue.create({
        data: {
          createdByMembershipId: actorMembershipId,
          id: issueId,
          identifier: `M6-${issueId.slice(0, 8)}`.toUpperCase(),
          sequenceNumber: 1,
          teamId,
          title: 'M6 알림 이슈',
          type: IssueType.TEAM_TASK,
          workflowStateId: stateId,
          workspaceId,
        },
      });
    });

    return {
      actorMembershipId,
      assigneeMembershipId,
      foreignMembershipId,
      inactiveMembershipId,
      issueId,
      lateSubscriberMembershipId,
      mentionedMembershipId,
      subscriberMembershipId,
      workspaceId,
    };
  }

  async function createEvent(
    fixture: WorkspaceFixture,
    input: {
      aggregateId: string;
      aggregateType: 'COMMENT' | 'ISSUE';
      eventType: string;
      payload: Prisma.InputJsonValue;
    },
  ): Promise<ClaimedOutboxEvent> {
    const eventId = randomUUID();
    const now = new Date();
    await database.client.outboxEvent.create({
      data: {
        actorMembershipId: fixture.actorMembershipId,
        aggregateId: input.aggregateId,
        aggregateType: input.aggregateType,
        attemptCount: 1,
        eventType: input.eventType,
        id: eventId,
        lockedAt: now,
        lockedBy: WORKER_ID,
        payload: input.payload,
        workspaceId: fixture.workspaceId,
      },
    });

    return {
      actorMembershipId: fixture.actorMembershipId,
      aggregateId: input.aggregateId,
      aggregateType: input.aggregateType,
      attemptCount: 1,
      availableAt: now,
      createdAt: now,
      eventType: input.eventType,
      id: eventId,
      payload: input.payload,
      workspaceId: fixture.workspaceId,
    };
  }

  function nextNotificationPayload(client: Client, timeoutMs: number): Promise<string | null> {
    return new Promise((resolve) => {
      const onNotification = (message: { payload?: string }) => {
        clearTimeout(timeout);
        resolve(message.payload ?? null);
      };
      const timeout = setTimeout(() => {
        client.off('notification', onNotification);
        resolve(null);
      }, timeoutMs);
      client.once('notification', onNotification);
    });
  }

  it('creates one issue-created notification per active same-workspace recipient', async () => {
    const fixture = await createWorkspaceFixture();
    const event = await createEvent(fixture, {
      aggregateId: fixture.issueId,
      aggregateType: 'ISSUE',
      eventType: ISSUE_CREATED,
      payload: {
        assigneeMembershipId: fixture.assigneeMembershipId,
        issueId: fixture.issueId,
        mentionedMembershipIds: [
          fixture.actorMembershipId,
          fixture.assigneeMembershipId,
          fixture.inactiveMembershipId,
          fixture.foreignMembershipId,
        ],
        schemaVersion: 1,
      },
    });

    await processor.processBatch([event], WORKER_ID);

    const notifications = await database.client.notification.findMany({
      where: { eventId: event.id },
    });
    expect(notifications).toEqual([
      expect.objectContaining({
        actorMembershipId: fixture.actorMembershipId,
        commentId: null,
        handoffId: null,
        issueId: fixture.issueId,
        recipientMembershipId: fixture.assigneeMembershipId,
        type: NotificationType.MENTIONED,
        workspaceId: fixture.workspaceId,
      }),
    ]);
  });

  it('uses event snapshots and mention-assignment-terminal priority for issue changes', async () => {
    const fixture = await createWorkspaceFixture();
    const event = await createEvent(fixture, {
      aggregateId: fixture.issueId,
      aggregateType: 'ISSUE',
      eventType: ISSUE_CHANGED,
      payload: {
        assigneeMembershipId: fixture.assigneeMembershipId,
        changedFields: ['DESCRIPTION', 'ASSIGNEE', 'WORKFLOW_STATE'],
        issueId: fixture.issueId,
        mentionedMembershipIds: [fixture.mentionedMembershipId],
        schemaVersion: 1,
        subscriberMembershipIds: [
          fixture.actorMembershipId,
          fixture.mentionedMembershipId,
          fixture.assigneeMembershipId,
          fixture.subscriberMembershipId,
          fixture.inactiveMembershipId,
          fixture.foreignMembershipId,
        ],
        terminalCategory: 'COMPLETED',
      },
    });
    await database.client.issueSubscription.create({
      data: {
        issueId: fixture.issueId,
        membershipId: fixture.lateSubscriberMembershipId,
        workspaceId: fixture.workspaceId,
      },
    });

    await processor.processBatch([event], WORKER_ID);

    const notifications = await database.client.notification.findMany({
      orderBy: { recipientMembershipId: 'asc' },
      select: { recipientMembershipId: true, type: true },
      where: { eventId: event.id },
    });
    expect(notifications).toEqual(
      [
        {
          recipientMembershipId: fixture.mentionedMembershipId,
          type: NotificationType.MENTIONED,
        },
        {
          recipientMembershipId: fixture.assigneeMembershipId,
          type: NotificationType.ISSUE_ASSIGNED,
        },
        {
          recipientMembershipId: fixture.subscriberMembershipId,
          type: NotificationType.ISSUE_COMPLETED,
        },
      ].sort((left, right) =>
        left.recipientMembershipId.localeCompare(right.recipientMembershipId),
      ),
    );
    expect(
      notifications.some(
        ({ recipientMembershipId }) => recipientMembershipId === fixture.lateSubscriberMembershipId,
      ),
    ).toBe(false);

    const canceledEvent = await createEvent(fixture, {
      aggregateId: fixture.issueId,
      aggregateType: 'ISSUE',
      eventType: ISSUE_CHANGED,
      payload: {
        assigneeMembershipId: null,
        changedFields: ['WORKFLOW_STATE'],
        issueId: fixture.issueId,
        mentionedMembershipIds: [],
        schemaVersion: 1,
        subscriberMembershipIds: [fixture.subscriberMembershipId],
        terminalCategory: 'CANCELED',
      },
    });
    await processor.processBatch([canceledEvent], WORKER_ID);
    await expect(
      database.client.notification.findFirstOrThrow({
        select: { type: true },
        where: { eventId: canceledEvent.id },
      }),
    ).resolves.toEqual({ type: NotificationType.ISSUE_CANCELED });
  });

  it('creates exact comment anchors for comment-created and new-mention events', async () => {
    const fixture = await createWorkspaceFixture();
    const commentId = randomUUID();
    await database.client.comment.create({
      data: {
        authorMembershipId: fixture.actorMembershipId,
        bodyMarkdown: '댓글',
        id: commentId,
        issueId: fixture.issueId,
        workspaceId: fixture.workspaceId,
      },
    });
    const createdEvent = await createEvent(fixture, {
      aggregateId: commentId,
      aggregateType: 'COMMENT',
      eventType: COMMENT_CREATED,
      payload: {
        commentId,
        hasMention: true,
        issueId: fixture.issueId,
        mentionedMembershipIds: [fixture.mentionedMembershipId],
        schemaVersion: 1,
        subscriberMembershipIds: [
          fixture.actorMembershipId,
          fixture.mentionedMembershipId,
          fixture.subscriberMembershipId,
        ],
      },
    });

    await processor.processBatch([createdEvent], WORKER_ID);

    const createdNotifications = await database.client.notification.findMany({
      orderBy: { recipientMembershipId: 'asc' },
      select: {
        commentId: true,
        handoffId: true,
        issueId: true,
        recipientMembershipId: true,
        type: true,
      },
      where: { eventId: createdEvent.id },
    });
    expect(createdNotifications).toEqual(
      [
        {
          commentId,
          handoffId: null,
          issueId: fixture.issueId,
          recipientMembershipId: fixture.mentionedMembershipId,
          type: NotificationType.MENTIONED,
        },
        {
          commentId,
          handoffId: null,
          issueId: fixture.issueId,
          recipientMembershipId: fixture.subscriberMembershipId,
          type: NotificationType.COMMENT_ADDED,
        },
      ].sort((left, right) =>
        left.recipientMembershipId.localeCompare(right.recipientMembershipId),
      ),
    );

    const mentionsAddedEvent = await createEvent(fixture, {
      aggregateId: commentId,
      aggregateType: 'COMMENT',
      eventType: COMMENT_MENTIONS_ADDED,
      payload: {
        commentId,
        issueId: fixture.issueId,
        mentionedMembershipIds: [fixture.assigneeMembershipId],
        schemaVersion: 1,
      },
    });
    await processor.processBatch([mentionsAddedEvent], WORKER_ID);
    await expect(
      database.client.notification.findFirstOrThrow({
        select: { commentId: true, issueId: true, recipientMembershipId: true, type: true },
        where: { eventId: mentionsAddedEvent.id },
      }),
    ).resolves.toEqual({
      commentId,
      issueId: fixture.issueId,
      recipientMembershipId: fixture.assigneeMembershipId,
      type: NotificationType.MENTIONED,
    });
  });

  it('inserts only a missing partial-conflict recipient and emits one committed NOTIFY', async () => {
    const fixture = await createWorkspaceFixture();
    const payload: IssueChangedOutboxPayload = {
      assigneeMembershipId: null,
      changedFields: ['WORKFLOW_STATE'],
      issueId: fixture.issueId,
      mentionedMembershipIds: [],
      schemaVersion: 1,
      subscriberMembershipIds: [fixture.mentionedMembershipId, fixture.subscriberMembershipId],
      terminalCategory: 'COMPLETED',
    };
    const event = await createEvent(fixture, {
      aggregateId: fixture.issueId,
      aggregateType: 'ISSUE',
      eventType: ISSUE_CHANGED,
      payload: { ...payload },
    });
    await database.client.notification.create({
      data: {
        actorMembershipId: fixture.actorMembershipId,
        eventId: event.id,
        issueId: fixture.issueId,
        recipientMembershipId: fixture.mentionedMembershipId,
        type: NotificationType.ISSUE_COMPLETED,
        workspaceId: fixture.workspaceId,
      },
    });
    const listener = new Client({ connectionString: process.env.DATABASE_URL });
    await listener.connect();
    await listener.query('LISTEN rivet_resource_changed_v1');

    try {
      const signalPromise = nextNotificationPayload(listener, 2_000);
      await handler.handleIssueChanged(event, payload);
      const signal = await signalPromise.then((payload) => (payload ? JSON.parse(payload) : null));

      expect(signal).toEqual(
        expect.objectContaining({
          changeType: 'CREATED',
          eventId: expect.stringMatching(/^[0-9a-f-]{36}$/),
          recipientMembershipId: fixture.subscriberMembershipId,
          resourceType: 'NOTIFICATION',
          version: null,
          workspaceId: fixture.workspaceId,
        }),
      );
      expect(signal.eventId).not.toBe(event.id);
      await expect(
        database.client.notification.count({ where: { eventId: event.id } }),
      ).resolves.toBe(2);

      const replaySignal = nextNotificationPayload(listener, 100);
      await handler.handleIssueChanged(event, payload);
      await expect(replaySignal).resolves.toBeNull();
      await expect(
        database.client.notification.count({ where: { eventId: event.id } }),
      ).resolves.toBe(2);
    } finally {
      await listener.end();
    }
  });

  it('rolls back inserted notifications when NOTIFY fails', async () => {
    const fixture = await createWorkspaceFixture();
    const payload: IssueCreatedOutboxPayload = {
      assigneeMembershipId: fixture.assigneeMembershipId,
      issueId: fixture.issueId,
      mentionedMembershipIds: [],
      schemaVersion: 1,
    };
    const event = await createEvent(fixture, {
      aggregateId: fixture.issueId,
      aggregateType: 'ISSUE',
      eventType: ISSUE_CREATED,
      payload: { ...payload },
    });
    const rollbackModule = await Test.createTestingModule({
      providers: [
        IssueCollaborationNotificationHandler,
        {
          provide: DatabaseService,
          useValue: {
            client: {
              $transaction: (callback: (transaction: unknown) => Promise<void>) =>
                database.client.$transaction((transaction) =>
                  callback({
                    $executeRaw: jest.fn().mockRejectedValue(new Error('notify failed')),
                    comment: transaction.comment,
                    issue: transaction.issue,
                    notification: transaction.notification,
                    workspaceMembership: transaction.workspaceMembership,
                  }),
                ),
            },
          },
        },
      ],
    }).compile();

    try {
      await expect(
        rollbackModule
          .get(IssueCollaborationNotificationHandler)
          .handleIssueCreated(event, payload),
      ).rejects.toThrow('notify failed');
      await expect(
        database.client.notification.count({ where: { eventId: event.id } }),
      ).resolves.toBe(0);
    } finally {
      await rollbackModule.close();
    }
  });

  it('permanently fails invalid schemas, missing issues, and cross-workspace sources', async () => {
    const fixture = await createWorkspaceFixture();
    const foreignFixture = await createWorkspaceFixture();
    const invalidSchemaEvent = await createEvent(fixture, {
      aggregateId: fixture.issueId,
      aggregateType: 'ISSUE',
      eventType: ISSUE_CREATED,
      payload: {
        assigneeMembershipId: null,
        issueId: fixture.issueId,
        mentionedMembershipIds: [],
        schemaVersion: 2,
      },
    });
    const crossWorkspaceEvent = await createEvent(fixture, {
      aggregateId: foreignFixture.issueId,
      aggregateType: 'ISSUE',
      eventType: ISSUE_CHANGED,
      payload: {
        assigneeMembershipId: null,
        changedFields: ['TITLE'],
        issueId: foreignFixture.issueId,
        mentionedMembershipIds: [],
        schemaVersion: 1,
        subscriberMembershipIds: [],
        terminalCategory: null,
      },
    });
    const missingIssueId = randomUUID();
    const missingIssueEvent = await createEvent(fixture, {
      aggregateId: missingIssueId,
      aggregateType: 'ISSUE',
      eventType: ISSUE_CHANGED,
      payload: {
        assigneeMembershipId: null,
        changedFields: ['TITLE'],
        issueId: missingIssueId,
        mentionedMembershipIds: [],
        schemaVersion: 1,
        subscriberMembershipIds: [],
        terminalCategory: null,
      },
    });

    await processor.processBatch(
      [invalidSchemaEvent, crossWorkspaceEvent, missingIssueEvent],
      WORKER_ID,
    );

    const failedEvents = await database.client.outboxEvent.findMany({
      orderBy: { id: 'asc' },
      select: { attemptCount: true, id: true, lastErrorCode: true, processedAt: true },
      where: {
        id: { in: [invalidSchemaEvent.id, crossWorkspaceEvent.id, missingIssueEvent.id] },
      },
    });
    expect(failedEvents).toEqual(
      [
        {
          attemptCount: 7,
          id: invalidSchemaEvent.id,
          lastErrorCode: 'OUTBOX_SCHEMA_VERSION_UNSUPPORTED',
          processedAt: null,
        },
        {
          attemptCount: 7,
          id: crossWorkspaceEvent.id,
          lastErrorCode: 'OUTBOX_EVENT_CONTRACT_INVALID',
          processedAt: null,
        },
        {
          attemptCount: 7,
          id: missingIssueEvent.id,
          lastErrorCode: 'OUTBOX_EVENT_CONTRACT_INVALID',
          processedAt: null,
        },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );
    await expect(
      database.client.notification.count({
        where: {
          eventId: {
            in: [invalidSchemaEvent.id, crossWorkspaceEvent.id, missingIssueEvent.id],
          },
        },
      }),
    ).resolves.toBe(0);
  });
});
