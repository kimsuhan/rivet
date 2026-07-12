import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { MembershipRole, NotificationType, StateCategory } from '@rivet/database';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap';
import { DatabaseService } from '../src/common/database/database.service';
import { AuthSessionService } from '../src/modules/auth/auth-session.service';
import { createCsrfToken } from '../src/modules/auth/auth-token';

const WEB_ORIGIN = 'http://localhost:3000';
const CSRF_HMAC_KEY = 'test-csrf-hmac-key-with-at-least-32-bytes';
const PASSWORD_HASH = 'integration-password-hash';

describe('M6 notification inbox', () => {
  const runId = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  let app: INestApplication;
  let database: DatabaseService;
  let recipientCookie: string;
  let recipientCsrf: string;
  let actorCookie: string;
  let actorCsrf: string;
  let foreignCookie: string;
  let foreignCsrf: string;
  let recipientNotificationId: string;
  let readNotificationId: string;
  let actorNotificationId: string;
  let foreignNotificationId: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    database = app.get(DatabaseService);

    const fixture = await database.client.$transaction(async (transaction) => {
      const users = [];
      for (const [displayName, suffix] of [
        ['알림 행위자', 'actor'],
        ['알림 수신자', 'recipient'],
        ['다른 워크스페이스 사용자', 'foreign'],
      ] as const) {
        const email = `m6.notifications.${suffix}.${runId}@example.com`;
        users.push(
          await transaction.user.create({
            data: {
              displayName,
              email,
              emailVerifiedAt: new Date(),
              normalizedEmail: email,
              passwordHash: PASSWORD_HASH,
            },
            select: { id: true },
          }),
        );
      }
      const [actor, recipient, foreign] = users;
      if (!actor || !recipient || !foreign) throw new Error('알림 테스트 사용자 누락');

      const [workspace, foreignWorkspace] = await Promise.all([
        transaction.workspace.create({
          data: {
            createdByUserId: actor.id,
            name: 'M6 알림 워크스페이스',
            normalizedSlug: `m6-notifications-${runId}`,
            slug: `m6-notifications-${runId}`,
          },
          select: { id: true },
        }),
        transaction.workspace.create({
          data: {
            createdByUserId: foreign.id,
            name: 'M6 다른 워크스페이스',
            normalizedSlug: `m6-notifications-foreign-${runId}`,
            slug: `m6-notifications-foreign-${runId}`,
          },
          select: { id: true },
        }),
      ]);
      const [actorMembership, recipientMembership, foreignMembership] = await Promise.all([
        transaction.workspaceMembership.create({
          data: { role: MembershipRole.ADMIN, userId: actor.id, workspaceId: workspace.id },
          select: { id: true },
        }),
        transaction.workspaceMembership.create({
          data: { role: MembershipRole.MEMBER, userId: recipient.id, workspaceId: workspace.id },
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

      const [team, foreignTeam] = await Promise.all([
        transaction.team.create({
          data: {
            key: 'NTF',
            name: '알림 팀',
            normalizedName: '알림 팀',
            workspaceId: workspace.id,
          },
          select: { id: true },
        }),
        transaction.team.create({
          data: {
            key: 'FNT',
            name: '다른 알림 팀',
            normalizedName: '다른 알림 팀',
            workspaceId: foreignWorkspace.id,
          },
          select: { id: true },
        }),
      ]);
      await transaction.teamMember.createMany({
        data: [
          {
            membershipId: actorMembership.id,
            teamId: team.id,
            workspaceId: workspace.id,
          },
          {
            membershipId: recipientMembership.id,
            teamId: team.id,
            workspaceId: workspace.id,
          },
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
      const [issue, foreignIssue] = await Promise.all([
        transaction.issue.create({
          data: {
            createdByMembershipId: actorMembership.id,
            identifier: 'NTF-1',
            sequenceNumber: 1,
            teamId: team.id,
            title: '알림함 격리 검증',
            workflowStateId: state.id,
            workspaceId: workspace.id,
          },
          select: { id: true },
        }),
        transaction.issue.create({
          data: {
            createdByMembershipId: foreignMembership.id,
            identifier: 'FNT-1',
            sequenceNumber: 1,
            teamId: foreignTeam.id,
            title: '다른 워크스페이스 알림',
            workflowStateId: foreignState.id,
            workspaceId: foreignWorkspace.id,
          },
          select: { id: true },
        }),
      ]);

      const events = [];
      for (const [workspaceId, aggregateId, actorMembershipId] of [
        [workspace.id, issue.id, actorMembership.id],
        [workspace.id, issue.id, actorMembership.id],
        [workspace.id, issue.id, null],
        [foreignWorkspace.id, foreignIssue.id, null],
      ] as const) {
        events.push(
          await transaction.outboxEvent.create({
            data: {
              actorMembershipId,
              aggregateId,
              aggregateType: 'ISSUE',
              eventType: 'TEST_NOTIFICATION',
              payload: { schemaVersion: 1 },
              processedAt: new Date(),
              workspaceId,
            },
            select: { id: true },
          }),
        );
      }
      const [recipientEvent, readEvent, actorEvent, foreignEvent] = events;
      if (!recipientEvent || !readEvent || !actorEvent || !foreignEvent) {
        throw new Error('알림 테스트 이벤트 누락');
      }

      const [recipientNotification, readNotification, actorNotification, foreignNotification] =
        await Promise.all([
          transaction.notification.create({
            data: {
              actorMembershipId: actorMembership.id,
              eventId: recipientEvent.id,
              issueId: issue.id,
              recipientMembershipId: recipientMembership.id,
              type: NotificationType.MENTIONED,
              workspaceId: workspace.id,
            },
            select: { id: true },
          }),
          transaction.notification.create({
            data: {
              actorMembershipId: actorMembership.id,
              eventId: readEvent.id,
              issueId: issue.id,
              readAt: new Date('2026-07-11T01:00:00.000Z'),
              recipientMembershipId: recipientMembership.id,
              type: NotificationType.ISSUE_ASSIGNED,
              workspaceId: workspace.id,
            },
            select: { id: true },
          }),
          transaction.notification.create({
            data: {
              eventId: actorEvent.id,
              issueId: issue.id,
              recipientMembershipId: actorMembership.id,
              type: NotificationType.ISSUE_COMPLETED,
              workspaceId: workspace.id,
            },
            select: { id: true },
          }),
          transaction.notification.create({
            data: {
              eventId: foreignEvent.id,
              issueId: foreignIssue.id,
              recipientMembershipId: foreignMembership.id,
              type: NotificationType.ISSUE_CANCELED,
              workspaceId: foreignWorkspace.id,
            },
            select: { id: true },
          }),
        ]);

      return {
        actorNotificationId: actorNotification.id,
        actorUserId: actor.id,
        foreignNotificationId: foreignNotification.id,
        foreignUserId: foreign.id,
        foreignWorkspaceId: foreignWorkspace.id,
        readNotificationId: readNotification.id,
        recipientNotificationId: recipientNotification.id,
        recipientUserId: recipient.id,
        userIds: users.map(({ id }) => id),
        workspaceId: workspace.id,
      };
    });

    userIds.push(...fixture.userIds);
    workspaceIds.push(fixture.workspaceId, fixture.foreignWorkspaceId);
    recipientNotificationId = fixture.recipientNotificationId;
    readNotificationId = fixture.readNotificationId;
    actorNotificationId = fixture.actorNotificationId;
    foreignNotificationId = fixture.foreignNotificationId;

    const sessions = app.get(AuthSessionService);
    const [actorSession, recipientSession, foreignSession] = await Promise.all([
      sessions.create(fixture.actorUserId),
      sessions.create(fixture.recipientUserId),
      sessions.create(fixture.foreignUserId),
    ]);
    actorCookie = `rivet_session=${actorSession.token}`;
    recipientCookie = `rivet_session=${recipientSession.token}`;
    foreignCookie = `rivet_session=${foreignSession.token}`;
    actorCsrf = createCsrfToken(actorSession.token, CSRF_HMAC_KEY);
    recipientCsrf = createCsrfToken(recipientSession.token, CSRF_HMAC_KEY);
    foreignCsrf = createCsrfToken(foreignSession.token, CSRF_HMAC_KEY);
  });

  afterAll(async () => {
    if (database) {
      await database.client.notification.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.outboxEvent.deleteMany({
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
      await database.client.session.deleteMany({ where: { userId: { in: userIds } } });
      await database.client.workspaceMembership.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
      await database.client.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app?.close();
  });

  it('keeps list, unread count, ownership and read mutations consistent', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Cookie', recipientCookie)
      .expect(200);
    expect(list.body.items).toHaveLength(2);
    expect(new Set(list.body.items.map(({ id }: { id: string }) => id))).toEqual(
      new Set([recipientNotificationId, readNotificationId]),
    );
    expect(list.body.items[0]).toEqual(
      expect.objectContaining({
        actor: expect.objectContaining({ displayName: '알림 행위자' }),
        issue: expect.objectContaining({ identifier: 'NTF-1', title: '알림함 격리 검증' }),
      }),
    );

    const unread = await request(app.getHttpServer())
      .get('/api/v1/notifications?read=false&type=MENTIONED')
      .set('Cookie', recipientCookie)
      .expect(200);
    expect(unread.body.items).toEqual([
      expect.objectContaining({ id: recipientNotificationId, readAt: null, type: 'MENTIONED' }),
    ]);

    await request(app.getHttpServer())
      .get('/api/v1/notifications/unread-count')
      .set('Cookie', recipientCookie)
      .expect(200, { count: 1 });

    const actorList = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Cookie', actorCookie)
      .expect(200);
    expect(actorList.body.items.map(({ id }: { id: string }) => id)).toEqual([actorNotificationId]);

    const foreignList = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Cookie', foreignCookie)
      .expect(200);
    expect(foreignList.body.items.map(({ id }: { id: string }) => id)).toEqual([
      foreignNotificationId,
    ]);

    await request(app.getHttpServer())
      .patch(`/api/v1/notifications/${recipientNotificationId}`)
      .set('Cookie', actorCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', actorCsrf)
      .send({ read: true })
      .expect(404)
      .expect(({ body }) => expect(body.code).toBe('RESOURCE_NOT_FOUND'));

    await request(app.getHttpServer())
      .patch(`/api/v1/notifications/${recipientNotificationId}`)
      .set('Cookie', foreignCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', foreignCsrf)
      .send({ read: true })
      .expect(404)
      .expect(({ body }) => expect(body.code).toBe('RESOURCE_NOT_FOUND'));

    const markedRead = await request(app.getHttpServer())
      .patch(`/api/v1/notifications/${recipientNotificationId}`)
      .set('Cookie', recipientCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', recipientCsrf)
      .send({ read: true })
      .expect(200);
    expect(markedRead.body).toEqual(
      expect.objectContaining({ id: recipientNotificationId, readAt: expect.any(String) }),
    );

    await request(app.getHttpServer())
      .get('/api/v1/notifications/unread-count')
      .set('Cookie', recipientCookie)
      .expect(200, { count: 0 });

    await request(app.getHttpServer())
      .patch(`/api/v1/notifications/${readNotificationId}`)
      .set('Cookie', recipientCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', recipientCsrf)
      .send({ read: false })
      .expect(200)
      .expect(({ body }) => expect(body.readAt).toBeNull());

    await request(app.getHttpServer())
      .get('/api/v1/notifications/unread-count')
      .set('Cookie', recipientCookie)
      .expect(200, { count: 1 });

    await request(app.getHttpServer())
      .post('/api/v1/notifications/read-all')
      .set('Cookie', recipientCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', recipientCsrf)
      .expect(200, { updatedCount: 1 });

    await request(app.getHttpServer())
      .get('/api/v1/notifications/unread-count')
      .set('Cookie', recipientCookie)
      .expect(200, { count: 0 });

    await request(app.getHttpServer())
      .post('/api/v1/notifications/read-all')
      .set('Cookie', recipientCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', recipientCsrf)
      .expect(200, { updatedCount: 0 });
  });
});
