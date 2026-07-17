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

describe('A2 personal saved views API', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let sessions: AuthSessionService;
  let ownerSessionToken: string;
  let ownerCsrfToken: string;
  let memberSessionToken: string;
  let memberCsrfToken: string;
  let otherSessionToken: string;
  let otherCsrfToken: string;
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    database = app.get(DatabaseService);
    sessions = app.get(AuthSessionService);

    const createUser = (displayName: string, kind: string) => {
      const email = `a2.saved-view.${kind}.${runId}@example.com`;
      return database.client.user.create({
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
    const [owner, member, other] = await Promise.all([
      createUser('보기 소유자', 'owner'),
      createUser('같은 워크스페이스 멤버', 'member'),
      createUser('다른 워크스페이스 멤버', 'other'),
    ]);
    userIds.push(owner.id, member.id, other.id);

    const [workspace, otherWorkspace] = await Promise.all([
      database.client.workspace.create({
        data: {
          createdByUserId: owner.id,
          name: 'A2 저장된 보기 워크스페이스',
          normalizedSlug: `a2-saved-view-${runId}`,
          slug: `a2-saved-view-${runId}`,
        },
        select: { id: true },
      }),
      database.client.workspace.create({
        data: {
          createdByUserId: other.id,
          name: '다른 A2 워크스페이스',
          normalizedSlug: `a2-saved-view-other-${runId}`,
          slug: `a2-saved-view-other-${runId}`,
        },
        select: { id: true },
      }),
    ]);
    workspaceIds.push(workspace.id, otherWorkspace.id);
    await database.client.workspaceMembership.createMany({
      data: [
        { role: 'ADMIN', status: 'ACTIVE', userId: owner.id, workspaceId: workspace.id },
        { role: 'MEMBER', status: 'ACTIVE', userId: member.id, workspaceId: workspace.id },
        { role: 'ADMIN', status: 'ACTIVE', userId: other.id, workspaceId: otherWorkspace.id },
      ],
    });

    const [ownerSession, memberSession, otherSession] = await Promise.all([
      sessions.create(owner.id),
      sessions.create(member.id),
      sessions.create(other.id),
    ]);
    ownerSessionToken = ownerSession.token;
    ownerCsrfToken = createCsrfToken(ownerSessionToken, CSRF_HMAC_KEY);
    memberSessionToken = memberSession.token;
    memberCsrfToken = createCsrfToken(memberSessionToken, CSRF_HMAC_KEY);
    otherSessionToken = otherSession.token;
    otherCsrfToken = createCsrfToken(otherSessionToken, CSRF_HMAC_KEY);
  });

  afterAll(async () => {
    if (database) {
      await database.client.session.deleteMany({ where: { userId: { in: userIds } } });
      await database.client.savedView.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
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

  it('isolates personal views and returns conflict recovery metadata over HTTP', async () => {
    const createView = (name: string, configuration: Record<string, unknown> = {}) =>
      request(app.getHttpServer())
        .post('/api/v1/saved-views')
        .set('Cookie', `rivet_session=${ownerSessionToken}`)
        .set('Origin', WEB_ORIGIN)
        .set('X-CSRF-Token', ownerCsrfToken)
        .send({ configuration, name, resourceType: 'ISSUES' });

    const first = await createView('긴급 보기', { query: '긴급', sort: 'updatedAt' }).expect(201);
    const second = await createView('다른 보기').expect(201);
    const firstId = first.body.id as string;
    const secondId = second.body.id as string;

    await request(app.getHttpServer())
      .get('/api/v1/saved-views?resourceType=ISSUES')
      .set('Cookie', `rivet_session=${ownerSessionToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.items).toHaveLength(2));
    await createView('  긴급 보기  ').expect(409).expect(({ body }) => {
      expect(body.code).toBe('SAVED_VIEW_NAME_IN_USE');
    });
    await createView('잘못된 보기', { url: 'https://unsafe.example' }).expect(422).expect(({ body }) => {
      expect(body.code).toBe('SAVED_VIEW_CONFIGURATION_INVALID');
    });

    for (const [token, csrf] of [
      [memberSessionToken, memberCsrfToken],
      [otherSessionToken, otherCsrfToken],
    ] as Array<[string, string]>) {
      await request(app.getHttpServer())
        .get(`/api/v1/saved-views/${firstId}`)
        .set('Cookie', `rivet_session=${token}`)
        .expect(404);
      await request(app.getHttpServer())
        .patch(`/api/v1/saved-views/${firstId}`)
        .set('Cookie', `rivet_session=${token}`)
        .set('Origin', WEB_ORIGIN)
        .set('X-CSRF-Token', csrf)
        .send({ name: '침입', version: 1 })
        .expect(404);
      await request(app.getHttpServer())
        .delete(`/api/v1/saved-views/${firstId}?version=1`)
        .set('Cookie', `rivet_session=${token}`)
        .set('Origin', WEB_ORIGIN)
        .set('X-CSRF-Token', csrf)
        .expect(404);
      await request(app.getHttpServer())
        .post(`/api/v1/saved-views/${firstId}/default`)
        .set('Cookie', `rivet_session=${token}`)
        .set('Origin', WEB_ORIGIN)
        .set('X-CSRF-Token', csrf)
        .send({ version: 1 })
        .expect(404);
    }

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/saved-views/${firstId}`)
      .set('Cookie', `rivet_session=${ownerSessionToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', ownerCsrfToken)
      .send({ name: '긴급 보기 수정', version: 1 })
      .expect(200);
    expect(updated.body.version).toBe(2);

    for (const path of [
      { method: 'patch', path: `/api/v1/saved-views/${firstId}`, send: { name: '오래됨', version: 1 } },
      { method: 'delete', path: `/api/v1/saved-views/${firstId}?version=1`, send: undefined },
      { method: 'post', path: `/api/v1/saved-views/${firstId}/default`, send: { version: 1 } },
    ] as const) {
      let operation = request(app.getHttpServer())[path.method](path.path)
        .set('Cookie', `rivet_session=${ownerSessionToken}`)
        .set('Origin', WEB_ORIGIN)
        .set('X-CSRF-Token', ownerCsrfToken);
      if (path.send) operation = operation.send(path.send);
      await operation.expect(409).expect(({ body }) => {
        expect(body).toMatchObject({ code: 'SAVED_VIEW_VERSION_CONFLICT', currentVersion: 2 });
      });
    }

    await request(app.getHttpServer())
      .post(`/api/v1/saved-views/${firstId}/default`)
      .set('Cookie', `rivet_session=${ownerSessionToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', ownerCsrfToken)
      .send({ version: 2 })
      .expect(200);
    const replaced = await request(app.getHttpServer())
      .post(`/api/v1/saved-views/${secondId}/default`)
      .set('Cookie', `rivet_session=${ownerSessionToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', ownerCsrfToken)
      .send({ version: 1 })
      .expect(200);
    expect(replaced.body).toMatchObject({ id: secondId, isDefault: true });
  });
});
