import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { MembershipRole, MembershipStatus, ProjectRole, StateCategory } from '@rivet/database';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap';
import { DatabaseService } from '../src/common/database/database.service';
import { AuthSessionService } from '../src/modules/auth/auth-session.service';
import { createCsrfToken } from '../src/modules/auth/auth-token.crypto';

const WEB_ORIGIN = 'http://localhost:3000';
const CSRF_HMAC_KEY = 'test-csrf-hmac-key-with-at-least-32-bytes';

describe('M2 team and workflow management', () => {
  const runId = randomUUID().slice(0, 8);
  const normalizedEmails = [
    `m2.team.admin.${runId}@example.com`,
    `m2.team.member.${runId}@example.com`,
    `m2.team.inactive.${runId}@example.com`,
    `m2.team.foreign.${runId}@example.com`,
  ];
  let app: INestApplication;
  let database: DatabaseService;
  let workspaceId: string;
  let foreignWorkspaceId: string;
  let adminMembershipId: string;
  let memberMembershipId: string;
  let inactiveMembershipId: string;
  let foreignTeamId: string;
  let foreignStateId: string;
  let adminCookie: string;
  let adminCsrfToken: string;
  let memberCookie: string;
  let memberCsrfToken: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    database = app.get(DatabaseService);

    const fixtures = await database.client.$transaction(async (transaction) => {
      const users = await Promise.all(
        normalizedEmails.map((normalizedEmail, index) =>
          transaction.user.create({
            data: {
              displayName: `M2 팀 사용자 ${index + 1}`,
              email: normalizedEmail,
              emailVerifiedAt: new Date(),
              normalizedEmail,
              passwordHash: 'integration-password-hash',
            },
            select: { id: true },
          }),
        ),
      );
      const [adminUser, memberUser, inactiveUser, foreignUser] = users;
      if (!adminUser || !memberUser || !inactiveUser || !foreignUser) {
        throw new Error('M2 팀 통합 테스트 사용자를 만들 수 없습니다.');
      }

      const workspace = await transaction.workspace.create({
        data: {
          createdByUserId: adminUser.id,
          name: 'M2 팀 워크스페이스',
          normalizedSlug: `m2-team-${runId}`,
          slug: `m2-team-${runId}`,
        },
        select: { id: true },
      });
      const foreignWorkspace = await transaction.workspace.create({
        data: {
          createdByUserId: foreignUser.id,
          name: 'M2 다른 워크스페이스',
          normalizedSlug: `m2-team-foreign-${runId}`,
          slug: `m2-team-foreign-${runId}`,
        },
        select: { id: true },
      });
      const adminMembership = await transaction.workspaceMembership.create({
        data: {
          role: MembershipRole.ADMIN,
          userId: adminUser.id,
          workspaceId: workspace.id,
        },
        select: { id: true },
      });
      const memberMembership = await transaction.workspaceMembership.create({
        data: {
          role: MembershipRole.MEMBER,
          userId: memberUser.id,
          workspaceId: workspace.id,
        },
        select: { id: true },
      });
      const inactiveMembership = await transaction.workspaceMembership.create({
        data: {
          deactivatedAt: new Date(),
          role: MembershipRole.MEMBER,
          status: MembershipStatus.INACTIVE,
          userId: inactiveUser.id,
          workspaceId: workspace.id,
        },
        select: { id: true },
      });
      await transaction.workspaceMembership.create({
        data: {
          role: MembershipRole.ADMIN,
          userId: foreignUser.id,
          workspaceId: foreignWorkspace.id,
        },
      });
      const foreignTeam = await transaction.team.create({
        data: {
          key: 'OUT',
          name: '다른 팀',
          normalizedName: '다른 팀',
          workspaceId: foreignWorkspace.id,
        },
        select: { id: true },
      });
      const foreignState = await transaction.workflowState.create({
        data: {
          category: StateCategory.BACKLOG,
          isDefault: true,
          name: '외부 상태',
          normalizedName: '외부 상태',
          position: 0,
          teamId: foreignTeam.id,
          workspaceId: foreignWorkspace.id,
        },
        select: { id: true },
      });

      return {
        adminMembershipId: adminMembership.id,
        adminUserId: adminUser.id,
        foreignStateId: foreignState.id,
        foreignTeamId: foreignTeam.id,
        foreignWorkspaceId: foreignWorkspace.id,
        inactiveMembershipId: inactiveMembership.id,
        memberMembershipId: memberMembership.id,
        memberUserId: memberUser.id,
        workspaceId: workspace.id,
      };
    });

    workspaceId = fixtures.workspaceId;
    foreignWorkspaceId = fixtures.foreignWorkspaceId;
    adminMembershipId = fixtures.adminMembershipId;
    memberMembershipId = fixtures.memberMembershipId;
    inactiveMembershipId = fixtures.inactiveMembershipId;
    foreignTeamId = fixtures.foreignTeamId;
    foreignStateId = fixtures.foreignStateId;
    const sessions = app.get(AuthSessionService);
    const [adminSession, memberSession] = await Promise.all([
      sessions.create(fixtures.adminUserId),
      sessions.create(fixtures.memberUserId),
    ]);
    adminCookie = `rivet_session=${adminSession.token}`;
    memberCookie = `rivet_session=${memberSession.token}`;
    adminCsrfToken = createCsrfToken(adminSession.token, CSRF_HMAC_KEY);
    memberCsrfToken = createCsrfToken(memberSession.token, CSRF_HMAC_KEY);

    await expect(sessions.resolve(adminSession.token)).resolves.toMatchObject({
      membership: { id: adminMembershipId, role: 'ADMIN', status: 'ACTIVE', workspaceId },
    });
  });

  afterAll(async () => {
    if (database) {
      const workspaceIds = [workspaceId, foreignWorkspaceId].filter(Boolean);
      const users = await database.client.user.findMany({
        select: { id: true },
        where: { normalizedEmail: { in: normalizedEmails } },
      });
      const userIds = users.map(({ id }) => id);

      await database.client.activityEvent.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.issueSubscription.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.issueLabel.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.teamWork.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.issue.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.projectTeam.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.project.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.workflowState.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.teamMember.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.team.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.session.deleteMany({ where: { userId: { in: userIds } } });
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

  it('enforces admin, workspace, version, membership, workflow, and archive rules', async () => {
    const team = await request(app.getHttpServer())
      .post('/api/v1/teams')
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({
        key: 'MGT',
        memberIds: [adminMembershipId, memberMembershipId],
        name: '관리 팀',
      })
      .expect(201);
    const teamId = team.body.id as string;
    expect(team.body).toMatchObject({
      archived: false,
      key: 'MGT',
      memberIds: expect.arrayContaining([adminMembershipId, memberMembershipId]),
      name: '관리 팀',
      version: 1,
    });
    expect(team.body.memberIds).toHaveLength(2);

    const memberList = await request(app.getHttpServer())
      .get('/api/v1/teams')
      .set('Cookie', memberCookie)
      .expect(200);
    expect(memberList.body.items).toContainEqual(
      expect.objectContaining({ id: teamId, memberCount: 2 }),
    );

    const hiddenForeignTeam = await request(app.getHttpServer())
      .get(`/api/v1/teams/${foreignTeamId}`)
      .set('Cookie', adminCookie)
      .expect(404);
    expect(hiddenForeignTeam.body.code).toBe('RESOURCE_NOT_FOUND');

    const forbiddenMemberUpdate = await request(app.getHttpServer())
      .patch(`/api/v1/teams/${teamId}`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({ name: '권한 없는 수정', version: 1 })
      .expect(403);
    expect(forbiddenMemberUpdate.body.code).toBe('FORBIDDEN');

    const renamed = await request(app.getHttpServer())
      .patch(`/api/v1/teams/${teamId}`)
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({ name: '플랫폼 팀', version: 1 })
      .expect(200);
    expect(renamed.body).toMatchObject({ name: '플랫폼 팀', version: 2 });

    const staleRename = await request(app.getHttpServer())
      .patch(`/api/v1/teams/${teamId}`)
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({ name: '오래된 수정', version: 1 })
      .expect(409);
    expect(staleRename.body).toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: 2 });

    const inactiveMember = await request(app.getHttpServer())
      .put(`/api/v1/teams/${teamId}/members/${inactiveMembershipId}`)
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .expect(404);
    expect(inactiveMember.body.code).toBe('RESOURCE_NOT_FOUND');

    await request(app.getHttpServer())
      .delete(`/api/v1/teams/${teamId}/members/${memberMembershipId}`)
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .expect(204);
    await expect(
      database.client.teamMember.findUniqueOrThrow({
        select: { removedAt: true },
        where: { teamId_membershipId: { membershipId: memberMembershipId, teamId } },
      }),
    ).resolves.toEqual({ removedAt: expect.any(Date) });

    const restoredMember = await request(app.getHttpServer())
      .put(`/api/v1/teams/${teamId}/members/${memberMembershipId}`)
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .expect(200);
    expect(restoredMember.body).toMatchObject({
      memberIds: [adminMembershipId, memberMembershipId].sort(),
      version: 4,
    });
    await expect(
      database.client.teamMember.findUniqueOrThrow({
        select: { removedAt: true },
        where: { teamId_membershipId: { membershipId: memberMembershipId, teamId } },
      }),
    ).resolves.toEqual({ removedAt: null });

    const workflow = await request(app.getHttpServer())
      .get(`/api/v1/teams/${teamId}/workflow-states`)
      .set('Cookie', memberCookie)
      .expect(200);
    expect(workflow.body.items).toHaveLength(7);
    const renamedStateBefore = workflow.body.items.find(
      (state: { name: string }) => state.name === '할 일',
    ) as { id: string; version: number };

    const renamedState = await request(app.getHttpServer())
      .patch(`/api/v1/workflow-states/${renamedStateBefore.id}`)
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({ name: '대기', version: renamedStateBefore.version })
      .expect(200);
    expect(renamedState.body).toMatchObject({ name: '대기', version: 2 });

    const statesForOrder = workflow.body.items.map((state: { id: string; version: number }) => ({
      id: state.id,
      version: state.id === renamedState.body.id ? renamedState.body.version : state.version,
    }));
    const reordered = await request(app.getHttpServer())
      .put(`/api/v1/teams/${teamId}/workflow-states/order`)
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({ states: statesForOrder.reverse() })
      .expect(200);
    expect(reordered.body.items.map((state: { position: number }) => state.position)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);

    const deletableState = reordered.body.items.find(
      (state: { name: string }) => state.name === '보류',
    ) as { id: string; name: string; version: number };
    const replacementState = reordered.body.items.find(
      (state: { name: string }) => state.name === '대기',
    ) as { id: string; name: string; version: number };
    const project = await database.client.project.create({
      data: { name: '조직 안전장치 프로젝트', workspaceId },
    });
    const issue = await database.client.issue.create({
      data: {
        createdByMembershipId: adminMembershipId,
        identifier: 'F-9001',
        projectId: project.id,
        sequenceNumber: 1,
        title: '조직 안전장치 검증',
        workspaceId,
      },
      select: { id: true },
    });
    const teamWork = await database.client.teamWork.create({
      data: {
        assigneeMembershipId: memberMembershipId,
        createdByMembershipId: adminMembershipId,
        identifier: 'MGT-1',
        issueId: issue.id,
        projectRole: ProjectRole.BACKEND,
        sequenceNumber: 1,
        teamId,
        workflowStateId: deletableState.id,
        workspaceId,
      },
      select: { id: true },
    });

    const blockedStateDelete = await request(app.getHttpServer())
      .delete(`/api/v1/workflow-states/${deletableState.id}`)
      .query({ version: deletableState.version })
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .expect(409);
    expect(blockedStateDelete.body).toMatchObject({
      code: 'WORKFLOW_STATE_IN_USE',
      details: {
        issues: [
          expect.objectContaining({ id: teamWork.id, identifier: 'MGT-1', issueId: issue.id }),
        ],
      },
    });

    await request(app.getHttpServer())
      .delete(`/api/v1/workflow-states/${deletableState.id}`)
      .query({ replacementStateId: replacementState.id, version: deletableState.version })
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .expect(204);
    await expect(
      database.client.teamWork.findUniqueOrThrow({
        select: { version: true, workflowStateId: true },
        where: { id: teamWork.id },
      }),
    ).resolves.toEqual({ version: 2, workflowStateId: replacementState.id });
    await expect(
      database.client.activityEvent.findFirstOrThrow({
        select: { actorMembershipId: true, eventType: true, fieldName: true },
        where: { issueId: issue.id, teamWorkId: teamWork.id },
      }),
    ).resolves.toEqual({
      actorMembershipId: adminMembershipId,
      eventType: 'TEAM_WORK_CHANGED',
      fieldName: 'workflowStateId',
    });

    const blockedRemoval = await request(app.getHttpServer())
      .delete(`/api/v1/teams/${teamId}/members/${memberMembershipId}`)
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .expect(409);
    expect(blockedRemoval.body.code).toBe('TEAM_MEMBER_HAS_OPEN_ASSIGNMENTS');

    const blockedArchive = await request(app.getHttpServer())
      .post(`/api/v1/teams/${teamId}/archive`)
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({ version: 4 })
      .expect(409);
    expect(blockedArchive.body.code).toBe('TEAM_HAS_OPEN_ISSUES');

    await database.client.teamWork.deleteMany({ where: { issueId: issue.id } });
    await database.client.issue.delete({ where: { id: issue.id } });
    await database.client.projectTeam.deleteMany({ where: { projectId: project.id } });
    await database.client.project.delete({ where: { id: project.id } });
    const compactedWorkflow = await request(app.getHttpServer())
      .get(`/api/v1/teams/${teamId}/workflow-states`)
      .set('Cookie', memberCookie)
      .expect(200);
    expect(
      compactedWorkflow.body.items.map((state: { position: number }) => state.position),
    ).toEqual([0, 1, 2, 3, 4, 5]);

    const hiddenForeignState = await request(app.getHttpServer())
      .patch(`/api/v1/workflow-states/${foreignStateId}`)
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({ name: '격리 위반', version: 1 })
      .expect(404);
    expect(hiddenForeignState.body.code).toBe('RESOURCE_NOT_FOUND');

    await database.client.team.update({
      data: { nextIssueNumber: 2 },
      where: { id: teamId },
    });
    const lockedKey = await request(app.getHttpServer())
      .patch(`/api/v1/teams/${teamId}`)
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({ key: 'NEW', version: 4 })
      .expect(409);
    expect(lockedKey.body.code).toBe('TEAM_KEY_LOCKED');

    const archived = await request(app.getHttpServer())
      .post(`/api/v1/teams/${teamId}/archive`)
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({ version: 4 })
      .expect(200);
    expect(archived.body).toMatchObject({ archived: true, version: 5 });

    const archivedMutation = await request(app.getHttpServer())
      .patch(`/api/v1/teams/${teamId}`)
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({ name: '보관 후 수정', version: 5 })
      .expect(404);
    expect(archivedMutation.body.code).toBe('RESOURCE_NOT_FOUND');

    const activeTeams = await request(app.getHttpServer())
      .get('/api/v1/teams')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(activeTeams.body.items).toEqual([]);
    const allTeams = await request(app.getHttpServer())
      .get('/api/v1/teams?includeArchived=true')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(allTeams.body.items).toContainEqual(
      expect.objectContaining({ id: teamId, archived: true }),
    );
  });
});
