import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { IssuePriority, MembershipRole, StateCategory } from '@rivet/database';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap';
import { DatabaseService } from '../src/common/database/database.service';
import { AuthSessionService } from '../src/modules/auth/auth-session.service';
import { createCsrfToken } from '../src/modules/auth/auth-token.crypto';

const WEB_ORIGIN = 'http://localhost:3000';
const CSRF_HMAC_KEY = 'test-csrf-hmac-key-with-at-least-32-bytes';
const PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$u5oksZN2qlFVAyszxdWrug$xmy/xfzl6zHrOnBcsxDzJEO7QyG0A';

describe('A4 workspace issue templates API', () => {
  const runId = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  let app: INestApplication;
  let database: DatabaseService;
  let workspaceId: string;
  let labelId: string;
  let projectId: string;
  let projectTeamId: string;
  let teamId: string;
  let memberMembershipId: string;
  let adminSessionToken: string;
  let adminCsrfToken: string;
  let memberSessionToken: string;
  let memberCsrfToken: string;
  let otherSessionToken: string;
  let otherCsrfToken: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    database = app.get(DatabaseService);

    const fixture = await database.client.$transaction(async (transaction) => {
      const createUser = (kind: string, displayName: string) => {
        const email = `a4.issue-template.${kind}.${runId}@example.com`;
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
      };
      const [admin, member, other] = await Promise.all([
        createUser('admin', 'A4 관리자'),
        createUser('member', 'A4 멤버'),
        createUser('other', 'A4 다른 관리자'),
      ]);
      const workspace = await transaction.workspace.create({
        data: {
          createdByUserId: admin.id,
          name: 'A4 템플릿 워크스페이스',
          normalizedSlug: `a4-template-${runId}`,
          slug: `a4-template-${runId}`,
        },
        select: { id: true },
      });
      const otherWorkspace = await transaction.workspace.create({
        data: {
          createdByUserId: other.id,
          name: 'A4 다른 워크스페이스',
          normalizedSlug: `a4-template-other-${runId}`,
          slug: `a4-template-other-${runId}`,
        },
        select: { id: true },
      });
      await transaction.workspaceMembership.createMany({
        data: [
          {
            role: MembershipRole.ADMIN,
            status: 'ACTIVE',
            userId: admin.id,
            workspaceId: workspace.id,
          },
          {
            role: MembershipRole.MEMBER,
            status: 'ACTIVE',
            userId: member.id,
            workspaceId: workspace.id,
          },
          {
            role: MembershipRole.ADMIN,
            status: 'ACTIVE',
            userId: other.id,
            workspaceId: otherWorkspace.id,
          },
        ],
      });
      const memberMembership = await transaction.workspaceMembership.findUniqueOrThrow({
        select: { id: true },
        where: { userId: member.id },
      });
      const label = await transaction.label.create({
        data: {
          color: '#D84A4A',
          name: '버그',
          normalizedName: '버그',
          workspaceId: workspace.id,
        },
        select: { id: true },
      });
      const team = await transaction.team.create({
        data: {
          key: 'API',
          name: '백엔드',
          normalizedName: '백엔드',
          workspaceId: workspace.id,
        },
        select: { id: true },
      });
      const removedTeamMembershipAt = new Date();
      await transaction.teamMember.create({
        data: {
          joinedAt: removedTeamMembershipAt,
          membershipId: memberMembership.id,
          removedAt: removedTeamMembershipAt,
          teamId: team.id,
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
          teamId: team.id,
          workspaceId: workspace.id,
        },
      });
      const project = await transaction.project.create({
        data: { name: 'A4 프로젝트', workspaceId: workspace.id },
        select: { id: true },
      });
      const projectTeam = await transaction.projectTeam.create({
        data: { projectId: project.id, teamId: team.id, workspaceId: workspace.id },
      });
      return {
        adminId: admin.id,
        labelId: label.id,
        memberMembershipId: memberMembership.id,
        memberId: member.id,
        otherId: other.id,
        otherWorkspaceId: otherWorkspace.id,
        projectId: project.id,
        projectTeamId: projectTeam.id,
        teamId: team.id,
        workspaceId: workspace.id,
      };
    });
    userIds.push(fixture.adminId, fixture.memberId, fixture.otherId);
    workspaceIds.push(fixture.workspaceId, fixture.otherWorkspaceId);
    workspaceId = fixture.workspaceId;
    labelId = fixture.labelId;
    projectId = fixture.projectId;
    projectTeamId = fixture.projectTeamId;
    teamId = fixture.teamId;
    memberMembershipId = fixture.memberMembershipId;

    const sessions = app.get(AuthSessionService);
    const [adminSession, memberSession, otherSession] = await Promise.all([
      sessions.create(fixture.adminId),
      sessions.create(fixture.memberId),
      sessions.create(fixture.otherId),
    ]);
    adminSessionToken = adminSession.token;
    adminCsrfToken = createCsrfToken(adminSessionToken, CSRF_HMAC_KEY);
    memberSessionToken = memberSession.token;
    memberCsrfToken = createCsrfToken(memberSessionToken, CSRF_HMAC_KEY);
    otherSessionToken = otherSession.token;
    otherCsrfToken = createCsrfToken(otherSessionToken, CSRF_HMAC_KEY);
  });

  afterAll(async () => {
    if (database && workspaceIds.length > 0) {
      await database.client.activityEvent.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.issueSubscription.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.issueLabel.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.teamWork.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.issue.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.outboxEvent.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.issueTemplateLabel.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.issueTemplate.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.projectTeam.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.project.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.label.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.teamMember.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.workflowState.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
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

  const mutate = (token: string, csrf: string, method: 'patch' | 'post', path: string) =>
    request(app.getHttpServer())
      [method](path)
      .set('Cookie', `rivet_session=${token}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', csrf);

  it('manages and applies templates without synchronizing created issues', async () => {
    const createBody = {
      descriptionMarkdown: '## 재현 절차\n\n1. 동작을 실행한다.',
      initialProjectTeamId: projectTeamId,
      labelIds: [labelId],
      name: '  버그 신고  ',
      priority: IssuePriority.HIGH,
      projectId,
    };

    await mutate(memberSessionToken, memberCsrfToken, 'post', '/api/v1/issue-templates')
      .send(createBody)
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('FORBIDDEN'));

    const created = await mutate(
      adminSessionToken,
      adminCsrfToken,
      'post',
      '/api/v1/issue-templates',
    )
      .send(createBody)
      .expect(201);
    expect(created.body).toMatchObject({
      archived: false,
      available: true,
      initialProjectTeamId: projectTeamId,
      labelIds: [labelId],
      name: '버그 신고',
      projectId,
      unavailableReason: null,
      version: 1,
    });
    const issueTemplateId = created.body.id as string;

    await mutate(adminSessionToken, adminCsrfToken, 'post', '/api/v1/issue-templates')
      .send({ ...createBody, name: '버그 신고' })
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('ISSUE_TEMPLATE_NAME_IN_USE'));

    await request(app.getHttpServer())
      .get('/api/v1/issue-templates')
      .set('Cookie', `rivet_session=${memberSessionToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual([
          expect.objectContaining({ available: true, id: issueTemplateId }),
        ]);
      });
    await request(app.getHttpServer())
      .get('/api/v1/issue-templates?includeArchived=true')
      .set('Cookie', `rivet_session=${memberSessionToken}`)
      .expect(403);

    await mutate(
      otherSessionToken,
      otherCsrfToken,
      'post',
      `/api/v1/issue-templates/${issueTemplateId}/apply`,
    )
      .send({ version: 1 })
      .expect(404)
      .expect(({ body }) => expect(body.code).toBe('RESOURCE_NOT_FOUND'));

    await mutate(
      memberSessionToken,
      memberCsrfToken,
      'post',
      `/api/v1/issue-templates/${issueTemplateId}/apply`,
    )
      .send({ version: 1 })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          descriptionMarkdown: createBody.descriptionMarkdown,
          id: issueTemplateId,
          version: 1,
        });
      });

    const issuesBeforeRemovedMemberAssignment = await database.client.issue.count({
      where: { workspaceId },
    });
    await mutate(memberSessionToken, memberCsrfToken, 'post', '/api/v1/issues')
      .send({
        appliedTemplate: { id: issueTemplateId, version: 1 },
        descriptionMarkdown: '제거된 팀 멤버 할당은 거부',
        initialTeams: [
          {
            assigneeMembershipId: memberMembershipId,
            projectTeamId,
          },
        ],
        projectId,
        title: '제거된 팀 멤버 할당 시도',
      })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('TEAM_MEMBERSHIP_REQUIRED'));
    await expect(database.client.issue.count({ where: { workspaceId } })).resolves.toBe(
      issuesBeforeRemovedMemberAssignment,
    );

    const issuesBeforeRejectedCreate = await database.client.issue.count({
      where: { workspaceId },
    });
    await database.client.label.update({
      data: { archivedAt: new Date(), version: { increment: 1 } },
      where: { id: labelId },
    });
    await mutate(memberSessionToken, memberCsrfToken, 'post', '/api/v1/issues')
      .send({
        appliedTemplate: { id: issueTemplateId, version: 1 },
        descriptionMarkdown: '사용자가 수정한 설명',
        labelIds: [],
        priority: IssuePriority.LOW,
        projectId,
        title: '템플릿으로 시작한 이슈',
      })
      .expect(422)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          code: 'ISSUE_TEMPLATE_TARGET_UNAVAILABLE',
          details: { unavailableReason: 'LABEL_UNAVAILABLE' },
        });
      });
    await expect(database.client.issue.count({ where: { workspaceId } })).resolves.toBe(
      issuesBeforeRejectedCreate,
    );
    await database.client.label.update({
      data: { archivedAt: null, version: { increment: 1 } },
      where: { id: labelId },
    });

    const issueResponse = await mutate(
      memberSessionToken,
      memberCsrfToken,
      'post',
      '/api/v1/issues',
    )
      .send({
        appliedTemplate: { id: issueTemplateId, version: 1 },
        descriptionMarkdown: '사용자가 수정한 설명',
        labelIds: [],
        priority: IssuePriority.LOW,
        projectId,
        title: '템플릿으로 시작한 이슈',
      })
      .expect(201);
    const issueId = issueResponse.body.issue.id as string;
    expect(issueResponse.body.issue).toMatchObject({
      descriptionMarkdown: '사용자가 수정한 설명',
      labels: [],
      priority: IssuePriority.LOW,
    });

    const [activity, outbox] = await Promise.all([
      database.client.activityEvent.findFirstOrThrow({
        select: { afterData: true },
        where: { eventType: 'ISSUE_CREATED', issueId, workspaceId },
      }),
      database.client.outboxEvent.findFirstOrThrow({
        select: { payload: true },
        where: { aggregateId: issueId, eventType: 'ISSUE_CREATED', workspaceId },
      }),
    ]);
    expect(activity.afterData).toMatchObject({ templateId: issueTemplateId, templateVersion: 1 });
    expect(JSON.stringify(activity.afterData)).not.toContain(createBody.descriptionMarkdown);
    expect(JSON.stringify(outbox.payload)).not.toContain(createBody.descriptionMarkdown);

    const updated = await mutate(
      adminSessionToken,
      adminCsrfToken,
      'patch',
      `/api/v1/issue-templates/${issueTemplateId}`,
    )
      .send({ descriptionMarkdown: '## 변경된 템플릿 본문', version: 1 })
      .expect(200);
    expect(updated.body.version).toBe(2);
    await mutate(
      adminSessionToken,
      adminCsrfToken,
      'patch',
      `/api/v1/issue-templates/${issueTemplateId}`,
    )
      .send({ name: '오래된 변경', version: 1 })
      .expect(409)
      .expect(({ body }) => {
        expect(body).toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: 2 });
      });
    await mutate(
      memberSessionToken,
      memberCsrfToken,
      'post',
      `/api/v1/issue-templates/${issueTemplateId}/apply`,
    )
      .send({ version: 1 })
      .expect(409)
      .expect(({ body }) => {
        expect(body).toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: 2 });
      });
    const issuesBeforeStaleTemplateCreate = await database.client.issue.count({
      where: { workspaceId },
    });
    await mutate(memberSessionToken, memberCsrfToken, 'post', '/api/v1/issues')
      .send({
        appliedTemplate: { id: issueTemplateId, version: 1 },
        descriptionMarkdown: '오래된 템플릿 version으로 생성 시도',
        labelIds: [],
        priority: IssuePriority.LOW,
        projectId,
        title: '오래된 템플릿 적용 생성',
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body).toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: 2 });
      });
    await expect(database.client.issue.count({ where: { workspaceId } })).resolves.toBe(
      issuesBeforeStaleTemplateCreate,
    );
    await expect(
      database.client.issue.findUniqueOrThrow({
        select: { descriptionMarkdown: true, priority: true },
        where: { id: issueId },
      }),
    ).resolves.toEqual({
      descriptionMarkdown: '사용자가 수정한 설명',
      priority: IssuePriority.LOW,
    });

    await database.client.team.update({ data: { archivedAt: new Date() }, where: { id: teamId } });
    await mutate(
      memberSessionToken,
      memberCsrfToken,
      'post',
      `/api/v1/issue-templates/${issueTemplateId}/apply`,
    )
      .send({ version: 2 })
      .expect(422)
      .expect(({ body }) => {
        expect(body.details).toEqual({ unavailableReason: 'PROJECT_TEAM_UNAVAILABLE' });
      });
    await database.client.team.update({ data: { archivedAt: null }, where: { id: teamId } });

    await database.client.projectTeam.update({
      data: { deactivatedAt: new Date(), isActive: false },
      where: { id: projectTeamId },
    });
    await mutate(
      memberSessionToken,
      memberCsrfToken,
      'post',
      `/api/v1/issue-templates/${issueTemplateId}/apply`,
    )
      .send({ version: 2 })
      .expect(422)
      .expect(({ body }) => {
        expect(body.details).toEqual({ unavailableReason: 'PROJECT_TEAM_UNAVAILABLE' });
      });
    await database.client.projectTeam.update({
      data: { deactivatedAt: null, isActive: true },
      where: { id: projectTeamId },
    });

    const archived = await mutate(
      adminSessionToken,
      adminCsrfToken,
      'post',
      `/api/v1/issue-templates/${issueTemplateId}/archive`,
    )
      .send({ version: 2 })
      .expect(200);
    expect(archived.body).toMatchObject({ archived: true, version: 3 });
    await mutate(
      adminSessionToken,
      adminCsrfToken,
      'patch',
      `/api/v1/issue-templates/${issueTemplateId}`,
    )
      .send({ descriptionMarkdown: '## 오래된 초안 변경 시도', version: 2 })
      .expect(409)
      .expect(({ body }) => {
        expect(body).toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: 3 });
      });
    await mutate(
      adminSessionToken,
      adminCsrfToken,
      'patch',
      `/api/v1/issue-templates/${issueTemplateId}`,
    )
      .send({ descriptionMarkdown: '## 보관 후 변경 시도', version: 3 })
      .expect(409)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          code: 'ISSUE_TEMPLATE_UNAVAILABLE',
          details: { unavailableReason: 'ARCHIVED' },
        });
      });
    await expect(
      database.client.issueTemplate.findUniqueOrThrow({
        select: { descriptionMarkdown: true, version: true },
        where: { id: issueTemplateId },
      }),
    ).resolves.toEqual({ descriptionMarkdown: '## 변경된 템플릿 본문', version: 3 });
    await mutate(
      memberSessionToken,
      memberCsrfToken,
      'post',
      `/api/v1/issue-templates/${issueTemplateId}/apply`,
    )
      .send({ version: 3 })
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('ISSUE_TEMPLATE_UNAVAILABLE'));
    await mutate(
      adminSessionToken,
      adminCsrfToken,
      'post',
      `/api/v1/issue-templates/${issueTemplateId}/archive`,
    )
      .send({ version: 2 })
      .expect(409)
      .expect(({ body }) => {
        expect(body).toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: 3 });
      });

    await mutate(
      memberSessionToken,
      memberCsrfToken,
      'post',
      `/api/v1/issue-templates/${issueTemplateId}/restore`,
    )
      .send({ version: 3 })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('FORBIDDEN'));
    await mutate(
      otherSessionToken,
      otherCsrfToken,
      'post',
      `/api/v1/issue-templates/${issueTemplateId}/restore`,
    )
      .send({ version: 3 })
      .expect(404)
      .expect(({ body }) => expect(body.code).toBe('RESOURCE_NOT_FOUND'));
    await mutate(
      adminSessionToken,
      adminCsrfToken,
      'post',
      `/api/v1/issue-templates/${issueTemplateId}/restore`,
    )
      .send({ version: 2 })
      .expect(409)
      .expect(({ body }) => {
        expect(body).toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: 3 });
      });

    await database.client.label.update({
      data: { archivedAt: new Date(), version: { increment: 1 } },
      where: { id: labelId },
    });
    await mutate(
      adminSessionToken,
      adminCsrfToken,
      'post',
      `/api/v1/issue-templates/${issueTemplateId}/restore`,
    )
      .send({ version: 3 })
      .expect(422)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          code: 'ISSUE_TEMPLATE_TARGET_UNAVAILABLE',
          details: { unavailableReason: 'LABEL_UNAVAILABLE' },
        });
      });
    await expect(
      database.client.issueTemplate.findUniqueOrThrow({
        select: { archivedAt: true, version: true },
        where: { id: issueTemplateId },
      }),
    ).resolves.toMatchObject({ archivedAt: expect.any(Date), version: 3 });
    await database.client.label.update({
      data: { archivedAt: null, version: { increment: 1 } },
      where: { id: labelId },
    });

    const replacement = await mutate(
      adminSessionToken,
      adminCsrfToken,
      'post',
      '/api/v1/issue-templates',
    )
      .send(createBody)
      .expect(201);
    const replacementTemplateId = replacement.body.id as string;
    await mutate(
      adminSessionToken,
      adminCsrfToken,
      'post',
      `/api/v1/issue-templates/${issueTemplateId}/restore`,
    )
      .send({ version: 3 })
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('ISSUE_TEMPLATE_NAME_IN_USE'));
    await mutate(
      adminSessionToken,
      adminCsrfToken,
      'post',
      `/api/v1/issue-templates/${replacementTemplateId}/archive`,
    )
      .send({ version: 1 })
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ archived: true, version: 2 }));

    const restored = await mutate(
      adminSessionToken,
      adminCsrfToken,
      'post',
      `/api/v1/issue-templates/${issueTemplateId}/restore`,
    )
      .send({ version: 3 })
      .expect(200);
    expect(restored.body).toMatchObject({
      archived: false,
      available: true,
      id: issueTemplateId,
      unavailableReason: null,
      version: 4,
    });
    await mutate(
      memberSessionToken,
      memberCsrfToken,
      'post',
      `/api/v1/issue-templates/${issueTemplateId}/apply`,
    )
      .send({ version: 4 })
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ id: issueTemplateId, version: 4 }));

    await request(app.getHttpServer())
      .get('/api/v1/issue-templates')
      .set('Cookie', `rivet_session=${memberSessionToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual([
          expect.objectContaining({ archived: false, id: issueTemplateId, version: 4 }),
        ]);
      });
    await request(app.getHttpServer())
      .get('/api/v1/issue-templates?includeArchived=true')
      .set('Cookie', `rivet_session=${adminSessionToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              archived: false,
              available: true,
              id: issueTemplateId,
              unavailableReason: null,
            }),
            expect.objectContaining({
              archived: true,
              available: false,
              id: replacementTemplateId,
              unavailableReason: 'ARCHIVED',
            }),
          ]),
        );
      });
  });
});
