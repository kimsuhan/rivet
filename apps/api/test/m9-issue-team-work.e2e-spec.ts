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
import { createCsrfToken } from '../src/modules/auth/auth-token';

const WEB_ORIGIN = 'http://localhost:3000';
const CSRF_HMAC_KEY = 'test-csrf-hmac-key-with-at-least-32-bytes';
const PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$u5oksZN2qlFVAyszxdWrug$xmy/xfzl6zj7sfdlIBgb2F6zHrOnBcsxDzJEO7QyG0A';

function handoffBody(): string {
  return [
    '## 변경 요약',
    '통합 계약 적용',
    '## API 명세 링크',
    'https://api.example.com/openapi.json',
    '## 사용 가능 환경',
    '개발 환경',
    '## 추가·변경 API',
    'PATCH /team-works/{id}',
    '## 요청·응답 변경',
    'teamWorkId 사용',
    '## 오류·권한',
    '기존 정책 유지',
    '## 프론트 주의사항',
    '정본 통합 상세 사용',
  ].join('\n\n');
}

describe('M9 issue content and team execution API', () => {
  const runId = randomUUID().slice(0, 8);
  let app: INestApplication;
  let database: DatabaseService;
  let userId: string;
  let workspaceId: string;
  let membershipId: string;
  let projectId: string;
  let webTeamId: string;
  let backendDoneId: string;
  let webDoneId: string;
  let webStartedId: string;
  let cookie: string;
  let csrf: string;

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
      const backend = await transaction.team.create({
        data: { key: 'API', name: '백엔드', normalizedName: '백엔드', workspaceId: workspace.id },
      });
      const web = await transaction.team.create({
        data: { key: 'WEB', name: '웹', normalizedName: '웹', workspaceId: workspace.id },
      });
      await transaction.teamMember.createMany({
        data: [
          { membershipId: membership.id, teamId: backend.id, workspaceId: workspace.id },
          { membershipId: membership.id, teamId: web.id, workspaceId: workspace.id },
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
        ],
      });
      return {
        backendDoneId: backendDone.id,
        membershipId: membership.id,
        projectId: project.id,
        userId: user.id,
        webDoneId: webDone.id,
        webStartedId: webStarted.id,
        webTeamId: web.id,
        workspaceId: workspace.id,
      };
    });
    ({
      userId,
      workspaceId,
      membershipId,
      projectId,
      webTeamId,
      backendDoneId,
      webDoneId,
      webStartedId,
    } = fixture);
    const session = await app.get(AuthSessionService).create(userId);
    cookie = `rivet_session=${session.token}`;
    csrf = createCsrfToken(session.token, CSRF_HMAC_KEY);
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
      await database.client.project.deleteMany({ where: { workspaceId } });
      await database.client.workflowState.deleteMany({ where: { workspaceId } });
      await database.client.teamMember.deleteMany({ where: { workspaceId } });
      await database.client.team.deleteMany({ where: { workspaceId } });
      await database.client.session.deleteMany({ where: { userId } });
      await database.client.workspaceMembership.deleteMany({ where: { workspaceId } });
      await database.client.workspace.deleteMany({ where: { id: workspaceId } });
      await database.client.user.deleteMany({ where: { id: userId } });
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
      .send({ roleAssignments: [{ projectRole: 'BACKEND' }] })
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

  it('runs the complete issue, team-work, handoff, search, comment, and completion flow', async () => {
    const created = await mutate('post', '/api/v1/issues')
      .send({
        initialRoles: [{ assigneeMembershipId: membershipId, projectRole: 'BACKEND' }],
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
      .send({ roleAssignments: [{ projectRole: 'WEB_FRONTEND' }] })
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
        workNoteMarkdown: '## 응답 계약\n\n`workspaceId`를 사용합니다.',
        version: web.version,
      })
      .expect(200);
    expect(note.body.teamWork).toMatchObject({
      assignee: { id: membershipId },
      readinessStatus: 'API_HANDOFF_PENDING',
      workNoteMarkdown: '## 응답 계약\n\n`workspaceId`를 사용합니다.',
    });
    await mutate('patch', `/api/v1/team-works/${web.id}`)
      .send({ version: note.body.teamWork.version, workflowStateId: webStartedId })
      .expect(422)
      .expect(({ body }) => expect(body.code).toBe('TEAM_WORK_API_HANDOFF_REQUIRED'));
    await mutate('patch', `/api/v1/team-works/${web.id}`)
      .send({
        workNoteMarkdown: '![이미지](/files/98ab3a6d-0d24-484e-a36a-b8028dc00465)',
        version: note.body.teamWork.version,
      })
      .expect(422);

    const currentBackend = await request(app.getHttpServer())
      .get(`/api/v1/team-works/${backend.id}`)
      .set('Cookie', cookie)
      .expect(200);

    const delivered = await mutate('patch', `/api/v1/team-works/${backend.id}`)
      .send({
        handoff: { bodyMarkdown: handoffBody(), destinationRoles: ['WEB_FRONTEND'] },
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
    expect(await database.client.apiHandoffTarget.count({ where: { teamWorkId: web.id } })).toBe(1);
    const readyWeb = await request(app.getHttpServer())
      .get(`/api/v1/team-works/${web.id}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(readyWeb.body.readinessStatus).toBe('READY');
    const completedWeb = await mutate('patch', `/api/v1/team-works/${web.id}`)
      .send({ version: readyWeb.body.version, workflowStateId: webDoneId })
      .expect(200);
    expect(completedWeb.body.issue.status).toBe('REVIEW');
    const completedIssue = await mutate('patch', `/api/v1/issues/${issue.id}`)
      .send({ statusAction: 'COMPLETE', version: completedWeb.body.issue.version })
      .expect(200);
    expect(completedIssue.body.status).toBe('DONE');

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
});
