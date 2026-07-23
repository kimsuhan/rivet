import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { MembershipRole, ProjectRole, StateCategory } from '@rivet/database';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap';
import { DatabaseService } from '../src/common/database/database.service';
import { AuthSessionService } from '../src/modules/auth/auth-session.service';
import { createCsrfToken } from '../src/modules/auth/auth-token.crypto';

const WEB_ORIGIN = 'http://localhost:3000';
const CSRF_HMAC_KEY = 'test-csrf-hmac-key-with-at-least-32-bytes';
const PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$u5oksZN2qlFVAyszxdWrug$xmy/xfzl6zj7sfdlIBgb2F6zHrOnBcsxDzJEO7QyG0A';

function handoffBody(mentionedMembershipId?: string): string {
  return [
    '## 작업 결과 요약',
    '통합 계약 적용',
    '## 결과물 링크',
    'https://api.example.com/openapi.json',
    '## 사용 가능 환경',
    '개발 환경',
    '## 후속 작업',
    'PATCH /team-works/{id}',
    '## 입력·출력 변경',
    'teamWorkId 사용',
    '## 주의·권한',
    '기존 정책 유지',
    '## 전달 대상 참고사항',
    mentionedMembershipId
      ? `정본 통합 상세는 @[M9 두 번째 사용자](rivet-member:${mentionedMembershipId})에게 확인`
      : '정본 통합 상세 사용',
  ].join('\n\n');
}

