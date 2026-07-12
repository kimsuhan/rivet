import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import {
  HandoffKind,
  IssueType,
  MembershipRole,
  ProjectRole,
  StateCategory,
} from '@rivet/database';
import { API_HANDOFF_CREATED, ISSUE_CHANGED, ISSUE_UNBLOCKED } from '@rivet/event-contracts';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap';
import { DatabaseService } from '../src/common/database/database.service';
import { AuthSessionService } from '../src/modules/auth/auth-session.service';
import { createCsrfToken } from '../src/modules/auth/auth-token';

const WEB_ORIGIN = 'http://localhost:3000';
const CSRF_HMAC_KEY = 'test-csrf-hmac-key-with-at-least-32-bytes';
const PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$u5oksZN2qlFVAyszxdWrug$xmy/xfzl6zj7sfdlIBgb2F6zHrOnBcsxDzJEO7QyG0A';

function handoffBody(summary: string): string {
  return [
    '## 변경 요약',
    summary,
    '## API 명세 링크',
    'https://api.example.com/openapi.json',
    '## 사용 가능 환경',
    '개발 환경',
    '## 추가·변경 API',
    'POST /sessions',
    '## 요청·응답 변경',
    '응답에 workspaceId가 추가됩니다.',
    '## 오류·권한',
    '기존 인증 정책을 유지합니다.',
    '## 프론트 주의사항',
    '새 필드는 점진적으로 사용합니다.',
  ].join('\n\n');
}

