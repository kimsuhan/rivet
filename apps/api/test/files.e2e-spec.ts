import { randomUUID } from 'node:crypto';
import { readdir, rm, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { IssueFileKind, MembershipRole, ProjectRole, ProjectStatus, StateCategory } from '@rivet/database';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap';
import { DatabaseService } from '../src/common/database/database.service';
import { AuthSessionService } from '../src/modules/auth/auth-session.service';
import { createCsrfToken } from '../src/modules/auth/auth-token.crypto';
import { FilesService } from '../src/modules/files/files.service';

const WEB_ORIGIN = 'http://localhost:3000';
const CSRF_HMAC_KEY = 'test-csrf-hmac-key-with-at-least-32-bytes';
const PASSWORD_HASH = 'integration-password-hash';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

describe('M5 files and profile', () => {
  const runId = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  let app: INestApplication;
  let database: DatabaseService;
  let files: FilesService;
  let memberUserId: string;
  let memberMembershipId: string;
  let workspaceId: string;
  let issueId: string;
  let projectId: string;
  let ownerCookie: string;
  let memberCookie: string;
  let foreignCookie: string;
  let onboardingCookie: string;
  let ownerCsrf: string;
  let memberCsrf: string;
  let foreignCsrf: string;
  let onboardingCsrf: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    database = app.get(DatabaseService);
    files = app.get(FilesService);

    const fixture = await database.client.$transaction(async (transaction) => {
      const users = await Promise.all(
        (
          [
            ['파일 관리자', 'owner'],
            ['파일 멤버', 'member'],
            ['다른 워크스페이스', 'foreign'],
            ['온보딩 사용자', 'onboarding'],
          ] as const
        ).map(([displayName, suffix]) => {
          const email = `m5.files.${suffix}.${runId}@example.com`;
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
      const [owner, member, foreign, onboarding] = users;
      if (!owner || !member || !foreign || !onboarding) throw new Error('파일 테스트 사용자 누락');

      const [workspace, foreignWorkspace] = await Promise.all([
        transaction.workspace.create({
          data: {
            createdByUserId: owner.id,
            name: 'M5 파일 워크스페이스',
            normalizedSlug: `m5-files-${runId}`,
            slug: `m5-files-${runId}`,
          },
          select: { id: true },
        }),
        transaction.workspace.create({
          data: {
            createdByUserId: foreign.id,
            name: 'M5 다른 워크스페이스',
            normalizedSlug: `m5-files-foreign-${runId}`,
            slug: `m5-files-foreign-${runId}`,
          },
          select: { id: true },
        }),
      ]);
      const [ownerMembership, memberMembership] = await Promise.all([
        transaction.workspaceMembership.create({
          data: { role: MembershipRole.ADMIN, userId: owner.id, workspaceId: workspace.id },
          select: { id: true },
        }),
        transaction.workspaceMembership.create({
          data: { role: MembershipRole.MEMBER, userId: member.id, workspaceId: workspace.id },
          select: { id: true },
        }),
      ]);
      await transaction.workspaceMembership.create({
        data: {
          role: MembershipRole.ADMIN,
          userId: foreign.id,
          workspaceId: foreignWorkspace.id,
        },
      });
      const team = await transaction.team.create({
        data: {
          key: 'FIL',
          name: '파일 팀',
          normalizedName: '파일 팀',
          workspaceId: workspace.id,
        },
        select: { id: true },
      });
      await transaction.teamMember.createMany({
        data: [ownerMembership.id, memberMembership.id].map((membershipId) => ({
          membershipId,
          teamId: team.id,
          workspaceId: workspace.id,
        })),
      });
      const state = await transaction.workflowState.create({
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
      });
      const project = await transaction.project.create({
        data: {
          leadMembershipId: memberMembership.id,
          name: '파일 프로젝트',
          status: ProjectStatus.IN_PROGRESS,
          workspaceId: workspace.id,
        },
        select: { id: true },
      });
      const issue = await transaction.issue.create({
        data: {
          createdByMembershipId: ownerMembership.id,
          identifier: 'F-1',
          projectId: project.id,
          sequenceNumber: 1,
          title: '파일 접근 테스트',
          workspaceId: workspace.id,
        },
        select: { id: true },
      });
      await transaction.teamWork.create({
        data: {
          assigneeMembershipId: memberMembership.id,
          createdByMembershipId: ownerMembership.id,
          identifier: 'FIL-1',
          issueId: issue.id,
          projectRole: ProjectRole.BACKEND,
          sequenceNumber: 1,
          teamId: team.id,
          workflowStateId: state.id,
          workspaceId: workspace.id,
        },
      });
      await transaction.activityEvent.create({
        data: {
          actorMembershipId: memberMembership.id,
          eventType: 'FILE_TEST_ACTIVITY',
          issueId: issue.id,
          workspaceId: workspace.id,
        },
      });

      return {
        foreignUserId: foreign.id,
        foreignWorkspaceId: foreignWorkspace.id,
        issueId: issue.id,
        memberMembershipId: memberMembership.id,
        memberUserId: member.id,
        onboardingUserId: onboarding.id,
        ownerMembershipId: ownerMembership.id,
        ownerUserId: owner.id,
        projectId: project.id,
        userIds: users.map(({ id }) => id),
        workspaceId: workspace.id,
      };
    });

    userIds.push(...fixture.userIds);
    workspaceIds.push(fixture.workspaceId, fixture.foreignWorkspaceId);
    memberUserId = fixture.memberUserId;
    memberMembershipId = fixture.memberMembershipId;
    workspaceId = fixture.workspaceId;
    issueId = fixture.issueId;
    projectId = fixture.projectId;

    const sessions = app.get(AuthSessionService);
    const [ownerSession, memberSession, foreignSession, onboardingSession] = await Promise.all([
      sessions.create(fixture.ownerUserId),
      sessions.create(fixture.memberUserId),
      sessions.create(fixture.foreignUserId),
      sessions.create(fixture.onboardingUserId),
    ]);
    ownerCookie = `rivet_session=${ownerSession.token}`;
    memberCookie = `rivet_session=${memberSession.token}`;
    foreignCookie = `rivet_session=${foreignSession.token}`;
    onboardingCookie = `rivet_session=${onboardingSession.token}`;
    ownerCsrf = createCsrfToken(ownerSession.token, CSRF_HMAC_KEY);
    memberCsrf = createCsrfToken(memberSession.token, CSRF_HMAC_KEY);
    foreignCsrf = createCsrfToken(foreignSession.token, CSRF_HMAC_KEY);
    onboardingCsrf = createCsrfToken(onboardingSession.token, CSRF_HMAC_KEY);
  });

  afterAll(async () => {
    if (database) {
      await database.client.user.updateMany({
        data: { avatarFileId: null },
        where: { id: { in: userIds } },
      });
      await database.client.issueFileAttachment.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.file.deleteMany({ where: { uploadedByUserId: { in: userIds } } });
      await database.client.activityEvent.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.teamWork.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.issue.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.project.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
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
    if (process.env.FILE_STORAGE_ROOT) {
      await rm(process.env.FILE_STORAGE_ROOT, { force: true, recursive: true });
    }
  });

  async function upload(
    cookie: string,
    csrf: string,
    scope: 'USER_PROFILE' | 'WORKSPACE',
    bytes: Buffer,
    filename: string,
  ): Promise<request.Response> {
    return request(app.getHttpServer())
      .post('/api/v1/files')
      .set('Cookie', cookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', csrf)
      .field('scope', scope)
      .attach('file', bytes, filename);
  }

  it('validates multipart size and magic bytes while storing objects/<uuid>', async () => {
    const missingFile = await request(app.getHttpServer())
      .post('/api/v1/files')
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrf)
      .field('scope', 'WORKSPACE');
    expect(missingFile.status).toBe(422);
    expect(missingFile.body.code).toBe('FILE_EMPTY');

    const invalidScope = await request(app.getHttpServer())
      .post('/api/v1/files')
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrf)
      .field('scope', 'INVALID')
      .attach('file', PNG, 'invalid.png');
    expect(invalidScope.status).toBe(422);
    expect(invalidScope.body.code).toBe('VALIDATION_ERROR');

    const unexpectedFileField = await request(app.getHttpServer())
      .post('/api/v1/files')
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrf)
      .field('scope', 'WORKSPACE')
      .attach('other', PNG, 'other.png');
    expect(unexpectedFileField.status).toBe(400);
    expect(unexpectedFileField.body.code).toBe('INVALID_REQUEST');

    const empty = await upload(memberCookie, memberCsrf, 'WORKSPACE', Buffer.alloc(0), 'empty.txt');
    expect(empty.status).toBe(422);
    expect(empty.body.code).toBe('FILE_EMPTY');

    const gifProfile = await upload(
      memberCookie,
      memberCsrf,
      'USER_PROFILE',
      Buffer.from('GIF89a'),
      'avatar.gif',
    );
    expect(gifProfile.status).toBe(415);
    expect(gifProfile.body.code).toBe('FILE_TYPE_NOT_ALLOWED');

    const oversized = await upload(
      memberCookie,
      memberCsrf,
      'WORKSPACE',
      Buffer.alloc(26_214_401, 1),
      'oversized.bin',
    );
    expect(oversized.status).toBe(413);
    expect(oversized.body.code).toBe('FILE_TOO_LARGE');

    const uploaded = await upload(memberCookie, memberCsrf, 'WORKSPACE', PNG, '화면.png');
    expect(uploaded.status).toBe(201);
    expect(uploaded.body).toMatchObject({
      detectedMimeType: 'image/png',
      inlineDisplayable: true,
      linked: false,
      originalName: '화면.png',
      scope: 'WORKSPACE',
      sizeBytes: PNG.length,
    });
    const stored = await database.client.file.findUniqueOrThrow({
      select: { storageKey: true },
      where: { id: uploaded.body.id as string },
    });
    expect(stored.storageKey).toBe(`objects/${uploaded.body.id as string}`);
    await expect(
      stat(join(process.env.FILE_STORAGE_ROOT!, stored.storageKey)),
    ).resolves.toMatchObject({
      size: PNG.length,
    });

    const temporaryFiles = await readdir(join(process.env.FILE_STORAGE_ROOT!, 'tmp'));
    expect(temporaryFiles).toEqual([]);
  });

  it('enforces unlinked, workspace, attachment, streaming, and missing-binary access', async () => {
    const uploaded = await upload(memberCookie, memberCsrf, 'WORKSPACE', PNG, '화면.png');
    expect(uploaded.status).toBe(201);
    const fileId = uploaded.body.id as string;

    await request(app.getHttpServer())
      .get(`/api/v1/files/${fileId}`)
      .set('Cookie', memberCookie)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/files/${fileId}`)
      .set('Cookie', ownerCookie)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/files/${fileId}`)
      .set('Cookie', foreignCookie)
      .expect(404);

    const attached = await request(app.getHttpServer())
      .post(`/api/v1/issues/${issueId}/attachments`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrf)
      .send({ fileId })
      .expect(201);
    expect(attached.body).toMatchObject({
      file: { id: fileId, linked: true },
      uploader: { id: memberUserId },
    });

    const streamed = await request(app.getHttpServer())
      .get(`/api/v1/files/${fileId}/content`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(streamed.headers['content-type']).toContain('image/png');
    expect(streamed.headers['content-disposition']).toContain('inline;');
    expect(streamed.headers['cache-control']).toBe('private, no-store');
    expect(streamed.headers['x-content-type-options']).toBe('nosniff');

    const downloaded = await request(app.getHttpServer())
      .get(`/api/v1/files/${fileId}/download`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(downloaded.headers['content-disposition']).toContain('attachment;');
    expect(downloaded.headers['cache-control']).toBe('private, no-store');
    expect(downloaded.headers['x-content-type-options']).toBe('nosniff');

    await request(app.getHttpServer())
      .get(`/api/v1/files/${fileId}/content`)
      .set('Cookie', foreignCookie)
      .expect(404);

    const listed = await request(app.getHttpServer())
      .get(`/api/v1/issues/${issueId}/attachments`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0]).toMatchObject({
      id: attached.body.id,
      uploader: { id: memberUserId },
    });

    await request(app.getHttpServer())
      .delete(`/api/v1/issues/${issueId}/attachments/${attached.body.id as string}`)
      .set('Cookie', ownerCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', ownerCsrf)
      .expect(204);
    await request(app.getHttpServer())
      .get(`/api/v1/files/${fileId}`)
      .set('Cookie', ownerCookie)
      .expect(404);
    await expect(
      database.client.file.findUniqueOrThrow({
        select: { unlinkedAt: true },
        where: { id: fileId },
      }),
    ).resolves.toEqual({ unlinkedAt: expect.any(Date) });

    const unavailable = await upload(memberCookie, memberCsrf, 'WORKSPACE', PNG, 'missing.png');
    const unavailableId = unavailable.body.id as string;
    const unavailableFile = await database.client.file.findUniqueOrThrow({
      select: { storageKey: true },
      where: { id: unavailableId },
    });
    await unlink(join(process.env.FILE_STORAGE_ROOT!, unavailableFile.storageKey));
    const unavailableResponse = await request(app.getHttpServer())
      .get(`/api/v1/files/${unavailableId}`)
      .set('Cookie', memberCookie)
      .expect(503);
    expect(unavailableResponse.body.code).toBe('FILE_UNAVAILABLE');
    await request(app.getHttpServer())
      .post(`/api/v1/issues/${issueId}/attachments`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrf)
      .send({ fileId: unavailableId })
      .expect(503);
    await request(app.getHttpServer())
      .delete(`/api/v1/files/${unavailableId}`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrf)
      .expect(204);
  });

  it('connects an owned profile image idempotently and propagates avatar summaries', async () => {
    const uploaded = await upload(memberCookie, memberCsrf, 'USER_PROFILE', PNG, '프로필.png');
    expect(uploaded.status).toBe(201);
    const avatarFileId = uploaded.body.id as string;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const avatar = await request(app.getHttpServer())
        .put('/api/v1/me/avatar')
        .set('Cookie', memberCookie)
        .set('Origin', WEB_ORIGIN)
        .set('X-CSRF-Token', memberCsrf)
        .send({ fileId: avatarFileId })
        .expect(200);
      expect(avatar.body.avatarFileId).toBe(avatarFileId);
    }

    const me = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Cookie', memberCookie)
      .expect(200);
    expect(me.body.avatarFileId).toBe(avatarFileId);
    const members = await request(app.getHttpServer())
      .get('/api/v1/members')
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(
      members.body.items.find(({ id }: { id: string }) => id === memberMembershipId),
    ).toMatchObject({
      user: { avatarFileId },
    });
    const issue = await request(app.getHttpServer())
      .get(`/api/v1/issues/${issueId}`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(
      issue.body.teamWorks.find(
        ({ assignee }: { assignee: { id: string } | null }) =>
          assignee?.id === memberMembershipId,
      ).assignee.user.avatarFileId,
    ).toBe(avatarFileId);
    const project = await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(project.body.lead.user.avatarFileId).toBe(avatarFileId);
    const timeline = await request(app.getHttpServer())
      .get(`/api/v1/issues/${issueId}/timeline`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(timeline.body.items[0].activity.actor.user.avatarFileId).toBe(avatarFileId);

    await request(app.getHttpServer())
      .get(`/api/v1/files/${avatarFileId}/content`)
      .set('Cookie', ownerCookie)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/files/${avatarFileId}`)
      .set('Cookie', foreignCookie)
      .expect(404);

    const cleared = await request(app.getHttpServer())
      .delete('/api/v1/me/avatar')
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrf)
      .expect(200);
    expect(cleared.body.avatarFileId).toBeNull();
    await expect(
      database.client.file.findUniqueOrThrow({
        select: { unlinkedAt: true },
        where: { id: avatarFileId },
      }),
    ).resolves.toEqual({ unlinkedAt: expect.any(Date) });
  });

  it('rejects absent workspace context, foreign files, invalid references, and partial missing sets', async () => {
    const noWorkspace = await request(app.getHttpServer())
      .get(`/api/v1/issues/${issueId}/attachments`)
      .set('Cookie', onboardingCookie)
      .expect(403);
    expect(noWorkspace.body.code).toBe('FORBIDDEN');
    const noWorkspaceUpload = await upload(
      onboardingCookie,
      onboardingCsrf,
      'WORKSPACE',
      PNG,
      'forbidden.png',
    );
    expect(noWorkspaceUpload.status).toBe(403);

    const foreignUpload = await upload(foreignCookie, foreignCsrf, 'WORKSPACE', PNG, 'foreign.png');
    expect(foreignUpload.status).toBe(201);
    const foreignAttach = await request(app.getHttpServer())
      .post(`/api/v1/issues/${issueId}/attachments`)
      .set('Cookie', memberCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', memberCsrf)
      .send({ fileId: foreignUpload.body.id })
      .expect(404);
    expect(foreignAttach.body.code).toBe('RESOURCE_NOT_FOUND');

    const valid = await upload(memberCookie, memberCsrf, 'WORKSPACE', PNG, 'body.png');
    const validFileId = valid.body.id as string;
    await expect(
      database.client.$transaction((transaction) =>
        files.attachIssueFiles(
          transaction,
          { membershipId: memberMembershipId, userId: memberUserId, workspaceId },
          issueId,
          [validFileId, randomUUID()],
        ),
      ),
    ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
    await expect(
      database.client.issueFileAttachment.count({ where: { fileId: validFileId } }),
    ).resolves.toBe(0);

    await expect(
      database.client.$transaction((transaction) =>
        files.syncBodyImages(
          transaction,
          { membershipId: memberMembershipId, userId: memberUserId, workspaceId },
          issueId,
          IssueFileKind.DESCRIPTION_IMAGE,
          ['not-a-uuid'],
        ),
      ),
    ).rejects.toMatchObject({ response: { code: 'FILE_REFERENCE_INVALID' } });

    await expect(
      database.client.$transaction((transaction) =>
        files.syncBodyImages(
          transaction,
          { membershipId: memberMembershipId, userId: memberUserId, workspaceId },
          issueId,
          IssueFileKind.DESCRIPTION_IMAGE,
          [validFileId, randomUUID()],
        ),
      ),
    ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
    await expect(
      database.client.issueFileAttachment.count({ where: { fileId: validFileId } }),
    ).resolves.toBe(0);
  });
});
