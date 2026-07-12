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

const PASSWORD_HASH = 'integration-password-hash';

describe('M7 CSV exports', () => {
  const runId = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  let app: INestApplication;
  let database: DatabaseService;
  let adminCookie: string;
  let memberCookie: string;
  let currentWorkspaceId: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    database = app.get(DatabaseService);

    const fixture = await database.client.$transaction(async (transaction) => {
      const createUser = (kind: 'admin' | 'foreign' | 'member') => {
        const email = `m7.exports.${kind}.${runId}@example.com`;
        return transaction.user.create({
          data: {
            displayName: `${kind} user`,
            email,
            emailVerifiedAt: new Date(),
            normalizedEmail: email,
            passwordHash: PASSWORD_HASH,
          },
          select: { id: true },
        });
      };
      const [admin, member, foreignAdmin] = await Promise.all([
        createUser('admin'),
        createUser('member'),
        createUser('foreign'),
      ]);
      const [workspace, foreignWorkspace] = await Promise.all([
        transaction.workspace.create({
          data: {
            createdByUserId: admin.id,
            name: 'CSV 현재 워크스페이스',
            normalizedSlug: `m7-exports-${runId}`,
            slug: `m7-exports-${runId}`,
          },
          select: { id: true },
        }),
        transaction.workspace.create({
          data: {
            createdByUserId: foreignAdmin.id,
            name: 'CSV 다른 워크스페이스',
            normalizedSlug: `m7-exports-foreign-${runId}`,
            slug: `m7-exports-foreign-${runId}`,
          },
          select: { id: true },
        }),
      ]);
      const [adminMembership, foreignMembership] = await Promise.all([
        transaction.workspaceMembership.create({
          data: { role: MembershipRole.ADMIN, userId: admin.id, workspaceId: workspace.id },
          select: { id: true },
        }),
        transaction.workspaceMembership.create({
          data: {
            role: MembershipRole.ADMIN,
            userId: foreignAdmin.id,
            workspaceId: foreignWorkspace.id,
          },
          select: { id: true },
        }),
      ]);
      await transaction.workspaceMembership.create({
        data: { role: MembershipRole.MEMBER, userId: member.id, workspaceId: workspace.id },
      });
      const [team, foreignTeam] = await Promise.all([
        transaction.team.create({
          data: {
            key: 'CSV',
            name: 'CSV 팀',
            normalizedName: 'csv 팀',
            workspaceId: workspace.id,
          },
          select: { id: true },
        }),
        transaction.team.create({
          data: {
            key: 'CSV',
            name: '다른 CSV 팀',
            normalizedName: '다른 csv 팀',
            workspaceId: foreignWorkspace.id,
          },
          select: { id: true },
        }),
      ]);
      await transaction.teamMember.createMany({
        data: [
          { membershipId: adminMembership.id, teamId: team.id, workspaceId: workspace.id },
          {
            membershipId: foreignMembership.id,
            teamId: foreignTeam.id,
            workspaceId: foreignWorkspace.id,
          },
        ],
      });
      const [state, foreignState] = await Promise.all([
        transaction.workflowState.create({
          data: {
            category: StateCategory.UNSTARTED,
            isDefault: true,
            name: '할 일',
            normalizedName: '할 일',
            position: 0,
            teamId: team.id,
            workspaceId: workspace.id,
          },
          select: { id: true },
        }),
        transaction.workflowState.create({
          data: {
            category: StateCategory.UNSTARTED,
            isDefault: true,
            name: '할 일',
            normalizedName: '할 일',
            position: 0,
            teamId: foreignTeam.id,
            workspaceId: foreignWorkspace.id,
          },
          select: { id: true },
        }),
      ]);
      const project = await transaction.project.create({
        data: { name: '+현재 프로젝트', workspaceId: workspace.id },
        select: { id: true },
      });
      await transaction.projectRoleTeam.create({
        data: {
          projectId: project.id,
          role: ProjectRole.BACKEND,
          teamId: team.id,
          workspaceId: workspace.id,
        },
      });
      await Promise.all([
        transaction.project.create({
          data: {
            deletedAt: new Date(),
            deletedByMembershipId: adminMembership.id,
            name: '삭제된 프로젝트 비노출',
            purgeAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            workspaceId: workspace.id,
          },
        }),
        transaction.project.create({
          data: { name: '다른 워크스페이스 프로젝트 비노출', workspaceId: foreignWorkspace.id },
        }),
        transaction.issue.create({
          data: {
            createdByMembershipId: adminMembership.id,
            identifier: 'CSV-1',
            sequenceNumber: 1,
            teamId: team.id,
            title: '=SUM(1,1)',
            type: 'TEAM_TASK',
            workflowStateId: state.id,
            workspaceId: workspace.id,
          },
        }),
        transaction.issue.create({
          data: {
            createdByMembershipId: adminMembership.id,
            deletedAt: new Date(),
            deletedByMembershipId: adminMembership.id,
            identifier: 'CSV-2',
            purgeAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            sequenceNumber: 2,
            teamId: team.id,
            title: '삭제된 이슈 비노출',
            type: 'TEAM_TASK',
            workflowStateId: state.id,
            workspaceId: workspace.id,
          },
        }),
        transaction.issue.create({
          data: {
            createdByMembershipId: foreignMembership.id,
            identifier: 'CSV-1',
            sequenceNumber: 1,
            teamId: foreignTeam.id,
            title: '다른 워크스페이스 이슈 비노출',
            type: 'TEAM_TASK',
            workflowStateId: foreignState.id,
            workspaceId: foreignWorkspace.id,
          },
        }),
      ]);

      return {
        adminUserId: admin.id,
        memberUserId: member.id,
        userIds: [admin.id, member.id, foreignAdmin.id],
        workspaceId: workspace.id,
        workspaceIds: [workspace.id, foreignWorkspace.id],
      };
    });

    userIds.push(...fixture.userIds);
    workspaceIds.push(...fixture.workspaceIds);
    currentWorkspaceId = fixture.workspaceId;
    const sessions = app.get(AuthSessionService);
    const [adminSession, memberSession] = await Promise.all([
      sessions.create(fixture.adminUserId),
      sessions.create(fixture.memberUserId),
    ]);
    adminCookie = `rivet_session=${adminSession.token}`;
    memberCookie = `rivet_session=${memberSession.token}`;
  });

  afterAll(async () => {
    if (database) {
      await database.client.exportAudit.deleteMany({
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
      await database.client.teamMember.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.team.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.session.deleteMany({ where: { userId: { in: userIds } } });
      await database.client.workspaceMembership.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
      await database.client.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app.close();
    if (process.env.FILE_STORAGE_ROOT) {
      await rm(process.env.FILE_STORAGE_ROOT, { force: true, recursive: true });
    }
  });

  function csv(path: string, cookie: string) {
    return request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('Cookie', cookie)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
  }

  it('allows only admins and streams workspace-isolated, formula-safe CSV files', async () => {
    await csv('/exports/issues.csv', memberCookie).expect(403);

    const issues = await csv('/exports/issues.csv', adminCookie)
      .expect('Content-Type', /text\/csv; charset=utf-8/u)
      .expect('Content-Disposition', /attachment; filename="rivet-issues-[0-9]{8}\.csv"/u)
      .expect(200);
    const issueCsv = (issues.body as Buffer).toString('utf8');
    expect(issueCsv.startsWith('\uFEFF')).toBe(true);
    expect(issueCsv).toContain('CSV-1');
    expect(issueCsv).toContain("'=SUM(1,1)");
    expect(issueCsv).not.toContain('삭제된 이슈 비노출');
    expect(issueCsv).not.toContain('다른 워크스페이스 이슈 비노출');

    const projects = await csv('/exports/projects.csv', adminCookie).expect(200);
    const projectCsv = (projects.body as Buffer).toString('utf8');
    expect(projectCsv.startsWith('\uFEFF')).toBe(true);
    expect(projectCsv).toContain("'+현재 프로젝트");
    expect(projectCsv).not.toContain('삭제된 프로젝트 비노출');
    expect(projectCsv).not.toContain('다른 워크스페이스 프로젝트 비노출');

    let audits = await database.client.exportAudit.findMany({
      orderBy: { requestedAt: 'asc' },
      where: { workspaceId: currentWorkspaceId },
    });
    for (
      let attempt = 0;
      attempt < 20 && audits.some(({ downloadedAt }) => !downloadedAt);
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      audits = await database.client.exportAudit.findMany({
        orderBy: { requestedAt: 'asc' },
        where: { workspaceId: currentWorkspaceId },
      });
    }
    expect(audits).toHaveLength(2);
    expect(audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          completedAt: expect.any(Date),
          downloadedAt: expect.any(Date),
          failedAt: null,
          itemCount: 1,
          type: 'ISSUES',
        }),
        expect.objectContaining({
          completedAt: expect.any(Date),
          downloadedAt: expect.any(Date),
          failedAt: null,
          itemCount: 1,
          type: 'PROJECTS',
        }),
      ]),
    );
  });
});
