import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap';
import { DatabaseService } from '../src/common/database/database.service';
import { AuthSessionService } from '../src/modules/auth/auth-session.service';
import { createCsrfToken } from '../src/modules/auth/auth-token.crypto';

const WEB_ORIGIN = 'http://localhost:3000';
const CSRF_HMAC_KEY = 'test-csrf-hmac-key-with-at-least-32-bytes';
const PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$u5oksZN2qlFVAyszxdWrug$xmy/xfzl6zj7sfdlIBgb2F6zHrOnBcsxDzJEO7QyG0A';
const runId = randomUUID().slice(0, 8);

describe('A5 product feedback API', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let sessions: AuthSessionService;
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  const auth = new Map<string, { csrf: string; token: string }>();

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    database = app.get(DatabaseService);
    sessions = app.get(AuthSessionService);

    const createUser = async (kind: string) => {
      const email = `a5.feedback.${kind}.${runId}@example.com`;
      const user = await database.client.user.create({
        data: {
          displayName: kind,
          email,
          emailVerifiedAt: new Date(),
          normalizedEmail: email,
          passwordHash: PASSWORD_HASH,
        },
      });
      userIds.push(user.id);
      return user;
    };
    const [admin, member, otherAdmin] = await Promise.all([
      createUser('admin'),
      createUser('member'),
      createUser('other-admin'),
    ]);
    const [workspace, otherWorkspace] = await Promise.all([
      database.client.workspace.create({
        data: {
          createdByUserId: admin.id,
          name: 'A5 피드백',
          normalizedSlug: `a5-feedback-${runId}`,
          slug: `a5-feedback-${runId}`,
        },
      }),
      database.client.workspace.create({
        data: {
          createdByUserId: otherAdmin.id,
          name: 'A5 다른 피드백',
          normalizedSlug: `a5-feedback-other-${runId}`,
          slug: `a5-feedback-other-${runId}`,
        },
      }),
    ]);
    workspaceIds.push(workspace.id, otherWorkspace.id);
    await database.client.workspaceMembership.createMany({
      data: [
        { role: 'ADMIN', userId: admin.id, workspaceId: workspace.id },
        { role: 'MEMBER', userId: member.id, workspaceId: workspace.id },
        { role: 'ADMIN', userId: otherAdmin.id, workspaceId: otherWorkspace.id },
      ],
    });
    for (const [key, user] of [
      ['admin', admin],
      ['member', member],
      ['other', otherAdmin],
    ] as const) {
      const session = await sessions.create(user.id);
      auth.set(key, { csrf: createCsrfToken(session.token, CSRF_HMAC_KEY), token: session.token });
    }
  });

  afterAll(async () => {
    if (database) {
      await database.client.productEventState.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.productFeedback.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.authRateLimitBucket.deleteMany({
        where: { scope: 'PRODUCT_EVENT_MEMBERSHIP' },
      });
      await database.client.session.deleteMany({ where: { userId: { in: userIds } } });
      await database.client.workspaceMembership.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
      await database.client.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app?.close();
    if (process.env.FILE_STORAGE_ROOT)
      await rm(process.env.FILE_STORAGE_ROOT, { force: true, recursive: true });
  });

  it('preserves idempotency, admin status control, and workspace isolation over HTTP', async () => {
    const member = auth.get('member')!;
    const submissionId = randomUUID();
    const payload = {
      body: '검색 결과를 선택한 뒤 이전 위치로 돌아가기 어려웠습니다.',
      category: 'USABILITY',
      currentPath: '/ko/issues',
      submissionId,
    };
    const submit = (body = payload) =>
      request(app.getHttpServer())
        .post('/api/v1/feedback')
        .set('Cookie', `rivet_session=${member.token}`)
        .set('Origin', WEB_ORIGIN)
        .set('X-CSRF-Token', member.csrf)
        .send(body);
    const created = await submit().expect(201);
    const retried = await submit().expect(201);
    expect(created.headers['cache-control']).toBe('private, no-store');
    expect(created.body).toEqual({
      createdAt: expect.any(String),
      id: expect.any(String),
      status: 'RECEIVED',
      submissionId,
    });
    expect(created.body).not.toHaveProperty('body');
    expect(created.body).not.toHaveProperty('workspaceId');
    expect(created.body).not.toHaveProperty('submittedByMembershipId');
    expect(retried.body.id).toBe(created.body.id);
    expect(await database.client.productFeedback.count({ where: { submissionId } })).toBe(1);
    await submit({ ...payload, body: '같은 식별자에 다른 본문을 보냅니다.' })
      .expect(409)
      .expect('Cache-Control', 'private, no-store');

    for (const currentPath of [
      '/ko/issues?query=user@example.com',
      '/ko/issues?token=secret',
      '/ko/issues?fileName=private.csv',
      '/ko/issues?query=자유 검색어',
    ]) {
      await submit({ ...payload, currentPath, submissionId: randomUUID() }).expect(422);
    }

    const concurrentSubmissionId = randomUUID();
    const concurrent = await Promise.all([
      submit({ ...payload, submissionId: concurrentSubmissionId }),
      submit({ ...payload, submissionId: concurrentSubmissionId }),
    ]);
    expect(concurrent.map((response) => response.status)).toEqual([201, 201]);
    expect(concurrent[0].body.id).toBe(concurrent[1].body.id);
    expect(
      await database.client.productFeedback.count({
        where: { submissionId: concurrentSubmissionId },
      }),
    ).toBe(1);

    await request(app.getHttpServer())
      .get('/api/v1/feedback')
      .set('Cookie', `rivet_session=${member.token}`)
      .expect(403)
      .expect('Cache-Control', 'private, no-store');
    const other = auth.get('other')!;
    await request(app.getHttpServer())
      .get('/api/v1/feedback')
      .set('Cookie', `rivet_session=${other.token}`)
      .expect(200)
      .expect('Cache-Control', 'private, no-store')
      .expect(({ body }) => expect(body.items).toHaveLength(0));

    const admin = auth.get('admin')!;
    const list = await request(app.getHttpServer())
      .get('/api/v1/feedback')
      .set('Cookie', `rivet_session=${admin.token}`)
      .expect(200);
    expect(list.headers['cache-control']).toBe('private, no-store');
    expect(list.body.items).toHaveLength(2);
    expect(list.body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ body: payload.body, status: 'RECEIVED' })]),
    );
    await request(app.getHttpServer())
      .patch(`/api/v1/feedback/${created.body.id}/status`)
      .set('Cookie', `rivet_session=${admin.token}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', admin.csrf)
      .send({ status: 'IN_REVIEW', version: 1 })
      .expect(200)
      .expect('Cache-Control', 'private, no-store')
      .expect(({ body }) => expect(body).toMatchObject({ status: 'IN_REVIEW', version: 2 }));
    await request(app.getHttpServer())
      .patch(`/api/v1/feedback/${created.body.id}/status`)
      .set('Cookie', `rivet_session=${admin.token}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', admin.csrf)
      .send({ status: 'IMPLEMENTED', version: 1 })
      .expect(409)
      .expect('Cache-Control', 'private, no-store');

    await request(app.getHttpServer())
      .patch(`/api/v1/feedback/${created.body.id}/status`)
      .set('Cookie', `rivet_session=${other.token}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', other.csrf)
      .send({ status: 'DEFERRED', version: 2 })
      .expect(404);

    const clientEvent = {
      name: 'push_permission_result',
      properties: { result: 'UNSUPPORTED' },
    };
    await request(app.getHttpServer())
      .post('/api/v1/product-events')
      .set('Cookie', `rivet_session=${member.token}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', member.csrf)
      .send(clientEvent)
      .expect(202);
    await request(app.getHttpServer())
      .post('/api/v1/product-events')
      .set('Cookie', `rivet_session=${member.token}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', member.csrf)
      .send(clientEvent)
      .expect(202);
    await request(app.getHttpServer())
      .post('/api/v1/product-events')
      .set('Cookie', `rivet_session=${member.token}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', member.csrf)
      .send({ name: 'push_permission_result', properties: { result: 'GRANTED' } })
      .expect(202);
    const permissionState = await database.client.productEventState.findFirstOrThrow({
      where: { semanticKey: 'push-permission', workspaceId: workspaceIds[0]! },
    });
    expect(permissionState).toMatchObject({ stateValue: 'GRANTED', version: 2 });

    for (const properties of [
      { notificationId: randomUUID() },
      { templateId: randomUUID() },
      { resourceType: 'ISSUES', savedViewId: randomUUID() },
    ]) {
      const name =
        'notificationId' in properties
          ? 'push_notification_clicked'
          : 'templateId' in properties
            ? 'issue_template_applied'
            : 'saved_view_opened';
      await request(app.getHttpServer())
        .post('/api/v1/product-events')
        .set('Cookie', `rivet_session=${member.token}`)
        .set('Origin', WEB_ORIGIN)
        .set('X-CSRF-Token', member.csrf)
        .send({ name, properties })
        .expect(422);
    }

    for (const occurredAt of ['2020-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z']) {
      await request(app.getHttpServer())
        .post('/api/v1/product-events')
        .set('Cookie', `rivet_session=${member.token}`)
        .set('Origin', WEB_ORIGIN)
        .set('X-CSRF-Token', member.csrf)
        .send({
          ...clientEvent,
          eventId: randomUUID(),
          occurredAt,
          payloadVersion: 1,
        })
        .expect(422);
    }

    let rateLimited = false;
    for (let index = 0; index < 60; index += 1) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/product-events')
        .set('Cookie', `rivet_session=${member.token}`)
        .set('Origin', WEB_ORIGIN)
        .set('X-CSRF-Token', member.csrf)
        .send(clientEvent);
      if (response.status === 429) {
        rateLimited = true;
        break;
      }
      expect(response.status).toBe(202);
    }
    expect(rateLimited).toBe(true);
    await expect(
      database.client.productEventState.findFirstOrThrow({
        where: { semanticKey: 'push-permission', workspaceId: workspaceIds[0]! },
      }),
    ).resolves.toMatchObject({ stateValue: 'UNSUPPORTED', version: 3 });
  });
});
