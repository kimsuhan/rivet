import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import {
  FeatureIssueStatus,
  IssuePriority,
  IssueType,
  MembershipRole,
  MembershipStatus,
  ProjectRole,
  ProjectStatus,
  StateCategory,
} from '@rivet/database';
import { ISSUE_CHANGED, ISSUE_CREATED } from '@rivet/event-contracts';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap';
import { DatabaseService } from '../src/common/database/database.service';
import { AuthSessionService } from '../src/modules/auth/auth-session.service';
import { createCsrfToken } from '../src/modules/auth/auth-token';

const WEB_ORIGIN = 'http://localhost:3000';
const CSRF_HMAC_KEY = 'test-csrf-hmac-key-with-at-least-32-bytes';
const PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$u5oksZN2qlFVAyszxdWrug$xmy/xfzl6zj7sfdlIBgb2F6zHrOnBcsxDzJEO7QyG0A';

describe('M3 issues', () => {
  const runId = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  let app: INestApplication;
  let database: DatabaseService;
  let teamId: string;
  let otherTeamId: string;
  let keyRaceTeamId: string;
  let backlogStateId: string;
  let startedStateId: string;
  let completedStateId: string;
  let otherTeamStateId: string;
  let labelAId: string;
  let labelBId: string;
  let adminMembershipId: string;
  let memberMembershipId: string;
  let outsiderMembershipId: string;
  let removeTargetMembershipId: string;
  let deactivateTargetMembershipId: string;
  let adminCookie: string;
  let memberCookie: string;
  let foreignCookie: string;
  let adminCsrfToken: string;
  let memberCsrfToken: string;

  async function collectIssueIds(query: Record<string, number | string>): Promise<string[]> {
    const ids: string[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;

    for (;;) {
      const response = await request(app.getHttpServer())
        .get('/api/v1/issues')
        .query({ ...query, ...(cursor ? { cursor } : {}) })
        .set('Cookie', memberCookie)
        .expect(200);
      const pageIds = (response.body.items as { id: string }[]).map(({ id }) => id);
      expect(new Set([...ids, ...pageIds]).size).toBe(ids.length + pageIds.length);
      ids.push(...pageIds);

      const nextCursor = response.body.nextCursor as string | null;
      if (nextCursor === null) {
        return ids;
      }
      expect(cursors.has(nextCursor)).toBe(false);
      cursors.add(nextCursor);
      cursor = nextCursor;
    }
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    database = app.get(DatabaseService);

    const fixtures = await database.client.$transaction(async (transaction) => {
      const userSpecs = [
        ['이슈 관리자', 'admin'],
        ['이슈 멤버', 'member'],
        ['팀 외부 멤버', 'outsider'],
        ['제거 경합 멤버', 'remove'],
        ['비활성 경합 멤버', 'deactivate'],
        ['다른 워크스페이스 관리자', 'foreign'],
      ] as const;
      const users = await Promise.all(
        userSpecs.map(([displayName, kind]) => {
          const email = `m3.issues.${kind}.${runId}@example.com`;
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
      const [admin, member, outsider, removeTarget, deactivateTarget, foreign] = users;
      if (!admin || !member || !outsider || !removeTarget || !deactivateTarget || !foreign) {
        throw new Error('M3 이슈 통합 테스트 사용자를 만들 수 없습니다.');
      }

      const [workspace, foreignWorkspace] = await Promise.all([
        transaction.workspace.create({
          data: {
            createdByUserId: admin.id,
            name: 'M3 이슈 워크스페이스',
            normalizedSlug: `m3-issues-${runId}`,
            slug: `m3-issues-${runId}`,
          },
          select: { id: true },
        }),
        transaction.workspace.create({
          data: {
            createdByUserId: foreign.id,
            name: 'M3 다른 워크스페이스',
            normalizedSlug: `m3-issues-foreign-${runId}`,
            slug: `m3-issues-foreign-${runId}`,
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
          data: { role: MembershipRole.MEMBER, userId: outsider.id, workspaceId: workspace.id },
          select: { id: true },
        }),
        transaction.workspaceMembership.create({
          data: { role: MembershipRole.MEMBER, userId: removeTarget.id, workspaceId: workspace.id },
          select: { id: true },
        }),
        transaction.workspaceMembership.create({
          data: {
            role: MembershipRole.MEMBER,
            userId: deactivateTarget.id,
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
      const [
        adminMembership,
        memberMembership,
        outsiderMembership,
        removeMembership,
        deactivateMembership,
      ] = memberships;
      if (
        !adminMembership ||
        !memberMembership ||
        !outsiderMembership ||
        !removeMembership ||
        !deactivateMembership
      ) {
        throw new Error('M3 이슈 통합 테스트 멤버십을 만들 수 없습니다.');
      }

      const [team, otherTeam, keyRaceTeam] = await Promise.all([
        transaction.team.create({
          data: {
            key: 'API',
            name: 'API 팀',
            normalizedName: 'api 팀',
            workspaceId: workspace.id,
          },
          select: { id: true },
        }),
        transaction.team.create({
          data: {
            key: 'ETC',
            name: '다른 팀',
            normalizedName: '다른 팀',
            workspaceId: workspace.id,
          },
          select: { id: true },
        }),
        transaction.team.create({
          data: {
            key: 'OLD',
            name: '키 경합 팀',
            normalizedName: '키 경합 팀',
            workspaceId: workspace.id,
          },
          select: { id: true },
        }),
      ]);
      await transaction.teamMember.createMany({
        data: [
          adminMembership.id,
          memberMembership.id,
          removeMembership.id,
          deactivateMembership.id,
        ].map((membershipId) => ({ membershipId, teamId: team.id, workspaceId: workspace.id })),
      });
      await transaction.teamMember.createMany({
        data: [adminMembership.id, memberMembership.id].flatMap((membershipId) => [
          { membershipId, teamId: otherTeam.id, workspaceId: workspace.id },
          { membershipId, teamId: keyRaceTeam.id, workspaceId: workspace.id },
        ]),
      });

      const [backlogState, completedState, startedState, otherTeamState] = await Promise.all([
        transaction.workflowState.create({
          data: {
            category: StateCategory.BACKLOG,
            isDefault: true,
            name: '백로그',
            normalizedName: '백로그',
            position: 0,
            teamId: team.id,
            workspaceId: workspace.id,
          },
          select: { id: true },
        }),
        transaction.workflowState.create({
          data: {
            category: StateCategory.COMPLETED,
            name: '완료',
            normalizedName: '완료',
            position: 2,
            teamId: team.id,
            workspaceId: workspace.id,
          },
          select: { id: true },
        }),
        transaction.workflowState.create({
          data: {
            category: StateCategory.STARTED,
            name: '진행 중',
            normalizedName: '진행 중',
            position: 1,
            teamId: team.id,
            workspaceId: workspace.id,
          },
          select: { id: true },
        }),
        transaction.workflowState.create({
          data: {
            category: StateCategory.BACKLOG,
            isDefault: true,
            name: '다른 팀 백로그',
            normalizedName: '다른 팀 백로그',
            position: 0,
            teamId: otherTeam.id,
            workspaceId: workspace.id,
          },
          select: { id: true },
        }),
      ]);
      await transaction.workflowState.create({
        data: {
          category: StateCategory.BACKLOG,
          isDefault: true,
          name: '키 경합 백로그',
          normalizedName: '키 경합 백로그',
          position: 0,
          teamId: keyRaceTeam.id,
          workspaceId: workspace.id,
        },
      });
      const [labelA, labelB] = await Promise.all([
        transaction.label.create({
          data: {
            color: '#D84A4A',
            name: '버그',
            normalizedName: '버그',
            workspaceId: workspace.id,
          },
          select: { id: true },
        }),
        transaction.label.create({
          data: {
            color: '#2AA198',
            name: '운영',
            normalizedName: '운영',
            workspaceId: workspace.id,
          },
          select: { id: true },
        }),
      ]);

      return {
        adminMembershipId: adminMembership.id,
        adminUserId: admin.id,
        backlogStateId: backlogState.id,
        completedStateId: completedState.id,
        deactivateTargetMembershipId: deactivateMembership.id,
        foreignUserId: foreign.id,
        foreignWorkspaceId: foreignWorkspace.id,
        keyRaceTeamId: keyRaceTeam.id,
        labelAId: labelA.id,
        labelBId: labelB.id,
        memberMembershipId: memberMembership.id,
        memberUserId: member.id,
        otherTeamId: otherTeam.id,
        otherTeamStateId: otherTeamState.id,
        outsiderMembershipId: outsiderMembership.id,
        removeTargetMembershipId: removeMembership.id,
        startedStateId: startedState.id,
        teamId: team.id,
        userIds: users.map(({ id }) => id),
        workspaceId: workspace.id,
      };
    });

    userIds.push(...fixtures.userIds);
    workspaceIds.push(fixtures.workspaceId, fixtures.foreignWorkspaceId);
    teamId = fixtures.teamId;
    otherTeamId = fixtures.otherTeamId;
    keyRaceTeamId = fixtures.keyRaceTeamId;
    backlogStateId = fixtures.backlogStateId;
    completedStateId = fixtures.completedStateId;
    startedStateId = fixtures.startedStateId;
    otherTeamStateId = fixtures.otherTeamStateId;
    labelAId = fixtures.labelAId;
    labelBId = fixtures.labelBId;
    adminMembershipId = fixtures.adminMembershipId;
    memberMembershipId = fixtures.memberMembershipId;
    outsiderMembershipId = fixtures.outsiderMembershipId;
    removeTargetMembershipId = fixtures.removeTargetMembershipId;
    deactivateTargetMembershipId = fixtures.deactivateTargetMembershipId;

    const sessions = app.get(AuthSessionService);
    const [adminSession, memberSession, foreignSession] = await Promise.all([
      sessions.create(fixtures.adminUserId),
      sessions.create(fixtures.memberUserId),
      sessions.create(fixtures.foreignUserId),
    ]);
    adminCookie = `rivet_session=${adminSession.token}`;
    memberCookie = `rivet_session=${memberSession.token}`;
    foreignCookie = `rivet_session=${foreignSession.token}`;
    adminCsrfToken = createCsrfToken(adminSession.token, CSRF_HMAC_KEY);
    memberCsrfToken = createCsrfToken(memberSession.token, CSRF_HMAC_KEY);
  });

  afterAll(async () => {
    if (database) {
      await database.client.notification.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.apiHandoff.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.issueBlockRelation.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.activityEvent.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.issueSubscription.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.issueLabel.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.issue.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.projectRoleTeam.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.project.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.label.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.workflowState.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
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

  it('creates, lists, reads, and updates TEAM_TASK issues with atomic side effects', async () => {
    const unsupportedType = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({ teamId, title: '기능 이슈', type: 'FEATURE' })
      .expect(422);
    expect(unsupportedType.body.code).toBe('ISSUE_TYPE_FIELD_INVALID');

    const created = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        assigneeMembershipId: adminMembershipId,
        labelIds: [labelBId, labelAId],
        priority: IssuePriority.HIGH,
        teamId,
        title: '  Cafe\u0301 로그인  ',
        type: 'TEAM_TASK',
      })
      .expect(201);
    const issueId = created.body.id as string;
    expect(created.body).toMatchObject({
      assignee: { id: adminMembershipId, user: { displayName: '이슈 관리자' } },
      blocked: false,
      descriptionMarkdown: null,
      identifier: 'API-1',
      priority: IssuePriority.HIGH,
      project: null,
      status: {
        category: StateCategory.BACKLOG,
        featureStatus: null,
        workflowState: { id: backlogStateId, name: '백로그' },
      },
      team: { id: teamId, key: 'API' },
      title: 'Café 로그인',
      type: 'TEAM_TASK',
      version: 1,
    });
    expect(created.body.labels.map(({ id }: { id: string }) => id)).toEqual(
      [labelAId, labelBId].sort(),
    );
    expect(created.body.blockers).toEqual([]);
    expect(created.body.blocking).toEqual([]);
    expect(created.body.attachments).toEqual([]);

    const concurrentIssues = await Promise.all(
      ['두 번째', '세 번째'].map((title) =>
        request(app.getHttpServer())
          .post('/api/v1/issues')
          .set('Cookie', adminCookie)
          .set('Origin', WEB_ORIGIN)
          .set('X-CSRF-Token', adminCsrfToken)
          .send({ teamId, title, type: 'TEAM_TASK' })
          .expect(201),
      ),
    );
    expect(new Set(concurrentIssues.map(({ body }) => body.identifier))).toEqual(
      new Set(['API-2', 'API-3']),
    );
    await expect(
      database.client.team.findUniqueOrThrow({
        select: { nextIssueNumber: true },
        where: { id: teamId },
      }),
    ).resolves.toEqual({ nextIssueNumber: 4 });

    const myIssues = await request(app.getHttpServer())
      .get('/api/v1/issues')
      .query({ assigneeMembershipId: 'me', stateCategory: 'BACKLOG,STARTED' })
      .set('Cookie', adminCookie)
      .expect(200);
    expect(myIssues.body.items).toEqual([
      expect.objectContaining({ id: issueId, identifier: 'API-1' }),
    ]);

    const filtered = await request(app.getHttpServer())
      .get('/api/v1/issues')
      .query({ labelId: labelAId, priority: 'HIGH', stateCategory: 'BACKLOG', teamId })
      .set('Cookie', memberCookie)
      .expect(200);
    expect(filtered.body.items).toEqual([expect.objectContaining({ id: issueId })]);

    const firstPage = await request(app.getHttpServer())
      .get('/api/v1/issues')
      .query({ limit: 1, sort: 'createdAt', sortDirection: 'asc' })
      .set('Cookie', memberCookie)
      .expect(200);
    expect(firstPage.body.items).toHaveLength(1);
    expect(firstPage.body.nextCursor).toEqual(expect.any(String));
    const secondPage = await request(app.getHttpServer())
      .get('/api/v1/issues')
      .query({
        cursor: firstPage.body.nextCursor,
        limit: 1,
        sort: 'createdAt',
        sortDirection: 'asc',
      })
      .set('Cookie', memberCookie)
      .expect(200);
    expect(secondPage.body.items[0].id).not.toBe(firstPage.body.items[0].id);

    const wrongCursorSignature = await request(app.getHttpServer())
      .get('/api/v1/issues')
      .query({
        cursor: firstPage.body.nextCursor,
        limit: 1,
        sort: 'priority',
        sortDirection: 'asc',
      })
      .set('Cookie', memberCookie)
      .expect(400);
    expect(wrongCursorSignature.body.code).toBe('INVALID_QUERY');

    const cursorTarget = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({ teamId, title: '커서 변경 대상', type: 'TEAM_TASK' })
      .expect(201);
    const mutableCursorPage = await request(app.getHttpServer())
      .get('/api/v1/issues?limit=1')
      .set('Cookie', memberCookie)
      .expect(200);
    expect(mutableCursorPage.body.items[0].id).toBe(cursorTarget.body.id);
    await database.client.issue.update({
      data: { title: '커서 변경 완료', updatedAt: new Date(Date.now() + 60_000) },
      where: { id: cursorTarget.body.id as string },
    });
    const staleCursor = await request(app.getHttpServer())
      .get('/api/v1/issues')
      .query({ cursor: mutableCursorPage.body.nextCursor, limit: 1 })
      .set('Cookie', memberCookie)
      .expect(400);
    expect(staleCursor.body.code).toBe('INVALID_QUERY');

    const byId = await request(app.getHttpServer())
      .get(`/api/v1/issues/${issueId}`)
      .set('Cookie', memberCookie)
      .expect(200);
    const byIdentifier = await request(app.getHttpServer())
      .get('/api/v1/issues/api-1')
      .set('Cookie', memberCookie)
      .expect(200);
    expect(byId.body.id).toBe(issueId);
    expect(byIdentifier.body.id).toBe(issueId);

    const retainedArchivedLabel = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({ labelIds: [labelAId], teamId, title: '보관 라벨 유지', type: 'TEAM_TASK' })
      .expect(201);
    await database.client.label.update({
      data: { archivedAt: new Date(), version: { increment: 1 } },
      where: { id: labelAId },
    });
    const keptArchived = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${String(retainedArchivedLabel.body.id)}`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({ labelIds: [labelAId, labelBId], version: 1 })
      .expect(200);
    expect(keptArchived.body.labels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ archived: true, id: labelAId }),
        expect.objectContaining({ archived: false, id: labelBId }),
      ]),
    );
    const newArchivedLabel = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({ labelIds: [labelAId], teamId, title: '보관 라벨 신규', type: 'TEAM_TASK' })
      .expect(404);
    expect(newArchivedLabel.body.code).toBe('RESOURCE_NOT_FOUND');

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${issueId}`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        assigneeMembershipId: memberMembershipId,
        labelIds: [labelBId],
        priority: IssuePriority.URGENT,
        title: '로그인 오류 수정',
        version: 1,
        workflowStateId: startedStateId,
      })
      .expect(200);
    expect(updated.body).toMatchObject({
      assignee: { id: memberMembershipId, user: { displayName: '이슈 멤버' } },
      priority: IssuePriority.URGENT,
      status: {
        category: StateCategory.STARTED,
        workflowState: { id: startedStateId, name: '진행 중' },
      },
      title: '로그인 오류 수정',
      version: 2,
    });

    const noOp = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${issueId}`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        assigneeMembershipId: memberMembershipId,
        labelIds: [labelBId],
        priority: IssuePriority.URGENT,
        title: '로그인 오류 수정',
        version: 2,
        workflowStateId: startedStateId,
      })
      .expect(200);
    expect(noOp.body.version).toBe(2);

    const events = await database.client.activityEvent.findMany({
      orderBy: { createdAt: 'asc' },
      where: { issueId },
    });
    expect(events).toHaveLength(6);
    expect(events.filter(({ eventType }) => eventType === 'ISSUE_CREATED')).toHaveLength(1);
    expect(events.find(({ fieldName }) => fieldName === 'workflowStateId')?.afterData).toEqual(
      expect.objectContaining({ id: startedStateId, name: '진행 중' }),
    );
    expect(events.find(({ fieldName }) => fieldName === 'assigneeMembershipId')?.afterData).toEqual(
      expect.objectContaining({ displayName: '이슈 멤버', id: memberMembershipId }),
    );
    expect(events.find(({ fieldName }) => fieldName === 'labelIds')?.afterData).toEqual([
      { id: labelBId, name: '운영' },
    ]);
    const subscriptions = await database.client.issueSubscription.findMany({
      orderBy: { membershipId: 'asc' },
      select: { membershipId: true },
      where: { issueId },
    });
    expect(subscriptions.map(({ membershipId }) => membershipId)).toEqual(
      [adminMembershipId, memberMembershipId].sort(),
    );
    const outboxEvents = await database.client.outboxEvent.findMany({
      orderBy: { createdAt: 'asc' },
      select: { eventType: true, payload: true },
      where: { aggregateId: issueId },
    });
    expect(outboxEvents).toEqual([
      {
        eventType: ISSUE_CREATED,
        payload: {
          assigneeMembershipId: adminMembershipId,
          issueId,
          mentionedMembershipIds: [],
          schemaVersion: 1,
        },
      },
      {
        eventType: ISSUE_CHANGED,
        payload: {
          assigneeMembershipId: memberMembershipId,
          changedFields: ['TITLE', 'WORKFLOW_STATE', 'ASSIGNEE', 'PRIORITY', 'LABELS'],
          issueId,
          mentionedMembershipIds: [],
          schemaVersion: 1,
          subscriberMembershipIds: [],
          terminalCategory: null,
        },
      },
    ]);

    const stale = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${issueId}`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({ title: '오래된 수정', version: 1 })
      .expect(409);
    expect(stale.body).toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: 2 });

    const immutableTeam = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${issueId}`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({ teamId: otherTeamId, version: 2 })
      .expect(409);
    expect(immutableTeam.body.code).toBe('ISSUE_TEAM_IMMUTABLE');

    const invalidState = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${issueId}`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({ version: 2, workflowStateId: otherTeamStateId })
      .expect(404);
    expect(invalidState.body.code).toBe('RESOURCE_NOT_FOUND');

    const invalidAssignee = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${issueId}`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({ assigneeMembershipId: outsiderMembershipId, version: 2 })
      .expect(422);
    expect(invalidAssignee.body.code).toBe('ASSIGNEE_NOT_TEAM_MEMBER');

    const hidden = await request(app.getHttpServer())
      .get(`/api/v1/issues/${issueId}`)
      .set('Cookie', foreignCookie)
      .expect(404);
    expect(hidden.body.code).toBe('RESOURCE_NOT_FOUND');

    const invalidFilter = await request(app.getHttpServer())
      .get('/api/v1/issues?teamId=not-a-uuid')
      .set('Cookie', memberCookie)
      .expect(400);
    expect(invalidFilter.body.code).toBe('INVALID_QUERY');
  });

  it('paginates equal-priority issues stably in both directions and validates cursors', async () => {
    const workspaceId = workspaceIds[0]!;
    const prioritySpecs = [
      {
        id: randomUUID(),
        priority: IssuePriority.NONE,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: randomUUID(),
        priority: IssuePriority.LOW,
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      },
      ...Array.from({ length: 5 }, () => ({
        id: randomUUID(),
        priority: IssuePriority.MEDIUM,
        updatedAt: new Date('2026-01-03T00:00:00.000Z'),
      })),
      {
        id: randomUUID(),
        priority: IssuePriority.HIGH,
        updatedAt: new Date('2026-01-04T00:00:00.000Z'),
      },
      {
        id: randomUUID(),
        priority: IssuePriority.URGENT,
        updatedAt: new Date('2026-01-05T00:00:00.000Z'),
      },
    ];
    await database.client.issue.createMany({
      data: prioritySpecs.map(({ id, priority, updatedAt }, index) => ({
        createdAt: updatedAt,
        createdByMembershipId: adminMembershipId,
        id,
        identifier: `SORT-P-${index}-${runId}`,
        priority,
        sequenceNumber: 20_000 + index,
        teamId: otherTeamId,
        title: `우선순위 정렬 ${index}`,
        type: IssueType.TEAM_TASK,
        updatedAt,
        workflowStateId: otherTeamStateId,
        workspaceId,
      })),
    });

    const mediumIds = prioritySpecs
      .filter(({ priority }) => priority === IssuePriority.MEDIUM)
      .map(({ id }) => id)
      .sort();
    const expectedPriorityAsc = [
      prioritySpecs.find(({ priority }) => priority === IssuePriority.NONE)!.id,
      prioritySpecs.find(({ priority }) => priority === IssuePriority.LOW)!.id,
      ...mediumIds,
      prioritySpecs.find(({ priority }) => priority === IssuePriority.HIGH)!.id,
      prioritySpecs.find(({ priority }) => priority === IssuePriority.URGENT)!.id,
    ];

    const priorityAsc = await collectIssueIds({
      limit: 100,
      sort: 'priority',
      sortDirection: 'asc',
      teamId: otherTeamId,
    });
    const priorityDesc = await collectIssueIds({
      limit: 100,
      sort: 'priority',
      sortDirection: 'desc',
      teamId: otherTeamId,
    });
    expect(priorityAsc).toEqual(expectedPriorityAsc);
    expect(priorityDesc).toEqual([...expectedPriorityAsc].reverse());

    const defaultOrder = await collectIssueIds({ limit: 100, teamId: otherTeamId });
    expect(defaultOrder).toEqual(
      [...prioritySpecs]
        .sort(
          (left, right) =>
            right.updatedAt.getTime() - left.updatedAt.getTime() ||
            (left.id < right.id ? 1 : left.id > right.id ? -1 : 0),
        )
        .map(({ id }) => id),
    );

    for (const sortDirection of ['asc', 'desc'] as const) {
      const expected = sortDirection === 'asc' ? mediumIds : [...mediumIds].reverse();
      const query = {
        limit: 2,
        priority: IssuePriority.MEDIUM,
        sort: 'priority',
        sortDirection,
        teamId: otherTeamId,
      };
      expect(await collectIssueIds(query)).toEqual(expected);
      expect(await collectIssueIds(query)).toEqual(expected);
    }

    const firstMediumPage = await request(app.getHttpServer())
      .get('/api/v1/issues')
      .query({
        limit: 2,
        priority: IssuePriority.MEDIUM,
        sort: 'priority',
        sortDirection: 'asc',
        teamId: otherTeamId,
      })
      .set('Cookie', memberCookie)
      .expect(200);
    expect(firstMediumPage.body.nextCursor).toEqual(expect.any(String));

    const wrongDirection = await request(app.getHttpServer())
      .get('/api/v1/issues')
      .query({
        cursor: firstMediumPage.body.nextCursor,
        limit: 2,
        priority: IssuePriority.MEDIUM,
        sort: 'priority',
        sortDirection: 'desc',
        teamId: otherTeamId,
      })
      .set('Cookie', memberCookie)
      .expect(400);
    expect(wrongDirection.body.code).toBe('INVALID_QUERY');

    const wrongFilter = await request(app.getHttpServer())
      .get('/api/v1/issues')
      .query({
        cursor: firstMediumPage.body.nextCursor,
        limit: 2,
        priority: IssuePriority.HIGH,
        sort: 'priority',
        sortDirection: 'asc',
        teamId: otherTeamId,
      })
      .set('Cookie', memberCookie)
      .expect(400);
    expect(wrongFilter.body.code).toBe('INVALID_QUERY');

    const changedFilterStillContainingCursor = await request(app.getHttpServer())
      .get('/api/v1/issues')
      .query({
        cursor: firstMediumPage.body.nextCursor,
        limit: 2,
        priority: `${IssuePriority.MEDIUM},${IssuePriority.HIGH}`,
        sort: 'priority',
        sortDirection: 'asc',
        teamId: otherTeamId,
      })
      .set('Cookie', memberCookie)
      .expect(400);
    expect(changedFilterStillContainingCursor.body.code).toBe('INVALID_QUERY');

    const normalizedFilterPage = await request(app.getHttpServer())
      .get('/api/v1/issues')
      .query({
        limit: 2,
        priority: `${IssuePriority.MEDIUM},${IssuePriority.HIGH}`,
        sort: 'priority',
        sortDirection: 'asc',
        teamId: otherTeamId,
      })
      .set('Cookie', memberCookie)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/issues')
      .query({
        cursor: normalizedFilterPage.body.nextCursor,
        limit: 2,
        priority: `${IssuePriority.HIGH},${IssuePriority.MEDIUM}`,
        sort: 'priority',
        sortDirection: 'asc',
        teamId: otherTeamId,
      })
      .set('Cookie', memberCookie)
      .expect(200);

    const wrongWorkspace = await request(app.getHttpServer())
      .get('/api/v1/issues')
      .query({
        cursor: firstMediumPage.body.nextCursor,
        limit: 2,
        priority: IssuePriority.MEDIUM,
        sort: 'priority',
        sortDirection: 'asc',
        teamId: otherTeamId,
      })
      .set('Cookie', foreignCookie)
      .expect(400);
    expect(wrongWorkspace.body.code).toBe('INVALID_QUERY');

    const malformedCursor = await request(app.getHttpServer())
      .get('/api/v1/issues')
      .query({ cursor: 'not-a-valid-cursor!', limit: 2 })
      .set('Cookie', memberCookie)
      .expect(400);
    expect(malformedCursor.body.code).toBe('INVALID_QUERY');

    for (const invalidSortQuery of [{ sort: 'unknown' }, { sortDirection: 'side' }]) {
      const invalidSort = await request(app.getHttpServer())
        .get('/api/v1/issues')
        .query(invalidSortQuery)
        .set('Cookie', memberCookie)
        .expect(400);
      expect(invalidSort.body.code).toBe('INVALID_QUERY');
    }
  });

  it('sorts mixed issue statuses by the full tuple across stable cursor pages', async () => {
    const workspaceId = workspaceIds[0]!;
    const ids = {
      canceledFeature: randomUUID(),
      completedFeature: randomUUID(),
      pausedFeature: randomUUID(),
      reviewFeature: randomUUID(),
      startedFeature: randomUUID(),
      startedTaskA: randomUUID(),
      startedTaskB: randomUUID(),
      startedTaskLate: randomUUID(),
      startedTaskMiddle: randomUUID(),
      unstartedFeature: randomUUID(),
      unsortedFeature: randomUUID(),
    };
    const { projectId } = await database.client.$transaction(async (transaction) => {
      const project = await transaction.project.create({
        data: {
          name: `상태 정렬 프로젝트 ${runId}`,
          status: ProjectStatus.IN_PROGRESS,
          workspaceId,
        },
        select: { id: true },
      });
      const sortTeam = await transaction.team.create({
        data: {
          key: 'SRT',
          name: `상태 정렬 팀 ${runId}`,
          normalizedName: `상태 정렬 팀 ${runId}`,
          workspaceId,
        },
        select: { id: true },
      });
      const [startedAtZero, startedAtOne, startedAtThree] = await Promise.all([
        transaction.workflowState.create({
          data: {
            category: StateCategory.STARTED,
            name: '정렬 진행 0',
            normalizedName: '정렬 진행 0',
            position: 0,
            teamId: sortTeam.id,
            workspaceId,
          },
          select: { id: true },
        }),
        transaction.workflowState.create({
          data: {
            category: StateCategory.STARTED,
            name: '정렬 진행 1',
            normalizedName: '정렬 진행 1',
            position: 1,
            teamId: otherTeamId,
            workspaceId,
          },
          select: { id: true },
        }),
        transaction.workflowState.create({
          data: {
            category: StateCategory.STARTED,
            name: '정렬 진행 3',
            normalizedName: '정렬 진행 3',
            position: 3,
            teamId,
            workspaceId,
          },
          select: { id: true },
        }),
      ]);
      await transaction.projectRoleTeam.createMany({
        data: [
          { projectId: project.id, role: ProjectRole.BACKEND, teamId, workspaceId },
          {
            projectId: project.id,
            role: ProjectRole.WEB_FRONTEND,
            teamId: otherTeamId,
            workspaceId,
          },
          {
            projectId: project.id,
            role: ProjectRole.APP_FRONTEND,
            teamId: sortTeam.id,
            workspaceId,
          },
        ],
      });
      await transaction.issue.createMany({
        data: [
          {
            createdByMembershipId: adminMembershipId,
            featureStatus: FeatureIssueStatus.UNSORTED,
            id: ids.unsortedFeature,
            identifier: `SORT-S-BACKLOG-${runId}`,
            projectId: project.id,
            sequenceNumber: 30_000,
            title: '백로그 기능',
            type: IssueType.FEATURE,
            workspaceId,
          },
          {
            createdByMembershipId: adminMembershipId,
            featureStatus: FeatureIssueStatus.PAUSED,
            id: ids.pausedFeature,
            identifier: `SORT-S-PAUSED-${runId}`,
            projectId: project.id,
            sequenceNumber: 30_005,
            title: '보류 기능',
            type: IssueType.FEATURE,
            workspaceId,
          },
          {
            createdByMembershipId: adminMembershipId,
            featureStatus: FeatureIssueStatus.TODO,
            id: ids.unstartedFeature,
            identifier: `SORT-S-TODO-${runId}`,
            projectId: project.id,
            sequenceNumber: 30_001,
            title: '시작 전 기능',
            type: IssueType.FEATURE,
            workspaceId,
          },
          {
            createdByMembershipId: adminMembershipId,
            featureStatus: FeatureIssueStatus.IN_PROGRESS,
            id: ids.startedFeature,
            identifier: `SORT-S-START-${runId}`,
            projectId: project.id,
            sequenceNumber: 30_002,
            title: '진행 기능',
            type: IssueType.FEATURE,
            workspaceId,
          },
          {
            createdByMembershipId: adminMembershipId,
            featureStatus: FeatureIssueStatus.REVIEW,
            id: ids.reviewFeature,
            identifier: `SORT-S-REVIEW-${runId}`,
            projectId: project.id,
            sequenceNumber: 30_006,
            title: '검토 기능',
            type: IssueType.FEATURE,
            workspaceId,
          },
          ...[ids.startedTaskA, ids.startedTaskB].map((id, index) => ({
            createdByMembershipId: adminMembershipId,
            id,
            identifier: `SORT-S-ZERO-${index}-${runId}`,
            projectId: project.id,
            projectRole: ProjectRole.APP_FRONTEND,
            sequenceNumber: 30_000 + index,
            teamId: sortTeam.id,
            title: `동일 튜플 작업 ${index}`,
            type: IssueType.TEAM_TASK,
            workflowStateId: startedAtZero.id,
            workspaceId,
          })),
          {
            createdByMembershipId: adminMembershipId,
            id: ids.startedTaskMiddle,
            identifier: `SORT-S-MIDDLE-${runId}`,
            projectId: project.id,
            projectRole: ProjectRole.WEB_FRONTEND,
            sequenceNumber: 30_100,
            teamId: otherTeamId,
            title: '중간 위치 작업',
            type: IssueType.TEAM_TASK,
            workflowStateId: startedAtOne.id,
            workspaceId,
          },
          {
            createdByMembershipId: adminMembershipId,
            id: ids.startedTaskLate,
            identifier: `SORT-S-LATE-${runId}`,
            projectId: project.id,
            projectRole: ProjectRole.BACKEND,
            sequenceNumber: 30_200,
            teamId,
            title: '뒤 위치 작업',
            type: IssueType.TEAM_TASK,
            workflowStateId: startedAtThree.id,
            workspaceId,
          },
          {
            createdByMembershipId: adminMembershipId,
            featureStatus: FeatureIssueStatus.DONE,
            id: ids.completedFeature,
            identifier: `SORT-S-DONE-${runId}`,
            projectId: project.id,
            sequenceNumber: 30_003,
            title: '완료 기능',
            type: IssueType.FEATURE,
            workspaceId,
          },
          {
            createdByMembershipId: adminMembershipId,
            featureStatus: FeatureIssueStatus.CANCELED,
            id: ids.canceledFeature,
            identifier: `SORT-S-CANCEL-${runId}`,
            projectId: project.id,
            sequenceNumber: 30_004,
            title: '취소 기능',
            type: IssueType.FEATURE,
            workspaceId,
          },
        ],
      });

      return { projectId: project.id };
    });

    const sameTupleTaskIds = [ids.startedTaskA, ids.startedTaskB].sort();
    const expectedAsc = [
      ids.unsortedFeature,
      ids.pausedFeature,
      ids.unstartedFeature,
      ids.startedFeature,
      ...sameTupleTaskIds,
      ids.reviewFeature,
      ids.startedTaskMiddle,
      ids.startedTaskLate,
      ids.completedFeature,
      ids.canceledFeature,
    ];
    const ascQuery = {
      limit: 2,
      projectId,
      sort: 'status',
      sortDirection: 'asc',
    };
    const descQuery = { ...ascQuery, sortDirection: 'desc' };

    expect(await collectIssueIds(ascQuery)).toEqual(expectedAsc);
    expect(await collectIssueIds(ascQuery)).toEqual(expectedAsc);
    expect(await collectIssueIds(descQuery)).toEqual([...expectedAsc].reverse());
    expect(await collectIssueIds(descQuery)).toEqual([...expectedAsc].reverse());
  }, 15_000);

  it('creates FEATURE hierarchies and enforces project-role invariants', async () => {
    const workspaceId = workspaceIds[0]!;
    const [project, otherProject] = await Promise.all([
      database.client.project.create({
        data: {
          name: 'M4 통합 프로젝트',
          status: ProjectStatus.IN_PROGRESS,
          workspaceId,
        },
      }),
      database.client.project.create({
        data: {
          name: 'M4 다른 프로젝트',
          status: ProjectStatus.IN_PROGRESS,
          workspaceId,
        },
      }),
    ]);
    await database.client.projectRoleTeam.createMany({
      data: [
        { projectId: project.id, role: ProjectRole.BACKEND, teamId, workspaceId },
        {
          projectId: project.id,
          role: ProjectRole.WEB_FRONTEND,
          teamId: otherTeamId,
          workspaceId,
        },
        { projectId: otherProject.id, role: ProjectRole.BACKEND, teamId, workspaceId },
      ],
    });

    const invalidFeature = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        featureStatus: FeatureIssueStatus.TODO,
        projectId: project.id,
        teamId,
        title: '잘못된 기능 이슈',
        type: 'FEATURE',
      })
      .expect(422);
    expect(invalidFeature.body.code).toBe('ISSUE_TYPE_FIELD_INVALID');

    const feature = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        featureStatus: FeatureIssueStatus.TODO,
        priority: IssuePriority.HIGH,
        projectId: project.id,
        title: '결제 흐름',
        type: 'FEATURE',
      })
      .expect(201);
    expect(feature.body).toMatchObject({
      assignee: null,
      identifier: 'F-1',
      progress: { completed: 0, percentage: 0, total: 0 },
      project: { id: project.id, name: 'M4 통합 프로젝트' },
      projectRole: null,
      status: {
        category: StateCategory.UNSTARTED,
        featureStatus: FeatureIssueStatus.TODO,
        workflowState: null,
      },
      team: null,
      type: 'FEATURE',
    });

    const child = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        parentIssueId: feature.body.id,
        projectId: project.id,
        projectRole: ProjectRole.BACKEND,
        teamId,
        title: '결제 API',
        type: 'TEAM_TASK',
      })
      .expect(201);
    expect(child.body).toMatchObject({
      parentIssue: { id: feature.body.id, title: '결제 흐름' },
      project: { id: project.id },
      projectRole: ProjectRole.BACKEND,
      team: { id: teamId },
    });

    const parentProjectMismatch = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        parentIssueId: feature.body.id,
        projectId: otherProject.id,
        projectRole: ProjectRole.BACKEND,
        teamId,
        title: '다른 프로젝트의 하위 작업',
        type: 'TEAM_TASK',
      })
      .expect(422);
    expect(parentProjectMismatch.body.code).toBe('PARENT_ISSUE_PROJECT_MISMATCH');

    const roleMismatch = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        projectId: project.id,
        projectRole: ProjectRole.BACKEND,
        teamId: otherTeamId,
        title: '역할 불일치',
        type: 'TEAM_TASK',
      })
      .expect(422);
    expect(roleMismatch.body.code).toBe('PROJECT_ROLE_TEAM_MISMATCH');

    const hierarchy = await request(app.getHttpServer())
      .get(`/api/v1/issues/${String(feature.body.id)}`)
      .set('Cookie', memberCookie)
      .expect(200);
    expect(hierarchy.body.progress).toEqual({ completed: 0, percentage: 0, total: 1 });

    await request(app.getHttpServer())
      .patch(`/api/v1/issues/${String(child.body.id)}`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({ version: 1, workflowStateId: completedStateId })
      .expect(200);
    const completedHierarchy = await request(app.getHttpServer())
      .get(`/api/v1/issues/${String(feature.body.id)}`)
      .set('Cookie', memberCookie)
      .expect(200);
    expect(completedHierarchy.body.progress).toEqual({ completed: 1, percentage: 100, total: 1 });

    const childProjectImmutable = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${String(child.body.id)}`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({ projectId: otherProject.id, version: 2 })
      .expect(409);
    expect(childProjectImmutable.body.code).toBe('ISSUE_PROJECT_IMMUTABLE');

    const filtered = await request(app.getHttpServer())
      .get('/api/v1/issues')
      .query({ projectId: project.id, projectRole: ProjectRole.BACKEND })
      .set('Cookie', memberCookie)
      .expect(200);
    expect(filtered.body.items.map(({ id }: { id: string }) => id)).toEqual([child.body.id]);

    const firstStatusPage = await request(app.getHttpServer())
      .get('/api/v1/issues')
      .query({ limit: 1, projectId: project.id, sort: 'status', sortDirection: 'asc' })
      .set('Cookie', memberCookie)
      .expect(200);
    expect(firstStatusPage.body.items[0].id).toBe(feature.body.id);
    const secondStatusPage = await request(app.getHttpServer())
      .get('/api/v1/issues')
      .query({
        cursor: firstStatusPage.body.nextCursor,
        limit: 1,
        projectId: project.id,
        sort: 'status',
        sortDirection: 'asc',
      })
      .set('Cookie', memberCookie)
      .expect(200);
    expect(secondStatusPage.body.items[0].id).toBe(child.body.id);

    const featureUpdated = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${String(feature.body.id)}`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({ featureStatus: FeatureIssueStatus.IN_PROGRESS, version: 1 })
      .expect(200);
    expect(featureUpdated.body).toMatchObject({
      status: { category: StateCategory.STARTED, featureStatus: FeatureIssueStatus.IN_PROGRESS },
      version: 2,
    });
    const featureProjectImmutable = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${String(feature.body.id)}`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({ projectId: otherProject.id, version: 2 })
      .expect(409);
    expect(featureProjectImmutable.body.code).toBe('ISSUE_PROJECT_IMMUTABLE');

    const invalidFeatureField = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${String(feature.body.id)}`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({ version: 2, workflowStateId: backlogStateId })
      .expect(422);
    expect(invalidFeatureField.body.code).toBe('ISSUE_TYPE_FIELD_INVALID');

    const concurrentFeatures = await Promise.all(
      ['모바일 결제', '웹 결제'].map((title) =>
        request(app.getHttpServer())
          .post('/api/v1/issues')
          .set('Cookie', adminCookie)
          .set('Origin', WEB_ORIGIN)
          .set('X-CSRF-Token', adminCsrfToken)
          .send({
            featureStatus: FeatureIssueStatus.UNSORTED,
            projectId: project.id,
            title,
            type: 'FEATURE',
          })
          .expect(201),
      ),
    );
    expect(new Set(concurrentFeatures.map(({ body }) => body.identifier))).toEqual(
      new Set(['F-2', 'F-3']),
    );
    await expect(
      database.client.workspace.findUniqueOrThrow({
        select: { nextFeatureIssueNumber: true },
        where: { id: workspaceId },
      }),
    ).resolves.toEqual({ nextFeatureIssueNumber: 4 });
  });

  it('serializes assignment against team removal and membership deactivation', async () => {
    const createRaceIssue = (title: string) =>
      request(app.getHttpServer())
        .post('/api/v1/issues')
        .set('Cookie', adminCookie)
        .set('Origin', WEB_ORIGIN)
        .set('X-CSRF-Token', adminCsrfToken)
        .send({ teamId, title, type: 'TEAM_TASK' })
        .expect(201);

    const removalIssue = await createRaceIssue('팀 제거 경합');
    const [assignDuringRemoval, removeDuringAssignment] = await Promise.all([
      request(app.getHttpServer())
        .patch(`/api/v1/issues/${String(removalIssue.body.id)}`)
        .set('Cookie', adminCookie)
        .set('Origin', WEB_ORIGIN)
        .set('X-CSRF-Token', adminCsrfToken)
        .send({ assigneeMembershipId: removeTargetMembershipId, version: 1 }),
      request(app.getHttpServer())
        .delete(`/api/v1/teams/${teamId}/members/${removeTargetMembershipId}`)
        .set('Cookie', adminCookie)
        .set('Origin', WEB_ORIGIN)
        .set('X-CSRF-Token', adminCsrfToken),
    ]);
    expect([
      [200, 409],
      [422, 204],
    ]).toContainEqual([assignDuringRemoval.status, removeDuringAssignment.status]);
    const removalInvariant = await database.client.issue.findUniqueOrThrow({
      select: { assigneeMembershipId: true },
      where: { id: removalIssue.body.id as string },
    });
    const removedTeamMember = await database.client.teamMember.findUniqueOrThrow({
      select: { removedAt: true },
      where: {
        teamId_membershipId: { membershipId: removeTargetMembershipId, teamId },
      },
    });
    expect(
      removalInvariant.assigneeMembershipId === removeTargetMembershipId &&
        removedTeamMember.removedAt !== null,
    ).toBe(false);

    const deactivationIssue = await createRaceIssue('비활성화 경합');
    const [assignDuringDeactivation, deactivateDuringAssignment] = await Promise.all([
      request(app.getHttpServer())
        .patch(`/api/v1/issues/${String(deactivationIssue.body.id)}`)
        .set('Cookie', adminCookie)
        .set('Origin', WEB_ORIGIN)
        .set('X-CSRF-Token', adminCsrfToken)
        .send({ assigneeMembershipId: deactivateTargetMembershipId, version: 1 }),
      request(app.getHttpServer())
        .post(`/api/v1/members/${deactivateTargetMembershipId}/deactivate`)
        .set('Cookie', adminCookie)
        .set('Origin', WEB_ORIGIN)
        .set('X-CSRF-Token', adminCsrfToken),
    ]);
    expect([
      [200, 409],
      [422, 200],
    ]).toContainEqual([assignDuringDeactivation.status, deactivateDuringAssignment.status]);
    const deactivationInvariant = await database.client.issue.findUniqueOrThrow({
      select: { assigneeMembershipId: true },
      where: { id: deactivationIssue.body.id as string },
    });
    const deactivatedMembership = await database.client.workspaceMembership.findUniqueOrThrow({
      select: { status: true },
      where: { id: deactivateTargetMembershipId },
    });
    expect(
      deactivationInvariant.assigneeMembershipId === deactivateTargetMembershipId &&
        deactivatedMembership.status === MembershipStatus.INACTIVE,
    ).toBe(false);
  });

  it('serializes the first issue number against a concurrent team key change', async () => {
    const [issueResponse, keyResponse] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/issues')
        .set('Cookie', adminCookie)
        .set('Origin', WEB_ORIGIN)
        .set('X-CSRF-Token', adminCsrfToken)
        .send({ teamId: keyRaceTeamId, title: '첫 키 경합 이슈', type: 'TEAM_TASK' }),
      request(app.getHttpServer())
        .patch(`/api/v1/teams/${keyRaceTeamId}`)
        .set('Cookie', adminCookie)
        .set('Origin', WEB_ORIGIN)
        .set('X-CSRF-Token', adminCsrfToken)
        .send({ key: 'NEW', version: 1 }),
    ]);
    expect(issueResponse.status).toBe(201);
    expect([200, 409]).toContain(keyResponse.status);
    if (keyResponse.status === 409) {
      expect(keyResponse.body.code).toBe('TEAM_KEY_LOCKED');
    }

    const finalTeam = await database.client.team.findUniqueOrThrow({
      select: { key: true, nextIssueNumber: true },
      where: { id: keyRaceTeamId },
    });
    expect(finalTeam.nextIssueNumber).toBe(2);
    expect(issueResponse.body.identifier).toBe(`${finalTeam.key}-1`);
  });
});
