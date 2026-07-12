import { randomUUID } from 'node:crypto';

import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { LoggerModule } from 'nestjs-pino';

import {
  HandoffKind,
  IssueType,
  MembershipRole,
  MembershipStatus,
  NotificationType,
  ProjectRole,
  StateCategory,
} from '@rivet/database';
import { API_HANDOFF_CREATED, type ApiHandoffCreatedOutboxPayload } from '@rivet/event-contracts';

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
  activeRecipientMembershipId: string;
  actorMembershipId: string;
  foreignRecipientMembershipId: string;
  inactiveRecipientMembershipId: string;
  issueId: string;
  workspaceId: string;
};

describe('API handoff notification integration', () => {
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  let context: INestApplicationContext;
  let database: DatabaseService;
  let handler: ApiHandoffNotificationHandler;
  let outbox: OutboxService;
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
        ApiHandoffNotificationHandler,
        { provide: IssueCollaborationNotificationHandler, useValue: {} },
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
    handler = context.get(ApiHandoffNotificationHandler);
    outbox = context.get(OutboxService);
    processor = context.get(OutboxProcessorService);
  });

  afterEach(async () => {
    if (workspaceIds.length === 0) return;

    const outboxEvents = await database.client.outboxEvent.findMany({
      select: { id: true },
      where: { workspaceId: { in: workspaceIds } },
    });
    const outboxEventIds = outboxEvents.map(({ id }) => id);
    await database.client.notification.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    });
    await database.client.emailDelivery.deleteMany({
      where: { outboxEventId: { in: outboxEventIds } },
    });
    await database.client.outboxEvent.deleteMany({ where: { id: { in: outboxEventIds } } });
    await database.client.activityEvent.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    });
    await database.client.apiHandoff.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    });
    await database.client.issueBlockRelation.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    });
    await database.client.issueSubscription.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    });
    await database.client.issueLabel.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    });
    await database.client.issue.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await database.client.projectRoleTeam.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    });
    await database.client.project.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await database.client.workflowState.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    });
    await database.client.teamMember.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    });
    await database.client.team.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
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
        passwordHash: '$argon2id$m4-worker-test',
      },
    });
    return id;
  }

  async function createWorkspaceFixture(): Promise<WorkspaceFixture> {
    const actorUserId = await createUser('M4 전달 작성자');
    const activeRecipientUserId = await createUser('M4 활성 수신자');
    const inactiveRecipientUserId = await createUser('M4 비활성 수신자');
    const foreignRecipientUserId = await createUser('M4 외부 수신자');
    const workspaceId = randomUUID();
    const foreignWorkspaceId = randomUUID();
    const actorMembershipId = randomUUID();
    const activeRecipientMembershipId = randomUUID();
    const inactiveRecipientMembershipId = randomUUID();
    const foreignRecipientMembershipId = randomUUID();
    const teamId = randomUUID();
    const stateId = randomUUID();
    const projectId = randomUUID();
    const issueId = randomUUID();
    workspaceIds.push(workspaceId, foreignWorkspaceId);

    await database.client.$transaction(async (transaction) => {
      await transaction.workspace.createMany({
        data: [
          {
            createdByUserId: actorUserId,
            id: workspaceId,
            name: 'M4 전달 워크스페이스',
            normalizedSlug: `m4-handoff-${workspaceId}`,
            slug: `m4-handoff-${workspaceId}`,
          },
          {
            createdByUserId: foreignRecipientUserId,
            id: foreignWorkspaceId,
            name: 'M4 외부 워크스페이스',
            normalizedSlug: `m4-foreign-${foreignWorkspaceId}`,
            slug: `m4-foreign-${foreignWorkspaceId}`,
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
            id: activeRecipientMembershipId,
            role: MembershipRole.MEMBER,
            userId: activeRecipientUserId,
            workspaceId,
          },
          {
            deactivatedAt: new Date(),
            id: inactiveRecipientMembershipId,
            role: MembershipRole.MEMBER,
            status: MembershipStatus.INACTIVE,
            userId: inactiveRecipientUserId,
            workspaceId,
          },
          {
            id: foreignRecipientMembershipId,
            role: MembershipRole.MEMBER,
            userId: foreignRecipientUserId,
            workspaceId: foreignWorkspaceId,
          },
        ],
      });
      await transaction.team.create({
        data: {
          id: teamId,
          key: 'API',
          name: '백엔드 팀',
          normalizedName: '백엔드 팀',
          workspaceId,
        },
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
      await transaction.project.create({
        data: { id: projectId, name: '전달 프로젝트', workspaceId },
      });
      await transaction.projectRoleTeam.create({
        data: { projectId, role: ProjectRole.BACKEND, teamId, workspaceId },
      });
      await transaction.issue.create({
        data: {
          createdByMembershipId: actorMembershipId,
          id: issueId,
          identifier: 'API-1',
          projectId,
          projectRole: ProjectRole.BACKEND,
          sequenceNumber: 1,
          teamId,
          title: '백엔드 전달 작업',
          type: IssueType.TEAM_TASK,
          workflowStateId: stateId,
          workspaceId,
        },
      });
    });

    return {
      activeRecipientMembershipId,
      actorMembershipId,
      foreignRecipientMembershipId,
      inactiveRecipientMembershipId,
      issueId,
      workspaceId,
    };
  }

  async function createHandoffEvent(
    fixture: WorkspaceFixture,
    kind: 'INITIAL' | 'FOLLOW_UP',
    sequenceNumber: number,
    issueId = fixture.issueId,
  ): Promise<{ eventId: string; handoffId: string; payload: ApiHandoffCreatedOutboxPayload }> {
    const handoffId = randomUUID();
    const eventId = randomUUID();
    await database.client.apiHandoff.create({
      data: {
        authorMembershipId: fixture.actorMembershipId,
        bodyMarkdown: `## 변경 요약\n${kind}`,
        id: handoffId,
        issueId: fixture.issueId,
        kind: kind === 'INITIAL' ? HandoffKind.INITIAL : HandoffKind.FOLLOW_UP,
        sequenceNumber,
        workspaceId: fixture.workspaceId,
      },
    });
    const payload: ApiHandoffCreatedOutboxPayload = {
      candidateRecipientMembershipIds: [
        fixture.actorMembershipId,
        fixture.activeRecipientMembershipId,
        fixture.inactiveRecipientMembershipId,
        fixture.foreignRecipientMembershipId,
      ],
      downstreamIssueIds: [],
      handoffId,
      issueId,
      kind,
      schemaVersion: 1,
    };
    await database.client.outboxEvent.create({
      data: {
        actorMembershipId: fixture.actorMembershipId,
        aggregateId: handoffId,
        aggregateType: 'API_HANDOFF',
        eventType: API_HANDOFF_CREATED,
        id: eventId,
        payload,
        workspaceId: fixture.workspaceId,
      },
    });
    return { eventId, handoffId, payload };
  }

  async function claimEvents(eventIds: string[], workerId: string): Promise<ClaimedOutboxEvent[]> {
    const events = (await outbox.claimBatch(workerId)).filter((event) =>
      eventIds.includes(event.id),
    );

    if (events.length !== eventIds.length) {
      throw new Error('테스트 작업 전달 Outbox 이벤트를 모두 claim하지 못했습니다.');
    }

    return events;
  }

  it('stores kind-specific notifications once and filters ineligible candidates', async () => {
    const fixture = await createWorkspaceFixture();
    const initial = await createHandoffEvent(fixture, 'INITIAL', 1);
    const followUp = await createHandoffEvent(fixture, 'FOLLOW_UP', 2);
    const workerId = 'm4-handoff-success-worker';
    const events = await claimEvents([initial.eventId, followUp.eventId], workerId);

    await processor.processBatch(events, workerId);

    const notifications = await database.client.notification.findMany({
      where: { workspaceId: fixture.workspaceId },
    });
    expect(notifications).toHaveLength(2);
    expect(notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorMembershipId: fixture.actorMembershipId,
          eventId: initial.eventId,
          handoffId: initial.handoffId,
          issueId: fixture.issueId,
          recipientMembershipId: fixture.activeRecipientMembershipId,
          type: NotificationType.API_HANDOFF_CREATED,
        }),
        expect.objectContaining({
          actorMembershipId: fixture.actorMembershipId,
          eventId: followUp.eventId,
          handoffId: followUp.handoffId,
          issueId: fixture.issueId,
          recipientMembershipId: fixture.activeRecipientMembershipId,
          type: NotificationType.API_HANDOFF_FOLLOW_UP_CREATED,
        }),
      ]),
    );

    for (const event of events) {
      const created = event.id === initial.eventId ? initial : followUp;
      await handler.handle(event, created.payload);
    }

    await expect(
      database.client.notification.count({ where: { workspaceId: fixture.workspaceId } }),
    ).resolves.toBe(2);
  });

  it('permanently fails when the payload issue does not match the handoff source', async () => {
    const fixture = await createWorkspaceFixture();
    const created = await createHandoffEvent(fixture, 'INITIAL', 1, randomUUID());
    const workerId = 'm4-handoff-contract-worker';
    const [event] = await claimEvents([created.eventId], workerId);

    if (!event) {
      throw new Error('테스트 작업 전달 Outbox 이벤트가 없습니다.');
    }

    await processor.processBatch([event], workerId);

    await expect(
      database.client.outboxEvent.findUniqueOrThrow({ where: { id: created.eventId } }),
    ).resolves.toMatchObject({
      attemptCount: 7,
      lastErrorCode: 'OUTBOX_EVENT_CONTRACT_INVALID',
      lockedAt: null,
      lockedBy: null,
      nextAttemptAt: null,
      processedAt: null,
    });
    await expect(
      database.client.notification.count({ where: { eventId: created.eventId } }),
    ).resolves.toBe(0);
  });
});
