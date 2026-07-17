import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap';
import { DatabaseService } from '../src/common/database/database.service';
import {
  AUTH_RATE_LIMITS,
  AuthRateLimitService,
} from '../src/modules/auth/auth-rate-limit.service';
import { AuthSessionService } from '../src/modules/auth/auth-session.service';
import { createCsrfToken } from '../src/modules/auth/auth-token.crypto';

const WEB_ORIGIN = 'http://localhost:3000';
const CSRF_HMAC_KEY = 'test-csrf-hmac-key-with-at-least-32-bytes';
const PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$u5oksZN2qlFVAyszxdWrug$xmy/xfzl6zj7sfdlIBgb2F6zHrOnBcsxDzJEO7QyG0A';
const runId = randomUUID().slice(0, 8);

describe('A3 Web Push subscriptions API', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let rateLimits: AuthRateLimitService;
  let sessions: AuthSessionService;
  let userId: string;
  let workspaceId: string;
  let membershipId: string;
  let firstSessionId: string;
  let firstToken: string;
  let firstCsrf: string;
  let secondSessionId: string;
  let secondToken: string;
  let secondCsrf: string;
  let foreignUserId: string;
  let foreignWorkspaceId: string;
  let foreignToken: string;
  let foreignCsrf: string;
  let rateLimitedSubscriptionId: string | undefined;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    database = app.get(DatabaseService);
    rateLimits = app.get(AuthRateLimitService);
    sessions = app.get(AuthSessionService);

    const email = `a3.web-push.${runId}@example.com`;
    const user = await database.client.user.create({
      data: {
        displayName: 'A3 Push 사용자',
        email,
        emailVerifiedAt: new Date(),
        normalizedEmail: email,
        passwordHash: PASSWORD_HASH,
      },
      select: { id: true },
    });
    userId = user.id;
    const workspace = await database.client.workspace.create({
      data: {
        createdByUserId: userId,
        name: 'A3 Web Push 워크스페이스',
        normalizedSlug: `a3-web-push-${runId}`,
        slug: `a3-web-push-${runId}`,
      },
      select: { id: true },
    });
    workspaceId = workspace.id;
    const membership = await database.client.workspaceMembership.create({
      data: { role: 'ADMIN', status: 'ACTIVE', userId, workspaceId },
      select: { id: true },
    });
    membershipId = membership.id;

    const [first, second] = await Promise.all([sessions.create(userId), sessions.create(userId)]);
    firstSessionId = first.context.sessionId;
    firstToken = first.token;
    firstCsrf = createCsrfToken(firstToken, CSRF_HMAC_KEY);
    secondSessionId = second.context.sessionId;
    secondToken = second.token;
    secondCsrf = createCsrfToken(secondToken, CSRF_HMAC_KEY);

    const foreignEmail = `a3.web-push.foreign.${runId}@example.com`;
    const foreignUser = await database.client.user.create({
      data: {
        displayName: 'A3 Push 격리 사용자',
        email: foreignEmail,
        emailVerifiedAt: new Date(),
        normalizedEmail: foreignEmail,
        passwordHash: PASSWORD_HASH,
      },
      select: { id: true },
    });
    foreignUserId = foreignUser.id;
    const foreignWorkspace = await database.client.workspace.create({
      data: {
        createdByUserId: foreignUserId,
        name: 'A3 Web Push 격리 워크스페이스',
        normalizedSlug: `a3-web-push-foreign-${runId}`,
        slug: `a3-web-push-foreign-${runId}`,
      },
      select: { id: true },
    });
    foreignWorkspaceId = foreignWorkspace.id;
    await database.client.workspaceMembership.create({
      data: {
        role: 'ADMIN',
        status: 'ACTIVE',
        userId: foreignUserId,
        workspaceId: foreignWorkspaceId,
      },
    });
    const foreignSession = await sessions.create(foreignUserId);
    foreignToken = foreignSession.token;
    foreignCsrf = createCsrfToken(foreignToken, CSRF_HMAC_KEY);
  });

  afterAll(async () => {
    if (database) {
      if (membershipId) {
        await rateLimits.clear(AUTH_RATE_LIMITS.webPushTestMembership, membershipId);
      }
      if (membershipId && rateLimitedSubscriptionId) {
        await rateLimits.clear(
          AUTH_RATE_LIMITS.webPushTestSubscription,
          `${membershipId}:${rateLimitedSubscriptionId}`,
        );
      }
      await database.client.webPushDelivery.deleteMany({
        where: { subscription: { workspaceId } },
      });
      await database.client.webPushSubscription.deleteMany({ where: { workspaceId } });
      await database.client.outboxEvent.deleteMany({
        where: { eventType: 'WEB_PUSH_TEST_REQUESTED', workspaceId },
      });
      await database.client.webPushDelivery.deleteMany({
        where: { subscription: { workspaceId: foreignWorkspaceId } },
      });
      await database.client.webPushSubscription.deleteMany({
        where: { workspaceId: foreignWorkspaceId },
      });
      await database.client.session.deleteMany({ where: { userId } });
      await database.client.session.deleteMany({ where: { userId: foreignUserId } });
      await database.client.workspaceMembership.deleteMany({ where: { workspaceId } });
      await database.client.workspaceMembership.deleteMany({
        where: { workspaceId: foreignWorkspaceId },
      });
      await database.client.workspace.delete({ where: { id: workspaceId } });
      await database.client.workspace.delete({ where: { id: foreignWorkspaceId } });
      await database.client.user.delete({ where: { id: userId } });
      await database.client.user.delete({ where: { id: foreignUserId } });
    }
    await app?.close();
    if (process.env.FILE_STORAGE_ROOT) {
      await rm(process.env.FILE_STORAGE_ROOT, { force: true, recursive: true });
    }
  });

  const register = (token: string, csrf: string, endpoint: string, browser: string) =>
    request(app.getHttpServer())
      .post('/api/v1/notifications/push/subscriptions')
      .set('Cookie', `rivet_session=${token}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({
        browser,
        endpoint,
        expirationTime: null,
        keys: {
          auth: Buffer.alloc(16, 1).toString('base64url'),
          p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 2)]).toString('base64url'),
        },
      });

  it('registers, lists, tests, rebinds, and deactivates browser subscriptions without key exposure', async () => {
    const first = await register(
      firstToken,
      firstCsrf,
      `https://push.example.test/${runId}/first`,
      'CHROME',
    ).expect(201);
    rateLimitedSubscriptionId = first.body.id;
    const second = await register(
      secondToken,
      secondCsrf,
      `https://push.example.test/${runId}/second`,
      'FIREFOX',
    ).expect(201);

    for (const body of [first.body, second.body]) {
      expect(body).not.toHaveProperty('endpoint');
      expect(body).not.toHaveProperty('keys');
      expect(body).not.toHaveProperty('lastErrorCode');
    }

    const list = await request(app.getHttpServer())
      .get('/api/v1/notifications/push/subscriptions')
      .set('Cookie', `rivet_session=${firstToken}`)
      .expect(200);
    expect(list.body.items).toHaveLength(2);
    expect(list.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ browser: 'CHROME', isCurrentSession: true, status: 'ACTIVE' }),
        expect.objectContaining({ browser: 'FIREFOX', isCurrentSession: false, status: 'ACTIVE' }),
      ]),
    );

    const testRequest = await request(app.getHttpServer())
      .post(`/api/v1/notifications/push/subscriptions/${first.body.id}/test`)
      .set('Cookie', `rivet_session=${firstToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', firstCsrf)
      .expect(202);
    expect(testRequest.body).toEqual({ accepted: true, eventId: expect.any(String) });
    await expect(
      database.client.outboxEvent.findUnique({ where: { id: testRequest.body.eventId } }),
    ).resolves.toMatchObject({
      actorMembershipId: membershipId,
      aggregateId: first.body.id,
      eventType: 'WEB_PUSH_TEST_REQUESTED',
      payload: { schemaVersion: 1, subscriptionId: first.body.id },
      workspaceId,
    });

    for (let index = 0; index < 2; index += 1) {
      await request(app.getHttpServer())
        .post(`/api/v1/notifications/push/subscriptions/${first.body.id}/test`)
        .set('Cookie', `rivet_session=${firstToken}`)
        .set('Origin', WEB_ORIGIN)
        .set('X-CSRF-Token', firstCsrf)
        .expect(202);
    }
    await request(app.getHttpServer())
      .post(`/api/v1/notifications/push/subscriptions/${first.body.id}/test`)
      .set('Cookie', `rivet_session=${firstToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', firstCsrf)
      .expect(429);
    await expect(
      database.client.outboxEvent.count({
        where: {
          aggregateId: first.body.id,
          eventType: 'WEB_PUSH_TEST_REQUESTED',
          workspaceId,
        },
      }),
    ).resolves.toBe(3);

    await register(
      secondToken,
      secondCsrf,
      `https://push.example.test/${runId}/first`,
      'EDGE',
    ).expect(201);
    await expect(
      database.client.webPushSubscription.findUnique({ where: { id: first.body.id } }),
    ).resolves.toMatchObject({ browser: 'EDGE', sessionId: secondSessionId, status: 'ACTIVE' });

    await sessions.revoke(firstSessionId);
    await expect(
      database.client.webPushSubscription.findUnique({ where: { id: second.body.id } }),
    ).resolves.toMatchObject({ auth: expect.any(String), status: 'ACTIVE' });

    await request(app.getHttpServer())
      .delete(`/api/v1/notifications/push/subscriptions/${second.body.id}`)
      .set('Cookie', `rivet_session=${secondToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', secondCsrf)
      .expect(204);
    await expect(
      database.client.webPushSubscription.findUnique({ where: { id: second.body.id } }),
    ).resolves.toMatchObject({ auth: null, endpoint: null, p256dh: null, status: 'INACTIVE' });
  });

  it('rejects cross-membership endpoint takeover, test, and deactivation', async () => {
    const ownerEndpoint = `https://push.example.test/${runId}/isolated-owner`;
    const owner = await register(secondToken, secondCsrf, ownerEndpoint, 'CHROME').expect(201);

    await register(foreignToken, foreignCsrf, ownerEndpoint, 'FIREFOX').expect(409);

    const foreign = await register(
      foreignToken,
      foreignCsrf,
      `https://push.example.test/${runId}/foreign`,
      'FIREFOX',
    ).expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/notifications/push/subscriptions/${foreign.body.id}/test`)
      .set('Cookie', `rivet_session=${secondToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', secondCsrf)
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/v1/notifications/push/subscriptions/${foreign.body.id}`)
      .set('Cookie', `rivet_session=${secondToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', secondCsrf)
      .expect(404);

    await expect(
      database.client.webPushSubscription.findUnique({ where: { id: owner.body.id } }),
    ).resolves.toMatchObject({ membershipId, status: 'ACTIVE' });
    await expect(
      database.client.webPushSubscription.findUnique({ where: { id: foreign.body.id } }),
    ).resolves.toMatchObject({ status: 'ACTIVE', workspaceId: foreignWorkspaceId });
  });
});
