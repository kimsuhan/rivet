import { randomUUID } from 'node:crypto';

import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { LoggerModule } from 'nestjs-pino';

import { MembershipRole, NotificationType, StateCategory } from '@rivet/database';
import type {
  ApiHandoffCreatedOutboxPayload,
  TeamWorkChangedOutboxPayload,
  TeamWorkCreatedOutboxPayload,
} from '@rivet/event-contracts';
import {
  API_HANDOFF_CREATED_SCHEMA_VERSION,
  TEAM_WORK_CHANGED_SCHEMA_VERSION,
} from '@rivet/event-contracts';

import { DatabaseModule } from '../src/common/database/database.module';
import { DatabaseService } from '../src/common/database/database.service';
import { workerConfig } from '../src/config/worker.config';
import { ApiHandoffNotificationHandler } from '../src/modules/outbox/handlers/api-handoff-notification.handler';
import { IssueCollaborationNotificationHandler } from '../src/modules/outbox/handlers/issue-collaboration-notification.handler';
import type { ClaimedOutboxEvent } from '../src/modules/outbox/outbox.types';

describe('M9 team-work worker PostgreSQL integration', () => {
  let context: INestApplicationContext;
  let database: DatabaseService;
  let teamWorkHandler: IssueCollaborationNotificationHandler;
  let handoffHandler: ApiHandoffNotificationHandler;
  const workspaceId = randomUUID();
  const actorUserId = randomUUID();
  const recipientUserId = randomUUID();
  const actorMembershipId = randomUUID();
  const recipientMembershipId = randomUUID();
  const backendTeamId = randomUUID();
  const webTeamId = randomUUID();
  const backendStateId = randomUUID();
  const webStateId = randomUUID();
  const projectId = randomUUID();
  const backendProjectTeamId = randomUUID();
  const webProjectTeamId = randomUUID();
  const issueId = randomUUID();
  const backendWorkId = randomUUID();
  const webWorkId = randomUUID();
  const handoffId = randomUUID();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, load: [workerConfig] }), LoggerModule.forRoot({ pinoHttp: { enabled: false } }), DatabaseModule],
      providers: [ApiHandoffNotificationHandler, IssueCollaborationNotificationHandler],
    }).compile();
    context = module;
    await context.init();
    database = context.get(DatabaseService);
    teamWorkHandler = context.get(IssueCollaborationNotificationHandler);
    handoffHandler = context.get(ApiHandoffNotificationHandler);

    const actorEmail = `${actorUserId}@example.test`;
    const recipientEmail = `${recipientUserId}@example.test`;
    await database.client.user.createMany({ data: [
      { displayName: '행위자', email: actorEmail, id: actorUserId, normalizedEmail: actorEmail, passwordHash: '$argon2id$m9' },
      { displayName: '수신자', email: recipientEmail, id: recipientUserId, normalizedEmail: recipientEmail, passwordHash: '$argon2id$m9' },
    ] });
    await database.client.workspace.create({ data: { createdByUserId: actorUserId, id: workspaceId, name: 'M9 Worker', normalizedSlug: `m9-worker-${workspaceId}`, slug: `m9-worker-${workspaceId}` } });
    await database.client.workspaceMembership.createMany({ data: [
      { id: actorMembershipId, role: MembershipRole.ADMIN, userId: actorUserId, workspaceId },
      { id: recipientMembershipId, role: MembershipRole.MEMBER, userId: recipientUserId, workspaceId },
    ] });
    await database.client.team.createMany({ data: [
      { id: backendTeamId, key: 'API', name: '백엔드', normalizedName: '백엔드', workspaceId },
      { id: webTeamId, key: 'WEB', name: '웹', normalizedName: '웹', workspaceId },
    ] });
    await database.client.teamMember.createMany({ data: [
      { membershipId: actorMembershipId, teamId: backendTeamId, workspaceId },
      { membershipId: recipientMembershipId, teamId: webTeamId, workspaceId },
    ] });
    await database.client.workflowState.createMany({ data: [
      { category: StateCategory.UNSTARTED, id: backendStateId, isDefault: true, name: '할 일', normalizedName: '할 일', position: 0, teamId: backendTeamId, workspaceId },
      { category: StateCategory.UNSTARTED, id: webStateId, isDefault: true, name: '할 일', normalizedName: '할 일', position: 0, teamId: webTeamId, workspaceId },
    ] });
    await database.client.project.create({ data: { id: projectId, name: 'M9 Worker 프로젝트', workspaceId } });
    await database.client.projectTeam.createMany({ data: [
      { id: backendProjectTeamId, projectId, teamId: backendTeamId, workspaceId },
      { id: webProjectTeamId, projectId, teamId: webTeamId, workspaceId },
    ] });
    await database.client.issue.create({ data: { createdByMembershipId: actorMembershipId, id: issueId, identifier: 'F-9100', projectId, sequenceNumber: 9100, title: 'Worker 통합 이슈', workspaceId } });
    await database.client.teamWork.createMany({ data: [
      { createdByMembershipId: actorMembershipId, id: backendWorkId, identifier: 'API-9100', issueId, projectTeamId: backendProjectTeamId, sequenceNumber: 9100, teamId: backendTeamId, workflowStateId: backendStateId, workspaceId },
      { assigneeMembershipId: recipientMembershipId, createdByMembershipId: actorMembershipId, id: webWorkId, identifier: 'WEB-9100', issueId, projectTeamId: webProjectTeamId, sequenceNumber: 9100, teamId: webTeamId, workflowStateId: webStateId, workspaceId },
    ] });
    await database.client.issueSubscription.create({ data: { issueId, membershipId: recipientMembershipId, workspaceId } });
    await database.client.apiHandoff.create({ data: { authorMembershipId: actorMembershipId, bodyMarkdown: '## 전달', id: handoffId, issueId, kind: 'INITIAL', sequenceNumber: 1, sourceTeamWorkId: backendWorkId, workspaceId } });
    await database.client.apiHandoffTarget.create({ data: { handoffId, teamWorkId: webWorkId, workspaceId } });
  });

  afterAll(async () => {
    await database.client.notification.deleteMany({ where: { workspaceId } });
    await database.client.apiHandoffTarget.deleteMany({ where: { workspaceId } });
    await database.client.apiHandoff.deleteMany({ where: { workspaceId } });
    await database.client.issueSubscription.deleteMany({ where: { workspaceId } });
    await database.client.teamWork.deleteMany({ where: { workspaceId } });
    await database.client.issue.deleteMany({ where: { workspaceId } });
    await database.client.projectTeam.deleteMany({ where: { workspaceId } });
    await database.client.project.deleteMany({ where: { workspaceId } });
    await database.client.workflowState.deleteMany({ where: { workspaceId } });
    await database.client.teamMember.deleteMany({ where: { workspaceId } });
    await database.client.team.deleteMany({ where: { workspaceId } });
    await database.client.workspaceMembership.deleteMany({ where: { workspaceId } });
    await database.client.workspace.deleteMany({ where: { id: workspaceId } });
    await database.client.user.deleteMany({ where: { id: { in: [actorUserId, recipientUserId] } } });
    await context.close();
  });

  function event(eventType: string, aggregateId: string): ClaimedOutboxEvent {
    const now = new Date();
    return { actorMembershipId, aggregateId, aggregateType: 'TEAM_WORK', attemptCount: 1, availableAt: now, createdAt: now, eventType, id: randomUUID(), payload: {}, workspaceId };
  }

  it('anchors assignment notifications to the selected team work', async () => {
    const payload: TeamWorkChangedOutboxPayload = { assigneeMembershipId: recipientMembershipId, changedFields: ['ASSIGNEE'], issueId, mentionedMembershipIds: [], schemaVersion: TEAM_WORK_CHANGED_SCHEMA_VERSION, subscriberMembershipIds: [], teamWorkId: webWorkId, terminalCategory: null };
    await teamWorkHandler.handleTeamWorkChanged(event('TEAM_WORK_CHANGED', webWorkId), payload);
    await expect(database.client.notification.findFirstOrThrow({ where: { type: NotificationType.TEAM_WORK_ASSIGNED, workspaceId } })).resolves.toMatchObject({ issueId, recipientMembershipId, teamWorkId: webWorkId });
  });

  it('prioritizes work-note mentions and anchors them to the edited team work', async () => {
    const payload: TeamWorkChangedOutboxPayload = {
      assigneeMembershipId: recipientMembershipId,
      changedFields: ['WORK_NOTE'],
      issueId,
      mentionedMembershipIds: [recipientMembershipId],
      schemaVersion: TEAM_WORK_CHANGED_SCHEMA_VERSION,
      subscriberMembershipIds: [recipientMembershipId],
      teamWorkId: webWorkId,
      terminalCategory: null,
    };

    await teamWorkHandler.handleTeamWorkChanged(event('TEAM_WORK_CHANGED', webWorkId), payload);

    await expect(
      database.client.notification.findFirstOrThrow({
        orderBy: { createdAt: 'desc' },
        where: { teamWorkId: webWorkId, type: NotificationType.MENTIONED, workspaceId },
      }),
    ).resolves.toMatchObject({ issueId, recipientMembershipId, teamWorkId: webWorkId });
  });

  it('anchors creation assignment notifications to the created team work', async () => {
    const payload: TeamWorkCreatedOutboxPayload = {
      assigneeMembershipId: recipientMembershipId,
      issueId,
      schemaVersion: 1,
      teamWorkId: webWorkId,
    };
    await teamWorkHandler.handleTeamWorkCreated(
      event('TEAM_WORK_CREATED', webWorkId),
      payload,
    );
    await expect(
      database.client.notification.findFirstOrThrow({
        orderBy: { createdAt: 'desc' },
        where: { type: NotificationType.TEAM_WORK_ASSIGNED, workspaceId },
      }),
    ).resolves.toMatchObject({
      issueId,
      recipientMembershipId,
      teamWorkId: webWorkId,
    });
  });

  it('anchors handoff notifications to the actual reused target team work', async () => {
    const payload: ApiHandoffCreatedOutboxPayload = { candidateRecipientMembershipIds: [recipientMembershipId], handoffId, issueId, kind: 'INITIAL', mentionedMembershipIds: [], schemaVersion: API_HANDOFF_CREATED_SCHEMA_VERSION, sourceTeamWorkId: backendWorkId, targetTeamWorkIds: [webWorkId] };
    await handoffHandler.handle(event('API_HANDOFF_CREATED', backendWorkId), payload);
    await expect(database.client.notification.findFirstOrThrow({ where: { handoffId, workspaceId } })).resolves.toMatchObject({ issueId, recipientMembershipId, teamWorkId: webWorkId, type: NotificationType.API_HANDOFF_CREATED });
  });

  it('prioritizes handoff mentions and keeps the handoff target anchor', async () => {
    const payload: ApiHandoffCreatedOutboxPayload = {
      candidateRecipientMembershipIds: [recipientMembershipId],
      handoffId,
      issueId,
      kind: 'INITIAL',
      mentionedMembershipIds: [recipientMembershipId],
      schemaVersion: API_HANDOFF_CREATED_SCHEMA_VERSION,
      sourceTeamWorkId: backendWorkId,
      targetTeamWorkIds: [webWorkId],
    };

    await handoffHandler.handle(event('API_HANDOFF_CREATED', backendWorkId), payload);

    await expect(
      database.client.notification.findFirstOrThrow({
        orderBy: { createdAt: 'desc' },
        where: { handoffId, type: NotificationType.MENTIONED, workspaceId },
      }),
    ).resolves.toMatchObject({
      issueId,
      recipientMembershipId,
      teamWorkId: webWorkId,
    });
  });
});
