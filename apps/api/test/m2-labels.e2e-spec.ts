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

describe('M2 workspace labels', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let sessions: AuthSessionService;
  let adminSessionToken: string;
  let adminCsrfToken: string;
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
      const email = `m2.labels.${kind}.${runId}@example.com`;
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
    const [admin, member, other] = await Promise.all([
      createUser('라벨 관리자', 'admin'),
      createUser('라벨 멤버', 'member'),
      createUser('다른 워크스페이스 관리자', 'other'),
    ]);
    userIds.push(admin.id, member.id, other.id);

    const [workspace, otherWorkspace] = await Promise.all([
      database.client.workspace.create({
        data: {
          createdByUserId: admin.id,
          name: 'M2 라벨 워크스페이스',
          normalizedSlug: `m2-labels-${runId}`,
          slug: `m2-labels-${runId}`,
        },
        select: { id: true },
      }),
      database.client.workspace.create({
        data: {
          createdByUserId: other.id,
          name: '다른 워크스페이스',
          normalizedSlug: `m2-labels-other-${runId}`,
          slug: `m2-labels-other-${runId}`,
        },
        select: { id: true },
      }),
    ]);
    workspaceIds.push(workspace.id, otherWorkspace.id);

    await database.client.workspaceMembership.createMany({
      data: [
        { role: 'ADMIN', status: 'ACTIVE', userId: admin.id, workspaceId: workspace.id },
        { role: 'MEMBER', status: 'ACTIVE', userId: member.id, workspaceId: workspace.id },
        { role: 'ADMIN', status: 'ACTIVE', userId: other.id, workspaceId: otherWorkspace.id },
      ],
    });

    const [adminSession, memberSession, otherSession] = await Promise.all([
      sessions.create(admin.id),
      sessions.create(member.id),
      sessions.create(other.id),
    ]);
    adminSessionToken = adminSession.token;
    adminCsrfToken = createCsrfToken(adminSessionToken, CSRF_HMAC_KEY);
    memberSessionToken = memberSession.token;
    memberCsrfToken = createCsrfToken(memberSessionToken, CSRF_HMAC_KEY);
    otherSessionToken = otherSession.token;
    otherCsrfToken = createCsrfToken(otherSessionToken, CSRF_HMAC_KEY);
  });

  afterAll(async () => {
    if (database) {
      await database.client.session.deleteMany({ where: { userId: { in: userIds } } });
      await database.client.savedView.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.label.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
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

  it('creates, searches, paginates, updates, archives, and isolates labels', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/labels')
      .set('Cookie', `rivet_session=${adminSessionToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({ color: '#d84a4a', name: '  Bug  ' })
      .expect(201);
    expect(created.body).toMatchObject({
      archived: false,
      color: '#D84A4A',
      name: 'Bug',
      version: 1,
    });
    const labelId = created.body.id as string;

    const duplicate = await request(app.getHttpServer())
      .post('/api/v1/labels')
      .set('Cookie', `rivet_session=${adminSessionToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({ color: '#123456', name: 'bug' })
      .expect(409);
    expect(duplicate.body.code).toBe('LABEL_NAME_IN_USE');

    const memberDenied = await request(app.getHttpServer())
      .post('/api/v1/labels')
      .set('Cookie', `rivet_session=${memberSessionToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrfToken)
      .send({ color: '#123456', name: '멤버 라벨' })
      .expect(403);
    expect(memberDenied.body.code).toBe('FORBIDDEN');

    for (const [name, color] of [
      ['Feature', '#6C5CE7'],
      ['Operations', '#2AA198'],
    ]) {
      await request(app.getHttpServer())
        .post('/api/v1/labels')
        .set('Cookie', `rivet_session=${adminSessionToken}`)
        .set('Origin', WEB_ORIGIN)
        .set('X-CSRF-Token', adminCsrfToken)
        .send({ color, name })
        .expect(201);
    }

    const firstPage = await request(app.getHttpServer())
      .get('/api/v1/labels?limit=1')
      .set('Cookie', `rivet_session=${memberSessionToken}`)
      .expect(200);
    expect(firstPage.body.items).toHaveLength(1);
    expect(firstPage.body.nextCursor).toEqual(expect.any(String));

    const secondPage = await request(app.getHttpServer())
      .get(`/api/v1/labels?limit=1&cursor=${String(firstPage.body.nextCursor)}`)
      .set('Cookie', `rivet_session=${memberSessionToken}`)
      .expect(200);
    expect(secondPage.body.items).toHaveLength(1);
    expect(secondPage.body.items[0].id).not.toBe(firstPage.body.items[0].id);

    const search = await request(app.getHttpServer())
      .get('/api/v1/labels?query=bu')
      .set('Cookie', `rivet_session=${memberSessionToken}`)
      .expect(200);
    expect(search.body.items).toEqual([expect.objectContaining({ id: labelId, name: 'Bug' })]);

    const hiddenFromOtherWorkspace = await request(app.getHttpServer())
      .patch(`/api/v1/labels/${labelId}`)
      .set('Cookie', `rivet_session=${otherSessionToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', otherCsrfToken)
      .send({ color: '#00AAEE', version: 1 })
      .expect(404);
    expect(hiddenFromOtherWorkspace.body.code).toBe('RESOURCE_NOT_FOUND');

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/labels/${labelId}`)
      .set('Cookie', `rivet_session=${adminSessionToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({ color: '#00aaee', name: ' Defect ', version: 1 })
      .expect(200);
    expect(updated.body).toMatchObject({ color: '#00AAEE', name: 'Defect', version: 2 });

    const stale = await request(app.getHttpServer())
      .patch(`/api/v1/labels/${labelId}`)
      .set('Cookie', `rivet_session=${adminSessionToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({ color: '#123456', version: 1 })
      .expect(409);
    expect(stale.body).toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: 2 });

    const archived = await request(app.getHttpServer())
      .post(`/api/v1/labels/${labelId}/archive`)
      .set('Cookie', `rivet_session=${adminSessionToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({ version: 2 })
      .expect(200);
    expect(archived.body).toMatchObject({ archived: true, version: 3 });

    const activeOnly = await request(app.getHttpServer())
      .get('/api/v1/labels?query=defect')
      .set('Cookie', `rivet_session=${memberSessionToken}`)
      .expect(200);
    expect(activeOnly.body.items).toEqual([]);

    const withArchived = await request(app.getHttpServer())
      .get('/api/v1/labels?includeArchived=true&query=defect')
      .set('Cookie', `rivet_session=${memberSessionToken}`)
      .expect(200);
    expect(withArchived.body.items).toEqual([
      expect.objectContaining({ archived: true, id: labelId, name: 'Defect' }),
    ]);

    await request(app.getHttpServer())
      .post('/api/v1/labels')
      .set('Cookie', `rivet_session=${adminSessionToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({ color: '#123456', name: 'DEFECT' })
      .expect(201);

    const archivedOnly = await request(app.getHttpServer())
      .get('/api/v1/labels?archivedOnly=true&includeArchived=true&query=defect')
      .set('Cookie', `rivet_session=${memberSessionToken}`)
      .expect(200);
    expect(archivedOnly.body.items).toEqual([
      expect.objectContaining({ archived: true, id: labelId, name: 'Defect' }),
    ]);

    const invalidCursor = await request(app.getHttpServer())
      .get('/api/v1/labels?cursor=not%2Ba%2Bcursor')
      .set('Cookie', `rivet_session=${memberSessionToken}`)
      .expect(400);
    expect(invalidCursor.body.code).toBe('INVALID_QUERY');
  });

});