describe('M9 issue content and team execution API', () => {
  const runId = randomUUID().slice(0, 8);
  let app: INestApplication;
  let database: DatabaseService;
  let userId: string;
  let secondUserId: string;
  let secondMembershipId: string;
  let workspaceId: string;
  let membershipId: string;
  let projectId: string;
  let soloProjectId: string;
  let webTeamId: string;
  let appTeamId: string;
  let backendDoneId: string;
  let webDoneId: string;
  let webStartedId: string;
  let appBacklogDefaultId: string;
  let appCompletedId: string;
  let appUnstartedId: string;
  let appPausedId: string;
  let appProjectTeamId: string;
  let backendProjectTeamId: string;
  let soloBackendProjectTeamId: string;
  let webProjectTeamId: string;
  let planningTeamId: string;
  let operationsTeamId: string;
  let planningStartedId: string;
  let planningDoneId: string;
  let operationsDoneId: string;
  let cookie: string;
  let csrf: string;
  let memberCookie: string;
  let memberCsrf: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    database = app.get(DatabaseService);
    const fixture = await database.client.$transaction(async (transaction) => {
      const email = `m9.${runId}@example.com`;
      const user = await transaction.user.create({
        data: {
          displayName: 'M9 사용자',
          email,
          emailVerifiedAt: new Date(),
          normalizedEmail: email,
          passwordHash: PASSWORD_HASH,
        },
      });
      const workspace = await transaction.workspace.create({
        data: {
          createdByUserId: user.id,
          name: 'M9 워크스페이스',
          normalizedSlug: `m9-${runId}`,
          slug: `m9-${runId}`,
        },
      });
      const membership = await transaction.workspaceMembership.create({
        data: { role: MembershipRole.ADMIN, userId: user.id, workspaceId: workspace.id },
      });
      const secondEmail = `m9-second.${runId}@example.com`;
      const secondUser = await transaction.user.create({
        data: {
          displayName: 'M9 두 번째 사용자',
          email: secondEmail,
          emailVerifiedAt: new Date(),
          normalizedEmail: secondEmail,
          passwordHash: PASSWORD_HASH,
        },
      });
      const secondMembership = await transaction.workspaceMembership.create({
        data: { role: MembershipRole.MEMBER, userId: secondUser.id, workspaceId: workspace.id },
      });
      const backend = await transaction.team.create({
        data: { key: 'API', name: '백엔드', normalizedName: '백엔드', workspaceId: workspace.id },
      });
      const web = await transaction.team.create({
        data: { key: 'WEB', name: '웹', normalizedName: '웹', workspaceId: workspace.id },
      });
      const app = await transaction.team.create({
        data: { key: 'APP', name: '앱', normalizedName: '앱', workspaceId: workspace.id },
      });
      const planning = await transaction.team.create({
        data: { key: 'PLAN', name: '기획', normalizedName: '기획', workspaceId: workspace.id },
      });
      const operations = await transaction.team.create({
        data: { key: 'OPS', name: '운영', normalizedName: '운영', workspaceId: workspace.id },
      });
      await transaction.teamMember.createMany({
        data: [
          { membershipId: membership.id, teamId: backend.id, workspaceId: workspace.id },
          { membershipId: membership.id, teamId: web.id, workspaceId: workspace.id },
          { membershipId: membership.id, teamId: app.id, workspaceId: workspace.id },
          { membershipId: membership.id, teamId: planning.id, workspaceId: workspace.id },
          { membershipId: membership.id, teamId: operations.id, workspaceId: workspace.id },
          { membershipId: secondMembership.id, teamId: app.id, workspaceId: workspace.id },
        ],
      });
      await transaction.workflowState.create({
        data: {
          category: StateCategory.UNSTARTED,
          isDefault: true,
          name: '할 일',
          normalizedName: '할 일',
          position: 0,
          teamId: backend.id,
          workspaceId: workspace.id,
        },
      });
      const backendDone = await transaction.workflowState.create({
        data: {
          category: StateCategory.COMPLETED,
          name: '완료',
          normalizedName: '완료',
          position: 1,
          teamId: backend.id,
          workspaceId: workspace.id,
        },
      });
      await transaction.workflowState.create({
        data: {
          category: StateCategory.UNSTARTED,
          isDefault: true,
          name: '할 일',
          normalizedName: '할 일',
          position: 0,
          teamId: web.id,
          workspaceId: workspace.id,
        },
      });
      const webStarted = await transaction.workflowState.create({
        data: {
          category: StateCategory.STARTED,
          name: '진행 중',
          normalizedName: '진행 중',
          position: 1,
          teamId: web.id,
          workspaceId: workspace.id,
        },
      });
      const webDone = await transaction.workflowState.create({
        data: {
          category: StateCategory.COMPLETED,
          name: '완료',
          normalizedName: '완료',
          position: 2,
          teamId: web.id,
          workspaceId: workspace.id,
        },
      });
      const appBacklogDefault = await transaction.workflowState.create({
        data: {
          category: StateCategory.BACKLOG,
          isDefault: true,
          name: '미분류',
          normalizedName: '미분류',
          position: 0,
          teamId: app.id,
          workspaceId: workspace.id,
        },
      });
      const appUnstarted = await transaction.workflowState.create({
        data: {
          category: StateCategory.UNSTARTED,
          name: '할 일',
          normalizedName: '할 일',
          position: 1,
          teamId: app.id,
          workspaceId: workspace.id,
        },
      });
      await transaction.workflowState.create({
        data: {
          category: StateCategory.STARTED,
          name: '진행 중',
          normalizedName: '진행 중',
          position: 2,
          teamId: app.id,
          workspaceId: workspace.id,
        },
      });
      const appCompleted = await transaction.workflowState.create({
        data: {
          category: StateCategory.COMPLETED,
          name: '완료',
          normalizedName: '완료',
          position: 3,
          teamId: app.id,
          workspaceId: workspace.id,
        },
      });
      const appPaused = await transaction.workflowState.create({
        data: {
          category: StateCategory.BACKLOG,
          isDefault: false,
          name: '보류',
          normalizedName: '보류',
          position: 4,
          teamId: app.id,
          workspaceId: workspace.id,
        },
      });
      await transaction.workflowState.createMany({
        data: [
          {
            category: StateCategory.UNSTARTED,
            isDefault: true,
            name: '대기',
            normalizedName: '대기',
            position: 0,
            teamId: planning.id,
            workspaceId: workspace.id,
          },
          {
            category: StateCategory.UNSTARTED,
            isDefault: true,
            name: '대기',
            normalizedName: '대기',
            position: 0,
            teamId: operations.id,
            workspaceId: workspace.id,
          },
        ],
      });
      const planningStarted = await transaction.workflowState.create({
        data: {
          category: StateCategory.STARTED,
          name: '진행 중',
          normalizedName: '진행 중',
          position: 1,
          teamId: planning.id,
          workspaceId: workspace.id,
        },
      });
      const planningDone = await transaction.workflowState.create({
        data: {
          category: StateCategory.COMPLETED,
          name: '완료',
          normalizedName: '완료',
          position: 2,
          teamId: planning.id,
          workspaceId: workspace.id,
        },
      });
      const operationsDone = await transaction.workflowState.create({
        data: {
          category: StateCategory.COMPLETED,
          name: '완료',
          normalizedName: '완료',
          position: 1,
          teamId: operations.id,
          workspaceId: workspace.id,
        },
      });
      const project = await transaction.project.create({
        data: { leadMembershipId: membership.id, name: '통합 프로젝트', workspaceId: workspace.id },
      });
      await transaction.projectRoleTeam.createMany({
        data: [
          {
            projectId: project.id,
            role: ProjectRole.BACKEND,
            teamId: backend.id,
            workspaceId: workspace.id,
          },
          {
            projectId: project.id,
            role: ProjectRole.WEB_FRONTEND,
            teamId: web.id,
            workspaceId: workspace.id,
          },
          {
            projectId: project.id,
            role: ProjectRole.APP_FRONTEND,
            teamId: app.id,
            workspaceId: workspace.id,
          },
        ],
      });
      const soloProject = await transaction.project.create({
        data: {
          leadMembershipId: membership.id,
          name: '프론트 역할 없는 프로젝트',
          workspaceId: workspace.id,
        },
      });
      await transaction.projectRoleTeam.create({
        data: {
          projectId: soloProject.id,
          role: ProjectRole.BACKEND,
          teamId: backend.id,
          workspaceId: workspace.id,
        },
      });
      const [backendProjectTeam, webProjectTeam, appProjectTeam, soloBackendProjectTeam] =
        await Promise.all([
          transaction.projectTeam.findUniqueOrThrow({
            where: { projectId_teamId: { projectId: project.id, teamId: backend.id } },
          }),
          transaction.projectTeam.findUniqueOrThrow({
            where: { projectId_teamId: { projectId: project.id, teamId: web.id } },
          }),
          transaction.projectTeam.findUniqueOrThrow({
            where: { projectId_teamId: { projectId: project.id, teamId: app.id } },
          }),
          transaction.projectTeam.findUniqueOrThrow({
            where: { projectId_teamId: { projectId: soloProject.id, teamId: backend.id } },
          }),
        ]);
      return {
        appBacklogDefaultId: appBacklogDefault.id,
        appCompletedId: appCompleted.id,
        appPausedId: appPaused.id,
        appTeamId: app.id,
        appUnstartedId: appUnstarted.id,
        appProjectTeamId: appProjectTeam.id,
        backendDoneId: backendDone.id,
        backendProjectTeamId: backendProjectTeam.id,
        membershipId: membership.id,
        operationsDoneId: operationsDone.id,
        operationsTeamId: operations.id,
        planningDoneId: planningDone.id,
        planningStartedId: planningStarted.id,
        planningTeamId: planning.id,
        projectId: project.id,
        secondMembershipId: secondMembership.id,
        secondUserId: secondUser.id,
        soloProjectId: soloProject.id,
        soloBackendProjectTeamId: soloBackendProjectTeam.id,
        userId: user.id,
        webDoneId: webDone.id,
        webStartedId: webStarted.id,
        webTeamId: web.id,
        webProjectTeamId: webProjectTeam.id,
        workspaceId: workspace.id,
      };
    });
    ({
      userId,
      secondUserId,
      workspaceId,
      membershipId,
      secondMembershipId,
      projectId,
      soloProjectId,
      webTeamId,
      appTeamId,
      backendDoneId,
      webDoneId,
      webStartedId,
      appBacklogDefaultId,
      appCompletedId,
      appUnstartedId,
      appPausedId,
      appProjectTeamId,
      backendProjectTeamId,
      soloBackendProjectTeamId,
      webProjectTeamId,
      planningTeamId,
      operationsTeamId,
      planningStartedId,
      planningDoneId,
      operationsDoneId,
    } = fixture);
    const session = await app.get(AuthSessionService).create(userId);
    cookie = `rivet_session=${session.token}`;
    csrf = createCsrfToken(session.token, CSRF_HMAC_KEY);
    const memberSession = await app.get(AuthSessionService).create(secondUserId);
    memberCookie = `rivet_session=${memberSession.token}`;
    memberCsrf = createCsrfToken(memberSession.token, CSRF_HMAC_KEY);
  });

  afterAll(async () => {
    if (database) {
      await database.client.notification.deleteMany({ where: { workspaceId } });
      await database.client.apiHandoffTarget.deleteMany({ where: { workspaceId } });
      await database.client.apiHandoff.deleteMany({ where: { workspaceId } });
      await database.client.activityEvent.deleteMany({ where: { workspaceId } });
      await database.client.comment.deleteMany({ where: { workspaceId } });
      await database.client.issueSubscription.deleteMany({ where: { workspaceId } });
      await database.client.teamWork.deleteMany({ where: { workspaceId } });
      await database.client.issue.deleteMany({ where: { workspaceId } });
      await database.client.outboxEvent.deleteMany({ where: { workspaceId } });
      await database.client.projectRoleTeam.deleteMany({ where: { workspaceId } });
      await database.client.projectTeam.deleteMany({ where: { workspaceId } });
      await database.client.project.deleteMany({ where: { workspaceId } });
      await database.client.workflowState.deleteMany({ where: { workspaceId } });
      await database.client.teamMember.deleteMany({ where: { workspaceId } });
      await database.client.team.deleteMany({ where: { workspaceId } });
      await database.client.session.deleteMany({
        where: { userId: { in: [userId, secondUserId] } },
      });
      await database.client.workspaceMembership.deleteMany({ where: { workspaceId } });
      await database.client.workspace.deleteMany({ where: { id: workspaceId } });
      await database.client.user.deleteMany({ where: { id: { in: [userId, secondUserId] } } });
    }
    await app?.close();
    if (process.env.FILE_STORAGE_ROOT)
      await rm(process.env.FILE_STORAGE_ROOT, { force: true, recursive: true });
  });

  const mutate = (method: 'delete' | 'patch' | 'post', path: string) =>
    request(app.getHttpServer())
      [method](path)
      .set('Cookie', cookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', csrf);

  const mutateAsMember = (method: 'patch' | 'post', path: string) =>
    request(app.getHttpServer())
      [method](path)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrf);

  it('creates an issue without execution and rejects legacy or standalone team-work creation', async () => {
    const created = await mutate('post', '/api/v1/issues')
      .send({ descriptionMarkdown: '# 공통 설명', projectId, title: '시작 역할 없는 이슈' })
      .expect(201);
    expect(created.body.issue).toMatchObject({
      descriptionMarkdown: '# 공통 설명',
      status: 'UNSORTED',
      teamWorks: [],
    });
    expect(created.body.createdTeamWorks).toEqual([]);
    const started = await mutate('post', `/api/v1/issues/${created.body.issue.id}/team-works`)
      .send({ teamAssignments: [{ projectTeamId: backendProjectTeamId }] })
      .expect(200);
    const removable = started.body.teamWorks[0] as { id: string; version: number };
    const removed = await mutate('post', `/api/v1/team-works/${removable.id}/remove`)
      .send({ version: removable.version })
      .expect(200);
    expect(removed.body).toMatchObject({
      id: created.body.issue.id,
      status: 'UNSORTED',
      teamWorks: [],
    });
    await request(app.getHttpServer())
      .get(`/api/v1/team-works/${removable.id}`)
      .set('Cookie', cookie)
      .expect(404);
    await mutate('post', '/api/v1/issues')
      .send({ projectId, title: '레거시', type: 'FEATURE' })
      .expect(422);
    await mutate('post', '/api/v1/team-works').send({ title: '독립 작업' }).expect(404);
  });

  it('manages non-enum project teams without role ordering and preserves participation history', async () => {
    const deniedCreate = await mutateAsMember('post', '/api/v1/projects')
      .send({
        leadMembershipId: membershipId,
        name: '권한 없는 참여 설정',
        teamIds: [planningTeamId],
      })
      .expect(403);
    expect(deniedCreate.body.code).toBe('PROJECT_TEAM_MANAGE_FORBIDDEN');

    const createdProject = await mutate('post', '/api/v1/projects')
      .send({ leadMembershipId: membershipId, name: '기획 운영 프로젝트' })
      .expect(201);
    expect(createdProject.body.projectTeams).toEqual([]);

    const deniedUpdate = await mutateAsMember('patch', `/api/v1/projects/${createdProject.body.id}`)
      .send({ teamIds: [planningTeamId], version: createdProject.body.version })
      .expect(403);
    expect(deniedUpdate.body.code).toBe('PROJECT_TEAM_MANAGE_FORBIDDEN');

    const participating = await mutate('patch', `/api/v1/projects/${createdProject.body.id}`)
      .send({
        teamIds: [planningTeamId, operationsTeamId],
        version: createdProject.body.version,
      })
      .expect(200);
    const planningProjectTeam = participating.body.projectTeams.find(
      ({ team }: { team: { id: string } }) => team.id === planningTeamId,
    );
    const operationsProjectTeam = participating.body.projectTeams.find(
      ({ team }: { team: { id: string } }) => team.id === operationsTeamId,
    );
    expect(planningProjectTeam).toMatchObject({
      active: true,
      team: { key: 'PLAN', name: '기획' },
    });
    expect(operationsProjectTeam).toMatchObject({
      active: true,
      team: { key: 'OPS', name: '운영' },
    });

    const unchanged = await mutate('patch', `/api/v1/projects/${createdProject.body.id}`)
      .send({
        teamIds: [planningTeamId, operationsTeamId],
        version: participating.body.version,
      })
      .expect(200);
    expect(unchanged.body.version).toBe(participating.body.version);
    expect(
      await database.client.projectTeam.count({
        where: { projectId: createdProject.body.id, teamId: planningTeamId },
      }),
    ).toBe(1);

    const issueCountBeforeInvalid = await database.client.issue.count({
      where: { projectId: createdProject.body.id },
    });
    await mutate('post', '/api/v1/issues')
      .send({
        initialTeams: [
          {
            assigneeMembershipId: secondMembershipId,
            projectTeamId: planningProjectTeam.id,
          },
        ],
        projectId: createdProject.body.id,
        title: '팀 밖 담당자 원자성 검증',
      })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('TEAM_MEMBERSHIP_REQUIRED'));
    expect(
      await database.client.issue.count({ where: { projectId: createdProject.body.id } }),
    ).toBe(issueCountBeforeInvalid);

    const createdIssue = await mutate('post', '/api/v1/issues')
      .send({
        initialTeams: [
          { assigneeMembershipId: membershipId, projectTeamId: planningProjectTeam.id },
          { assigneeMembershipId: membershipId, projectTeamId: operationsProjectTeam.id },
        ],
        projectId: createdProject.body.id,
        title: '기획 운영 병렬 실행',
      })
      .expect(201);
    expect(createdIssue.body.createdTeamWorks).toHaveLength(2);
    const planningWork = createdIssue.body.createdTeamWorks.find(
      ({ identifier }: { identifier: string }) => identifier.startsWith('PLAN-'),
    );
    const operationsWork = createdIssue.body.createdTeamWorks.find(
      ({ identifier }: { identifier: string }) => identifier.startsWith('OPS-'),
    );
    expect(planningWork.identifier).toMatch(/^PLAN-/u);
    expect(operationsWork.identifier).toMatch(/^OPS-/u);

    await mutate('patch', `/api/v1/team-works/${planningWork.id}`)
      .send({ version: planningWork.version, workflowStateId: operationsDoneId })
      .expect(404);
    const startedPlanning = await mutate('patch', `/api/v1/team-works/${planningWork.id}`)
      .send({ version: planningWork.version, workflowStateId: planningStartedId })
      .expect(200);

    await mutate('patch', `/api/v1/projects/${createdProject.body.id}`)
      .send({ teamIds: [operationsTeamId], version: unchanged.body.version })
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('PROJECT_TEAM_IN_USE'));

    const handoffCountBefore = await database.client.apiHandoff.count({
      where: { issueId: createdIssue.body.issue.id },
    });
    await mutate('patch', `/api/v1/team-works/${planningWork.id}`)
      .send({
        completionMode: 'HANDOFF_AND_COMPLETE',
        handoff: {
          bodyMarkdown: handoffBody(),
          destinationProjectTeamIds: [operationsProjectTeam.id, webProjectTeamId],
        },
        version: startedPlanning.body.teamWork.version,
        workflowStateId: planningDoneId,
      })
      .expect(422);
    expect(
      await database.client.apiHandoff.count({ where: { issueId: createdIssue.body.issue.id } }),
    ).toBe(handoffCountBefore);

    const delivered = await mutate('patch', `/api/v1/team-works/${planningWork.id}`)
      .send({
        completionMode: 'HANDOFF_AND_COMPLETE',
        handoff: {
          bodyMarkdown: handoffBody(),
          destinationProjectTeamIds: [operationsProjectTeam.id],
        },
        version: startedPlanning.body.teamWork.version,
        workflowStateId: planningDoneId,
      })
      .expect(200);
    expect(delivered.body.downstreamTeamWorks.map(({ id }: { id: string }) => id)).toEqual([
      operationsWork.id,
    ]);

    const currentOperations = await request(app.getHttpServer())
      .get(`/api/v1/team-works/${operationsWork.id}`)
      .set('Cookie', cookie)
      .expect(200);
    const completedOperations = await mutate('patch', `/api/v1/team-works/${operationsWork.id}`)
      .send({
        completionMode: 'COMPLETE_ONLY',
        version: currentOperations.body.version,
        workflowStateId: operationsDoneId,
      })
      .expect(200);
    expect(completedOperations.body.issue.progress).toEqual({
      completed: 2,
      percentage: 100,
      total: 2,
    });

    const deactivated = await mutate('patch', `/api/v1/projects/${createdProject.body.id}`)
      .send({ teamIds: [operationsTeamId], version: unchanged.body.version })
      .expect(200);
    expect(
      deactivated.body.projectTeams.find(({ id }: { id: string }) => id === planningProjectTeam.id),
    ).toMatchObject({ active: false });
    await mutate('post', '/api/v1/issues')
      .send({
        initialTeams: [{ projectTeamId: planningProjectTeam.id }],
        projectId: createdProject.body.id,
        title: '비활성 참여 팀 거부',
      })
      .expect(422)
      .expect(({ body }) => expect(body.code).toBe('INITIAL_TEAM_NOT_AVAILABLE'));

    const [reactivated, conflicted] = await Promise.all([
      mutate('patch', `/api/v1/projects/${createdProject.body.id}`).send({
        teamIds: [planningTeamId, operationsTeamId],
        version: deactivated.body.version,
      }),
      mutate('patch', `/api/v1/projects/${createdProject.body.id}`).send({
        teamIds: [planningTeamId, operationsTeamId],
        version: deactivated.body.version,
      }),
    ]);
    expect([reactivated.status, conflicted.status].sort()).toEqual([200, 409]);
    const successful = reactivated.status === 200 ? reactivated : conflicted;
    expect(
      successful.body.projectTeams.find(
        ({ team }: { team: { id: string } }) => team.id === planningTeamId,
      ),
    ).toMatchObject({ active: true, id: planningProjectTeam.id });
    expect(
      await database.client.projectTeam.count({
        where: { projectId: createdProject.body.id, teamId: planningTeamId },
      }),
    ).toBe(1);
  });

  it('runs the complete issue, team-work, handoff, search, comment, and completion flow', async () => {
    const created = await mutate('post', '/api/v1/issues')
      .send({
        initialTeams: [{ assigneeMembershipId: membershipId, projectTeamId: backendProjectTeamId }],
        priority: 'HIGH',
        projectId,
        title: 'M9 전체 흐름',
      })
      .expect(201);
    const issue = created.body.issue as { id: string; identifier: string; version: number };
    const backend = created.body.createdTeamWorks[0] as {
      id: string;
      identifier: string;
      version: number;
    };
    expect(backend.identifier).toMatch(/^API-/u);

    const started = await mutate('post', `/api/v1/issues/${issue.id}/team-works`)
      .send({ teamAssignments: [{ projectTeamId: webProjectTeamId }] })
      .expect(200);
    const web = started.body.teamWorks[0] as { id: string; identifier: string; version: number };
    expect(
      await database.client.outboxEvent.count({
        where: {
          aggregateId: { in: [backend.id, web.id] },
          eventType: 'TEAM_WORK_CREATED',
          workspaceId,
        },
      }),
    ).toBe(2);
    const listed = await request(app.getHttpServer())
      .get(`/api/v1/issues/${issue.id}/team-works`)
      .set('Cookie', cookie)
      .expect(200);
    expect(listed.body.items.map(({ id }: { id: string }) => id).sort()).toEqual(
      [backend.id, web.id].sort(),
    );
    await request(app.getHttpServer())
      .get('/api/v1/team-works')
      .query({ assigneeMembershipId: 'me' })
      .set('Cookie', cookie)
      .expect(200)
      .expect(({ body }) =>
        expect(body.items.map(({ id }: { id: string }) => id)).toContain(backend.id),
      );
    await request(app.getHttpServer())
      .get('/api/v1/team-works')
      .query({ teamId: webTeamId })
      .set('Cookie', cookie)
      .expect(200)
      .expect(({ body }) =>
        expect(body.items.map(({ id }: { id: string }) => id)).toContain(web.id),
      );

    const note = await mutate('patch', `/api/v1/team-works/${web.id}`)
      .send({
        assigneeMembershipId: membershipId,
        workNoteMarkdown: `## 응답 계약\n\n@[M9 두 번째 사용자](rivet-member:${secondMembershipId})와 \`workspaceId\`를 확인합니다.`,
        version: web.version,
      })
      .expect(200);
    expect(note.body.teamWork).toMatchObject({
      assignee: { id: membershipId },
      workNoteMarkdown: `## 응답 계약\n\n@[M9 두 번째 사용자](rivet-member:${secondMembershipId})와 \`workspaceId\`를 확인합니다.`,
    });
    await expect(
      database.client.mention.findFirstOrThrow({
        where: { mentionedMembershipId: secondMembershipId, teamWorkId: web.id, workspaceId },
      }),
    ).resolves.toMatchObject({ issueId: issue.id });
    await expect(
      database.client.outboxEvent.findFirstOrThrow({
        orderBy: { createdAt: 'desc' },
        where: { aggregateId: web.id, eventType: 'TEAM_WORK_CHANGED', workspaceId },
      }),
    ).resolves.toMatchObject({
      payload: expect.objectContaining({
        mentionedMembershipIds: [secondMembershipId],
        schemaVersion: 2,
      }),
    });
    await expect(
      database.client.issueSubscription.findUnique({
        where: {
          issueId_membershipId: { issueId: issue.id, membershipId: secondMembershipId },
        },
      }),
    ).resolves.not.toBeNull();
    expect(note.body.teamWork.readinessStatus).toBeUndefined();
    const startedWeb = await mutate('patch', `/api/v1/team-works/${web.id}`)
      .send({ version: note.body.teamWork.version, workflowStateId: webStartedId })
      .expect(200);
    expect(startedWeb.body.teamWork.stateCategory).toBe('STARTED');
    await mutate('patch', `/api/v1/team-works/${web.id}`)
      .send({
        workNoteMarkdown: '![이미지](/files/98ab3a6d-0d24-484e-a36a-b8028dc00465)',
        version: startedWeb.body.teamWork.version,
      })
      .expect(422);

    const currentBackend = await request(app.getHttpServer())
      .get(`/api/v1/team-works/${backend.id}`)
      .set('Cookie', cookie)
      .expect(200);

    // 완료 전이에 completionMode가 없으면 명확한 422를 반환한다.
    await mutate('patch', `/api/v1/team-works/${backend.id}`)
      .send({ version: currentBackend.body.version, workflowStateId: backendDoneId })
      .expect(422)
      .expect(({ body }) => expect(body.code).toBe('TEAM_WORK_COMPLETION_MODE_REQUIRED'));
    // COMPLETE_ONLY에는 handoff를 허용하지 않는다.
    await mutate('patch', `/api/v1/team-works/${backend.id}`)
      .send({
        completionMode: 'COMPLETE_ONLY',
        handoff: { bodyMarkdown: handoffBody() },
        version: currentBackend.body.version,
        workflowStateId: backendDoneId,
      })
      .expect(422)
      .expect(({ body }) => expect(body.code).toBe('TEAM_WORK_HANDOFF_NOT_ALLOWED'));
    // HANDOFF_AND_COMPLETE에는 전달 본문이 필요하다.
    await mutate('patch', `/api/v1/team-works/${backend.id}`)
      .send({
        completionMode: 'HANDOFF_AND_COMPLETE',
        version: currentBackend.body.version,
        workflowStateId: backendDoneId,
      })
      .expect(422)
      .expect(({ body }) => expect(body.code).toBe('TEAM_WORK_HANDOFF_REQUIRED'));
    // 완료가 아닌 전이에 completionMode가 오면 422를 반환한다.
    await mutate('patch', `/api/v1/team-works/${backend.id}`)
      .send({
        completionMode: 'COMPLETE_ONLY',
        version: currentBackend.body.version,
        workNoteMarkdown: '완료가 아닌 변경',
      })
      .expect(422)
      .expect(({ body }) => expect(body.code).toBe('TEAM_WORK_COMPLETION_MODE_NOT_ALLOWED'));

    const delivered = await mutate('patch', `/api/v1/team-works/${backend.id}`)
      .send({
        completionMode: 'HANDOFF_AND_COMPLETE',
        handoff: {
          bodyMarkdown: handoffBody(secondMembershipId),
          destinationProjectTeamIds: [webProjectTeamId],
        },
        version: currentBackend.body.version,
        workflowStateId: backendDoneId,
      })
      .expect(200);
    expect(delivered.body.downstreamTeamWorks.map(({ id }: { id: string }) => id)).toEqual([
      web.id,
    ]);
    expect(delivered.body.handoff).toMatchObject({
      sourceTeamWorkId: backend.id,
      targetTeamWorkIds: [web.id],
    });
    await expect(
      database.client.mention.findFirstOrThrow({
        where: {
          apiHandoffId: delivered.body.handoff.id,
          mentionedMembershipId: secondMembershipId,
          workspaceId,
        },
      }),
    ).resolves.toMatchObject({ issueId: issue.id });
    await expect(
      database.client.outboxEvent.findFirstOrThrow({
        where: {
          aggregateId: delivered.body.handoff.id,
          eventType: 'API_HANDOFF_CREATED',
          workspaceId,
        },
      }),
    ).resolves.toMatchObject({
      payload: expect.objectContaining({
        mentionedMembershipIds: [secondMembershipId],
        schemaVersion: 2,
      }),
    });
    expect(await database.client.apiHandoffTarget.count({ where: { teamWorkId: web.id } })).toBe(1);
    const readyWeb = await request(app.getHttpServer())
      .get(`/api/v1/team-works/${web.id}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(readyWeb.body.stateCategory).toBe('STARTED');
    // 프론트 전용 작업은 프로젝트에 프론트 역할이 있어도 전달 없이 완료할 수 있다.
    const completedWeb = await mutate('patch', `/api/v1/team-works/${web.id}`)
      .send({
        completionMode: 'COMPLETE_ONLY',
        version: readyWeb.body.version,
        workflowStateId: webDoneId,
      })
      .expect(200);
    expect(completedWeb.body.issue.status).toBe('DONE');

    const comment = await mutate('post', `/api/v1/issues/${issue.id}/comments`)
      .send({ bodyMarkdown: '공통 댓글', teamWorkId: web.id })
      .expect(201);
    expect(comment.body.teamWorkId).toBe(web.id);
    const timeline = await request(app.getHttpServer())
      .get(`/api/v1/issues/${issue.id}/timeline`)
      .set('Cookie', cookie)
      .expect(200);
    expect(timeline.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          comment: expect.objectContaining({ teamWorkId: web.id }),
          type: 'COMMENT',
        }),
      ]),
    );
    expect(timeline.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          activity: expect.objectContaining({
            eventType: 'TEAM_WORK_CHANGED',
            teamWorkId: web.id,
            teamWorkIdentifier: web.identifier,
          }),
          type: 'ACTIVITY',
        }),
      ]),
    );
    const search = await request(app.getHttpServer())
      .get('/api/v1/search')
      .query({ query: web.identifier })
      .set('Cookie', cookie)
      .expect(200);
    expect(search.body.items[0]).toMatchObject({
      issue: { id: issue.id },
      resourceType: 'TEAM_WORK',
      teamWork: { id: web.id },
    });
  });

  it('uses any-category default for unassigned work and unstarted for assigned work', async () => {
    const unassignedIssue = await mutate('post', '/api/v1/issues')
      .send({
        initialTeams: [{ projectTeamId: appProjectTeamId }],
        projectId,
        title: '담당자 없는 앱 작업',
      })
      .expect(201);
    const backlogWork = unassignedIssue.body.createdTeamWorks[0] as {
      id: string;
      stateCategory: string;
      version: number;
      workflowState: { id: string };
    };
    expect(backlogWork.stateCategory).toBe('BACKLOG');
    expect(backlogWork.workflowState.id).toBe(appBacklogDefaultId);

    const assignedIssue = await mutate('post', '/api/v1/issues')
      .send({
        initialTeams: [{ assigneeMembershipId: membershipId, projectTeamId: appProjectTeamId }],
        projectId,
        title: '담당자 있는 앱 작업',
      })
      .expect(201);
    const unstartedWork = assignedIssue.body.createdTeamWorks[0] as {
      stateCategory: string;
      workflowState: { id: string };
    };
    expect(unstartedWork.stateCategory).toBe('UNSTARTED');
    expect(unstartedWork.workflowState.id).toBe(appUnstartedId);

    const assigned = await mutate('patch', `/api/v1/team-works/${backlogWork.id}`)
      .send({ assigneeMembershipId: membershipId, version: backlogWork.version })
      .expect(200);
    expect(assigned.body.teamWork.stateCategory).toBe('UNSTARTED');
    expect(assigned.body.teamWork.workflowState.id).toBe(appUnstartedId);

    const reassigned = await mutate('patch', `/api/v1/team-works/${backlogWork.id}`)
      .send({ assigneeMembershipId: secondMembershipId, version: assigned.body.teamWork.version })
      .expect(200);
    expect(reassigned.body.teamWork.stateCategory).toBe('UNSTARTED');
    expect(reassigned.body.teamWork.assignee).toMatchObject({ id: secondMembershipId });

    const unassigned = await mutate('patch', `/api/v1/team-works/${backlogWork.id}`)
      .send({ assigneeMembershipId: null, version: reassigned.body.teamWork.version })
      .expect(200);
    expect(unassigned.body.teamWork.stateCategory).toBe('UNSTARTED');
    expect(unassigned.body.teamWork.assignee).toBeNull();

    const pausedIssue = await mutate('post', '/api/v1/issues')
      .send({ projectId, title: '보류 상태 수동 앱 작업' })
      .expect(201);
    const appTeamRow = await database.client.team.findUniqueOrThrow({ where: { id: appTeamId } });
    const pausedWork = await database.client.teamWork.create({
      data: {
        createdByMembershipId: membershipId,
        identifier: `${appTeamRow.key}-${appTeamRow.nextIssueNumber}`,
        issueId: pausedIssue.body.issue.id,
        projectTeamId: appProjectTeamId,
        sequenceNumber: appTeamRow.nextIssueNumber,
        teamId: appTeamId,
        workflowStateId: appPausedId,
        workspaceId,
      },
    });
    await database.client.team.update({
      data: { nextIssueNumber: { increment: 1 } },
      where: { id: appTeamId },
    });
    const pausedAssigned = await mutate('patch', `/api/v1/team-works/${pausedWork.id}`)
      .send({ assigneeMembershipId: membershipId, version: pausedWork.version })
      .expect(200);
    expect(pausedAssigned.body.teamWork.stateCategory).toBe('BACKLOG');
    expect(pausedAssigned.body.teamWork.workflowState.id).toBe(appPausedId);

    const completedDefault = await mutate(
      'post',
      `/api/v1/workflow-states/${appCompletedId}/default`,
    )
      .send({ version: 1 })
      .expect(200);
    expect(
      completedDefault.body.items.filter((state: { isDefault: boolean }) => state.isDefault),
    ).toEqual([expect.objectContaining({ category: 'COMPLETED', id: appCompletedId })]);

    const completedIssue = await mutate('post', '/api/v1/issues')
      .send({
        initialTeams: [{ projectTeamId: appProjectTeamId }],
        projectId,
        title: '완료가 기본값인 담당자 없는 앱 작업',
      })
      .expect(201);
    expect(completedIssue.body.createdTeamWorks[0]).toMatchObject({
      stateCategory: 'COMPLETED',
      workflowState: { id: appCompletedId },
    });

    await mutate('post', `/api/v1/workflow-states/${appBacklogDefaultId}/default`)
      .send({ version: 2 })
      .expect(200);
  });

  it('applies the same auto-start rule to claim and bulk assignment entry points', async () => {
    const claimIssue = await mutate('post', '/api/v1/issues')
      .send({
        initialTeams: [{ projectTeamId: appProjectTeamId }],
        projectId,
        title: '내가 맡기 대상 작업',
      })
      .expect(201);
    const claimTarget = claimIssue.body.createdTeamWorks[0] as { id: string };
    const claimed = await mutate('post', `/api/v1/issues/${claimIssue.body.issue.id}/claim`)
      .send({ projectTeamId: appProjectTeamId, teamWorkId: claimTarget.id })
      .expect(200);
    expect(claimed.body.teamWork.stateCategory).toBe('UNSTARTED');
    expect(claimed.body.teamWork.assignee).toMatchObject({ id: membershipId });

    const bulkIssue = await mutate('post', '/api/v1/issues')
      .send({
        initialTeams: [{ projectTeamId: appProjectTeamId }],
        projectId,
        title: '일괄 배정 대상 작업',
      })
      .expect(201);
    const bulkTarget = bulkIssue.body.createdTeamWorks[0] as { id: string; version: number };
    const assignedInBulk = await mutate(
      'post',
      `/api/v1/issues/${bulkIssue.body.issue.id}/assign-team-works`,
    )
      .send({
        assignments: [
          {
            assigneeMembershipId: secondMembershipId,
            teamWorkId: bulkTarget.id,
            version: bulkTarget.version,
          },
        ],
      })
      .expect(200);
    expect(assignedInBulk.body.teamWorks[0].stateCategory).toBe('UNSTARTED');
    expect(assignedInBulk.body.teamWorks[0].assignee).toMatchObject({ id: secondMembershipId });
  });

  it('rejects HANDOFF_AND_COMPLETE when no active destination project team is selected', async () => {
    const soloIssue = await mutate('post', '/api/v1/issues')
      .send({
        initialTeams: [
          { assigneeMembershipId: membershipId, projectTeamId: soloBackendProjectTeamId },
        ],
        projectId: soloProjectId,
        title: '프론트 역할 없는 프로젝트의 백엔드 작업',
      })
      .expect(201);
    const soloBackend = soloIssue.body.createdTeamWorks[0] as { id: string; version: number };
    await mutate('patch', `/api/v1/team-works/${soloBackend.id}`)
      .send({
        completionMode: 'HANDOFF_AND_COMPLETE',
        handoff: { bodyMarkdown: handoffBody() },
        version: soloBackend.version,
        workflowStateId: backendDoneId,
      })
      .expect(422)
      .expect(({ body }) => expect(body.code).toBe('HANDOFF_DESTINATION_REQUIRED'));
  });

  it('removing the last completed team work of a DONE issue reopens status instead of leaving a 0% DONE issue', async () => {
    const soloIssue = await mutate('post', '/api/v1/issues')
      .send({
        initialTeams: [
          { assigneeMembershipId: membershipId, projectTeamId: soloBackendProjectTeamId },
        ],
        projectId: soloProjectId,
        title: 'DONE 이후 팀 작업 삭제 정합성',
      })
      .expect(201);
    const issueId = soloIssue.body.issue.id as string;
    const teamWork = soloIssue.body.createdTeamWorks[0] as { id: string; version: number };

    const completed = await mutate('patch', `/api/v1/team-works/${teamWork.id}`)
      .send({
        completionMode: 'COMPLETE_ONLY',
        version: teamWork.version,
        workflowStateId: backendDoneId,
      })
      .expect(200);
    expect(completed.body.issue.status).toBe('DONE');
    expect(completed.body.issue.progress).toEqual({ completed: 1, percentage: 100, total: 1 });

    const removed = await mutate('post', `/api/v1/team-works/${teamWork.id}/remove`)
      .send({ version: completed.body.teamWork.version })
      .expect(200);
    // DONE은 "유효 팀 작업 전체 완료"를 전제로 하므로, 마지막 완료 작업이 삭제되면
    // 상태와 진행률이 함께 재계산되어야 하고 DONE·0%가 동시에 남지 않아야 한다.
    expect(removed.body.status).not.toBe('DONE');
    expect(removed.body.progress).toEqual({ completed: 0, percentage: 0, total: 0 });

    const reopenBlocked = await mutate('post', `/api/v1/issues/${issueId}/team-works`)
      .send({ teamAssignments: [{ projectTeamId: soloBackendProjectTeamId }] })
      .expect(200);
    expect(reopenBlocked.body.issue.status).not.toBe('DONE');
  });

  it('records readable before/after values on activity when exactly one field changes', async () => {
    const created = await mutate('post', '/api/v1/issues')
      .send({
        priority: 'MEDIUM',
        projectId,
        title: '활동 전후 값 기록',
      })
      .expect(201);
    const issueId = created.body.issue.id as string;

    await mutate('patch', `/api/v1/issues/${issueId}`)
      .send({ priority: 'URGENT', version: created.body.issue.version })
      .expect(200);

    const started = await mutate('post', `/api/v1/issues/${issueId}/team-works`)
      .send({ teamAssignments: [{ projectTeamId: webProjectTeamId }] })
      .expect(200);
    const web = started.body.teamWorks[0] as { id: string; version: number };
    await mutate('patch', `/api/v1/team-works/${web.id}`)
      .send({ version: web.version, workflowStateId: webStartedId })
      .expect(200);

    const timeline = await request(app.getHttpServer())
      .get(`/api/v1/issues/${issueId}/timeline`)
      .set('Cookie', cookie)
      .expect(200);
    const priorityActivity = timeline.body.items.find(
      (item: { activity?: { fieldName?: string } }) => item.activity?.fieldName === 'priority',
    );
    expect(priorityActivity.activity).toMatchObject({
      after: 'URGENT',
      before: 'MEDIUM',
      eventType: 'ISSUE_CHANGED',
      fieldName: 'priority',
    });
    const stateActivity = timeline.body.items.find(
      (item: { activity?: { fieldName?: string } }) =>
        item.activity?.fieldName === 'workflowStateId',
    );
    expect(stateActivity.activity).toMatchObject({
      after: { id: webStartedId, name: '진행 중' },
      before: { name: '할 일' },
      eventType: 'TEAM_WORK_CHANGED',
      fieldName: 'workflowStateId',
    });
  });
});
