import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import {
  IssueType,
  MembershipRole,
  MembershipStatus,
  ProjectRole,
  ProjectStatus,
  StateCategory,
} from '@rivet/database';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap';
import { DatabaseService } from '../src/common/database/database.service';
import { AuthSessionService } from '../src/modules/auth/auth-session.service';
import { createCsrfToken } from '../src/modules/auth/auth-token';

const WEB_ORIGIN = 'http://localhost:3000';
const CSRF_HMAC_KEY = 'test-csrf-hmac-key-with-at-least-32-bytes';
const PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$u5oksZN2qlFVAyszxdWrug$xmy/xfzl6zHrOnBcsxDzJEO7QyG0A';

describe('M4 projects', () => {
  const runId = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  const projectIds: string[] = [];
  let app: INestApplication;
  let database: DatabaseService;
  let workspaceId: string;
  let adminMembershipId: string;
  let memberMembershipId: string;
  let inactiveMembershipId: string;
  let backendTeamId: string;
  let replacementTeamId: string;
  let archivedTeamId: string;
  let foreignTeamId: string;
  let startedStateId: string;
  let completedStateId: string;
  let canceledStateId: string;
  let memberCookie: string;
  let memberCsrfToken: string;
  let foreignCookie: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    database = app.get(DatabaseService);

    const fixture = await database.client.$transaction(async (transaction) => {
      const userSpecs = [
        ['프로젝트 관리자', 'admin'],
        ['프로젝트 멤버', 'member'],
        ['비활성 리드', 'inactive'],
        ['다른 워크스페이스 관리자', 'foreign'],
      ] as const;
      const users = await Promise.all(
        userSpecs.map(([displayName, kind]) => {
          const email = `m4.projects.${kind}.${runId}@example.com`;
          return transaction.user.create({
            data: {
              displayName,
              email,
              emailVerifiedAt: new Date(),
              normalizedEmail: email,
              passwordHash: PASSWORD_HASH,
            },
            select: { id: true },
          });
        }),
      );
      const [admin, member, inactive, foreign] = users;
      if (!admin || !member || !inactive || !foreign) {
        throw new Error('M4 프로젝트 통합 테스트 사용자를 만들 수 없습니다.');
      }

      const [workspace, foreignWorkspace] = await Promise.all([
        transaction.workspace.create({
          data: {
            createdByUserId: admin.id,
            name: 'M4 프로젝트 워크스페이스',
            normalizedSlug: `m4-projects-${runId}`,
            slug: `m4-projects-${runId}`,
          },
          select: { id: true },
        }),
        transaction.workspace.create({
          data: {
            createdByUserId: foreign.id,
            name: 'M4 프로젝트 다른 워크스페이스',
            normalizedSlug: `m4-projects-other-${runId}`,
            slug: `m4-projects-other-${runId}`,
          },
          select: { id: true },
        }),
      ]);
      const memberships = await Promise.all([
        transaction.workspaceMembership.create({
          data: { role: MembershipRole.ADMIN, userId: admin.id, workspaceId: workspace.id },
          select: { id: true },
        }),
        transaction.workspaceMembership.create({
          data: { role: MembershipRole.MEMBER, userId: member.id, workspaceId: workspace.id },
          select: { id: true },
        }),
        transaction.workspaceMembership.create({
          data: {
            deactivatedAt: new Date(),
            role: MembershipRole.MEMBER,
            status: MembershipStatus.INACTIVE,
            userId: inactive.id,
            workspaceId: workspace.id,
          },
          select: { id: true },
        }),
        transaction.workspaceMembership.create({
          data: {
            role: MembershipRole.ADMIN,
            userId: foreign.id,
            workspaceId: foreignWorkspace.id,
          },
          select: { id: true },
        }),
      ]);
      const [adminMembership, memberMembership, inactiveMembership] = memberships;
      if (!adminMembership || !memberMembership || !inactiveMembership) {
        throw new Error('M4 프로젝트 통합 테스트 멤버십을 만들 수 없습니다.');
      }
      const [backendTeam, replacementTeam, archivedTeam, foreignTeam] = await Promise.all([
        transaction.team.create({
          data: {
            key: 'BE',
            name: '백엔드 팀',
            normalizedName: '백엔드 팀',
            workspaceId: workspace.id,
          },
          select: { id: true },
        }),
        transaction.team.create({
          data: {
            key: 'API',
            name: '교체 백엔드 팀',
            normalizedName: '교체 백엔드 팀',
            workspaceId: workspace.id,
          },
          select: { id: true },
        }),
        transaction.team.create({
          data: {
            archivedAt: new Date(),
            key: 'OLD',
            name: '보관 팀',
            normalizedName: '보관 팀',
            workspaceId: workspace.id,
          },
          select: { id: true },
        }),
        transaction.team.create({
          data: {
            key: 'EXT',
            name: '다른 워크스페이스 팀',
            normalizedName: '다른 워크스페이스 팀',
            workspaceId: foreignWorkspace.id,
          },
          select: { id: true },
        }),
      ]);
      const [startedState, completedState, canceledState] = await Promise.all([
        transaction.workflowState.create({
          data: {
            category: StateCategory.STARTED,
            isDefault: true,
            name: '진행 중',
            normalizedName: '진행 중',
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
            category: StateCategory.CANCELED,
            name: '취소',
            normalizedName: '취소',
            position: 2,
            teamId: backendTeam.id,
            workspaceId: workspace.id,
          },
          select: { id: true },
        }),
      ]);

      return {
        adminMembershipId: adminMembership.id,
        backendTeamId: backendTeam.id,
        canceledStateId: canceledState.id,
        completedStateId: completedState.id,
        foreignTeamId: foreignTeam.id,
        foreignUserId: foreign.id,
        foreignWorkspaceId: foreignWorkspace.id,
        inactiveMembershipId: inactiveMembership.id,
        memberMembershipId: memberMembership.id,
        memberUserId: member.id,
        archivedTeamId: archivedTeam.id,
        replacementTeamId: replacementTeam.id,
        startedStateId: startedState.id,
        userIds: users.map(({ id }) => id),
        workspaceId: workspace.id,
      };
    });

    userIds.push(...fixture.userIds);
    workspaceIds.push(fixture.workspaceId, fixture.foreignWorkspaceId);
    workspaceId = fixture.workspaceId;
    adminMembershipId = fixture.adminMembershipId;
    memberMembershipId = fixture.memberMembershipId;
    inactiveMembershipId = fixture.inactiveMembershipId;
    backendTeamId = fixture.backendTeamId;
    replacementTeamId = fixture.replacementTeamId;
    archivedTeamId = fixture.archivedTeamId;
    foreignTeamId = fixture.foreignTeamId;
    startedStateId = fixture.startedStateId;
    completedStateId = fixture.completedStateId;
    canceledStateId = fixture.canceledStateId;

    const sessions = app.get(AuthSessionService);
    const [memberSession, foreignSession] = await Promise.all([
      sessions.create(fixture.memberUserId),
      sessions.create(fixture.foreignUserId),
    ]);
    memberCookie = `rivet_session=${memberSession.token}`;
    memberCsrfToken = createCsrfToken(memberSession.token, CSRF_HMAC_KEY);
    foreignCookie = `rivet_session=${foreignSession.token}`;
  });

  afterAll(async () => {
    if (database) {
      await database.client.issue.deleteMany({ where: { projectId: { in: projectIds } } });
      await database.client.activityEvent.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.projectRoleTeam.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.project.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.workflowState.deleteMany({
        where: { team: { workspaceId: { in: workspaceIds } } },
      });
      await database.client.teamMember.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.team.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.session.deleteMany({ where: { userId: { in: userIds } } });
      await database.client.outboxEvent.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.workspaceMembership.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
      await database.client.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app?.close();
    if (process.env.FILE_STORAGE_ROOT) {
      await rm(process.env.FILE_STORAGE_ROOT, { force: true, recursive: true });
    }
  });

  it('creates, lists, updates, archives, and isolates projects with stable progress', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        description: '  웹과 앱 결제 흐름을 개편한다.  ',
        leadMembershipId: adminMembershipId,
        name: '  결제 개편  ',
        roleTeams: [
          { role: ProjectRole.WEB_FRONTEND, teamId: backendTeamId },
          { role: ProjectRole.BACKEND, teamId: backendTeamId },
        ],
        startDate: '2026-07-15',
        targetDate: '2026-08-15',
      })
      .expect(201);
    expect(created.body).toMatchObject({
      archived: false,
      description: '웹과 앱 결제 흐름을 개편한다.',
      lead: { id: adminMembershipId, status: MembershipStatus.ACTIVE },
      name: '결제 개편',
      progress: { completed: 0, percentage: 0, total: 0 },
      roleTeams: [
        { role: ProjectRole.BACKEND, team: { id: backendTeamId } },
        { role: ProjectRole.WEB_FRONTEND, team: { id: backendTeamId } },
      ],
      status: ProjectStatus.PLANNED,
      version: 1,
    });
    const projectId = created.body.id as string;
    projectIds.push(projectId);

    const missingRole = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({ name: '역할 없음', roleTeams: [] })
      .expect(422);
    expect(missingRole.body.code).toBe('PROJECT_ROLE_REQUIRED');

    for (const [name, teamId] of [
      ['보관 팀 프로젝트', archivedTeamId],
      ['다른 워크스페이스 팀 프로젝트', foreignTeamId],
    ]) {
      const invalidTeam = await request(app.getHttpServer())
        .post('/api/v1/projects')
        .set('Cookie', memberCookie)
        .set('Origin', WEB_ORIGIN)
        .set('X-CSRF-Token', memberCsrfToken)
        .send({ name, roleTeams: [{ role: ProjectRole.BACKEND, teamId }] })
        .expect(404);
      expect(invalidTeam.body.code).toBe('RESOURCE_NOT_FOUND');
    }

    const inactiveLead = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        leadMembershipId: inactiveMembershipId,
        name: '비활성 리드 프로젝트',
        roleTeams: [{ role: ProjectRole.BACKEND, teamId: backendTeamId }],
      })
      .expect(404);
    expect(inactiveLead.body.code).toBe('RESOURCE_NOT_FOUND');

    const extraSpecs = [
      ['선행 프로젝트', '2026-07-15'],
      ['목표일 없음 A', null],
      ['목표일 없음 B', null],
    ] as const;
    for (const [name, targetDate] of extraSpecs) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/projects')
        .set('Cookie', memberCookie)
        .set('Origin', WEB_ORIGIN)
        .set('X-CSRF-Token', memberCsrfToken)
        .send({
          leadMembershipId: adminMembershipId,
          name,
          roleTeams: [{ role: ProjectRole.BACKEND, teamId: backendTeamId }],
          targetDate,
        })
        .expect(201);
      projectIds.push(response.body.id as string);
    }

    const firstPage = await request(app.getHttpServer())
      .get('/api/v1/projects?sort=targetDate&sortDirection=asc&limit=3')
      .set('Cookie', memberCookie)
      .expect(200);
    expect(firstPage.body.items).toHaveLength(3);
    expect(firstPage.body.items[0].name).toBe('선행 프로젝트');
    expect(firstPage.body.items[1].name).toBe('결제 개편');
    expect(firstPage.body.nextCursor).toEqual(expect.any(String));

    const secondPage = await request(app.getHttpServer())
      .get(
        `/api/v1/projects?sort=targetDate&sortDirection=asc&limit=3&cursor=${String(firstPage.body.nextCursor)}`,
      )
      .set('Cookie', memberCookie)
      .expect(200);
    const pagedIds = [...firstPage.body.items, ...secondPage.body.items].map(
      (item: { id: string }) => item.id,
    );
    expect(new Set(pagedIds)).toEqual(new Set(projectIds));
    expect(pagedIds).toHaveLength(projectIds.length);

    const filtered = await request(app.getHttpServer())
      .get(`/api/v1/projects?status=${ProjectStatus.PLANNED}&leadMembershipId=${adminMembershipId}`)
      .set('Cookie', memberCookie)
      .expect(200);
    expect(filtered.body.items).toHaveLength(4);

    const hiddenFromOtherWorkspace = await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}`)
      .set('Cookie', foreignCookie)
      .expect(404);
    expect(hiddenFromOtherWorkspace.body.code).toBe('RESOURCE_NOT_FOUND');

    await database.client.issue.createMany({
      data: [
        [startedStateId, 1, 'BE-1'],
        [completedStateId, 2, 'BE-2'],
        [canceledStateId, 3, 'BE-3'],
      ].map(([workflowStateId, sequenceNumber, identifier]) => ({
        createdByMembershipId: memberMembershipId,
        identifier: String(identifier),
        priority: 'NONE' as const,
        projectId,
        projectRole: ProjectRole.BACKEND,
        sequenceNumber: Number(sequenceNumber),
        teamId: backendTeamId,
        title: `프로젝트 작업 ${String(sequenceNumber)}`,
        type: IssueType.TEAM_TASK,
        workflowStateId: String(workflowStateId),
        workspaceId,
      })),
    });

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}`)
      .set('Cookie', memberCookie)
      .expect(200);
    expect(detail.body.progress).toEqual({ completed: 1, percentage: 50, total: 2 });

    const roleInUse = await request(app.getHttpServer())
      .patch(`/api/v1/projects/${projectId}`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        roleTeams: [
          { role: ProjectRole.BACKEND, teamId: replacementTeamId },
          { role: ProjectRole.WEB_FRONTEND, teamId: backendTeamId },
        ],
        version: 1,
      })
      .expect(409);
    expect(roleInUse.body).toMatchObject({
      code: 'PROJECT_ROLE_IN_USE',
      details: {
        issues: expect.arrayContaining([expect.objectContaining({ identifier: 'BE-1' })]),
      },
    });

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/projects/${projectId}`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        leadMembershipId: null,
        name: ' 결제 전면 개편 ',
        status: ProjectStatus.IN_PROGRESS,
        version: 1,
      })
      .expect(200);
    expect(updated.body).toMatchObject({
      lead: null,
      name: '결제 전면 개편',
      status: ProjectStatus.IN_PROGRESS,
      version: 2,
    });

    const stale = await request(app.getHttpServer())
      .patch(`/api/v1/projects/${projectId}`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({ name: '오래된 수정', version: 1 })
      .expect(409);
    expect(stale.body).toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: 2 });

    const removedUnusedRole = await request(app.getHttpServer())
      .patch(`/api/v1/projects/${projectId}`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        roleTeams: [{ role: ProjectRole.BACKEND, teamId: backendTeamId }],
        version: 2,
      })
      .expect(200);
    expect(removedUnusedRole.body).toMatchObject({
      roleTeams: [{ role: ProjectRole.BACKEND, team: { id: backendTeamId } }],
      version: 3,
    });

    const archived = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/archive`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({ version: 3 })
      .expect(200);
    expect(archived.body).toMatchObject({ archived: true, version: 4 });

    const activeOnly = await request(app.getHttpServer())
      .get('/api/v1/projects')
      .set('Cookie', memberCookie)
      .expect(200);
    expect(activeOnly.body.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: projectId })]),
    );
    const withArchived = await request(app.getHttpServer())
      .get('/api/v1/projects?includeArchived=true')
      .set('Cookie', memberCookie)
      .expect(200);
    expect(withArchived.body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ archived: true, id: projectId })]),
    );

    const activities = await database.client.activityEvent.findMany({
      select: { eventType: true, fieldName: true },
      where: { projectId, workspaceId },
    });
    expect(activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: 'PROJECT_CREATED' }),
        expect.objectContaining({ eventType: 'PROJECT_UPDATED', fieldName: 'name' }),
        expect.objectContaining({ eventType: 'PROJECT_UPDATED', fieldName: 'roleTeams' }),
        expect.objectContaining({ eventType: 'PROJECT_ARCHIVED' }),
      ]),
    );
  });
});
