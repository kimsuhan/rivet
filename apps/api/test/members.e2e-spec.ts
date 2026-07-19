import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { MembershipRole, MembershipStatus, ProjectRole, StateCategory } from '@rivet/database';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap';
import { DatabaseService } from '../src/common/database/database.service';
import { createCsrfToken, createSessionToken } from '../src/modules/auth/auth-token.crypto';

const WEB_ORIGIN = 'http://localhost:3000';
const CSRF_HMAC_KEY = 'test-csrf-hmac-key-with-at-least-32-bytes';
const runId = randomUUID().slice(0, 8);
const normalizedEmails = [
  `m2.admin.${runId}@example.com`,
  `m2.member.${runId}@example.com`,
  `m2.inactive.${runId}@example.com`,
  `m2.cross.${runId}@example.com`,
];

describe('M2 member management API', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let fixture: {
    adminMembershipId: string;
    adminSessionToken: string;
    crossMembershipId: string;
    crossTeamId: string;
    inactiveMembershipId: string;
    memberMembershipId: string;
    memberSessionToken: string;
    memberUserId: string;
    stateId: string;
    teamId: string;
    workspaceId: string;
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    database = app.get(DatabaseService);

    const adminSession = createSessionToken();
    const memberSession = createSessionToken();
    const memberSecondSession = createSessionToken();
    const joinedAt = new Date('2026-07-11T00:00:00.000Z');
    const sessionCreatedAt = new Date();

    fixture = await database.client.$transaction(async (transaction) => {
      const [admin, member, inactive, cross] = await Promise.all(
        normalizedEmails.map((normalizedEmail, index) =>
          transaction.user.create({
            data: {
              displayName: ['관리자', '활성 멤버', '비활성 멤버', '다른 워크스페이스'][index]!,
              email: normalizedEmail,
              emailVerifiedAt: sessionCreatedAt,
              normalizedEmail,
              passwordHash: 'integration-password-hash',
            },
            select: { id: true },
          }),
        ),
      );
      const workspace = await transaction.workspace.create({
        data: {
          createdByUserId: admin!.id,
          name: 'M2 멤버 테스트',
          normalizedSlug: `m2-members-${runId}`,
          slug: `m2-members-${runId}`,
        },
        select: { id: true },
      });
      const crossWorkspace = await transaction.workspace.create({
        data: {
          createdByUserId: cross!.id,
          name: 'M2 다른 워크스페이스',
          normalizedSlug: `m2-cross-${runId}`,
          slug: `m2-cross-${runId}`,
        },
        select: { id: true },
      });
      const adminMembership = await transaction.workspaceMembership.create({
        data: {
          joinedAt,
          role: MembershipRole.ADMIN,
          status: MembershipStatus.ACTIVE,
          userId: admin!.id,
          workspaceId: workspace.id,
        },
        select: { id: true },
      });
      const memberMembership = await transaction.workspaceMembership.create({
        data: {
          joinedAt: new Date(joinedAt.getTime() + 1_000),
          role: MembershipRole.MEMBER,
          status: MembershipStatus.ACTIVE,
          userId: member!.id,
          workspaceId: workspace.id,
        },
        select: { id: true },
      });
      const inactiveMembership = await transaction.workspaceMembership.create({
        data: {
          deactivatedAt: new Date(joinedAt.getTime() + 3_000),
          joinedAt: new Date(joinedAt.getTime() + 2_000),
          role: MembershipRole.MEMBER,
          status: MembershipStatus.INACTIVE,
          userId: inactive!.id,
          workspaceId: workspace.id,
        },
        select: { id: true },
      });
      const crossMembership = await transaction.workspaceMembership.create({
        data: {
          role: MembershipRole.ADMIN,
          status: MembershipStatus.ACTIVE,
          userId: cross!.id,
          workspaceId: crossWorkspace.id,
        },
        select: { id: true },
      });
      const team = await transaction.team.create({
        data: {
          key: 'MEM',
          name: '멤버 팀',
          normalizedName: '멤버 팀',
          workspaceId: workspace.id,
        },
        select: { id: true },
      });
      const state = await transaction.workflowState.create({
        data: {
          category: StateCategory.BACKLOG,
          isDefault: true,
          name: '미분류',
          normalizedName: '미분류',
          position: 0,
          teamId: team.id,
          workspaceId: workspace.id,
        },
        select: { id: true },
      });
      const crossTeam = await transaction.team.create({
        data: {
          key: 'CRS',
          name: '다른 팀',
          normalizedName: '다른 팀',
          workspaceId: crossWorkspace.id,
        },
        select: { id: true },
      });
      await transaction.teamMember.createMany({
        data: [
          {
            membershipId: adminMembership.id,
            teamId: team.id,
            workspaceId: workspace.id,
          },
          {
            membershipId: memberMembership.id,
            teamId: team.id,
            workspaceId: workspace.id,
          },
        ],
      });
      const sessionData = {
        absoluteExpiresAt: new Date(sessionCreatedAt.getTime() + 86_400_000),
        createdAt: sessionCreatedAt,
        idleExpiresAt: new Date(sessionCreatedAt.getTime() + 43_200_000),
        lastSeenAt: sessionCreatedAt,
      };
      await transaction.session.createMany({
        data: [
          {
            ...sessionData,
            tokenHash: new Uint8Array(adminSession.tokenHash),
            userId: admin!.id,
          },
          {
            ...sessionData,
            tokenHash: new Uint8Array(memberSession.tokenHash),
            userId: member!.id,
          },
          {
            ...sessionData,
            tokenHash: new Uint8Array(memberSecondSession.tokenHash),
            userId: member!.id,
          },
        ],
      });

      return {
        adminMembershipId: adminMembership.id,
        adminSessionToken: adminSession.token,
        crossMembershipId: crossMembership.id,
        crossTeamId: crossTeam.id,
        inactiveMembershipId: inactiveMembership.id,
        memberMembershipId: memberMembership.id,
        memberSessionToken: memberSession.token,
        memberUserId: member!.id,
        stateId: state.id,
        teamId: team.id,
        workspaceId: workspace.id,
      };
    });
  });

  afterAll(async () => {
    if (database) {
      const users = await database.client.user.findMany({
        select: { id: true },
        where: { normalizedEmail: { in: normalizedEmails } },
      });
      const userIds = users.map(({ id }) => id);
      const workspaces = await database.client.workspace.findMany({
        select: { id: true },
        where: { createdByUserId: { in: userIds } },
      });
      const workspaceIds = workspaces.map(({ id }) => id);

      await database.client.session.deleteMany({ where: { userId: { in: userIds } } });
      await database.client.activityEvent.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.issueSubscription.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.issueLabel.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.issue.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
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
    }

    await app?.close();
    if (process.env.FILE_STORAGE_ROOT) {
      await rm(process.env.FILE_STORAGE_ROOT, { force: true, recursive: true });
    }
  });

  it('paginates and filters members with stable workspace-scoped cursors', async () => {
    const first = await request(app.getHttpServer())
      .get('/api/v1/members?status=ACTIVE,INACTIVE&limit=2')
      .set('Cookie', `rivet_session=${fixture.adminSessionToken}`)
      .expect(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.items.every((item: Record<string, unknown>) => 'email' in item)).toBe(true);
    expect(first.body.nextCursor).toEqual(expect.any(String));

    const second = await request(app.getHttpServer())
      .get(`/api/v1/members?status=ACTIVE,INACTIVE&limit=2&cursor=${first.body.nextCursor}`)
      .set('Cookie', `rivet_session=${fixture.adminSessionToken}`)
      .expect(200);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();
    expect(
      new Set(
        [...first.body.items, ...second.body.items].map((item: Record<string, unknown>) => item.id),
      ).size,
    ).toBe(3);

    const inactive = await request(app.getHttpServer())
      .get('/api/v1/members?status=INACTIVE')
      .set('Cookie', `rivet_session=${fixture.adminSessionToken}`)
      .expect(200);
    expect(inactive.body.items).toEqual([
      expect.objectContaining({ id: fixture.inactiveMembershipId, status: 'INACTIVE' }),
    ]);

    const team = await request(app.getHttpServer())
      .get(`/api/v1/members?teamId=${fixture.teamId}`)
      .set('Cookie', `rivet_session=${fixture.adminSessionToken}`)
      .expect(200);
    expect(team.body.items.map((item: Record<string, unknown>) => item.id)).toEqual([
      fixture.adminMembershipId,
      fixture.memberMembershipId,
    ]);
  });

  it('exposes and searches email only for administrators', async () => {
    const memberList = await request(app.getHttpServer())
      .get('/api/v1/members')
      .set('Cookie', `rivet_session=${fixture.memberSessionToken}`)
      .expect(200);
    expect(memberList.body.items.every((item: Record<string, unknown>) => !('email' in item))).toBe(
      true,
    );

    const memberEmailSearch = await request(app.getHttpServer())
      .get(`/api/v1/members?query=${encodeURIComponent(normalizedEmails[2]!)}`)
      .set('Cookie', `rivet_session=${fixture.memberSessionToken}`)
      .expect(200);
    expect(memberEmailSearch.body.items).toEqual([]);

    const adminEmailSearch = await request(app.getHttpServer())
      .get(`/api/v1/members?query=${encodeURIComponent(normalizedEmails[2]!)}`)
      .set('Cookie', `rivet_session=${fixture.adminSessionToken}`)
      .expect(200);
    expect(adminEmailSearch.body.items).toEqual([
      expect.objectContaining({ email: normalizedEmails[2], id: fixture.inactiveMembershipId }),
    ]);
  });

  it('returns team summaries without leaking cross-workspace members or teams', async () => {
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/members/${fixture.memberMembershipId}`)
      .set('Cookie', `rivet_session=${fixture.memberSessionToken}`)
      .expect(200);
    expect(detail.body).toMatchObject({
      id: fixture.memberMembershipId,
      teams: [{ archived: false, id: fixture.teamId, key: 'MEM', name: '멤버 팀' }],
      user: { avatarFileId: null, displayName: '활성 멤버' },
    });
    expect(detail.body).not.toHaveProperty('email');

    const crossMember = await request(app.getHttpServer())
      .get(`/api/v1/members/${fixture.crossMembershipId}`)
      .set('Cookie', `rivet_session=${fixture.adminSessionToken}`)
      .expect(404);
    expect(crossMember.body.code).toBe('RESOURCE_NOT_FOUND');

    const crossTeam = await request(app.getHttpServer())
      .get(`/api/v1/members?teamId=${fixture.crossTeamId}`)
      .set('Cookie', `rivet_session=${fixture.adminSessionToken}`)
      .expect(404);
    expect(crossTeam.body.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('rejects malformed list filters with INVALID_QUERY', async () => {
    const invalidStatus = await request(app.getHttpServer())
      .get('/api/v1/members?status=UNKNOWN')
      .set('Cookie', `rivet_session=${fixture.adminSessionToken}`)
      .expect(400);
    expect(invalidStatus.body.code).toBe('INVALID_QUERY');

    const invalidCursor = await request(app.getHttpServer())
      .get('/api/v1/members?cursor=not-a-cursor')
      .set('Cookie', `rivet_session=${fixture.adminSessionToken}`)
      .expect(400);
    expect(invalidCursor.body.code).toBe('INVALID_QUERY');
  });

  it('rejects member, self, and cross-workspace deactivation attempts', async () => {
    const memberCsrf = createCsrfToken(fixture.memberSessionToken, CSRF_HMAC_KEY);
    const memberAttempt = await request(app.getHttpServer())
      .post(`/api/v1/members/${fixture.inactiveMembershipId}/deactivate`)
      .set('Cookie', `rivet_session=${fixture.memberSessionToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrf)
      .expect(403);
    expect(memberAttempt.body.code).toBe('FORBIDDEN');

    const adminCsrf = createCsrfToken(fixture.adminSessionToken, CSRF_HMAC_KEY);
    const selfAttempt = await request(app.getHttpServer())
      .post(`/api/v1/members/${fixture.adminMembershipId}/deactivate`)
      .set('Cookie', `rivet_session=${fixture.adminSessionToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrf)
      .expect(403);
    expect(selfAttempt.body.code).toBe('FORBIDDEN');

    const crossAttempt = await request(app.getHttpServer())
      .post(`/api/v1/members/${fixture.crossMembershipId}/deactivate`)
      .set('Cookie', `rivet_session=${fixture.adminSessionToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrf)
      .expect(404);
    expect(crossAttempt.body.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('keeps a member active while an unfinished issue is assigned', async () => {
    const project = await database.client.project.create({
      data: { name: '멤버 검증 프로젝트', workspaceId: fixture.workspaceId },
    });
    const issue = await database.client.issue.create({
      data: {
        createdByMembershipId: fixture.adminMembershipId,
        identifier: 'F-9001',
        projectId: project.id,
        sequenceNumber: 1,
        title: '멤버 비활성화 차단 검증',
        workspaceId: fixture.workspaceId,
      },
      select: { id: true },
    });
    const teamWork = await database.client.teamWork.create({
      data: {
        assigneeMembershipId: fixture.memberMembershipId,
        createdByMembershipId: fixture.adminMembershipId,
        identifier: 'MEM-1',
        issueId: issue.id,
        projectRole: ProjectRole.BACKEND,
        sequenceNumber: 1,
        teamId: fixture.teamId,
        workflowStateId: fixture.stateId,
        workspaceId: fixture.workspaceId,
      },
      select: { id: true },
    });
    const adminCsrf = createCsrfToken(fixture.adminSessionToken, CSRF_HMAC_KEY);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/members/${fixture.memberMembershipId}/deactivate`)
      .set('Cookie', `rivet_session=${fixture.adminSessionToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrf)
      .expect(409);
    expect(response.body).toMatchObject({
      code: 'MEMBER_HAS_OPEN_ASSIGNMENTS',
      details: {
        issues: [
          {
            id: teamWork.id,
            identifier: 'MEM-1',
            title: '멤버 비활성화 차단 검증',
          },
        ],
      },
    });
    await expect(
      database.client.workspaceMembership.findUniqueOrThrow({
        select: { status: true },
        where: { id: fixture.memberMembershipId },
      }),
    ).resolves.toEqual({ status: MembershipStatus.ACTIVE });

    await database.client.teamWork.deleteMany({ where: { issueId: issue.id } });
    await database.client.issue.delete({ where: { id: issue.id } });
    await database.client.projectTeam.deleteMany({ where: { projectId: project.id } });
    await database.client.project.delete({ where: { id: project.id } });
  });

  it('deactivates a member and revokes all sessions atomically', async () => {
    const adminCsrf = createCsrfToken(fixture.adminSessionToken, CSRF_HMAC_KEY);
    const response = await request(app.getHttpServer())
      .post(`/api/v1/members/${fixture.memberMembershipId}/deactivate`)
      .set('Cookie', `rivet_session=${fixture.adminSessionToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrf)
      .expect(200);
    expect(response.body).toMatchObject({
      email: normalizedEmails[1],
      id: fixture.memberMembershipId,
      status: 'INACTIVE',
    });
    expect(response.body.deactivatedAt).toEqual(expect.any(String));

    const stored = await database.client.workspaceMembership.findFirstOrThrow({
      select: { deactivatedAt: true, status: true },
      where: { id: fixture.memberMembershipId, workspaceId: fixture.workspaceId },
    });
    expect(stored.status).toBe(MembershipStatus.INACTIVE);
    expect(stored.deactivatedAt).not.toBeNull();
    expect(
      await database.client.session.count({
        where: { revokedAt: null, userId: fixture.memberUserId },
      }),
    ).toBe(0);

    const revokedSession = await request(app.getHttpServer())
      .get('/api/v1/members')
      .set('Cookie', `rivet_session=${fixture.memberSessionToken}`)
      .expect(401);
    expect(revokedSession.body.code).toBe('SESSION_REQUIRED');
  });
});
