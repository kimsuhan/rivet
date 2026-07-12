import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { IssueType, MembershipRole, ProjectRole, StateCategory } from '@rivet/database';
import { ISSUE_PURGE_SCHEDULED, PROJECT_PURGE_SCHEDULED } from '@rivet/event-contracts';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap';
import { DatabaseService } from '../src/common/database/database.service';
import { AuthSessionService } from '../src/modules/auth/auth-session.service';
import { createCsrfToken } from '../src/modules/auth/auth-token';

const WEB_ORIGIN = 'http://localhost:3000';
const CSRF_HMAC_KEY = 'test-csrf-hmac-key-with-at-least-32-bytes';
const PASSWORD_HASH = 'integration-password-hash';

describe('M7 trash and restore API', () => {
  const runId = randomUUID().slice(0, 8);
  let app: INestApplication;
  let database: DatabaseService;
  let workspaceId: string;
  let adminUserId: string;
  let memberUserId: string;
  let adminMembershipId: string;
  let projectId: string;
  let emptyProjectId: string;
  let featureId: string;
  let blockingId: string;
  let blockedId: string;
  let deletedProjectIssueId: string;
  let adminCookie: string;
  let adminCsrf: string;
  let memberCookie: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    database = app.get(DatabaseService);

    const fixture = await database.client.$transaction(async (transaction) => {
      const adminEmail = `m7.trash.admin.${runId}@example.com`;
      const memberEmail = `m7.trash.member.${runId}@example.com`;
      const admin = await transaction.user.create({
        data: {
          displayName: 'M7 관리자',
          email: adminEmail,
          emailVerifiedAt: new Date(),
          normalizedEmail: adminEmail,
          passwordHash: PASSWORD_HASH,
        },
      });
      const member = await transaction.user.create({
        data: {
          displayName: 'M7 멤버',
          email: memberEmail,
          emailVerifiedAt: new Date(),
          normalizedEmail: memberEmail,
          passwordHash: PASSWORD_HASH,
        },
      });
      const workspace = await transaction.workspace.create({
        data: {
          createdByUserId: admin.id,
          name: 'M7 휴지통 워크스페이스',
          normalizedSlug: `m7-trash-${runId}`,
          slug: `m7-trash-${runId}`,
        },
      });
      const adminMembership = await transaction.workspaceMembership.create({
        data: { role: MembershipRole.ADMIN, userId: admin.id, workspaceId: workspace.id },
      });
      await transaction.workspaceMembership.create({
        data: { role: MembershipRole.MEMBER, userId: member.id, workspaceId: workspace.id },
      });
      const team = await transaction.team.create({
        data: {
          key: 'MVA',
          name: 'M7 API',
          normalizedName: 'm7 api',
          workspaceId: workspace.id,
        },
      });
      await transaction.teamMember.create({
        data: {
          membershipId: adminMembership.id,
          teamId: team.id,
          workspaceId: workspace.id,
        },
      });
      const state = await transaction.workflowState.create({
        data: {
          category: StateCategory.UNSTARTED,
          isDefault: true,
          name: '할 일',
          normalizedName: '할 일',
          position: 0,
          teamId: team.id,
          workspaceId: workspace.id,
        },
      });
      const project = await transaction.project.create({
        data: { name: '연결 프로젝트', workspaceId: workspace.id },
      });
      const emptyProject = await transaction.project.create({
        data: { name: '빈 프로젝트', workspaceId: workspace.id },
      });
      await transaction.projectRoleTeam.createMany({
        data: [project.id, emptyProject.id].map((currentProjectId) => ({
          projectId: currentProjectId,
          role: ProjectRole.BACKEND,
          teamId: team.id,
          workspaceId: workspace.id,
        })),
      });
      const feature = await transaction.issue.create({
        data: {
          createdByMembershipId: adminMembership.id,
          featureStatus: 'TODO',
          identifier: 'F-901',
          projectId: project.id,
          sequenceNumber: 901,
          title: '하위 작업이 있는 기능',
          type: IssueType.FEATURE,
          workspaceId: workspace.id,
        },
      });
      const createTask = (identifier: string, sequenceNumber: number, title: string) =>
        transaction.issue.create({
          data: {
            createdByMembershipId: adminMembership.id,
            identifier,
            sequenceNumber,
            teamId: team.id,
            title,
            type: IssueType.TEAM_TASK,
            workflowStateId: state.id,
            workspaceId: workspace.id,
          },
        });
      await transaction.issue.create({
        data: {
          createdByMembershipId: adminMembership.id,
          identifier: 'MVA-901',
          parentIssueId: feature.id,
          projectId: project.id,
          projectRole: ProjectRole.BACKEND,
          sequenceNumber: 901,
          teamId: team.id,
          title: '기능 하위 작업',
          type: IssueType.TEAM_TASK,
          workflowStateId: state.id,
          workspaceId: workspace.id,
        },
      });
      const blocking = await createTask('MVA-902', 902, '차단하는 작업');
      const blocked = await createTask('MVA-903', 903, '삭제 검색 대상 작업');
      await transaction.issueBlockRelation.create({
        data: {
          blockedIssueId: blocked.id,
          blockingIssueId: blocking.id,
          createdByMembershipId: adminMembership.id,
          workspaceId: workspace.id,
        },
      });
      const deletedProjectIssue = await transaction.issue.create({
        data: {
          createdByMembershipId: adminMembership.id,
          identifier: 'MVA-904',
          projectId: project.id,
          projectRole: ProjectRole.BACKEND,
          sequenceNumber: 904,
          teamId: team.id,
          title: '휴지통 프로젝트 연결 작업',
          type: IssueType.TEAM_TASK,
          workflowStateId: state.id,
          workspaceId: workspace.id,
        },
      });
      return {
        adminMembershipId: adminMembership.id,
        adminUserId: admin.id,
        blockedId: blocked.id,
        blockingId: blocking.id,
        deletedProjectIssueId: deletedProjectIssue.id,
        emptyProjectId: emptyProject.id,
        featureId: feature.id,
        memberUserId: member.id,
        projectId: project.id,
        workspaceId: workspace.id,
      };
    });

    ({
      adminMembershipId,
      adminUserId,
      blockedId,
      blockingId,
      deletedProjectIssueId,
      emptyProjectId,
      featureId,
      memberUserId,
      projectId,
      workspaceId,
    } = fixture);
    const sessions = app.get(AuthSessionService);
    const [adminSession, memberSession] = await Promise.all([
      sessions.create(adminUserId),
      sessions.create(memberUserId),
    ]);
    adminCookie = `rivet_session=${adminSession.token}`;
    adminCsrf = createCsrfToken(adminSession.token, CSRF_HMAC_KEY);
    memberCookie = `rivet_session=${memberSession.token}`;
  });

  afterAll(async () => {
    if (workspaceId) {
      await database.client.notification.deleteMany({ where: { workspaceId } });
      await database.client.issueBlockRelation.deleteMany({ where: { workspaceId } });
      await database.client.issueFileAttachment.deleteMany({ where: { workspaceId } });
      await database.client.mention.deleteMany({ where: { workspaceId } });
      await database.client.comment.deleteMany({ where: { workspaceId } });
      await database.client.apiHandoff.deleteMany({ where: { workspaceId } });
      await database.client.issueSubscription.deleteMany({ where: { workspaceId } });
      await database.client.issueLabel.deleteMany({ where: { workspaceId } });
      await database.client.activityEvent.deleteMany({ where: { workspaceId } });
      await database.client.issue.deleteMany({ where: { workspaceId } });
      await database.client.projectRoleTeam.deleteMany({ where: { workspaceId } });
      await database.client.project.deleteMany({ where: { workspaceId } });
      await database.client.workflowState.deleteMany({ where: { workspaceId } });
      await database.client.teamMember.deleteMany({ where: { workspaceId } });
      await database.client.team.deleteMany({ where: { workspaceId } });
      await database.client.outboxEvent.deleteMany({ where: { workspaceId } });
      await database.client.session.deleteMany({
        where: { userId: { in: [adminUserId, memberUserId] } },
      });
      await database.client.workspaceMembership.deleteMany({ where: { workspaceId } });
      await database.client.workspace.delete({ where: { id: workspaceId } });
      await database.client.user.deleteMany({
        where: { id: { in: [adminUserId, memberUserId] } },
      });
    }
    await app.close();
    if (process.env.FILE_STORAGE_ROOT) {
      await rm(process.env.FILE_STORAGE_ROOT, { force: true, recursive: true });
    }
  });

  function mutation(path: string, cookie = adminCookie, csrf = adminCsrf) {
    return request(app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Cookie', cookie)
      .set('Origin', WEB_ORIGIN)
      .set('x-csrf-token', csrf);
  }

  it('enforces trash rules, hides deleted issues, and supports admin restore', async () => {
    await mutation(`/issues/${featureId}/trash`)
      .send({ version: 1 })
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('ISSUE_HAS_CHILDREN'));
    await mutation(`/issues/${blockingId}/trash`)
      .send({ version: 1 })
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('ISSUE_BLOCKS_OTHERS'));

    await mutation(`/issues/${blockedId}/trash`).send({ version: 1 }).expect(204);
    const deleted = await database.client.issue.findUniqueOrThrow({ where: { id: blockedId } });
    expect(deleted.deletedAt).not.toBeNull();
    if (!deleted.deletedAt || !deleted.purgeAt)
      throw new Error('휴지통 시각이 저장되지 않았습니다.');
    expect(deleted.purgeAt.getTime()).toBe(deleted.deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    expect(deleted.deletedByMembershipId).toBe(adminMembershipId);
    await expect(
      database.client.outboxEvent.findFirstOrThrow({
        where: { aggregateId: blockedId, eventType: ISSUE_PURGE_SCHEDULED },
      }),
    ).resolves.toEqual(expect.objectContaining({ availableAt: deleted.purgeAt }));

    await request(app.getHttpServer())
      .get(`/api/v1/issues/${blockedId}`)
      .set('Cookie', adminCookie)
      .expect(404);
    await request(app.getHttpServer())
      .get('/api/v1/issues')
      .set('Cookie', adminCookie)
      .expect(200)
      .expect(({ body }) =>
        expect(body.items.map((item: { id: string }) => item.id)).not.toContain(blockedId),
      );
    await request(app.getHttpServer())
      .get('/api/v1/search/issues')
      .query({ query: '삭제 검색 대상' })
      .set('Cookie', adminCookie)
      .expect(200)
      .expect(({ body }) => expect(body.items).toHaveLength(0));

    await request(app.getHttpServer()).get('/api/v1/trash').set('Cookie', memberCookie).expect(403);
    const trash = await request(app.getHttpServer())
      .get('/api/v1/trash')
      .query({ resourceType: 'ISSUE' })
      .set('Cookie', adminCookie)
      .expect(200);
    expect(trash.body.items).toContainEqual(
      expect.objectContaining({ id: blockedId, resourceType: 'ISSUE', version: 2 }),
    );

    await mutation(`/trash/issues/${blockedId}/restore`).send({ version: 1 }).expect(409);
    await mutation(`/trash/issues/${blockedId}/restore`)
      .send({ version: 2 })
      .expect(200)
      .expect(({ body }) =>
        expect(body).toEqual(
          expect.objectContaining({ id: blockedId, resourceType: 'ISSUE', version: 3 }),
        ),
      );
    const canceled = await database.client.outboxEvent.findFirstOrThrow({
      where: { aggregateId: blockedId, eventType: ISSUE_PURGE_SCHEDULED },
    });
    expect(canceled.canceledAt).not.toBeNull();
  });

  it('counts deleted project issues as non-empty and restores an empty project', async () => {
    await mutation(`/issues/${deletedProjectIssueId}/trash`).send({ version: 1 }).expect(204);
    await mutation(`/projects/${projectId}/trash`)
      .send({ version: 1 })
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('PROJECT_NOT_EMPTY'));

    await mutation(`/projects/${emptyProjectId}/trash`).send({ version: 1 }).expect(204);
    const deletedProject = await database.client.project.findUniqueOrThrow({
      where: { id: emptyProjectId },
    });
    expect(deletedProject.deletedAt).not.toBeNull();
    await expect(
      database.client.outboxEvent.findFirstOrThrow({
        where: { aggregateId: emptyProjectId, eventType: PROJECT_PURGE_SCHEDULED },
      }),
    ).resolves.toEqual(expect.objectContaining({ availableAt: deletedProject.purgeAt }));

    const pastDeletedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await database.client.project.update({
      data: {
        deletedAt: pastDeletedAt,
        purgeAt: new Date(pastDeletedAt.getTime() + 30 * 24 * 60 * 60 * 1000),
      },
      where: { id: emptyProjectId },
    });
    await mutation(`/trash/projects/${emptyProjectId}/restore`).send({ version: 2 }).expect(404);

    const futureDeletedAt = new Date();
    await database.client.project.update({
      data: {
        deletedAt: futureDeletedAt,
        purgeAt: new Date(futureDeletedAt.getTime() + 30 * 24 * 60 * 60 * 1000),
      },
      where: { id: emptyProjectId },
    });

    await mutation(`/trash/projects/${emptyProjectId}/restore`)
      .send({ version: 2 })
      .expect(200)
      .expect(({ body }) =>
        expect(body).toEqual(
          expect.objectContaining({ id: emptyProjectId, resourceType: 'PROJECT', version: 3 }),
        ),
      );
  });
});
