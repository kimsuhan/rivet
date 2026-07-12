import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { MembershipRole, StateCategory } from '@rivet/database';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap';
import { DatabaseService } from '../src/common/database/database.service';
import { AuthSessionService } from '../src/modules/auth/auth-session.service';

const PASSWORD_HASH = 'integration-password-hash';

describe('M6 issue search', () => {
  const runId = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  let app: INestApplication;
  let database: DatabaseService;
  let currentCookie: string;
  let foreignCookie: string;
  let exactIssueId: string;
  let firstPartialIssueId: string;
  let secondPartialIssueId: string;
  let foreignExactIssueId: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    database = app.get(DatabaseService);

    const fixture = await database.client.$transaction(async (transaction) => {
      const [currentUser, foreignUser] = await Promise.all([
        transaction.user.create({
          data: {
            displayName: '검색 사용자',
            email: `m6.search.${runId}@example.com`,
            emailVerifiedAt: new Date(),
            normalizedEmail: `m6.search.${runId}@example.com`,
            passwordHash: PASSWORD_HASH,
          },
          select: { id: true },
        }),
        transaction.user.create({
          data: {
            displayName: '다른 검색 사용자',
            email: `m6.search.foreign.${runId}@example.com`,
            emailVerifiedAt: new Date(),
            normalizedEmail: `m6.search.foreign.${runId}@example.com`,
            passwordHash: PASSWORD_HASH,
          },
          select: { id: true },
        }),
      ]);
      const [workspace, foreignWorkspace] = await Promise.all([
        transaction.workspace.create({
          data: {
            createdByUserId: currentUser.id,
            name: 'M6 검색 워크스페이스',
            normalizedSlug: `m6-search-${runId}`,
            slug: `m6-search-${runId}`,
          },
          select: { id: true },
        }),
        transaction.workspace.create({
          data: {
            createdByUserId: foreignUser.id,
            name: 'M6 검색 다른 워크스페이스',
            normalizedSlug: `m6-search-foreign-${runId}`,
            slug: `m6-search-foreign-${runId}`,
          },
          select: { id: true },
        }),
      ]);
      const [membership, foreignMembership] = await Promise.all([
        transaction.workspaceMembership.create({
          data: {
            role: MembershipRole.ADMIN,
            userId: currentUser.id,
            workspaceId: workspace.id,
          },
          select: { id: true },
        }),
        transaction.workspaceMembership.create({
          data: {
            role: MembershipRole.ADMIN,
            userId: foreignUser.id,
            workspaceId: foreignWorkspace.id,
          },
          select: { id: true },
        }),
      ]);
      const [team, foreignTeam] = await Promise.all([
        transaction.team.create({
          data: {
            key: 'SRH',
            name: '검색 팀',
            normalizedName: '검색 팀',
            workspaceId: workspace.id,
          },
          select: { id: true },
        }),
        transaction.team.create({
          data: {
            key: 'SRH',
            name: '다른 검색 팀',
            normalizedName: '다른 검색 팀',
            workspaceId: foreignWorkspace.id,
          },
          select: { id: true },
        }),
      ]);
      await transaction.teamMember.createMany({
        data: [
          { membershipId: membership.id, teamId: team.id, workspaceId: workspace.id },
          {
            membershipId: foreignMembership.id,
            teamId: foreignTeam.id,
            workspaceId: foreignWorkspace.id,
          },
        ],
      });
      const [workflowState, foreignWorkflowState] = await Promise.all([
        transaction.workflowState.create({
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
        }),
        transaction.workflowState.create({
          data: {
            category: StateCategory.BACKLOG,
            isDefault: true,
            name: '미분류',
            normalizedName: '미분류',
            position: 0,
            teamId: foreignTeam.id,
            workspaceId: foreignWorkspace.id,
          },
          select: { id: true },
        }),
      ]);
      const [exactIssue, firstPartialIssue, secondPartialIssue, foreignExactIssue] =
        await Promise.all([
          transaction.issue.create({
            data: {
              createdByMembershipId: membership.id,
              identifier: 'SRH-1',
              sequenceNumber: 1,
              teamId: team.id,
              title: '표시 ID 정확 일치',
              updatedAt: new Date('2026-07-11T01:00:00.000Z'),
              workflowStateId: workflowState.id,
              workspaceId: workspace.id,
            },
            select: { id: true },
          }),
          transaction.issue.create({
            data: {
              createdByMembershipId: membership.id,
              identifier: 'SRH-2',
              sequenceNumber: 2,
              teamId: team.id,
              title: 'SRH-1 문서 최신',
              updatedAt: new Date('2026-07-11T03:00:00.000Z'),
              workflowStateId: workflowState.id,
              workspaceId: workspace.id,
            },
            select: { id: true },
          }),
          transaction.issue.create({
            data: {
              createdByMembershipId: membership.id,
              identifier: 'SRH-3',
              sequenceNumber: 3,
              teamId: team.id,
              title: 'SRH-1 문서 이전',
              updatedAt: new Date('2026-07-11T02:00:00.000Z'),
              workflowStateId: workflowState.id,
              workspaceId: workspace.id,
            },
            select: { id: true },
          }),
          transaction.issue.create({
            data: {
              createdByMembershipId: foreignMembership.id,
              identifier: 'SRH-1',
              sequenceNumber: 1,
              teamId: foreignTeam.id,
              title: 'SRH-1 다른 워크스페이스 문서',
              updatedAt: new Date('2026-07-11T04:00:00.000Z'),
              workflowStateId: foreignWorkflowState.id,
              workspaceId: foreignWorkspace.id,
            },
            select: { id: true },
          }),
          transaction.issue.create({
            data: {
              createdByMembershipId: membership.id,
              deletedAt: new Date('2026-07-11T06:00:00.000Z'),
              deletedByMembershipId: membership.id,
              identifier: 'SRH-4',
              purgeAt: new Date('2026-08-10T06:00:00.000Z'),
              sequenceNumber: 4,
              teamId: team.id,
              title: 'SRH-1 휴지통 문서',
              updatedAt: new Date('2026-07-11T05:00:00.000Z'),
              workflowStateId: workflowState.id,
              workspaceId: workspace.id,
            },
            select: { id: true },
          }),
        ]);

      return {
        currentUserId: currentUser.id,
        exactIssueId: exactIssue.id,
        firstPartialIssueId: firstPartialIssue.id,
        foreignExactIssueId: foreignExactIssue.id,
        foreignUserId: foreignUser.id,
        foreignWorkspaceId: foreignWorkspace.id,
        secondPartialIssueId: secondPartialIssue.id,
        userIds: [currentUser.id, foreignUser.id],
        workspaceId: workspace.id,
      };
    });

    userIds.push(...fixture.userIds);
    workspaceIds.push(fixture.workspaceId, fixture.foreignWorkspaceId);
    exactIssueId = fixture.exactIssueId;
    firstPartialIssueId = fixture.firstPartialIssueId;
    secondPartialIssueId = fixture.secondPartialIssueId;
    foreignExactIssueId = fixture.foreignExactIssueId;

    const sessions = app.get(AuthSessionService);
    const [currentSession, foreignSession] = await Promise.all([
      sessions.create(fixture.currentUserId),
      sessions.create(fixture.foreignUserId),
    ]);
    currentCookie = `rivet_session=${currentSession.token}`;
    foreignCookie = `rivet_session=${foreignSession.token}`;
  });

  afterAll(async () => {
    if (database) {
      await database.client.issue.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.workflowState.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.teamMember.deleteMany({
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
  });

  it('prioritizes an exact identifier, paginates title matches and isolates workspaces', async () => {
    const first = await request(app.getHttpServer())
      .get('/api/v1/search/issues')
      .query({ limit: 1, query: 'srh-1' })
      .set('Cookie', currentCookie)
      .expect(200);
    expect(first.body.items).toEqual([
      expect.objectContaining({
        issue: expect.objectContaining({ id: exactIssueId, identifier: 'SRH-1' }),
        matchType: 'IDENTIFIER_EXACT',
      }),
    ]);
    expect(first.body.nextCursor).toEqual(expect.any(String));

    const second = await request(app.getHttpServer())
      .get('/api/v1/search/issues')
      .query({ cursor: first.body.nextCursor as string, limit: 1, query: 'srh-1' })
      .set('Cookie', currentCookie)
      .expect(200);
    expect(second.body.items).toEqual([
      expect.objectContaining({
        issue: expect.objectContaining({ id: firstPartialIssueId }),
        matchType: 'TITLE_PARTIAL',
      }),
    ]);
    expect(second.body.nextCursor).toEqual(expect.any(String));

    const third = await request(app.getHttpServer())
      .get('/api/v1/search/issues')
      .query({ cursor: second.body.nextCursor as string, limit: 1, query: 'srh-1' })
      .set('Cookie', currentCookie)
      .expect(200);
    expect(third.body.items).toEqual([
      expect.objectContaining({
        issue: expect.objectContaining({ id: secondPartialIssueId }),
        matchType: 'TITLE_PARTIAL',
      }),
    ]);
    expect(third.body.nextCursor).toBeNull();
    expect(
      [...first.body.items, ...second.body.items, ...third.body.items].some(
        ({ issue }: { issue: { id: string } }) => issue.id === foreignExactIssueId,
      ),
    ).toBe(false);

    const foreign = await request(app.getHttpServer())
      .get('/api/v1/search/issues')
      .query({ query: 'srh-1' })
      .set('Cookie', foreignCookie)
      .expect(200);
    expect(foreign.body.items[0]).toEqual(
      expect.objectContaining({
        issue: expect.objectContaining({ id: foreignExactIssueId }),
        matchType: 'IDENTIFIER_EXACT',
      }),
    );
  });

  it('rejects an empty query and skips one-codepoint title searches', async () => {
    const missing = await request(app.getHttpServer())
      .get('/api/v1/search/issues')
      .set('Cookie', currentCookie)
      .expect(400);
    expect(missing.body.code).toBe('INVALID_QUERY');

    const oneCodepoint = await request(app.getHttpServer())
      .get('/api/v1/search/issues')
      .query({ query: '검' })
      .set('Cookie', currentCookie)
      .expect(200);
    expect(oneCodepoint.body).toEqual({ items: [], nextCursor: null });
  });
});
