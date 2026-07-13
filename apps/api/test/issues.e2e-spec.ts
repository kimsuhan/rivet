import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import {
  FeatureIssueStatus,
  HandoffKind,
  IssuePriority,
  IssueType,
  MembershipRole,
  MembershipStatus,
  ProjectRole,
  ProjectStatus,
  StateCategory,
} from '@rivet/database';
import {
  API_HANDOFF_CREATED,
  type ApiHandoffCreatedOutboxPayload,
  ISSUE_CHANGED,
  ISSUE_CREATED,
} from '@rivet/event-contracts';

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
    const issueId = created.body.issue.id as string;
    expect(created.body.createdTeamTasks).toEqual([]);
    expect(created.body.issue).toMatchObject({
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
    expect(created.body.issue.labels.map(({ id }: { id: string }) => id)).toEqual(
      [labelAId, labelBId].sort(),
    );
    expect(created.body.issue.blockers).toEqual([]);
    expect(created.body.issue.blocking).toEqual([]);
    expect(created.body.issue.attachments).toEqual([]);

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
    expect(new Set(concurrentIssues.map(({ body }) => body.issue.identifier))).toEqual(
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
    expect(mutableCursorPage.body.items[0].id).toBe(cursorTarget.body.issue.id);
    await database.client.issue.update({
      data: { title: '커서 변경 완료', updatedAt: new Date(Date.now() + 60_000) },
      where: { id: cursorTarget.body.issue.id as string },
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
      .patch(`/api/v1/issues/${String(retainedArchivedLabel.body.issue.id)}`)
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
        {
          projectId: project.id,
          role: ProjectRole.APP_FRONTEND,
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

    const invalidTeamTaskRoles = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({ initialRoles: [], teamId, title: '잘못된 팀 작업', type: 'TEAM_TASK' })
      .expect(422);
    expect(invalidTeamTaskRoles.body.code).toBe('ISSUE_TYPE_FIELD_INVALID');

    const feature = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        featureStatus: FeatureIssueStatus.TODO,
        initialRoles: [ProjectRole.BACKEND],
        priority: IssuePriority.HIGH,
        projectId: project.id,
        title: '결제 흐름',
        type: 'FEATURE',
      })
      .expect(201);
    expect(feature.body.issue).toMatchObject({
      assignee: null,
      identifier: 'F-1',
      progress: { completed: 0, percentage: 0, total: 1 },
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
    expect(feature.body.createdTeamTasks).toHaveLength(1);
    const child = feature.body.createdTeamTasks[0] as {
      id: string;
      identifier: string;
      priority: IssuePriority;
      projectRole: ProjectRole;
      title: string;
      version: number;
    };
    expect(child).toMatchObject({
      assignee: null,
      parentIssue: { id: feature.body.issue.id, title: '결제 흐름' },
      priority: IssuePriority.HIGH,
      project: { id: project.id },
      projectRole: ProjectRole.BACKEND,
      team: { id: teamId },
      title: '결제 흐름',
      version: 1,
    });

    const parentProjectMismatch = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        parentIssueId: feature.body.issue.id,
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
      .get(`/api/v1/issues/${String(feature.body.issue.id)}`)
      .set('Cookie', memberCookie)
      .expect(200);
    expect(hierarchy.body.progress).toEqual({ completed: 0, percentage: 0, total: 1 });

    const directInitial = await request(app.getHttpServer())
      .post(`/api/v1/issues/${String(child.id)}/handoffs`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({ bodyMarkdown: handoffBody('직접 최초 전달은 거절됩니다.'), kind: 'INITIAL' })
      .expect(422);
    expect(directInitial.body.code).toBe('HANDOFF_REQUIRES_COMPLETION');
    await expect(
      database.client.apiHandoff.count({ where: { issueId: child.id, workspaceId } }),
    ).resolves.toBe(0);

    const completed = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${String(child.id)}`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        handoff: {
          bodyMarkdown: handoffBody('백엔드 계약과 구현을 전달합니다.'),
          destinationRoles: [ProjectRole.WEB_FRONTEND],
        },
        version: 1,
        workflowStateId: completedStateId,
      })
      .expect(200);
    expect(completed.body).toMatchObject({
      blockRelations: [expect.objectContaining({ blockingIssueId: child.id, resolved: true })],
      downstreamTeamTasks: [
        expect.objectContaining({
          parentIssue: expect.objectContaining({ id: feature.body.issue.id }),
          projectRole: ProjectRole.WEB_FRONTEND,
          team: expect.objectContaining({ id: otherTeamId }),
          title: '결제 흐름',
        }),
      ],
      handoff: expect.objectContaining({ kind: 'INITIAL' }),
      updatedParentIssue: expect.objectContaining({
        id: feature.body.issue.id,
        progress: { completed: 1, percentage: 50, total: 2 },
      }),
    });
    const downstream = completed.body.downstreamTeamTasks[0] as {
      id: string;
      identifier: string;
      projectRole: ProjectRole;
      title: string;
    };
    const handoffOutbox = await database.client.outboxEvent.findFirstOrThrow({
      where: {
        aggregateId: completed.body.handoff.id as string,
        eventType: API_HANDOFF_CREATED,
        workspaceId,
      },
    });
    expect(handoffOutbox.payload as ApiHandoffCreatedOutboxPayload).toEqual({
      candidateRecipientMembershipIds: [adminMembershipId],
      downstreamIssueIds: [downstream.id],
      handoffId: completed.body.handoff.id,
      issueId: child.id,
      kind: 'INITIAL',
      schemaVersion: 1,
    });
    const parentTimeline = await request(app.getHttpServer())
      .get(`/api/v1/issues/${String(feature.body.issue.id)}/timeline`)
      .query({ limit: 100 })
      .set('Cookie', memberCookie)
      .expect(200);
    const deliveredActivities = parentTimeline.body.items.filter(
      ({ activity }: { activity?: { eventType: string } }) =>
        activity?.eventType === 'BACKEND_WORK_DELIVERED',
    );
    expect(deliveredActivities).toHaveLength(1);
    expect(deliveredActivities[0].activity).toMatchObject({
      after: {
        backendIssue: {
          id: child.id,
          identifier: child.identifier,
          title: child.title,
        },
        downstreamIssues: [
          {
            id: downstream.id,
            identifier: downstream.identifier,
            role: downstream.projectRole,
            title: downstream.title,
          },
        ],
        handoffId: completed.body.handoff.id,
        relationIds: [completed.body.blockRelations[0].id],
      },
      eventType: 'BACKEND_WORK_DELIVERED',
      fieldName: null,
    });
    const completedHierarchy = await request(app.getHttpServer())
      .get(`/api/v1/issues/${String(feature.body.issue.id)}`)
      .set('Cookie', memberCookie)
      .expect(200);
    expect(completedHierarchy.body.progress).toEqual({ completed: 1, percentage: 50, total: 2 });

    const retriedCompletion = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${String(child.id)}`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        handoff: {
          bodyMarkdown: handoffBody('백엔드 계약과 구현을 전달합니다.'),
          destinationRoles: [ProjectRole.WEB_FRONTEND],
        },
        version: 1,
        workflowStateId: completedStateId,
      })
      .expect(409);
    expect(retriedCompletion.body).toMatchObject({
      code: 'ISSUE_VERSION_CONFLICT',
      currentVersion: 2,
    });
    const retriedCompletionWithoutHandoff = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${String(child.id)}`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({ version: 1, workflowStateId: completedStateId })
      .expect(409);
    expect(retriedCompletionWithoutHandoff.body).toMatchObject({
      code: 'ISSUE_VERSION_CONFLICT',
      currentVersion: 2,
    });
    await expect(
      database.client.apiHandoff.count({
        where: { issueId: child.id, kind: 'INITIAL', workspaceId },
      }),
    ).resolves.toBe(1);
    await expect(
      database.client.issueBlockRelation.count({
        where: { blockingIssueId: child.id, workspaceId },
      }),
    ).resolves.toBe(1);

    const additionalAppTask = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        assigneeMembershipId: adminMembershipId,
        parentIssueId: feature.body.issue.id,
        projectId: project.id,
        projectRole: ProjectRole.APP_FRONTEND,
        teamId: otherTeamId,
        title: '추가 앱 작업',
        type: IssueType.TEAM_TASK,
      })
      .expect(201);
    const additionalAppTaskId = additionalAppTask.body.issue.id as string;
    const taskCountBeforeFollowUp = await database.client.issue.count({
      where: {
        parentIssueId: feature.body.issue.id,
        type: IssueType.TEAM_TASK,
        workspaceId,
      },
    });
    const followUp = await request(app.getHttpServer())
      .post(`/api/v1/issues/${String(child.id)}/handoffs`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        bodyMarkdown: handoffBody('추가 계약 변경을 전달합니다.'),
        kind: 'FOLLOW_UP',
      })
      .expect(201);
    const followUpOutbox = await database.client.outboxEvent.findFirstOrThrow({
      where: {
        aggregateId: followUp.body.id as string,
        eventType: API_HANDOFF_CREATED,
        workspaceId,
      },
    });
    expect(followUpOutbox.payload as ApiHandoffCreatedOutboxPayload).toMatchObject({
      candidateRecipientMembershipIds: [adminMembershipId],
      downstreamIssueIds: [additionalAppTaskId, downstream.id].sort(),
      issueId: child.id,
      kind: 'FOLLOW_UP',
      schemaVersion: 1,
    });
    await expect(
      database.client.issue.count({
        where: {
          parentIssueId: feature.body.issue.id,
          type: IssueType.TEAM_TASK,
          workspaceId,
        },
      }),
    ).resolves.toBe(taskCountBeforeFollowUp);

    const parentWithHandoffs = await request(app.getHttpServer())
      .get(`/api/v1/issues/${String(feature.body.issue.id)}`)
      .set('Cookie', memberCookie)
      .expect(200);
    expect(parentWithHandoffs.body.handoffFlows).toHaveLength(1);
    expect(parentWithHandoffs.body.handoffFlows[0]).toMatchObject({
      handoffs: [
        expect.objectContaining({
          changeSummary: '백엔드 계약과 구현을 전달합니다.',
          id: completed.body.handoff.id,
          kind: HandoffKind.INITIAL,
          sequenceNumber: 1,
        }),
        expect.objectContaining({
          changeSummary: '추가 계약 변경을 전달합니다.',
          id: followUp.body.id,
          kind: HandoffKind.FOLLOW_UP,
          sequenceNumber: 2,
        }),
      ],
      sourceIssue: expect.objectContaining({ id: child.id, projectRole: ProjectRole.BACKEND }),
    });
    expect(
      new Set(
        parentWithHandoffs.body.handoffFlows[0].downstreamIssues.map(
          ({ id }: { id: string }) => id,
        ),
      ),
    ).toEqual(new Set([downstream.id, additionalAppTaskId]));
    expect(parentWithHandoffs.body.workflowRelations).toEqual([
      expect.objectContaining({
        blockedIssueId: downstream.id,
        blockingIssueId: child.id,
        resolved: true,
      }),
    ]);

    for (const frontendIssueId of [downstream.id, additionalAppTaskId]) {
      const receivedHandoffs = await request(app.getHttpServer())
        .get(`/api/v1/issues/${frontendIssueId}`)
        .set('Cookie', memberCookie)
        .expect(200);
      expect(receivedHandoffs.body.handoffFlows).toEqual([
        expect.objectContaining({
          handoffs: [
            expect.objectContaining({ id: completed.body.handoff.id }),
            expect.objectContaining({ id: followUp.body.id }),
          ],
          sourceIssue: expect.objectContaining({ id: child.id }),
        }),
      ]);
      expect(receivedHandoffs.body.workflowRelations).toEqual([]);
    }

    await database.client.$transaction([
      database.client.activityEvent.deleteMany({
        where: {
          eventType: { in: ['API_HANDOFF_CREATED', 'BACKEND_WORK_DELIVERED'] },
          issueId: { in: [child.id, feature.body.issue.id as string] },
          workspaceId,
        },
      }),
      database.client.issueBlockRelation.deleteMany({
        where: { blockingIssueId: child.id, workspaceId },
      }),
    ]);
    const legacyParentHandoffs = await request(app.getHttpServer())
      .get(`/api/v1/issues/${String(feature.body.issue.id)}`)
      .set('Cookie', memberCookie)
      .expect(200);
    expect(
      new Set(
        legacyParentHandoffs.body.handoffFlows[0].downstreamIssues.map(
          ({ id }: { id: string }) => id,
        ),
      ),
    ).toEqual(new Set([downstream.id, additionalAppTaskId]));
    const legacyFrontendHandoffs = await request(app.getHttpServer())
      .get(`/api/v1/issues/${downstream.id}`)
      .set('Cookie', memberCookie)
      .expect(200);
    expect(legacyFrontendHandoffs.body.handoffFlows).toEqual([
      expect.objectContaining({
        handoffs: [
          expect.objectContaining({ id: completed.body.handoff.id }),
          expect.objectContaining({ id: followUp.body.id }),
        ],
        sourceIssue: expect.objectContaining({ id: child.id }),
      }),
    ]);

    const childProjectImmutable = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${String(child.id)}`)
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
    expect(filtered.body.items.map(({ id }: { id: string }) => id)).toEqual([child.id]);

    const projectIssues = await request(app.getHttpServer())
      .get('/api/v1/issues')
      .query({ limit: 10, projectId: project.id, sort: 'status', sortDirection: 'asc' })
      .set('Cookie', memberCookie)
      .expect(200);
    expect(new Set(projectIssues.body.items.map(({ id }: { id: string }) => id))).toEqual(
      new Set([feature.body.issue.id, child.id, downstream.id, additionalAppTaskId]),
    );

    const featureUpdated = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${String(feature.body.issue.id)}`)
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
      .patch(`/api/v1/issues/${String(feature.body.issue.id)}`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({ projectId: otherProject.id, version: 2 })
      .expect(409);
    expect(featureProjectImmutable.body.code).toBe('ISSUE_PROJECT_IMMUTABLE');

    const invalidFeatureField = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${String(feature.body.issue.id)}`)
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
    expect(new Set(concurrentFeatures.map(({ body }) => body.issue.identifier))).toEqual(
      new Set(['F-2', 'F-3']),
    );
    await expect(
      database.client.workspace.findUniqueOrThrow({
        select: { nextFeatureIssueNumber: true },
        where: { id: workspaceId },
      }),
    ).resolves.toEqual({ nextFeatureIssueNumber: 4 });
  });

  it('creates only selected initial tasks and starts missing roles idempotently', async () => {
    const workspaceId = workspaceIds[0]!;
    const appTeam = await database.client.team.create({
      data: {
        key: 'APP',
        name: `앱 팀 ${runId}`,
        normalizedName: `앱 팀 ${runId}`,
        workspaceId,
      },
    });
    await database.client.teamMember.createMany({
      data: [adminMembershipId, memberMembershipId].map((membershipId) => ({
        membershipId,
        teamId: appTeam.id,
        workspaceId,
      })),
    });
    await database.client.workflowState.create({
      data: {
        category: StateCategory.BACKLOG,
        isDefault: true,
        name: '앱 백로그',
        normalizedName: '앱 백로그',
        position: 0,
        teamId: appTeam.id,
        workspaceId,
      },
    });

    const roleConfigurations = [
      {
        configured: [ProjectRole.BACKEND],
        expected: [],
        initialRoles: undefined,
      },
      {
        configured: [ProjectRole.BACKEND],
        expected: [],
        initialRoles: [],
      },
      {
        configured: [ProjectRole.BACKEND],
        expected: [ProjectRole.BACKEND],
        initialRoles: [ProjectRole.BACKEND],
      },
      {
        configured: [ProjectRole.WEB_FRONTEND],
        expected: [ProjectRole.WEB_FRONTEND],
        initialRoles: [ProjectRole.WEB_FRONTEND],
      },
      {
        configured: [ProjectRole.APP_FRONTEND],
        expected: [ProjectRole.APP_FRONTEND],
        initialRoles: [ProjectRole.APP_FRONTEND],
      },
      {
        configured: [ProjectRole.BACKEND, ProjectRole.WEB_FRONTEND, ProjectRole.APP_FRONTEND],
        expected: [ProjectRole.BACKEND, ProjectRole.WEB_FRONTEND, ProjectRole.APP_FRONTEND],
        initialRoles: [ProjectRole.BACKEND, ProjectRole.WEB_FRONTEND, ProjectRole.APP_FRONTEND],
      },
      {
        configured: [ProjectRole.WEB_FRONTEND, ProjectRole.APP_FRONTEND],
        expected: [ProjectRole.WEB_FRONTEND, ProjectRole.APP_FRONTEND],
        initialRoles: [ProjectRole.WEB_FRONTEND, ProjectRole.APP_FRONTEND],
      },
    ] as const;
    let backendOnlyProjectId = '';
    let frontendOnlyProjectId = '';

    for (const [index, configuration] of roleConfigurations.entries()) {
      const project = await database.client.project.create({
        data: {
          name: `역할 조합 프로젝트 ${index + 1}`,
          status: ProjectStatus.IN_PROGRESS,
          workspaceId,
        },
      });
      await database.client.projectRoleTeam.createMany({
        data: configuration.configured.map((role) => ({
          projectId: project.id,
          role,
          teamId:
            role === ProjectRole.BACKEND
              ? teamId
              : role === ProjectRole.WEB_FRONTEND
                ? otherTeamId
                : appTeam.id,
          workspaceId,
        })),
      });
      if (
        backendOnlyProjectId === '' &&
        configuration.configured.length === 1 &&
        configuration.configured[0] === ProjectRole.BACKEND
      ) {
        backendOnlyProjectId = project.id;
      }
      if (
        configuration.configured.length === 2 &&
        !(configuration.configured as readonly ProjectRole[]).includes(ProjectRole.BACKEND)
      ) {
        frontendOnlyProjectId = project.id;
      }

      const title = `역할 조합 이슈 ${index + 1}`;
      const created = await request(app.getHttpServer())
        .post('/api/v1/issues')
        .set('Cookie', memberCookie)
        .set('Origin', WEB_ORIGIN)
        .set('X-CSRF-Token', memberCsrfToken)
        .send({
          featureStatus: FeatureIssueStatus.TODO,
          ...(configuration.initialRoles === undefined
            ? {}
            : { initialRoles: configuration.initialRoles }),
          priority: IssuePriority.MEDIUM,
          projectId: project.id,
          title,
          type: IssueType.FEATURE,
        })
        .expect(201);

      expect(created.body.issue).toMatchObject({
        priority: IssuePriority.MEDIUM,
        progress: {
          completed: 0,
          percentage: 0,
          total: configuration.expected.length,
        },
        project: { id: project.id },
        title,
        type: IssueType.FEATURE,
      });
      expect(
        created.body.createdTeamTasks.map(
          ({ projectRole }: { projectRole: ProjectRole }) => projectRole,
        ),
      ).toEqual(configuration.expected);
      expect(created.body.createdTeamTasks).toEqual(
        configuration.expected.map((projectRole) =>
          expect.objectContaining({
            assignee: null,
            parentIssue: expect.objectContaining({ id: created.body.issue.id }),
            priority: IssuePriority.MEDIUM,
            projectRole,
            status: expect.objectContaining({ category: StateCategory.BACKLOG }),
            title,
            version: 1,
          }),
        ),
      );
    }

    const backendOnlyIssueCount = await database.client.issue.count({
      where: { projectId: backendOnlyProjectId, workspaceId },
    });
    const unavailableRole = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        featureStatus: FeatureIssueStatus.TODO,
        initialRoles: [ProjectRole.APP_FRONTEND],
        projectId: backendOnlyProjectId,
        title: '설정되지 않은 시작 역할',
        type: IssueType.FEATURE,
      })
      .expect(422);
    expect(unavailableRole.body.code).toBe('INITIAL_ROLE_NOT_AVAILABLE');
    const duplicateRole = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        featureStatus: FeatureIssueStatus.TODO,
        initialRoles: [ProjectRole.BACKEND, ProjectRole.BACKEND],
        projectId: backendOnlyProjectId,
        title: '중복 시작 역할',
        type: IssueType.FEATURE,
      })
      .expect(422);
    expect(duplicateRole.body.code).toBe('VALIDATION_ERROR');
    await expect(
      database.client.issue.count({ where: { projectId: backendOnlyProjectId, workspaceId } }),
    ).resolves.toBe(backendOnlyIssueCount);

    expect(frontendOnlyProjectId).not.toBe('');
    const legacyFeature = await database.client.issue.create({
      data: {
        createdByMembershipId: adminMembershipId,
        featureStatus: FeatureIssueStatus.TODO,
        identifier: `LEGACY-${runId.toUpperCase()}`,
        priority: IssuePriority.HIGH,
        projectId: frontendOnlyProjectId,
        sequenceNumber: 90_000,
        title: '기존 작업 없는 기능 이슈',
        type: IssueType.FEATURE,
        workspaceId,
      },
    });
    const missingStartRole = await request(app.getHttpServer())
      .post(`/api/v1/issues/${legacyFeature.id}/start`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({ initialRoles: [] })
      .expect(422);
    expect(missingStartRole.body.code).toBe('INITIAL_ROLE_REQUIRED');
    const unavailableStartRole = await request(app.getHttpServer())
      .post(`/api/v1/issues/${legacyFeature.id}/start`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({ initialRoles: [ProjectRole.BACKEND] })
      .expect(422);
    expect(unavailableStartRole.body.code).toBe('INITIAL_ROLE_NOT_AVAILABLE');
    const concurrentStarts = await Promise.all(
      [0, 1].map(() =>
        request(app.getHttpServer())
          .post(`/api/v1/issues/${legacyFeature.id}/start`)
          .set('Cookie', memberCookie)
          .set('Origin', WEB_ORIGIN)
          .set('X-CSRF-Token', memberCsrfToken)
          .send({ initialRoles: [ProjectRole.WEB_FRONTEND, ProjectRole.APP_FRONTEND] })
          .expect(200),
      ),
    );
    expect(concurrentStarts.map(({ body }) => body.createdTeamTasks.length).sort()).toEqual([0, 2]);
    expect(
      new Set(
        concurrentStarts.flatMap(({ body }) =>
          body.createdTeamTasks.map(({ projectRole }: { projectRole: ProjectRole }) => projectRole),
        ),
      ),
    ).toEqual(new Set([ProjectRole.WEB_FRONTEND, ProjectRole.APP_FRONTEND]));
    const retriedStart = await request(app.getHttpServer())
      .post(`/api/v1/issues/${legacyFeature.id}/start`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({ initialRoles: [ProjectRole.WEB_FRONTEND, ProjectRole.APP_FRONTEND] })
      .expect(200);
    expect(retriedStart.body.createdTeamTasks).toEqual([]);
    await expect(
      database.client.issue.count({
        where: {
          deletedAt: null,
          parentIssueId: legacyFeature.id,
          type: IssueType.TEAM_TASK,
          workspaceId,
        },
      }),
    ).resolves.toBe(2);

    const partiallyStarted = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        featureStatus: FeatureIssueStatus.TODO,
        initialRoles: [ProjectRole.WEB_FRONTEND],
        projectId: frontendOnlyProjectId,
        title: '일부 역할만 시작한 이슈',
        type: IssueType.FEATURE,
      })
      .expect(201);
    const completedStart = await request(app.getHttpServer())
      .post(`/api/v1/issues/${String(partiallyStarted.body.issue.id)}/start`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({ initialRoles: [ProjectRole.WEB_FRONTEND, ProjectRole.APP_FRONTEND] })
      .expect(200);
    expect(completedStart.body.createdTeamTasks).toEqual([
      expect.objectContaining({ projectRole: ProjectRole.APP_FRONTEND }),
    ]);
    const webCompletedState = await database.client.workflowState.create({
      data: {
        category: StateCategory.COMPLETED,
        name: `웹 완료 ${runId}`,
        normalizedName: `웹 완료 ${runId}`,
        position: 100,
        teamId: otherTeamId,
        workspaceId,
      },
    });
    const firstWebTaskId = partiallyStarted.body.createdTeamTasks[0].id as string;
    await request(app.getHttpServer())
      .patch(`/api/v1/issues/${firstWebTaskId}`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({ version: 1, workflowStateId: webCompletedState.id })
      .expect(200);
    const restartedWeb = await request(app.getHttpServer())
      .post(`/api/v1/issues/${String(partiallyStarted.body.issue.id)}/start`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({ initialRoles: [ProjectRole.WEB_FRONTEND] })
      .expect(200);
    expect(restartedWeb.body.createdTeamTasks).toEqual([
      expect.objectContaining({ projectRole: ProjectRole.WEB_FRONTEND }),
    ]);
    expect(restartedWeb.body.createdTeamTasks[0].id).not.toBe(firstWebTaskId);
  });

  it('rolls back feature creation and role-based start when a later role fails', async () => {
    const workspaceId = workspaceIds[0]!;
    const teamWithoutState = await database.client.team.create({
      data: {
        key: 'BAD',
        name: `기본 상태 없는 팀 ${runId}`,
        normalizedName: `기본 상태 없는 팀 ${runId}`,
        workspaceId,
      },
    });
    const project = await database.client.project.create({
      data: {
        name: '원자성 검증 프로젝트',
        status: ProjectStatus.IN_PROGRESS,
        workspaceId,
      },
    });
    await database.client.projectRoleTeam.createMany({
      data: [
        {
          projectId: project.id,
          role: ProjectRole.WEB_FRONTEND,
          teamId: otherTeamId,
          workspaceId,
        },
        {
          projectId: project.id,
          role: ProjectRole.APP_FRONTEND,
          teamId: teamWithoutState.id,
          workspaceId,
        },
      ],
    });
    const [workspaceBefore, webTeamBefore] = await Promise.all([
      database.client.workspace.findUniqueOrThrow({
        select: { nextFeatureIssueNumber: true },
        where: { id: workspaceId },
      }),
      database.client.team.findUniqueOrThrow({
        select: { nextIssueNumber: true },
        where: { id: otherTeamId },
      }),
    ]);

    const failed = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        featureStatus: FeatureIssueStatus.TODO,
        initialRoles: [ProjectRole.WEB_FRONTEND, ProjectRole.APP_FRONTEND],
        projectId: project.id,
        title: '부분 생성되면 안 되는 이슈',
        type: IssueType.FEATURE,
      })
      .expect(404);
    expect(failed.body.code).toBe('RESOURCE_NOT_FOUND');

    await expect(
      database.client.issue.count({ where: { projectId: project.id, workspaceId } }),
    ).resolves.toBe(0);
    await expect(
      database.client.workspace.findUniqueOrThrow({
        select: { nextFeatureIssueNumber: true },
        where: { id: workspaceId },
      }),
    ).resolves.toEqual(workspaceBefore);
    await expect(
      database.client.team.findUniqueOrThrow({
        select: { nextIssueNumber: true },
        where: { id: otherTeamId },
      }),
    ).resolves.toEqual(webTeamBefore);

    const analysisFeature = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        featureStatus: FeatureIssueStatus.TODO,
        projectId: project.id,
        title: '작업 시작 원자성 검증',
        type: IssueType.FEATURE,
      })
      .expect(201);
    expect(analysisFeature.body.createdTeamTasks).toEqual([]);
    const [webBeforeStart, invalidBeforeStart] = await Promise.all([
      database.client.team.findUniqueOrThrow({
        select: { nextIssueNumber: true },
        where: { id: otherTeamId },
      }),
      database.client.team.findUniqueOrThrow({
        select: { nextIssueNumber: true },
        where: { id: teamWithoutState.id },
      }),
    ]);
    const failedStart = await request(app.getHttpServer())
      .post(`/api/v1/issues/${String(analysisFeature.body.issue.id)}/start`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({ initialRoles: [ProjectRole.WEB_FRONTEND, ProjectRole.APP_FRONTEND] })
      .expect(404);
    expect(failedStart.body.code).toBe('RESOURCE_NOT_FOUND');
    await expect(
      database.client.issue.count({ where: { projectId: project.id, workspaceId } }),
    ).resolves.toBe(1);
    await expect(
      Promise.all([
        database.client.team.findUniqueOrThrow({
          select: { nextIssueNumber: true },
          where: { id: otherTeamId },
        }),
        database.client.team.findUniqueOrThrow({
          select: { nextIssueNumber: true },
          where: { id: teamWithoutState.id },
        }),
      ]),
    ).resolves.toEqual([webBeforeStart, invalidBeforeStart]);
  });

  it('delivers to WEB and APP together with one atomic parent progress update', async () => {
    const workspaceId = workspaceIds[0]!;
    const [webTeam, appTeam] = await Promise.all([
      database.client.team.create({
        data: {
          key: 'DWB',
          name: `동시 전달 웹 팀 ${runId}`,
          normalizedName: `동시 전달 웹 팀 ${runId}`,
          workspaceId,
        },
      }),
      database.client.team.create({
        data: {
          key: 'DAP',
          name: `동시 전달 앱 팀 ${runId}`,
          normalizedName: `동시 전달 앱 팀 ${runId}`,
          workspaceId,
        },
      }),
    ]);
    await database.client.teamMember.createMany({
      data: [
        ...[adminMembershipId, memberMembershipId, removeTargetMembershipId].map(
          (membershipId) => ({ membershipId, teamId: webTeam.id, workspaceId }),
        ),
        ...[adminMembershipId, memberMembershipId, deactivateTargetMembershipId].map(
          (membershipId) => ({ membershipId, teamId: appTeam.id, workspaceId }),
        ),
      ],
    });
    await database.client.workflowState.createMany({
      data: [
        {
          category: StateCategory.BACKLOG,
          isDefault: true,
          name: '동시 전달 웹 백로그',
          normalizedName: '동시 전달 웹 백로그',
          position: 0,
          teamId: webTeam.id,
          workspaceId,
        },
        {
          category: StateCategory.BACKLOG,
          isDefault: true,
          name: '동시 전달 앱 백로그',
          normalizedName: '동시 전달 앱 백로그',
          position: 0,
          teamId: appTeam.id,
          workspaceId,
        },
      ],
    });
    const project = await database.client.project.create({
      data: {
        name: '웹 앱 동시 전달 프로젝트',
        status: ProjectStatus.IN_PROGRESS,
        workspaceId,
      },
    });
    await database.client.projectRoleTeam.createMany({
      data: [
        { projectId: project.id, role: ProjectRole.BACKEND, teamId, workspaceId },
        {
          projectId: project.id,
          role: ProjectRole.WEB_FRONTEND,
          teamId: webTeam.id,
          workspaceId,
        },
        {
          projectId: project.id,
          role: ProjectRole.APP_FRONTEND,
          teamId: appTeam.id,
          workspaceId,
        },
      ],
    });
    const feature = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        featureStatus: FeatureIssueStatus.TODO,
        initialRoles: [ProjectRole.BACKEND],
        priority: IssuePriority.URGENT,
        projectId: project.id,
        title: '웹과 앱 동시 전달',
        type: IssueType.FEATURE,
      })
      .expect(201);
    const backendId = feature.body.createdTeamTasks[0].id as string;
    const completed = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${backendId}`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        handoff: {
          bodyMarkdown: handoffBody('웹과 앱 역할에 함께 전달합니다.'),
          destinationRoles: [ProjectRole.WEB_FRONTEND, ProjectRole.APP_FRONTEND],
        },
        version: 1,
        workflowStateId: completedStateId,
      })
      .expect(200);
    expect(
      new Set(
        completed.body.downstreamTeamTasks.map(
          ({ projectRole }: { projectRole: ProjectRole }) => projectRole,
        ),
      ),
    ).toEqual(new Set([ProjectRole.WEB_FRONTEND, ProjectRole.APP_FRONTEND]));
    expect(completed.body.blockRelations).toHaveLength(2);
    expect(completed.body.updatedParentIssue.progress).toEqual({
      completed: 1,
      percentage: 33,
      total: 3,
    });
    const downstreamIds = completed.body.downstreamTeamTasks
      .map(({ id }: { id: string }) => id)
      .sort();
    const outbox = await database.client.outboxEvent.findFirstOrThrow({
      where: {
        aggregateId: completed.body.handoff.id as string,
        eventType: API_HANDOFF_CREATED,
        workspaceId,
      },
    });
    expect(outbox.payload as ApiHandoffCreatedOutboxPayload).toEqual({
      candidateRecipientMembershipIds: [
        adminMembershipId,
        deactivateTargetMembershipId,
        removeTargetMembershipId,
      ].sort(),
      downstreamIssueIds: downstreamIds,
      handoffId: completed.body.handoff.id,
      issueId: backendId,
      kind: 'INITIAL',
      schemaVersion: 1,
    });
  });

  it('reuses every open downstream task and serializes concurrent backend deliveries', async () => {
    const workspaceId = workspaceIds[0]!;
    await database.client.teamMember.create({
      data: {
        membershipId: removeTargetMembershipId,
        teamId: otherTeamId,
        workspaceId,
      },
    });
    const reuseProject = await database.client.project.create({
      data: {
        name: '기존 후행 작업 재사용 프로젝트',
        status: ProjectStatus.IN_PROGRESS,
        workspaceId,
      },
    });
    await database.client.projectRoleTeam.createMany({
      data: [
        {
          projectId: reuseProject.id,
          role: ProjectRole.BACKEND,
          teamId,
          workspaceId,
        },
        {
          projectId: reuseProject.id,
          role: ProjectRole.WEB_FRONTEND,
          teamId: otherTeamId,
          workspaceId,
        },
      ],
    });
    const reusableFeature = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        featureStatus: FeatureIssueStatus.TODO,
        initialRoles: [ProjectRole.BACKEND, ProjectRole.WEB_FRONTEND],
        projectId: reuseProject.id,
        title: '기존 웹 작업 재사용',
        type: IssueType.FEATURE,
      })
      .expect(201);
    const reusableBackendId = reusableFeature.body.createdTeamTasks.find(
      ({ projectRole }: { projectRole: ProjectRole }) => projectRole === ProjectRole.BACKEND,
    ).id as string;
    const initiallyParallelWebId = reusableFeature.body.createdTeamTasks.find(
      ({ projectRole }: { projectRole: ProjectRole }) => projectRole === ProjectRole.WEB_FRONTEND,
    ).id as string;
    const existingWebTasks = await Promise.all(
      ['기존 웹 작업 A', '기존 웹 작업 B'].map((title, index) =>
        request(app.getHttpServer())
          .post('/api/v1/issues')
          .set('Cookie', memberCookie)
          .set('Origin', WEB_ORIGIN)
          .set('X-CSRF-Token', memberCsrfToken)
          .send({
            ...(index === 0 ? { assigneeMembershipId: adminMembershipId } : {}),
            parentIssueId: reusableFeature.body.issue.id,
            projectId: reuseProject.id,
            projectRole: ProjectRole.WEB_FRONTEND,
            teamId: otherTeamId,
            title,
            type: IssueType.TEAM_TASK,
          })
          .expect(201),
      ),
    );
    const existingWebTaskIds = [
      initiallyParallelWebId,
      ...existingWebTasks.map(({ body }) => body.issue.id as string),
    ].sort();
    const reuseCompletion = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${reusableBackendId}`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        handoff: {
          bodyMarkdown: handoffBody('기존 웹 작업 두 건에 전달합니다.'),
          destinationRoles: [ProjectRole.WEB_FRONTEND],
        },
        version: 1,
        workflowStateId: completedStateId,
      })
      .expect(200);
    expect(
      reuseCompletion.body.downstreamTeamTasks.map(({ id }: { id: string }) => id).sort(),
    ).toEqual(existingWebTaskIds);
    expect(reuseCompletion.body.blockRelations).toEqual([]);
    const reuseHandoffOutbox = await database.client.outboxEvent.findFirstOrThrow({
      where: {
        aggregateId: reuseCompletion.body.handoff.id as string,
        eventType: API_HANDOFF_CREATED,
        workspaceId,
      },
    });
    expect(reuseHandoffOutbox.payload as ApiHandoffCreatedOutboxPayload).toMatchObject({
      candidateRecipientMembershipIds: [adminMembershipId],
      downstreamIssueIds: existingWebTaskIds,
      issueId: reusableBackendId,
      kind: 'INITIAL',
      schemaVersion: 1,
    });
    await expect(
      database.client.issue.count({
        where: {
          parentIssueId: reusableFeature.body.issue.id,
          type: IssueType.TEAM_TASK,
          workspaceId,
        },
      }),
    ).resolves.toBe(4);
    await expect(
      database.client.issueBlockRelation.count({
        where: { blockingIssueId: reusableBackendId, workspaceId },
      }),
    ).resolves.toBe(0);

    const concurrentProject = await database.client.project.create({
      data: {
        name: '동시 전달 직렬화 프로젝트',
        status: ProjectStatus.IN_PROGRESS,
        workspaceId,
      },
    });
    await database.client.projectRoleTeam.createMany({
      data: [
        {
          projectId: concurrentProject.id,
          role: ProjectRole.BACKEND,
          teamId,
          workspaceId,
        },
        {
          projectId: concurrentProject.id,
          role: ProjectRole.WEB_FRONTEND,
          teamId: otherTeamId,
          workspaceId,
        },
      ],
    });
    const concurrentFeature = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        featureStatus: FeatureIssueStatus.TODO,
        initialRoles: [ProjectRole.BACKEND],
        projectId: concurrentProject.id,
        title: '동시 백엔드 전달',
        type: IssueType.FEATURE,
      })
      .expect(201);
    const secondBackend = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        parentIssueId: concurrentFeature.body.issue.id,
        projectId: concurrentProject.id,
        projectRole: ProjectRole.BACKEND,
        teamId,
        title: '두 번째 백엔드 작업',
        type: IssueType.TEAM_TASK,
      })
      .expect(201);
    const backendIds = [
      concurrentFeature.body.createdTeamTasks[0].id as string,
      secondBackend.body.issue.id as string,
    ];
    const concurrentCompletions = await Promise.all(
      backendIds.map((backendId, index) =>
        request(app.getHttpServer())
          .patch(`/api/v1/issues/${backendId}`)
          .set('Cookie', memberCookie)
          .set('Origin', WEB_ORIGIN)
          .set('X-CSRF-Token', memberCsrfToken)
          .send({
            handoff: {
              bodyMarkdown: handoffBody(`동시 백엔드 전달 ${index + 1}`),
              destinationRoles: [ProjectRole.WEB_FRONTEND],
            },
            version: 1,
            workflowStateId: completedStateId,
          })
          .expect(200),
      ),
    );
    const concurrentDownstreamIds = concurrentCompletions.map(
      ({ body }) => body.downstreamTeamTasks[0].id as string,
    );
    expect(new Set(concurrentDownstreamIds).size).toBe(1);
    const concurrentHandoffOutboxes = await database.client.outboxEvent.findMany({
      where: {
        aggregateId: {
          in: concurrentCompletions.map(({ body }) => body.handoff.id as string),
        },
        eventType: API_HANDOFF_CREATED,
        workspaceId,
      },
    });
    expect(
      concurrentHandoffOutboxes
        .map(
          ({ payload }) =>
            (payload as ApiHandoffCreatedOutboxPayload).candidateRecipientMembershipIds,
        )
        .sort((left, right) => left.length - right.length),
    ).toEqual([[], [adminMembershipId, removeTargetMembershipId].sort()]);
    await expect(
      database.client.issue.count({
        where: {
          parentIssueId: concurrentFeature.body.issue.id,
          projectRole: ProjectRole.WEB_FRONTEND,
          type: IssueType.TEAM_TASK,
          workspaceId,
        },
      }),
    ).resolves.toBe(1);
    await expect(
      database.client.issueBlockRelation.count({
        where: {
          blockedIssueId: concurrentDownstreamIds[0]!,
          blockingIssueId: { in: backendIds },
          workspaceId,
        },
      }),
    ).resolves.toBe(1);
  });

  it('rolls back backend completion when handoff validation or downstream creation fails', async () => {
    const workspaceId = workspaceIds[0]!;
    const invalidFrontendTeam = await database.client.team.create({
      data: {
        key: 'ERR',
        name: `전달 실패 팀 ${runId}`,
        normalizedName: `전달 실패 팀 ${runId}`,
        workspaceId,
      },
    });
    const project = await database.client.project.create({
      data: {
        name: '전달 원자성 검증 프로젝트',
        status: ProjectStatus.IN_PROGRESS,
        workspaceId,
      },
    });
    await database.client.projectRoleTeam.createMany({
      data: [
        {
          projectId: project.id,
          role: ProjectRole.BACKEND,
          teamId,
          workspaceId,
        },
        {
          projectId: project.id,
          role: ProjectRole.WEB_FRONTEND,
          teamId: invalidFrontendTeam.id,
          workspaceId,
        },
      ],
    });
    const feature = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        featureStatus: FeatureIssueStatus.TODO,
        initialRoles: [ProjectRole.BACKEND],
        projectId: project.id,
        title: '실패해도 완료되지 않는 백엔드',
        type: IssueType.FEATURE,
      })
      .expect(201);
    const backendId = feature.body.createdTeamTasks[0].id as string;

    const missingHandoff = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${backendId}`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({ version: 1, workflowStateId: completedStateId })
      .expect(409);
    expect(missingHandoff.body.code).toBe('HANDOFF_REQUIRED');

    const missingDestination = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${backendId}`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        handoff: { bodyMarkdown: handoffBody('전달 대상이 없습니다.') },
        version: 1,
        workflowStateId: completedStateId,
      })
      .expect(422);
    expect(missingDestination.body.code).toBe('HANDOFF_DESTINATION_REQUIRED');

    const unsupportedDestination = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${backendId}`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        handoff: {
          bodyMarkdown: handoffBody('설정되지 않은 앱 역할입니다.'),
          destinationRoles: [ProjectRole.APP_FRONTEND],
        },
        version: 1,
        workflowStateId: completedStateId,
      })
      .expect(422);
    expect(unsupportedDestination.body.code).toBe('PROJECT_FRONTEND_ROLE_REQUIRED');

    const failedCreation = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${backendId}`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        handoff: {
          bodyMarkdown: handoffBody('후행 작업 생성 중 실패합니다.'),
          destinationRoles: [ProjectRole.WEB_FRONTEND],
        },
        version: 1,
        workflowStateId: completedStateId,
      })
      .expect(404);
    expect(failedCreation.body.code).toBe('RESOURCE_NOT_FOUND');

    await expect(
      database.client.issue.findUniqueOrThrow({
        select: {
          version: true,
          workflowState: { select: { category: true } },
        },
        where: { id: backendId },
      }),
    ).resolves.toEqual({
      version: 1,
      workflowState: { category: StateCategory.BACKLOG },
    });
    await expect(
      database.client.issue.count({
        where: {
          parentIssueId: feature.body.issue.id,
          type: IssueType.TEAM_TASK,
          workspaceId,
        },
      }),
    ).resolves.toBe(1);
    await expect(
      database.client.apiHandoff.count({ where: { issueId: backendId, workspaceId } }),
    ).resolves.toBe(0);
    await expect(
      database.client.issueBlockRelation.count({
        where: { blockingIssueId: backendId, workspaceId },
      }),
    ).resolves.toBe(0);
    await expect(
      database.client.team.findUniqueOrThrow({
        select: { nextIssueNumber: true },
        where: { id: invalidFrontendTeam.id },
      }),
    ).resolves.toEqual({ nextIssueNumber: 1 });
  });

  it('reports closed and scope-conflicting downstream tasks without changing the backend task', async () => {
    const workspaceId = workspaceIds[0]!;
    const otherTeamCompletedState = await database.client.workflowState.create({
      data: {
        category: StateCategory.COMPLETED,
        name: '다른 팀 완료',
        normalizedName: '다른 팀 완료',
        position: 10,
        teamId: otherTeamId,
        workspaceId,
      },
    });
    const closedProject = await database.client.project.create({
      data: {
        name: '닫힌 후행 작업 프로젝트',
        status: ProjectStatus.IN_PROGRESS,
        workspaceId,
      },
    });
    await database.client.projectRoleTeam.createMany({
      data: [
        {
          projectId: closedProject.id,
          role: ProjectRole.BACKEND,
          teamId,
          workspaceId,
        },
        {
          projectId: closedProject.id,
          role: ProjectRole.WEB_FRONTEND,
          teamId: otherTeamId,
          workspaceId,
        },
      ],
    });
    const closedFeature = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        featureStatus: FeatureIssueStatus.TODO,
        initialRoles: [ProjectRole.BACKEND],
        projectId: closedProject.id,
        title: '닫힌 웹 작업이 있는 이슈',
        type: IssueType.FEATURE,
      })
      .expect(201);
    const closedBackendId = closedFeature.body.createdTeamTasks[0].id as string;
    const closedWeb = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        parentIssueId: closedFeature.body.issue.id,
        projectId: closedProject.id,
        projectRole: ProjectRole.WEB_FRONTEND,
        teamId: otherTeamId,
        title: '이미 완료된 웹 작업',
        type: IssueType.TEAM_TASK,
      })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/issues/${String(closedWeb.body.issue.id)}`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({ version: 1, workflowStateId: otherTeamCompletedState.id })
      .expect(200);

    const closedConflict = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${closedBackendId}`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        handoff: {
          bodyMarkdown: handoffBody('닫힌 웹 작업에는 전달할 수 없습니다.'),
          destinationRoles: [ProjectRole.WEB_FRONTEND],
        },
        version: 1,
        workflowStateId: completedStateId,
      })
      .expect(409);
    expect(closedConflict.body).toMatchObject({
      code: 'DOWNSTREAM_TASK_ALREADY_CLOSED',
      details: {
        issues: [
          expect.objectContaining({
            category: StateCategory.COMPLETED,
            id: closedWeb.body.issue.id,
            projectRole: ProjectRole.WEB_FRONTEND,
          }),
        ],
      },
    });
    await expect(
      database.client.issue.findUniqueOrThrow({
        select: { version: true, workflowState: { select: { category: true } } },
        where: { id: closedBackendId },
      }),
    ).resolves.toEqual({
      version: 1,
      workflowState: { category: StateCategory.BACKLOG },
    });
    await expect(
      database.client.apiHandoff.count({ where: { issueId: closedBackendId, workspaceId } }),
    ).resolves.toBe(0);
    await expect(
      database.client.issueBlockRelation.count({
        where: { blockingIssueId: closedBackendId, workspaceId },
      }),
    ).resolves.toBe(0);

    const scopeProject = await database.client.project.create({
      data: {
        name: '범위 불일치 후행 작업 프로젝트',
        status: ProjectStatus.IN_PROGRESS,
        workspaceId,
      },
    });
    await database.client.projectRoleTeam.createMany({
      data: [
        {
          projectId: scopeProject.id,
          role: ProjectRole.BACKEND,
          teamId,
          workspaceId,
        },
        {
          projectId: scopeProject.id,
          role: ProjectRole.WEB_FRONTEND,
          teamId: otherTeamId,
          workspaceId,
        },
      ],
    });
    const scopeFeature = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        featureStatus: FeatureIssueStatus.TODO,
        initialRoles: [ProjectRole.BACKEND],
        projectId: scopeProject.id,
        title: '범위 불일치 웹 작업이 있는 이슈',
        type: IssueType.FEATURE,
      })
      .expect(201);
    const scopeBackendId = scopeFeature.body.createdTeamTasks[0].id as string;
    const scopeConflictTaskResponse = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        parentIssueId: scopeFeature.body.issue.id,
        projectId: scopeProject.id,
        projectRole: ProjectRole.WEB_FRONTEND,
        teamId: otherTeamId,
        title: '팀 범위가 깨진 기존 웹 작업',
        type: IssueType.TEAM_TASK,
      })
      .expect(201);
    const scopeConflictTaskId = scopeConflictTaskResponse.body.issue.id as string;
    await database.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await transaction.$executeRaw`
        UPDATE "issues"
        SET
          "sequence_number" = 95000,
          "team_id" = ${teamId}::uuid,
          "workflow_state_id" = ${backlogStateId}::uuid
        WHERE "id" = ${scopeConflictTaskId}::uuid
      `;
    });
    const scopeConflict = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${scopeBackendId}`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        handoff: {
          bodyMarkdown: handoffBody('범위가 맞지 않아 전달할 수 없습니다.'),
          destinationRoles: [ProjectRole.WEB_FRONTEND],
        },
        version: 1,
        workflowStateId: completedStateId,
      })
      .expect(409);
    expect(scopeConflict.body).toMatchObject({
      code: 'DOWNSTREAM_TASK_SCOPE_CONFLICT',
      details: {
        issues: [
          expect.objectContaining({
            id: scopeConflictTaskId,
            projectRole: ProjectRole.WEB_FRONTEND,
            teamId,
          }),
        ],
      },
    });
    await expect(
      database.client.issue.findUniqueOrThrow({
        select: { version: true, workflowState: { select: { category: true } } },
        where: { id: scopeBackendId },
      }),
    ).resolves.toEqual({
      version: 1,
      workflowState: { category: StateCategory.BACKLOG },
    });
    await expect(
      database.client.apiHandoff.count({ where: { issueId: scopeBackendId, workspaceId } }),
    ).resolves.toBe(0);
    await expect(
      database.client.issueBlockRelation.count({
        where: { blockingIssueId: scopeBackendId, workspaceId },
      }),
    ).resolves.toBe(0);
  });

  it('lists feature work queues with workflow summaries and stable progress cursors', async () => {
    const workspaceId = workspaceIds[0]!;
    const project = await database.client.project.create({
      data: {
        name: `전역 이슈 목록 ${runId}`,
        status: ProjectStatus.IN_PROGRESS,
        workspaceId,
      },
    });
    await database.client.projectRoleTeam.createMany({
      data: [
        { projectId: project.id, role: ProjectRole.BACKEND, teamId, workspaceId },
        {
          projectId: project.id,
          role: ProjectRole.WEB_FRONTEND,
          teamId: otherTeamId,
          workspaceId,
        },
      ],
    });
    const canceledState = await database.client.workflowState.create({
      data: {
        category: StateCategory.CANCELED,
        name: `전역 이슈 취소 ${runId}`,
        normalizedName: `전역 이슈 취소 ${runId}`,
        position: 500_000,
        teamId,
        workspaceId,
      },
    });
    const featureIds = {
      assigned: randomUUID(),
      canceledOnly: randomUUID(),
      completed: randomUUID(),
      completedOnly: randomUUID(),
      deletedOnly: randomUUID(),
      done: randomUUID(),
      review: randomUUID(),
      unassigned: randomUUID(),
    };
    const features = [
      [featureIds.review, FeatureIssueStatus.TODO, '검토 필요'],
      [featureIds.canceledOnly, FeatureIssueStatus.TODO, '취소 이력만 있음'],
      [featureIds.completedOnly, FeatureIssueStatus.REVIEW, '완료 확인 단일'],
      [featureIds.unassigned, FeatureIssueStatus.IN_PROGRESS, '담당 필요 검색 대상'],
      [featureIds.assigned, FeatureIssueStatus.IN_PROGRESS, '담당 완료 진행'],
      [featureIds.completed, FeatureIssueStatus.REVIEW, '완료와 취소 혼합'],
      [featureIds.done, FeatureIssueStatus.DONE, '상위 이슈 완료'],
      [featureIds.deletedOnly, FeatureIssueStatus.TODO, '삭제 작업만 있음'],
    ] as const;
    await database.client.issue.createMany({
      data: features.map(([id, featureStatus, title], index) => ({
        createdByMembershipId: adminMembershipId,
        featureStatus,
        id,
        identifier: `GQF-${runId}-${index}`,
        priority: IssuePriority.MEDIUM,
        projectId: project.id,
        sequenceNumber: 500_000 + index,
        title,
        type: IssueType.FEATURE,
        workspaceId,
      })),
    });
    const childIds = {
      assigned: randomUUID(),
      canceled: randomUUID(),
      completed: randomUUID(),
      completedOnly: randomUUID(),
      deleted: randomUUID(),
      unassigned: randomUUID(),
    };
    const deletedAt = new Date();
    const childSpecs = [
      {
        assigneeMembershipId: null,
        id: childIds.canceled,
        parentIssueId: featureIds.canceledOnly,
        workflowStateId: canceledState.id,
      },
      {
        assigneeMembershipId: null,
        id: childIds.completedOnly,
        parentIssueId: featureIds.completedOnly,
        workflowStateId: completedStateId,
      },
      {
        assigneeMembershipId: null,
        id: childIds.unassigned,
        parentIssueId: featureIds.unassigned,
        workflowStateId: backlogStateId,
      },
      {
        assigneeMembershipId: adminMembershipId,
        id: childIds.assigned,
        parentIssueId: featureIds.assigned,
        workflowStateId: startedStateId,
      },
      {
        assigneeMembershipId: null,
        id: childIds.completed,
        parentIssueId: featureIds.completed,
        workflowStateId: completedStateId,
      },
      {
        assigneeMembershipId: null,
        id: randomUUID(),
        parentIssueId: featureIds.completed,
        workflowStateId: canceledState.id,
      },
      {
        assigneeMembershipId: null,
        id: childIds.deleted,
        parentIssueId: featureIds.deletedOnly,
        workflowStateId: backlogStateId,
      },
    ];
    await database.client.issue.createMany({
      data: childSpecs.map(
        ({ assigneeMembershipId, id, parentIssueId, workflowStateId }, index) => ({
          ...(id === childIds.deleted
            ? {
                deletedAt,
                deletedByMembershipId: adminMembershipId,
                purgeAt: new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1_000),
              }
            : {}),
          assigneeMembershipId,
          createdByMembershipId: adminMembershipId,
          id,
          identifier: `GQT-${runId}-${index}`,
          parentIssueId,
          projectId: project.id,
          projectRole: ProjectRole.BACKEND,
          sequenceNumber: 500_000 + index,
          teamId,
          title: `전역 이슈 하위 ${index}`,
          type: IssueType.TEAM_TASK,
          workflowStateId,
          workspaceId,
        }),
      ),
    });

    const queueIds = async (workQueue: string): Promise<string[]> => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/issues')
        .query({ limit: 100, projectId: project.id, type: IssueType.FEATURE, workQueue })
        .set('Cookie', adminCookie)
        .expect(200);
      expect(response.body.totalCount).toBe(response.body.items.length);
      expect(response.body.workQueueCounts).toEqual({
        ALL: 8,
        ASSIGNMENT_REQUIRED: 1,
        COMPLETED: 1,
        COMPLETION_REQUIRED: 2,
        IN_PROGRESS: 2,
        REVIEW_REQUIRED: 2,
      });
      return response.body.items.map(({ id }: { id: string }) => id).sort();
    };
    expect(await queueIds('REVIEW_REQUIRED')).toEqual(
      [featureIds.review, featureIds.deletedOnly].sort(),
    );
    expect(await queueIds('ASSIGNMENT_REQUIRED')).toEqual([featureIds.unassigned]);
    expect(await queueIds('IN_PROGRESS')).toEqual(
      [featureIds.assigned, featureIds.unassigned].sort(),
    );
    expect(await queueIds('COMPLETION_REQUIRED')).toEqual(
      [featureIds.completed, featureIds.completedOnly].sort(),
    );
    expect(await queueIds('COMPLETED')).toEqual([featureIds.done]);
    const implicitFeatureQueue = await request(app.getHttpServer())
      .get('/api/v1/issues')
      .query({ limit: 100, projectId: project.id, workQueue: 'IN_PROGRESS' })
      .set('Cookie', adminCookie)
      .expect(200);
    expect(implicitFeatureQueue.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: featureIds.assigned, type: IssueType.FEATURE }),
        expect.objectContaining({ id: featureIds.unassigned, type: IssueType.FEATURE }),
      ]),
    );
    expect(implicitFeatureQueue.body.totalCount).toBe(2);
    expect(implicitFeatureQueue.body.workQueueCounts.ALL).toBe(8);

    const filtered = await request(app.getHttpServer())
      .get('/api/v1/issues')
      .query({
        activeProjectRole: ProjectRole.BACKEND,
        createdByMembershipId: adminMembershipId,
        projectId: project.id,
        query: '담당 필요',
        type: IssueType.FEATURE,
        unassigned: 'true',
        workQueue: 'ASSIGNMENT_REQUIRED',
      })
      .set('Cookie', adminCookie)
      .expect(200);
    expect(filtered.body.totalCount).toBe(1);
    expect(filtered.body.workQueueCounts).toEqual({
      ALL: 1,
      ASSIGNMENT_REQUIRED: 1,
      COMPLETED: 0,
      COMPLETION_REQUIRED: 0,
      IN_PROGRESS: 1,
      REVIEW_REQUIRED: 0,
    });
    expect(filtered.body.items).toEqual([
      expect.objectContaining({
        createdBy: expect.objectContaining({ id: adminMembershipId }),
        id: featureIds.unassigned,
        workflowSummary: expect.objectContaining({
          activeRoleTeams: [
            expect.objectContaining({
              projectRole: ProjectRole.BACKEND,
              team: expect.objectContaining({ id: teamId }),
              unassignedCount: 1,
            }),
          ],
          activeRoles: [ProjectRole.BACKEND],
          allTargetTasksCompleted: false,
          canceledCount: 0,
          completedCount: 0,
          currentUserTeamRoles: [ProjectRole.BACKEND, ProjectRole.WEB_FRONTEND],
          teamTaskCount: 1,
          unassignedCount: 1,
        }),
      }),
    ]);

    const assigned = await request(app.getHttpServer())
      .get('/api/v1/issues')
      .query({ projectId: project.id, query: '담당 완료', type: IssueType.FEATURE })
      .set('Cookie', adminCookie)
      .expect(200);
    expect(assigned.body.items[0].workflowSummary.currentUserAssignedTeamTasks).toEqual([
      {
        id: childIds.assigned,
        identifier: expect.any(String),
        projectRole: ProjectRole.BACKEND,
      },
    ]);

    const isolationTitle = `전역 FEATURE 격리 ${runId}`;
    const isolationProject = await database.client.project.create({
      data: {
        name: isolationTitle,
        status: ProjectStatus.IN_PROGRESS,
        workspaceId,
      },
    });
    const [visibleFeature, deletedFeature] = await Promise.all([
      database.client.issue.create({
        data: {
          createdByMembershipId: adminMembershipId,
          featureStatus: FeatureIssueStatus.TODO,
          identifier: `ISO-${runId}-VISIBLE`,
          projectId: isolationProject.id,
          sequenceNumber: 700_001,
          title: isolationTitle,
          type: IssueType.FEATURE,
          workspaceId,
        },
      }),
      database.client.issue.create({
        data: {
          createdByMembershipId: adminMembershipId,
          deletedAt,
          deletedByMembershipId: adminMembershipId,
          featureStatus: FeatureIssueStatus.TODO,
          identifier: `ISO-${runId}-DELETED`,
          projectId: isolationProject.id,
          purgeAt: new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1_000),
          sequenceNumber: 700_002,
          title: isolationTitle,
          type: IssueType.FEATURE,
          workspaceId,
        },
      }),
    ]);
    await database.client.issue.create({
      data: {
        createdByMembershipId: adminMembershipId,
        identifier: `ISO-${runId}-TASK`,
        sequenceNumber: 700_003,
        teamId,
        title: isolationTitle,
        type: IssueType.TEAM_TASK,
        workflowStateId: backlogStateId,
        workspaceId,
      },
    });
    const foreignMembership = await database.client.workspaceMembership.findFirstOrThrow({
      where: { workspaceId: workspaceIds[1]! },
    });
    const foreignProject = await database.client.project.create({
      data: {
        name: isolationTitle,
        status: ProjectStatus.IN_PROGRESS,
        workspaceId: workspaceIds[1]!,
      },
    });
    await database.client.issue.create({
      data: {
        createdByMembershipId: foreignMembership.id,
        featureStatus: FeatureIssueStatus.TODO,
        identifier: `ISO-${runId}-FOREIGN`,
        projectId: foreignProject.id,
        sequenceNumber: 700_001,
        title: isolationTitle,
        type: IssueType.FEATURE,
        workspaceId: workspaceIds[1]!,
      },
    });
    const isolated = await request(app.getHttpServer())
      .get('/api/v1/issues')
      .query({ limit: 100, query: isolationTitle, type: IssueType.FEATURE })
      .set('Cookie', adminCookie)
      .expect(200);
    expect(isolated.body).toMatchObject({
      items: [expect.objectContaining({ id: visibleFeature.id, type: IssueType.FEATURE })],
      totalCount: 1,
      workQueueCounts: {
        ALL: 1,
        ASSIGNMENT_REQUIRED: 0,
        COMPLETED: 0,
        COMPLETION_REQUIRED: 0,
        IN_PROGRESS: 0,
        REVIEW_REQUIRED: 1,
      },
    });
    expect(isolated.body.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: deletedFeature.id })]),
    );

    const progressOrder = await collectIssueIds({
      limit: 2,
      projectId: project.id,
      sort: 'progress',
      sortDirection: 'asc',
      type: IssueType.FEATURE,
    });
    expect(progressOrder).toEqual([
      ...[
        featureIds.assigned,
        featureIds.canceledOnly,
        featureIds.deletedOnly,
        featureIds.done,
        featureIds.review,
        featureIds.unassigned,
      ].sort(),
      ...[featureIds.completed, featureIds.completedOnly].sort(),
    ]);
  });

  it('starts roles with assignees while preserving legacy and current-team boundaries', async () => {
    const workspaceId = workspaceIds[0]!;
    const project = await database.client.project.create({
      data: {
        name: `역할별 배정 ${runId}`,
        status: ProjectStatus.IN_PROGRESS,
        workspaceId,
      },
    });
    await database.client.projectRoleTeam.createMany({
      data: [
        { projectId: project.id, role: ProjectRole.BACKEND, teamId, workspaceId },
        {
          projectId: project.id,
          role: ProjectRole.WEB_FRONTEND,
          teamId: otherTeamId,
          workspaceId,
        },
      ],
    });
    const feature = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({
        featureStatus: FeatureIssueStatus.TODO,
        projectId: project.id,
        title: '역할별 담당자 지정',
        type: IssueType.FEATURE,
      })
      .expect(201);
    const featureId = feature.body.issue.id as string;

    const mixedContract = await request(app.getHttpServer())
      .post(`/api/v1/issues/${featureId}/start`)
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({
        initialRoles: [ProjectRole.BACKEND],
        roleAssignments: [
          { assigneeMembershipId: adminMembershipId, projectRole: ProjectRole.BACKEND },
        ],
      })
      .expect(422);
    expect(mixedContract.body.code).toBe('INITIAL_ROLE_INPUT_CONFLICT');

    const started = await request(app.getHttpServer())
      .post(`/api/v1/issues/${featureId}/start`)
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({
        roleAssignments: [
          { assigneeMembershipId: adminMembershipId, projectRole: ProjectRole.BACKEND },
          { assigneeMembershipId: null, projectRole: ProjectRole.WEB_FRONTEND },
        ],
      })
      .expect(200);
    expect(started.body.issue).toMatchObject({
      version: 2,
      workflowSummary: {
        activeRoles: [ProjectRole.BACKEND, ProjectRole.WEB_FRONTEND],
        completedCount: 0,
        currentUserAssignedTeamTasks: [
          expect.objectContaining({ projectRole: ProjectRole.BACKEND }),
        ],
        teamTaskCount: 2,
        unassignedCount: 1,
      },
    });
    expect(started.body.createdTeamTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assignee: expect.objectContaining({ id: adminMembershipId }),
          projectRole: ProjectRole.BACKEND,
        }),
        expect.objectContaining({ assignee: null, projectRole: ProjectRole.WEB_FRONTEND }),
      ]),
    );

    const idempotent = await request(app.getHttpServer())
      .post(`/api/v1/issues/${featureId}/start`)
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({
        roleAssignments: [
          { assigneeMembershipId: adminMembershipId, projectRole: ProjectRole.BACKEND },
        ],
      })
      .expect(200);
    expect(idempotent.body.createdTeamTasks).toEqual([]);
    expect(idempotent.body.issue.version).toBe(2);

    const staleAssignment = await request(app.getHttpServer())
      .post(`/api/v1/issues/${featureId}/start`)
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({
        roleAssignments: [
          { assigneeMembershipId: memberMembershipId, projectRole: ProjectRole.BACKEND },
        ],
      })
      .expect(409);
    expect(staleAssignment.body.code).toBe('ISSUE_ASSIGNMENT_CONFLICT');
    await expect(
      database.client.issue.findUniqueOrThrow({
        select: { version: true },
        where: { id: featureId },
      }),
    ).resolves.toEqual({ version: 2 });

    const wrongTeamFeature = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({
        featureStatus: FeatureIssueStatus.TODO,
        projectId: project.id,
        title: '다른 역할 팀 담당자 전체 롤백',
        type: IssueType.FEATURE,
      })
      .expect(201);
    const wrongTeamFeatureId = wrongTeamFeature.body.issue.id as string;
    const wrongTeamAssignment = await request(app.getHttpServer())
      .post(`/api/v1/issues/${wrongTeamFeatureId}/start`)
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({
        roleAssignments: [
          { assigneeMembershipId: adminMembershipId, projectRole: ProjectRole.BACKEND },
          {
            assigneeMembershipId: deactivateTargetMembershipId,
            projectRole: ProjectRole.WEB_FRONTEND,
          },
        ],
      })
      .expect(422);
    expect(wrongTeamAssignment.body.code).toBe('ASSIGNEE_NOT_TEAM_MEMBER');
    await expect(
      database.client.issue.findMany({
        select: { id: true },
        where: { parentIssueId: wrongTeamFeatureId },
      }),
    ).resolves.toEqual([]);
    await expect(
      database.client.issue.findUniqueOrThrow({
        select: { version: true },
        where: { id: wrongTeamFeatureId },
      }),
    ).resolves.toEqual({ version: 1 });

    const inactiveFeature = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({
        featureStatus: FeatureIssueStatus.TODO,
        projectId: project.id,
        title: '비활성 담당자 거부',
        type: IssueType.FEATURE,
      })
      .expect(201);
    await database.client.workspaceMembership.update({
      data: { deactivatedAt: new Date(), status: MembershipStatus.INACTIVE },
      where: { id: deactivateTargetMembershipId },
    });
    try {
      const inactiveAssignment = await request(app.getHttpServer())
        .post(`/api/v1/issues/${String(inactiveFeature.body.issue.id)}/start`)
        .set('Cookie', adminCookie)
        .set('Origin', WEB_ORIGIN)
        .set('X-CSRF-Token', adminCsrfToken)
        .send({
          roleAssignments: [
            {
              assigneeMembershipId: deactivateTargetMembershipId,
              projectRole: ProjectRole.BACKEND,
            },
          ],
        })
        .expect(422);
      expect(inactiveAssignment.body.code).toBe('ASSIGNEE_NOT_TEAM_MEMBER');
    } finally {
      await database.client.workspaceMembership.update({
        data: { deactivatedAt: null, status: MembershipStatus.ACTIVE },
        where: { id: deactivateTargetMembershipId },
      });
    }
    await expect(
      database.client.issue.count({
        where: { parentIssueId: inactiveFeature.body.issue.id as string },
      }),
    ).resolves.toBe(0);

    const privateTeam = await database.client.team.create({
      data: {
        key: 'OWN',
        name: `현재 팀 검증 ${runId}`,
        normalizedName: `현재 팀 검증 ${runId}`,
        workspaceId,
      },
    });
    await database.client.teamMember.create({
      data: { membershipId: adminMembershipId, teamId: privateTeam.id, workspaceId },
    });
    await database.client.workflowState.create({
      data: {
        category: StateCategory.BACKLOG,
        isDefault: true,
        name: '현재 팀 백로그',
        normalizedName: '현재 팀 백로그',
        position: 0,
        teamId: privateTeam.id,
        workspaceId,
      },
    });
    const privateProject = await database.client.project.create({
      data: {
        name: `현재 팀 프로젝트 ${runId}`,
        status: ProjectStatus.IN_PROGRESS,
        workspaceId,
      },
    });
    await database.client.projectRoleTeam.create({
      data: {
        projectId: privateProject.id,
        role: ProjectRole.BACKEND,
        teamId: privateTeam.id,
        workspaceId,
      },
    });
    const privateFeature = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({
        featureStatus: FeatureIssueStatus.TODO,
        projectId: privateProject.id,
        title: '우리 팀에서 시작',
        type: IssueType.FEATURE,
      })
      .expect(201);
    const denied = await request(app.getHttpServer())
      .post(`/api/v1/issues/${String(privateFeature.body.issue.id)}/start`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({
        initialRoles: [ProjectRole.BACKEND],
        requireCurrentUserTeamMembership: true,
      })
      .expect(403);
    expect(denied.body.code).toBe('TEAM_MEMBERSHIP_REQUIRED');
    await expect(
      database.client.issue.count({
        where: { parentIssueId: privateFeature.body.issue.id as string },
      }),
    ).resolves.toBe(0);
  });

  it('revalidates every child task when quick-completing a feature without changing legacy status edits', async () => {
    const workspaceId = workspaceIds[0]!;
    const project = await database.client.project.create({
      data: {
        name: `빠른 완료 재검증 ${runId}`,
        status: ProjectStatus.IN_PROGRESS,
        workspaceId,
      },
    });
    await database.client.projectRoleTeam.create({
      data: {
        projectId: project.id,
        role: ProjectRole.BACKEND,
        teamId,
        workspaceId,
      },
    });
    const feature = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({
        featureStatus: FeatureIssueStatus.REVIEW,
        initialRoles: [ProjectRole.BACKEND],
        projectId: project.id,
        title: '완료 창 이후 작업 재개 경합',
        type: IssueType.FEATURE,
      })
      .expect(201);
    const featureId = feature.body.issue.id as string;
    const task = feature.body.createdTeamTasks[0] as { id: string; version: number };

    const initiallyCompleted = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${task.id}`)
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({ version: task.version, workflowStateId: completedStateId })
      .expect(200);
    const reopened = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${task.id}`)
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({ version: initiallyCompleted.body.version, workflowStateId: startedStateId })
      .expect(200);
    const latestParent = await request(app.getHttpServer())
      .get(`/api/v1/issues/${featureId}`)
      .set('Cookie', adminCookie)
      .expect(200);

    const rejected = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${featureId}`)
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({
        featureStatus: FeatureIssueStatus.DONE,
        requireCompletedTeamTasks: true,
        version: latestParent.body.version,
      })
      .expect(409);
    expect(rejected.body).toMatchObject({
      code: 'ISSUE_COMPLETION_NOT_READY',
      details: { completedCount: 0, targetTaskCount: 1 },
    });

    await request(app.getHttpServer())
      .patch(`/api/v1/issues/${task.id}`)
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({ version: reopened.body.version, workflowStateId: completedStateId })
      .expect(200);
    const completableParent = await request(app.getHttpServer())
      .get(`/api/v1/issues/${featureId}`)
      .set('Cookie', adminCookie)
      .expect(200);
    const completed = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${featureId}`)
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({
        featureStatus: FeatureIssueStatus.DONE,
        requireCompletedTeamTasks: true,
        version: completableParent.body.version,
      })
      .expect(200);
    expect(completed.body.status.featureStatus).toBe(FeatureIssueStatus.DONE);

    const legacyFeature = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({
        featureStatus: FeatureIssueStatus.TODO,
        projectId: project.id,
        title: '기존 직접 상태 변경 호환',
        type: IssueType.FEATURE,
      })
      .expect(201);
    const legacyCompleted = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${String(legacyFeature.body.issue.id)}`)
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({ featureStatus: FeatureIssueStatus.DONE, version: legacyFeature.body.issue.version })
      .expect(200);
    expect(legacyCompleted.body.status.featureStatus).toBe(FeatureIssueStatus.DONE);
  });

  it('claims and batch-assigns team tasks atomically', async () => {
    const workspaceId = workspaceIds[0]!;
    const project = await database.client.project.create({
      data: {
        name: `내가 맡기와 일괄 배정 ${runId}`,
        status: ProjectStatus.IN_PROGRESS,
        workspaceId,
      },
    });
    await database.client.projectRoleTeam.createMany({
      data: [
        { projectId: project.id, role: ProjectRole.BACKEND, teamId, workspaceId },
        {
          projectId: project.id,
          role: ProjectRole.WEB_FRONTEND,
          teamId: otherTeamId,
          workspaceId,
        },
      ],
    });
    const createFeature = async (title: string, initialRoles?: ProjectRole[]) =>
      request(app.getHttpServer())
        .post('/api/v1/issues')
        .set('Cookie', adminCookie)
        .set('Origin', WEB_ORIGIN)
        .set('X-CSRF-Token', adminCsrfToken)
        .send({
          featureStatus: FeatureIssueStatus.TODO,
          ...(initialRoles ? { initialRoles } : {}),
          projectId: project.id,
          title,
          type: IssueType.FEATURE,
        })
        .expect(201);

    const outsiderUser = await database.client.workspaceMembership.findUniqueOrThrow({
      select: { userId: true },
      where: { id: outsiderMembershipId },
    });
    const outsiderSession = await app.get(AuthSessionService).create(outsiderUser.userId);
    const outsiderCookie = `rivet_session=${outsiderSession.token}`;
    const outsiderCsrfToken = createCsrfToken(outsiderSession.token, CSRF_HMAC_KEY);
    const deniedClaimFeature = await createFeature('역할 팀 외부 멤버 맡기', [ProjectRole.BACKEND]);
    const deniedClaim = await request(app.getHttpServer())
      .post(`/api/v1/issues/${String(deniedClaimFeature.body.issue.id)}/claim`)
      .set('Cookie', outsiderCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', outsiderCsrfToken)
      .send({ projectRole: ProjectRole.BACKEND })
      .expect(403);
    expect(deniedClaim.body.code).toBe('TEAM_MEMBERSHIP_REQUIRED');

    const claimable = await createFeature('기존 미할당 작업 맡기', [ProjectRole.BACKEND]);
    const claimableTaskId = claimable.body.createdTeamTasks[0].id as string;
    const claimed = await request(app.getHttpServer())
      .post(`/api/v1/issues/${String(claimable.body.issue.id)}/claim`)
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({ projectRole: ProjectRole.BACKEND })
      .expect(200);
    expect(claimed.body).toMatchObject({
      issue: { version: 2 },
      teamTask: { assignee: { id: adminMembershipId }, id: claimableTaskId, version: 2 },
      workflowSummary: {
        currentUserAssignedTeamTasks: [expect.objectContaining({ id: claimableTaskId })],
        unassignedCount: 0,
      },
    });
    await expect(
      database.client.issueSubscription.findUnique({
        where: {
          issueId_membershipId: {
            issueId: claimableTaskId,
            membershipId: adminMembershipId,
          },
        },
      }),
    ).resolves.not.toBeNull();
    await expect(
      database.client.outboxEvent.findFirst({
        where: { aggregateId: claimableTaskId, eventType: ISSUE_CHANGED, workspaceId },
      }),
    ).resolves.toMatchObject({
      actorMembershipId: adminMembershipId,
      payload: expect.objectContaining({ assigneeMembershipId: adminMembershipId }),
    });

    const createdByClaim = await createFeature('작업 생성 후 맡기');
    const createdClaim = await request(app.getHttpServer())
      .post(`/api/v1/issues/${String(createdByClaim.body.issue.id)}/claim`)
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({ projectRole: ProjectRole.BACKEND })
      .expect(200);
    expect(createdClaim.body).toMatchObject({
      issue: { version: 2 },
      teamTask: {
        assignee: { id: adminMembershipId },
        projectRole: ProjectRole.BACKEND,
        version: 1,
      },
    });

    const concurrent = await createFeature('동시 내가 맡기', [ProjectRole.BACKEND]);
    const concurrentResponses = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/issues/${String(concurrent.body.issue.id)}/claim`)
        .set('Cookie', adminCookie)
        .set('Origin', WEB_ORIGIN)
        .set('X-CSRF-Token', adminCsrfToken)
        .send({ projectRole: ProjectRole.BACKEND }),
      request(app.getHttpServer())
        .post(`/api/v1/issues/${String(concurrent.body.issue.id)}/claim`)
        .set('Cookie', memberCookie)
        .set('Origin', WEB_ORIGIN)
        .set('X-CSRF-Token', memberCsrfToken)
        .send({ projectRole: ProjectRole.BACKEND }),
    ]);
    expect(concurrentResponses.map(({ status }) => status).sort()).toEqual([200, 409]);
    await expect(
      database.client.issue.findUniqueOrThrow({
        select: { version: true },
        where: { id: concurrent.body.issue.id as string },
      }),
    ).resolves.toEqual({ version: 2 });

    const multiple = await createFeature('복수 후보 내가 맡기');
    const multipleTaskResponses = await Promise.all(
      ['복수 후보 1', '복수 후보 2'].map((title) =>
        request(app.getHttpServer())
          .post('/api/v1/issues')
          .set('Cookie', adminCookie)
          .set('Origin', WEB_ORIGIN)
          .set('X-CSRF-Token', adminCsrfToken)
          .send({
            parentIssueId: multiple.body.issue.id,
            projectId: project.id,
            projectRole: ProjectRole.BACKEND,
            teamId,
            title,
            type: IssueType.TEAM_TASK,
          })
          .expect(201),
      ),
    );
    const targetRequired = await request(app.getHttpServer())
      .post(`/api/v1/issues/${String(multiple.body.issue.id)}/claim`)
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({ projectRole: ProjectRole.BACKEND })
      .expect(409);
    expect(targetRequired.body).toMatchObject({
      code: 'CLAIM_TARGET_REQUIRED',
      details: { candidates: expect.arrayContaining([expect.any(Object), expect.any(Object)]) },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/issues/${String(multiple.body.issue.id)}/claim`)
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({
        projectRole: ProjectRole.BACKEND,
        teamTaskIssueId: multipleTaskResponses[0]!.body.issue.id,
      })
      .expect(200);

    const batchFeature = await createFeature('복수 역할 일괄 배정', [
      ProjectRole.BACKEND,
      ProjectRole.WEB_FRONTEND,
    ]);
    const backendTask = batchFeature.body.createdTeamTasks.find(
      ({ projectRole }: { projectRole: ProjectRole }) => projectRole === ProjectRole.BACKEND,
    );
    const webTask = batchFeature.body.createdTeamTasks.find(
      ({ projectRole }: { projectRole: ProjectRole }) => projectRole === ProjectRole.WEB_FRONTEND,
    );
    expect(backendTask).toBeDefined();
    expect(webTask).toBeDefined();
    const batch = await request(app.getHttpServer())
      .post(`/api/v1/issues/${String(batchFeature.body.issue.id)}/assign-team-tasks`)
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({
        assignments: [
          {
            assigneeMembershipId: adminMembershipId,
            teamTaskIssueId: backendTask.id,
            version: 1,
          },
          {
            assigneeMembershipId: memberMembershipId,
            teamTaskIssueId: webTask.id,
            version: 1,
          },
        ],
      })
      .expect(200);
    expect(batch.body.issue.version).toBe(2);
    expect(batch.body.teamTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assignee: expect.objectContaining({ id: adminMembershipId }) }),
        expect.objectContaining({ assignee: expect.objectContaining({ id: memberMembershipId }) }),
      ]),
    );
    await expect(
      database.client.outboxEvent.count({
        where: {
          aggregateId: { in: [backendTask.id as string, webTask.id as string] },
          eventType: ISSUE_CHANGED,
          workspaceId,
        },
      }),
    ).resolves.toBe(2);
    await expect(
      database.client.activityEvent.count({
        where: {
          eventType: 'ISSUE_UPDATED',
          fieldName: 'assigneeMembershipId',
          issueId: { in: [backendTask.id as string, webTask.id as string] },
          workspaceId,
        },
      }),
    ).resolves.toBe(2);
    await expect(
      database.client.issueSubscription.findUnique({
        where: {
          issueId_membershipId: {
            issueId: backendTask.id as string,
            membershipId: adminMembershipId,
          },
        },
      }),
    ).resolves.not.toBeNull();
    await expect(
      database.client.issueSubscription.findUnique({
        where: {
          issueId_membershipId: {
            issueId: webTask.id as string,
            membershipId: memberMembershipId,
          },
        },
      }),
    ).resolves.not.toBeNull();

    const invalidCandidateFeature = await createFeature('일괄 배정 후보 검증', [
      ProjectRole.BACKEND,
    ]);
    const invalidCandidateTaskId = invalidCandidateFeature.body.createdTeamTasks[0].id as string;
    const invalidCandidate = await request(app.getHttpServer())
      .post(`/api/v1/issues/${String(invalidCandidateFeature.body.issue.id)}/assign-team-tasks`)
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({
        assignments: [
          {
            assigneeMembershipId: outsiderMembershipId,
            teamTaskIssueId: invalidCandidateTaskId,
            version: 1,
          },
        ],
      })
      .expect(422);
    expect(invalidCandidate.body.code).toBe('ASSIGNEE_NOT_TEAM_MEMBER');
    await expect(
      database.client.issue.findUniqueOrThrow({
        select: { assigneeMembershipId: true, version: true },
        where: { id: invalidCandidateTaskId },
      }),
    ).resolves.toEqual({ assigneeMembershipId: null, version: 1 });
    await expect(
      database.client.issue.findUniqueOrThrow({
        select: { version: true },
        where: { id: invalidCandidateFeature.body.issue.id as string },
      }),
    ).resolves.toEqual({ version: 1 });

    const rollbackFeature = await createFeature('일괄 배정 전체 롤백', [
      ProjectRole.BACKEND,
      ProjectRole.WEB_FRONTEND,
    ]);
    const rollbackTasks = rollbackFeature.body.createdTeamTasks as Array<{
      id: string;
      projectRole: ProjectRole;
    }>;
    const rollback = await request(app.getHttpServer())
      .post(`/api/v1/issues/${String(rollbackFeature.body.issue.id)}/assign-team-tasks`)
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({
        assignments: rollbackTasks.map(({ id }, index) => ({
          assigneeMembershipId: index === 0 ? adminMembershipId : memberMembershipId,
          teamTaskIssueId: id,
          version: index === 0 ? 1 : 999,
        })),
      })
      .expect(409);
    expect(rollback.body.code).toBe('ISSUE_VERSION_CONFLICT');
    expect(rollback.body.details).toMatchObject({
      candidates: expect.arrayContaining([
        expect.objectContaining({ members: expect.any(Array), teamId }),
        expect.objectContaining({ members: expect.any(Array), teamId: otherTeamId }),
      ]),
      staleTeamTaskIssueId: rollbackTasks[1]!.id,
      teamTasks: expect.arrayContaining(
        rollbackTasks.map(({ id }) => expect.objectContaining({ id })),
      ),
    });
    await expect(
      database.client.issue.findMany({
        orderBy: { id: 'asc' },
        select: { assigneeMembershipId: true, version: true },
        where: { id: { in: rollbackTasks.map(({ id }) => id) } },
      }),
    ).resolves.toEqual([
      { assigneeMembershipId: null, version: 1 },
      { assigneeMembershipId: null, version: 1 },
    ]);
    await expect(
      database.client.issue.findUniqueOrThrow({
        select: { version: true },
        where: { id: rollbackFeature.body.issue.id as string },
      }),
    ).resolves.toEqual({ version: 1 });

    const otherParent = await createFeature('다른 상위 이슈', [ProjectRole.BACKEND]);
    const otherParentTaskId = otherParent.body.createdTeamTasks[0].id as string;
    const mixedParentBatch = await request(app.getHttpServer())
      .post(`/api/v1/issues/${String(rollbackFeature.body.issue.id)}/assign-team-tasks`)
      .set('Cookie', adminCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({
        assignments: [
          {
            assigneeMembershipId: adminMembershipId,
            teamTaskIssueId: rollbackTasks[0]!.id,
            version: 1,
          },
          {
            assigneeMembershipId: adminMembershipId,
            teamTaskIssueId: otherParentTaskId,
            version: 1,
          },
        ],
      })
      .expect(409);
    expect(mixedParentBatch.body.code).toBe('ISSUE_ASSIGNMENT_CONFLICT');
    expect(mixedParentBatch.body.details).toMatchObject({
      candidates: expect.any(Array),
      requestedAssignments: expect.any(Array),
      teamTasks: expect.any(Array),
    });
    await expect(
      database.client.issue.findUniqueOrThrow({
        select: { assigneeMembershipId: true, version: true },
        where: { id: rollbackTasks[0]!.id },
      }),
    ).resolves.toEqual({ assigneeMembershipId: null, version: 1 });
    await expect(
      database.client.issue.findUniqueOrThrow({
        select: { version: true },
        where: { id: rollbackFeature.body.issue.id as string },
      }),
    ).resolves.toEqual({ version: 1 });
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
        .patch(`/api/v1/issues/${String(removalIssue.body.issue.id)}`)
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
      where: { id: removalIssue.body.issue.id as string },
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
        .patch(`/api/v1/issues/${String(deactivationIssue.body.issue.id)}`)
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
      where: { id: deactivationIssue.body.issue.id as string },
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
    expect(issueResponse.body.issue.identifier).toBe(`${finalTeam.key}-1`);
  });
});