describe('M4 issue collaboration', () => {
  const runId = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  let app: INestApplication;
  let database: DatabaseService;
  let workspaceId: string;
  let actorMembershipId: string;
  let recipientMembershipId: string;
  let subscriberMembershipId: string;
  let backendStateId: string;
  let backendCompletedStateId: string;
  let backendCompletedAltStateId: string;
  let backendIssueId: string;
  let webIssueId: string;
  let webChainIssueId: string;
  let inlineBackendIssueId: string;
  let inlineWebIssueId: string;
  let noDownstreamBackendIssueId: string;
  let actorCookie: string;
  let actorCsrfToken: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    database = app.get(DatabaseService);

    const fixtures = await database.client.$transaction(async (transaction) => {
      const users = await Promise.all(
        [
          ['협업 작성자', 'actor'],
          ['후행 담당자', 'recipient'],
          ['후행 구독자', 'subscriber'],
        ].map(([displayName, kind]) => {
          const email = `m4.collaboration.${kind}.${runId}@example.com`;
          return transaction.user.create({
            data: {
              displayName: displayName!,
              email,
              emailVerifiedAt: new Date(),
              normalizedEmail: email,
              passwordHash: PASSWORD_HASH,
            },
            select: { id: true },
          });
        }),
      );
      const [actor, recipient, subscriber] = users;
      if (!actor || !recipient || !subscriber) {
        throw new Error('M4 협업 통합 테스트 사용자를 만들 수 없습니다.');
      }

      const workspace = await transaction.workspace.create({
        data: {
          createdByUserId: actor.id,
          name: 'M4 협업 워크스페이스',
          normalizedSlug: `m4-collaboration-${runId}`,
          slug: `m4-collaboration-${runId}`,
        },
        select: { id: true },
      });
      const memberships = await Promise.all([
        transaction.workspaceMembership.create({
          data: { role: MembershipRole.ADMIN, userId: actor.id, workspaceId: workspace.id },
          select: { id: true },
        }),
        transaction.workspaceMembership.create({
          data: { role: MembershipRole.MEMBER, userId: recipient.id, workspaceId: workspace.id },
          select: { id: true },
        }),
        transaction.workspaceMembership.create({
          data: { role: MembershipRole.MEMBER, userId: subscriber.id, workspaceId: workspace.id },
          select: { id: true },
        }),
      ]);
      const [actorMembership, recipientMembership, subscriberMembership] = memberships;
      if (!actorMembership || !recipientMembership || !subscriberMembership) {
        throw new Error('M4 협업 통합 테스트 멤버십을 만들 수 없습니다.');
      }

      const [backendTeam, webTeam, appTeam] = await Promise.all([
        transaction.team.create({
          data: {
            key: 'API',
            name: '백엔드 팀',
            normalizedName: '백엔드 팀',
            workspaceId: workspace.id,
          },
          select: { id: true },
        }),
        transaction.team.create({
          data: {
            key: 'WEB',
            name: '웹 팀',
            normalizedName: '웹 팀',
            workspaceId: workspace.id,
          },
          select: { id: true },
        }),
        transaction.team.create({
          data: {
            key: 'APP',
            name: '앱 팀',
            normalizedName: '앱 팀',
            workspaceId: workspace.id,
          },
          select: { id: true },
        }),
      ]);
      await transaction.teamMember.createMany({
        data: [
          {
            membershipId: actorMembership.id,
            teamId: backendTeam.id,
            workspaceId: workspace.id,
          },
          {
            membershipId: recipientMembership.id,
            teamId: webTeam.id,
            workspaceId: workspace.id,
          },
          {
            membershipId: subscriberMembership.id,
            teamId: webTeam.id,
            workspaceId: workspace.id,
          },
          {
            membershipId: recipientMembership.id,
            teamId: appTeam.id,
            workspaceId: workspace.id,
          },
        ],
      });

      const [backendState, backendCompleted, backendCompletedAlt, webState, appCompleted] =
        await Promise.all([
          transaction.workflowState.create({
            data: {
              category: StateCategory.BACKLOG,
              isDefault: true,
              name: '백로그',
              normalizedName: '백로그',
              position: 0,
              teamId: backendTeam.id,
              workspaceId: workspace.id,
            },
            select: { id: true },
          }),
          transaction.workflowState.create({
            data: {
              category: StateCategory.COMPLETED,
              name: '완료',
              normalizedName: '완료',
              position: 1,
              teamId: backendTeam.id,
              workspaceId: workspace.id,
            },
            select: { id: true },
          }),
          transaction.workflowState.create({
            data: {
              category: StateCategory.COMPLETED,
              name: '배포 준비',
              normalizedName: '배포 준비',
              position: 2,
              teamId: backendTeam.id,
              workspaceId: workspace.id,
            },
            select: { id: true },
          }),
          transaction.workflowState.create({
            data: {
              category: StateCategory.BACKLOG,
              isDefault: true,
              name: '대기',
              normalizedName: '대기',
              position: 0,
              teamId: webTeam.id,
              workspaceId: workspace.id,
            },
            select: { id: true },
          }),
          transaction.workflowState.create({
            data: {
              category: StateCategory.COMPLETED,
              isDefault: true,
              name: '완료',
              normalizedName: '완료',
              position: 0,
              teamId: appTeam.id,
              workspaceId: workspace.id,
            },
            select: { id: true },
          }),
        ]);
      const project = await transaction.project.create({
        data: { name: '협업 프로젝트', workspaceId: workspace.id },
        select: { id: true },
      });
      await transaction.projectRoleTeam.createMany({
        data: [
          {
            projectId: project.id,
            role: ProjectRole.BACKEND,
            teamId: backendTeam.id,
            workspaceId: workspace.id,
          },
          {
            projectId: project.id,
            role: ProjectRole.WEB_FRONTEND,
            teamId: webTeam.id,
            workspaceId: workspace.id,
          },
          {
            projectId: project.id,
            role: ProjectRole.APP_FRONTEND,
            teamId: appTeam.id,
            workspaceId: workspace.id,
          },
        ],
      });

      const createIssue = (data: {
        assigneeMembershipId?: string;
        identifier: string;
        projectRole: ProjectRole;
        sequenceNumber: number;
        teamId: string;
        title: string;
        workflowStateId: string;
      }) =>
        transaction.issue.create({
          data: {
            assigneeMembershipId: data.assigneeMembershipId ?? null,
            createdByMembershipId: actorMembership.id,
            identifier: data.identifier,
            projectId: project.id,
            projectRole: data.projectRole,
            sequenceNumber: data.sequenceNumber,
            teamId: data.teamId,
            title: data.title,
            type: IssueType.TEAM_TASK,
            workflowStateId: data.workflowStateId,
            workspaceId: workspace.id,
          },
          select: { id: true },
        });
      const [
        backendIssue,
        webIssue,
        webChainIssue,
        inlineBackendIssue,
        inlineWebIssue,
        noDownstreamBackendIssue,
        completedAppIssue,
      ] = await Promise.all([
        createIssue({
          assigneeMembershipId: actorMembership.id,
          identifier: 'API-1',
          projectRole: ProjectRole.BACKEND,
          sequenceNumber: 1,
          teamId: backendTeam.id,
          title: '인증 API 구현',
          workflowStateId: backendState.id,
        }),
        createIssue({
          assigneeMembershipId: recipientMembership.id,
          identifier: 'WEB-1',
          projectRole: ProjectRole.WEB_FRONTEND,
          sequenceNumber: 1,
          teamId: webTeam.id,
          title: '로그인 화면 연결',
          workflowStateId: webState.id,
        }),
        createIssue({
          identifier: 'WEB-2',
          projectRole: ProjectRole.WEB_FRONTEND,
          sequenceNumber: 2,
          teamId: webTeam.id,
          title: '세션 상태 표시',
          workflowStateId: webState.id,
        }),
        createIssue({
          identifier: 'API-2',
          projectRole: ProjectRole.BACKEND,
          sequenceNumber: 2,
          teamId: backendTeam.id,
          title: '프로필 API 구현',
          workflowStateId: backendState.id,
        }),
        createIssue({
          assigneeMembershipId: recipientMembership.id,
          identifier: 'WEB-3',
          projectRole: ProjectRole.WEB_FRONTEND,
          sequenceNumber: 3,
          teamId: webTeam.id,
          title: '프로필 화면 연결',
          workflowStateId: webState.id,
        }),
        createIssue({
          identifier: 'API-3',
          projectRole: ProjectRole.BACKEND,
          sequenceNumber: 3,
          teamId: backendTeam.id,
          title: '독립 API 구현',
          workflowStateId: backendState.id,
        }),
        createIssue({
          assigneeMembershipId: recipientMembership.id,
          identifier: 'APP-1',
          projectRole: ProjectRole.APP_FRONTEND,
          sequenceNumber: 1,
          teamId: appTeam.id,
          title: '완료된 앱 연결',
          workflowStateId: appCompleted.id,
        }),
      ]);
      await transaction.issueSubscription.createMany({
        data: [
          {
            issueId: backendIssue.id,
            membershipId: subscriberMembership.id,
            workspaceId: workspace.id,
          },
          {
            issueId: webIssue.id,
            membershipId: subscriberMembership.id,
            workspaceId: workspace.id,
          },
          {
            issueId: inlineWebIssue.id,
            membershipId: subscriberMembership.id,
            workspaceId: workspace.id,
          },
          {
            issueId: completedAppIssue.id,
            membershipId: subscriberMembership.id,
            workspaceId: workspace.id,
          },
        ],
      });
      await transaction.issueBlockRelation.create({
        data: {
          blockedIssueId: completedAppIssue.id,
          blockingIssueId: backendIssue.id,
          createdByMembershipId: actorMembership.id,
          workspaceId: workspace.id,
        },
      });

      return {
        actorMembershipId: actorMembership.id,
        actorUserId: actor.id,
        backendCompletedAltStateId: backendCompletedAlt.id,
        backendCompletedStateId: backendCompleted.id,
        backendIssueId: backendIssue.id,
        backendStateId: backendState.id,
        inlineBackendIssueId: inlineBackendIssue.id,
        inlineWebIssueId: inlineWebIssue.id,
        noDownstreamBackendIssueId: noDownstreamBackendIssue.id,
        recipientMembershipId: recipientMembership.id,
        subscriberMembershipId: subscriberMembership.id,
        userIds: users.map(({ id }) => id),
        webChainIssueId: webChainIssue.id,
        webIssueId: webIssue.id,
        workspaceId: workspace.id,
      };
    });

    userIds.push(...fixtures.userIds);
    workspaceId = fixtures.workspaceId;
    actorMembershipId = fixtures.actorMembershipId;
    recipientMembershipId = fixtures.recipientMembershipId;
    subscriberMembershipId = fixtures.subscriberMembershipId;
    backendStateId = fixtures.backendStateId;
    backendCompletedAltStateId = fixtures.backendCompletedAltStateId;
    backendCompletedStateId = fixtures.backendCompletedStateId;
    backendIssueId = fixtures.backendIssueId;
    webIssueId = fixtures.webIssueId;
    webChainIssueId = fixtures.webChainIssueId;
    inlineBackendIssueId = fixtures.inlineBackendIssueId;
    inlineWebIssueId = fixtures.inlineWebIssueId;
    noDownstreamBackendIssueId = fixtures.noDownstreamBackendIssueId;

    const session = await app.get(AuthSessionService).create(fixtures.actorUserId);
    actorCookie = `rivet_session=${session.token}`;
    actorCsrfToken = createCsrfToken(session.token, CSRF_HMAC_KEY);
  });

  afterAll(async () => {
    if (database && workspaceId) {
      await database.client.notification.deleteMany({ where: { workspaceId } });
      await database.client.outboxEvent.deleteMany({ where: { workspaceId } });
      await database.client.activityEvent.deleteMany({ where: { workspaceId } });
      await database.client.issueBlockRelation.deleteMany({ where: { workspaceId } });
      await database.client.issueSubscription.deleteMany({ where: { workspaceId } });
      await database.client.apiHandoff.deleteMany({ where: { workspaceId } });
      await database.client.issueLabel.deleteMany({ where: { workspaceId } });
      await database.client.issue.deleteMany({ where: { workspaceId } });
      await database.client.projectRoleTeam.deleteMany({ where: { workspaceId } });
      await database.client.project.deleteMany({ where: { workspaceId } });
      await database.client.workflowState.deleteMany({ where: { workspaceId } });
      await database.client.teamMember.deleteMany({ where: { workspaceId } });
      await database.client.team.deleteMany({ where: { workspaceId } });
      await database.client.session.deleteMany({ where: { userId: { in: userIds } } });
      await database.client.workspaceMembership.deleteMany({ where: { workspaceId } });
      await database.client.workspace.delete({ where: { id: workspaceId } });
      await database.client.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app?.close();
    if (process.env.FILE_STORAGE_ROOT) {
      await rm(process.env.FILE_STORAGE_ROOT, { force: true, recursive: true });
    }
  });

  it('keeps relation, handoff, completion, outbox, and timeline invariants atomic', async () => {
    const self = await request(app.getHttpServer())
      .post('/api/v1/issue-block-relations')
      .set('Cookie', actorCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', actorCsrfToken)
      .send({
        blockedIssueId: backendIssueId,
        blockedIssueVersion: 1,
        blockingIssueId: backendIssueId,
        blockingIssueVersion: 1,
      })
      .expect(422);
    expect(self.body.code).toBe('BLOCK_RELATION_SELF');

    const firstRelation = await request(app.getHttpServer())
      .post('/api/v1/issue-block-relations')
      .set('Cookie', actorCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', actorCsrfToken)
      .send({
        blockedIssueId: webIssueId,
        blockedIssueVersion: 1,
        blockingIssueId: backendIssueId,
        blockingIssueVersion: 1,
      })
      .expect(201);
    expect(firstRelation.body).toMatchObject({
      blockedIssue: { blocked: true, id: webIssueId, version: 2 },
      blockingIssue: { id: backendIssueId, version: 2 },
      relation: {
        blockedIssueId: webIssueId,
        blockingIssueId: backendIssueId,
        resolved: false,
      },
    });
    const firstRelationId = firstRelation.body.relation.id as string;

    const duplicate = await request(app.getHttpServer())
      .post('/api/v1/issue-block-relations')
      .set('Cookie', actorCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', actorCsrfToken)
      .send({
        blockedIssueId: webIssueId,
        blockedIssueVersion: 2,
        blockingIssueId: backendIssueId,
        blockingIssueVersion: 2,
      })
      .expect(409);
    expect(duplicate.body.code).toBe('BLOCK_RELATION_DUPLICATE');

    await request(app.getHttpServer())
      .post('/api/v1/issue-block-relations')
      .set('Cookie', actorCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', actorCsrfToken)
      .send({
        blockedIssueId: webChainIssueId,
        blockedIssueVersion: 1,
        blockingIssueId: webIssueId,
        blockingIssueVersion: 2,
      })
      .expect(201);
    const cycle = await request(app.getHttpServer())
      .post('/api/v1/issue-block-relations')
      .set('Cookie', actorCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', actorCsrfToken)
      .send({
        blockedIssueId: backendIssueId,
        blockedIssueVersion: 2,
        blockingIssueId: webChainIssueId,
        blockingIssueVersion: 2,
      })
      .expect(409);
    expect(cycle.body.code).toBe('BLOCK_RELATION_CYCLE');

    const initial = await request(app.getHttpServer())
      .post(`/api/v1/issues/${backendIssueId}/handoffs`)
      .set('Cookie', actorCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', actorCsrfToken)
      .send({
        bodyMarkdown: handoffBody('인증 API 계약을 추가했습니다.'),
        kind: HandoffKind.INITIAL,
      })
      .expect(201);
    expect(initial.body).toMatchObject({
      author: { id: actorMembershipId },
      kind: HandoffKind.INITIAL,
      sequenceNumber: 1,
    });
    const initialOutbox = await database.client.outboxEvent.findFirstOrThrow({
      where: { aggregateId: initial.body.id as string, eventType: API_HANDOFF_CREATED },
    });
    expect(initialOutbox.aggregateType).toBe('API_HANDOFF');
    expect(initialOutbox.payload).toEqual({
      candidateRecipientMembershipIds: [recipientMembershipId, subscriberMembershipId].sort(),
      downstreamIssueIds: [webIssueId],
      handoffId: initial.body.id,
      issueId: backendIssueId,
      kind: HandoffKind.INITIAL,
      schemaVersion: 1,
    });

    const completedWithExistingInitial = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${backendIssueId}`)
      .set('Cookie', actorCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', actorCsrfToken)
      .send({ version: 2, workflowStateId: backendCompletedStateId })
      .expect(200);
    expect(completedWithExistingInitial.body).toMatchObject({
      status: { category: StateCategory.COMPLETED },
      version: 3,
    });
    const completedOutbox = await database.client.outboxEvent.findFirstOrThrow({
      where: { aggregateId: backendIssueId, eventType: ISSUE_CHANGED },
    });
    expect(completedOutbox.payload).toEqual({
      assigneeMembershipId: null,
      changedFields: ['WORKFLOW_STATE'],
      issueId: backendIssueId,
      mentionedMembershipIds: [],
      schemaVersion: 1,
      subscriberMembershipIds: [subscriberMembershipId],
      terminalCategory: StateCategory.COMPLETED,
    });
    const unblockedOutbox = await database.client.outboxEvent.findFirstOrThrow({
      where: { aggregateId: webIssueId, eventType: ISSUE_UNBLOCKED },
    });
    expect(unblockedOutbox).toMatchObject({
      actorMembershipId,
      aggregateType: 'ISSUE',
      workspaceId,
    });
    expect(unblockedOutbox.payload).toEqual({
      blockedProjectRole: ProjectRole.WEB_FRONTEND,
      blockerIssueId: backendIssueId,
      blockingDurationBucket: 'LT_1_HOUR',
      blockingProjectRole: ProjectRole.BACKEND,
      issueId: webIssueId,
      schemaVersion: 1,
    });
    await expect(
      database.client.apiHandoff.count({ where: { issueId: backendIssueId } }),
    ).resolves.toBe(1);

    const followUp = await request(app.getHttpServer())
      .post(`/api/v1/issues/${backendIssueId}/handoffs`)
      .set('Cookie', actorCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', actorCsrfToken)
      .send({ bodyMarkdown: handoffBody('오류 응답을 보완했습니다.'), kind: HandoffKind.FOLLOW_UP })
      .expect(201);
    expect(followUp.body).toMatchObject({ kind: HandoffKind.FOLLOW_UP, sequenceNumber: 2 });

    const inlineRelation = await request(app.getHttpServer())
      .post('/api/v1/issue-block-relations')
      .set('Cookie', actorCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', actorCsrfToken)
      .send({
        blockedIssueId: inlineWebIssueId,
        blockedIssueVersion: 1,
        blockingIssueId: inlineBackendIssueId,
        blockingIssueVersion: 1,
      })
      .expect(201);
    expect(inlineRelation.body.blockingIssue.version).toBe(2);

    const missingRequiredHandoff = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${inlineBackendIssueId}`)
      .set('Cookie', actorCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', actorCsrfToken)
      .send({ version: 2, workflowStateId: backendCompletedStateId })
      .expect(409);
    expect(missingRequiredHandoff.body.code).toBe('HANDOFF_REQUIRED');
    await expect(
      database.client.issue.findUniqueOrThrow({
        select: { version: true, workflowStateId: true },
        where: { id: inlineBackendIssueId },
      }),
    ).resolves.toEqual({ version: 2, workflowStateId: backendStateId });
    await expect(
      database.client.apiHandoff.count({ where: { issueId: inlineBackendIssueId } }),
    ).resolves.toBe(0);

    const inlineCompleted = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${inlineBackendIssueId}`)
      .set('Cookie', actorCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', actorCsrfToken)
      .send({
        handoff: { bodyMarkdown: handoffBody('프로필 API 계약을 추가했습니다.') },
        version: 2,
        workflowStateId: backendCompletedStateId,
      })
      .expect(200);
    expect(inlineCompleted.body).toMatchObject({
      handoffSummary: { count: 1, hasInitial: true },
      status: { category: StateCategory.COMPLETED },
      version: 3,
    });
    const inlineHandoff = await database.client.apiHandoff.findFirstOrThrow({
      where: { issueId: inlineBackendIssueId, kind: HandoffKind.INITIAL },
    });
    const inlineOutbox = await database.client.outboxEvent.findFirstOrThrow({
      where: { aggregateId: inlineHandoff.id, eventType: API_HANDOFF_CREATED },
    });
    expect(inlineOutbox.payload).toMatchObject({
      candidateRecipientMembershipIds: [recipientMembershipId, subscriberMembershipId].sort(),
      downstreamIssueIds: [inlineWebIssueId],
    });

    const nonCompletionHandoff = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${noDownstreamBackendIssueId}`)
      .set('Cookie', actorCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', actorCsrfToken)
      .send({
        handoff: { bodyMarkdown: handoffBody('저장되면 안 됩니다.') },
        title: '변경되면 안 되는 제목',
        version: 1,
      })
      .expect(422);
    expect(nonCompletionHandoff.body.code).toBe('HANDOFF_REQUIRES_COMPLETION');
    await expect(
      database.client.issue.findUniqueOrThrow({
        select: { title: true, version: true },
        where: { id: noDownstreamBackendIssueId },
      }),
    ).resolves.toEqual({ title: '독립 API 구현', version: 1 });

    const completedWithoutDownstream = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${noDownstreamBackendIssueId}`)
      .set('Cookie', actorCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', actorCsrfToken)
      .send({ version: 1, workflowStateId: backendCompletedStateId })
      .expect(200);
    expect(completedWithoutDownstream.body).toMatchObject({
      status: { category: StateCategory.COMPLETED },
      version: 2,
    });

    const movedBetweenCompletedStates = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${noDownstreamBackendIssueId}`)
      .set('Cookie', actorCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', actorCsrfToken)
      .send({ version: 2, workflowStateId: backendCompletedAltStateId })
      .expect(200);
    expect(movedBetweenCompletedStates.body).toMatchObject({
      status: { category: StateCategory.COMPLETED },
      version: 3,
    });
    await expect(
      database.client.issue.findUniqueOrThrow({
        select: { workflowStateId: true },
        where: { id: noDownstreamBackendIssueId },
      }),
    ).resolves.toEqual({ workflowStateId: backendCompletedAltStateId });
    await expect(
      database.client.apiHandoff.count({ where: { issueId: noDownstreamBackendIssueId } }),
    ).resolves.toBe(0);

    const [backendTemplate, webTemplate] = await Promise.all([
      database.client.issue.findUniqueOrThrow({
        select: { projectId: true, projectRole: true, teamId: true },
        where: { id: backendIssueId },
      }),
      database.client.issue.findUniqueOrThrow({
        select: { projectId: true, projectRole: true, teamId: true, workflowStateId: true },
        where: { id: webIssueId },
      }),
    ]);
    if (
      !backendTemplate.projectId ||
      !backendTemplate.teamId ||
      !webTemplate.projectId ||
      !webTemplate.teamId ||
      !webTemplate.workflowStateId
    ) {
      throw new Error('마지막 blocker 테스트 템플릿이 유효하지 않습니다.');
    }
    const firstBlockerId = randomUUID();
    const finalBlockerId = randomUUID();
    const multiplyBlockedIssueId = randomUUID();
    await database.client.issue.createMany({
      data: [
        {
          createdByMembershipId: actorMembershipId,
          id: firstBlockerId,
          identifier: `API-LAST-A-${runId}`,
          projectId: backendTemplate.projectId,
          projectRole: ProjectRole.BACKEND,
          sequenceNumber: 10_001,
          teamId: backendTemplate.teamId,
          title: '첫 번째 선행 작업',
          type: IssueType.TEAM_TASK,
          workflowStateId: backendStateId,
          workspaceId,
        },
        {
          createdByMembershipId: actorMembershipId,
          id: finalBlockerId,
          identifier: `API-LAST-B-${runId}`,
          projectId: backendTemplate.projectId,
          projectRole: ProjectRole.BACKEND,
          sequenceNumber: 10_002,
          teamId: backendTemplate.teamId,
          title: '마지막 선행 작업',
          type: IssueType.TEAM_TASK,
          workflowStateId: backendStateId,
          workspaceId,
        },
        {
          createdByMembershipId: actorMembershipId,
          id: multiplyBlockedIssueId,
          identifier: `WEB-LAST-${runId}`,
          projectId: webTemplate.projectId,
          projectRole: ProjectRole.WEB_FRONTEND,
          sequenceNumber: 10_001,
          teamId: webTemplate.teamId,
          title: '두 선행 작업을 기다리는 화면',
          type: IssueType.TEAM_TASK,
          workflowStateId: webTemplate.workflowStateId,
          workspaceId,
        },
      ],
    });
    await database.client.issueBlockRelation.createMany({
      data: [firstBlockerId, finalBlockerId].map((blockingIssueId) => ({
        blockedIssueId: multiplyBlockedIssueId,
        blockingIssueId,
        createdByMembershipId: actorMembershipId,
        workspaceId,
      })),
    });

    await request(app.getHttpServer())
      .patch(`/api/v1/issues/${firstBlockerId}`)
      .set('Cookie', actorCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', actorCsrfToken)
      .send({
        handoff: { bodyMarkdown: handoffBody('첫 번째 선행 작업을 완료했습니다.') },
        version: 1,
        workflowStateId: backendCompletedStateId,
      })
      .expect(200);
    await expect(
      database.client.outboxEvent.count({
        where: { aggregateId: multiplyBlockedIssueId, eventType: ISSUE_UNBLOCKED },
      }),
    ).resolves.toBe(0);

    await request(app.getHttpServer())
      .patch(`/api/v1/issues/${finalBlockerId}`)
      .set('Cookie', actorCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', actorCsrfToken)
      .send({
        handoff: { bodyMarkdown: handoffBody('마지막 선행 작업을 완료했습니다.') },
        version: 1,
        workflowStateId: backendCompletedStateId,
      })
      .expect(200);
    await expect(
      database.client.outboxEvent.count({
        where: { aggregateId: multiplyBlockedIssueId, eventType: ISSUE_UNBLOCKED },
      }),
    ).resolves.toBe(1);

    await request(app.getHttpServer())
      .patch(`/api/v1/issues/${finalBlockerId}`)
      .set('Cookie', actorCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', actorCsrfToken)
      .send({ version: 2, workflowStateId: backendCompletedAltStateId })
      .expect(200);
    await expect(
      database.client.outboxEvent.count({
        where: { aggregateId: multiplyBlockedIssueId, eventType: ISSUE_UNBLOCKED },
      }),
    ).resolves.toBe(1);

    const timelineFirst = await request(app.getHttpServer())
      .get(`/api/v1/issues/${backendIssueId}/timeline`)
      .query({ limit: 2 })
      .set('Cookie', actorCookie)
      .expect(200);
    expect(timelineFirst.body.items).toHaveLength(2);
    expect(timelineFirst.body.nextCursor).toEqual(expect.any(String));
    expect(
      timelineFirst.body.items.filter(
        ({ activity }: { activity?: { eventType: string } }) =>
          activity?.eventType === API_HANDOFF_CREATED,
      ),
    ).toHaveLength(0);
    const timelineSecond = await request(app.getHttpServer())
      .get(`/api/v1/issues/${backendIssueId}/timeline`)
      .query({ cursor: timelineFirst.body.nextCursor, limit: 100 })
      .set('Cookie', actorCookie)
      .expect(200);
    const timelineItems = [...timelineFirst.body.items, ...timelineSecond.body.items] as Array<{
      handoff?: { id: string };
      type: string;
    }>;
    expect(timelineItems.filter(({ type }) => type === 'HANDOFF')).toHaveLength(2);
    expect(new Set(timelineItems.flatMap(({ handoff }) => (handoff ? [handoff.id] : [])))).toEqual(
      new Set([initial.body.id as string, followUp.body.id as string]),
    );

    const removed = await request(app.getHttpServer())
      .post(`/api/v1/issue-block-relations/${firstRelationId}/remove`)
      .set('Cookie', actorCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', actorCsrfToken)
      .send({ blockingIssueVersion: 3, blockedIssueVersion: 3 })
      .expect(200);
    expect(removed.body).toMatchObject({
      blockedIssue: { blocked: false, id: webIssueId, version: 4 },
      blockingIssue: { id: backendIssueId, version: 4 },
      relation: { id: firstRelationId, resolved: true },
    });
    await expect(
      database.client.activityEvent.count({
        where: {
          eventType: { in: ['ISSUE_BLOCK_RELATION_ADDED', 'ISSUE_BLOCK_RELATION_REMOVED'] },
          workspaceId,
        },
      }),
    ).resolves.toBe(8);
  });

  it('stores every blocking duration boundary in the producer payload', async () => {
    const boundaries = [
      { expectedBucket: 'LT_1_HOUR', seconds: 3_599 },
      { expectedBucket: 'LT_1_DAY', seconds: 3_600 },
      { expectedBucket: 'LT_1_DAY', seconds: 86_399 },
      { expectedBucket: 'LT_7_DAYS', seconds: 86_400 },
      { expectedBucket: 'LT_7_DAYS', seconds: 604_799 },
      { expectedBucket: 'GTE_7_DAYS', seconds: 604_800 },
    ] as const;
    const [backendTemplate, webTemplate] = await Promise.all([
      database.client.issue.findUniqueOrThrow({
        select: { projectId: true, teamId: true },
        where: { id: backendIssueId },
      }),
      database.client.issue.findUniqueOrThrow({
        select: { projectId: true, teamId: true, workflowStateId: true },
        where: { id: webIssueId },
      }),
    ]);
    if (
      !backendTemplate.projectId ||
      !backendTemplate.teamId ||
      !webTemplate.projectId ||
      !webTemplate.teamId ||
      !webTemplate.workflowStateId
    ) {
      throw new Error('차단 시간 경계 테스트 템플릿이 유효하지 않습니다.');
    }

    const blockingIssueId = randomUUID();
    const blockedIssues = boundaries.map((boundary, index) => ({
      ...boundary,
      id: randomUUID(),
      sequenceNumber: 30_001 + index,
    }));
    await database.client.issue.createMany({
      data: [
        {
          createdByMembershipId: actorMembershipId,
          id: blockingIssueId,
          identifier: `API-BUCKET-${runId}`,
          projectId: backendTemplate.projectId,
          projectRole: ProjectRole.BACKEND,
          sequenceNumber: 30_000,
          teamId: backendTemplate.teamId,
          title: '차단 시간 경계 선행 작업',
          type: IssueType.TEAM_TASK,
          workflowStateId: backendStateId,
          workspaceId,
        },
        ...blockedIssues.map(({ id, seconds, sequenceNumber }) => ({
          createdByMembershipId: actorMembershipId,
          id,
          identifier: `WEB-BUCKET-${seconds}-${runId}`,
          projectId: webTemplate.projectId,
          projectRole: ProjectRole.WEB_FRONTEND,
          sequenceNumber,
          teamId: webTemplate.teamId,
          title: `${seconds}초 차단 후행 작업`,
          type: IssueType.TEAM_TASK,
          workflowStateId: webTemplate.workflowStateId,
          workspaceId,
        })),
      ],
    });

    const transitionAt = Date.now();
    await database.client.issueBlockRelation.createMany({
      data: blockedIssues.map(({ id, seconds }) => ({
        blockedIssueId: id,
        blockingIssueId,
        createdAt: new Date(transitionAt - seconds * 1_000),
        createdByMembershipId: actorMembershipId,
        workspaceId,
      })),
    });
    const now = jest.spyOn(Date, 'now').mockReturnValue(transitionAt);
    try {
      await request(app.getHttpServer())
        .patch(`/api/v1/issues/${blockingIssueId}`)
        .set('Cookie', actorCookie)
        .set('Origin', WEB_ORIGIN)
        .set('X-CSRF-Token', actorCsrfToken)
        .send({
          handoff: { bodyMarkdown: handoffBody('차단 시간 경계를 해제했습니다.') },
          version: 1,
          workflowStateId: backendCompletedStateId,
        })
        .expect(200);
    } finally {
      now.mockRestore();
    }

    const events = await database.client.outboxEvent.findMany({
      where: {
        aggregateId: { in: blockedIssues.map(({ id }) => id) },
        eventType: ISSUE_UNBLOCKED,
      },
    });
    expect(events).toHaveLength(boundaries.length);
    for (const { expectedBucket, id } of blockedIssues) {
      expect(events.find((event) => event.aggregateId === id)?.payload).toMatchObject({
        blockingDurationBucket: expectedBucket,
      });
    }
  });
});
