import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { MembershipRole, MembershipStatus, TokenPurpose } from '@rivet/database';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap';
import { DatabaseService } from '../src/common/database/database.service';
import { createOneTimeToken } from '../src/modules/auth/auth-token';

const WEB_ORIGIN = 'http://localhost:3000';
const TOKEN_HMAC_KEY = 'test-token-hmac-key-with-at-least-32-bytes';
const runId = randomUUID().slice(0, 8);
const flowNormalizedEmail = `m1.flow.${runId}@example.com`;
const expiredNormalizedEmail = `m1.expired.${runId}@example.com`;
const crossWorkspaceNormalizedEmail = `m1.cross.${runId}@example.com`;
const normalizedEmails = [
  flowNormalizedEmail,
  expiredNormalizedEmail,
  crossWorkspaceNormalizedEmail,
];

describe('M1 authentication and first workspace', () => {
  let app: INestApplication;
  let database: DatabaseService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    database = app.get(DatabaseService);
    await database.client.authRateLimitBucket.deleteMany();
  });

  afterAll(async () => {
    if (database) {
      const users = await database.client.user.findMany({
        select: { id: true },
        where: { normalizedEmail: { in: normalizedEmails } },
      });
      const userIds = users.map(({ id }) => id);
      const workspaces = await database.client.workspace.findMany({
        select: { id: true },
        where: { createdByUserId: { in: userIds } },
      });
      const workspaceIds = workspaces.map(({ id }) => id);
      const outboxEvents = await database.client.outboxEvent.findMany({
        select: { id: true },
        where: {
          OR: [{ aggregateId: { in: userIds } }, { workspaceId: { in: workspaceIds } }],
        },
      });
      const outboxEventIds = outboxEvents.map(({ id }) => id);

      await database.client.emailDelivery.deleteMany({
        where: { outboxEventId: { in: outboxEventIds } },
      });
      await database.client.outboxEvent.deleteMany({ where: { id: { in: outboxEventIds } } });
      await database.client.workflowState.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.teamMember.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.team.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.workspaceMembership.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
      await database.client.session.deleteMany({ where: { userId: { in: userIds } } });
      await database.client.oneTimeToken.deleteMany({ where: { userId: { in: userIds } } });
      await database.client.user.deleteMany({ where: { id: { in: userIds } } });
      await database.client.authRateLimitBucket.deleteMany();
    }

    await app?.close();

    if (process.env.FILE_STORAGE_ROOT) {
      await rm(process.env.FILE_STORAGE_ROOT, { force: true, recursive: true });
    }
  });

  it('rejects public mutations with an unsafe origin or non-JSON body', async () => {
    const body = {
      displayName: '출처 검사',
      email: `m1.origin.${runId}@example.com`,
      password: '출처 검사를 위한 충분히 긴 비밀번호',
    };

    const missingOrigin = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-up')
      .send(body)
      .expect(403);
    expect(missingOrigin.body.code).toBe('CSRF_INVALID');

    const externalOrigin = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-up')
      .set('Origin', 'https://evil.example')
      .send(body)
      .expect(403);
    expect(externalOrigin.body.code).toBe('CSRF_INVALID');

    const formRequest = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-up')
      .set('Origin', WEB_ORIGIN)
      .type('form')
      .send(body)
      .expect(400);
    expect(formRequest.body.code).toBe('INVALID_REQUEST');

    const protectedFormRequest = await request(app.getHttpServer())
      .post('/api/v1/workspaces')
      .set('Origin', WEB_ORIGIN)
      .type('form')
      .send({ name: '형식 검사', slug: `format-${runId}` })
      .expect(400);
    expect(protectedFormRequest.body.code).toBe('INVALID_REQUEST');
  });

  it('rejects invalid, expired, and reusable email verification tokens', async () => {
    const email = expiredNormalizedEmail;
    const password = '만료 토큰 검증을 위한 충분히 긴 비밀번호';

    await request(app.getHttpServer())
      .post('/api/v1/auth/sign-up')
      .set('Origin', WEB_ORIGIN)
      .send({ displayName: '만료 토큰', email, password })
      .expect(202);

    const user = await database.client.user.findUniqueOrThrow({
      select: { id: true },
      where: { normalizedEmail: email },
    });
    const token = await database.client.oneTimeToken.findFirstOrThrow({
      orderBy: { createdAt: 'desc' },
      select: { id: true },
      where: { purpose: TokenPurpose.EMAIL_VERIFICATION, userId: user.id },
    });
    const rawToken = createOneTimeToken('EMAIL_VERIFICATION', TOKEN_HMAC_KEY, token.id).token;

    const invalid = await request(app.getHttpServer())
      .post('/api/v1/auth/email-verifications/verify')
      .set('Origin', WEB_ORIGIN)
      .send({ token: `${rawToken}tampered` })
      .expect(422);
    expect(invalid.body.code).toBe('TOKEN_INVALID');

    await database.client.$executeRaw`
      UPDATE "one_time_tokens"
      SET "created_at" = NOW() - INTERVAL '2 days',
          "expires_at" = NOW() - INTERVAL '1 day'
      WHERE "id" = ${token.id}::uuid
    `;

    const expired = await request(app.getHttpServer())
      .post('/api/v1/auth/email-verifications/verify')
      .set('Origin', WEB_ORIGIN)
      .send({ token: rawToken })
      .expect(410);
    expect(expired.body.code).toBe('TOKEN_EXPIRED');
  });

  it('completes signup, onboarding, password reset, logout, and rate limiting', async () => {
    const agent = request.agent(app.getHttpServer());
    const email = `M1.Flow.${runId}@Example.com`;
    const normalizedEmail = flowNormalizedEmail;
    const password = 'NFC와 공백을 허용하는 충분히 긴 비밀번호 2026';
    const newPassword = '재설정 후 사용하는 충분히 긴 새 비밀번호 2027';
    const slug = `m1-${runId}`;

    const signup = await agent
      .post('/api/v1/auth/sign-up')
      .set('Origin', WEB_ORIGIN)
      .send({ displayName: '  M1 사용자  ', email: `  ${email}  `, password })
      .expect(202);
    expect(signup.body.accepted).toBe(true);
    expect(signup.body.emailMasked).toBe(`M1***@Example.com`);
    expect(signup.body.nextStep).toBe('VERIFY_EMAIL');
    expect(signup.headers['set-cookie']).toBeUndefined();

    const user = await database.client.user.findUniqueOrThrow({
      select: { email: true, emailVerifiedAt: true, id: true, passwordHash: true },
      where: { normalizedEmail },
    });
    expect(user.email).toBe(email);
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);

    const verificationToken = await database.client.oneTimeToken.findFirstOrThrow({
      orderBy: { createdAt: 'desc' },
      select: { id: true, tokenHash: true },
      where: { purpose: TokenPurpose.EMAIL_VERIFICATION, userId: user.id },
    });
    expect(verificationToken.tokenHash).toHaveLength(32);
    expect(
      await database.client.outboxEvent.count({
        where: { aggregateId: user.id, eventType: 'AUTH_EMAIL_VERIFICATION_REQUESTED' },
      }),
    ).toBe(1);

    const unverifiedLogin = await agent
      .post('/api/v1/auth/login')
      .set('Origin', WEB_ORIGIN)
      .send({ email, password })
      .expect(403);
    expect(unverifiedLogin.body.code).toBe('EMAIL_NOT_VERIFIED');
    expect(unverifiedLogin.headers['set-cookie']).toBeUndefined();
    expect(await database.client.session.count({ where: { userId: user.id } })).toBe(0);

    const rawVerificationToken = createOneTimeToken(
      'EMAIL_VERIFICATION',
      TOKEN_HMAC_KEY,
      verificationToken.id,
    ).token;
    const verification = await agent
      .post('/api/v1/auth/email-verifications/verify')
      .set('Origin', WEB_ORIGIN)
      .send({ token: rawVerificationToken })
      .expect(200);
    expect(verification.body).toEqual({ verified: true });
    expect(verification.headers['set-cookie']).toBeUndefined();

    const reusedVerification = await agent
      .post('/api/v1/auth/email-verifications/verify')
      .set('Origin', WEB_ORIGIN)
      .send({ token: rawVerificationToken })
      .expect(409);
    expect(reusedVerification.body.code).toBe('TOKEN_ALREADY_USED');

    const login = await agent
      .post('/api/v1/auth/login')
      .set('Origin', WEB_ORIGIN)
      .send({ email: normalizedEmail, password })
      .expect(200);
    expect(login.body).toMatchObject({
      authenticated: true,
      membership: null,
      onboardingStep: 'CREATE_WORKSPACE',
      user: { displayName: 'M1 사용자', email, id: user.id },
      workspace: null,
    });
    expect(login.body.csrfToken).toMatch(/^[A-Za-z0-9_-]+$/);
    const setCookies = login.headers['set-cookie'];
    expect(Array.isArray(setCookies)).toBe(true);
    const sessionCookie = Array.isArray(setCookies) ? setCookies[0] : undefined;
    expect(sessionCookie).toContain('rivet_session=');
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('SameSite=Lax');
    expect(sessionCookie).toContain('Path=/');
    expect(sessionCookie).not.toContain('Secure');
    expect(sessionCookie).not.toContain('Domain=');
    const csrfToken = login.body.csrfToken as string;

    const noWorkspace = await agent.get('/api/v1/workspace').expect(404);
    expect(noWorkspace.body.code).toBe('RESOURCE_NOT_FOUND');

    const noOrigin = await agent
      .post('/api/v1/workspaces')
      .set('X-CSRF-Token', csrfToken)
      .send({ name: 'M1 워크스페이스', slug })
      .expect(403);
    expect(noOrigin.body.code).toBe('CSRF_INVALID');

    const noCsrf = await agent
      .post('/api/v1/workspaces')
      .set('Origin', WEB_ORIGIN)
      .send({ name: 'M1 워크스페이스', slug })
      .expect(403);
    expect(noCsrf.body.code).toBe('CSRF_INVALID');

    const workspace = await agent
      .post('/api/v1/workspaces')
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', csrfToken)
      .send({ name: 'M1 워크스페이스', slug })
      .expect(201);
    expect(workspace.body).toMatchObject({ name: 'M1 워크스페이스', slug, version: 1 });

    const afterWorkspace = await agent.get('/api/v1/auth/session').expect(200);
    expect(afterWorkspace.body).toMatchObject({
      authenticated: true,
      membership: { role: 'ADMIN', status: 'ACTIVE' },
      onboardingStep: 'CREATE_TEAM',
      workspace: { id: workspace.body.id, slug },
    });
    const membershipId = afterWorkspace.body.membership.id as string;
    expect((await agent.get('/api/v1/workspace').expect(200)).body).toEqual(workspace.body);

    const crossWorkspaceMembership = await database.client.$transaction(async (transaction) => {
      const crossWorkspaceUser = await transaction.user.create({
        data: {
          displayName: '다른 워크스페이스 사용자',
          email: crossWorkspaceNormalizedEmail,
          emailVerifiedAt: new Date(),
          normalizedEmail: crossWorkspaceNormalizedEmail,
          passwordHash: user.passwordHash,
        },
        select: { id: true },
      });
      const crossWorkspace = await transaction.workspace.create({
        data: {
          createdByUserId: crossWorkspaceUser.id,
          name: '다른 워크스페이스',
          normalizedSlug: `m1-cross-${runId}`,
          slug: `m1-cross-${runId}`,
        },
        select: { id: true },
      });

      return transaction.workspaceMembership.create({
        data: {
          role: MembershipRole.ADMIN,
          status: MembershipStatus.ACTIVE,
          userId: crossWorkspaceUser.id,
          workspaceId: crossWorkspace.id,
        },
        select: { id: true },
      });
    });
    const teamRowsBeforeCrossWorkspaceRequest = await Promise.all([
      database.client.team.count({ where: { workspaceId: workspace.body.id as string } }),
      database.client.teamMember.count({ where: { workspaceId: workspace.body.id as string } }),
      database.client.workflowState.count({ where: { workspaceId: workspace.body.id as string } }),
    ]);

    const crossWorkspaceTeam = await agent
      .post('/api/v1/teams')
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', csrfToken)
      .send({
        key: 'BAD',
        memberIds: [membershipId, crossWorkspaceMembership.id],
        name: '격리 위반 팀',
      })
      .expect(404);
    expect(crossWorkspaceTeam.body.code).toBe('RESOURCE_NOT_FOUND');
    await expect(
      Promise.all([
        database.client.team.count({ where: { workspaceId: workspace.body.id as string } }),
        database.client.teamMember.count({ where: { workspaceId: workspace.body.id as string } }),
        database.client.workflowState.count({
          where: { workspaceId: workspace.body.id as string },
        }),
      ]),
    ).resolves.toEqual(teamRowsBeforeCrossWorkspaceRequest);

    const secondWorkspace = await agent
      .post('/api/v1/workspaces')
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', csrfToken)
      .send({ name: '두 번째 워크스페이스', slug: `${slug}-second` })
      .expect(409);
    expect(secondWorkspace.body.code).toBe('WORKSPACE_LIMIT_REACHED');

    const team = await agent
      .post('/api/v1/teams')
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', csrfToken)
      .send({ key: 'MVP', memberIds: [membershipId], name: '기본 팀' })
      .expect(201);
    expect(team.body).toMatchObject({ archived: false, key: 'MVP', name: '기본 팀' });
    expect(team.body.workflowStates).toEqual([
      expect.objectContaining({ category: 'BACKLOG', isDefault: true, name: '미분류' }),
      expect.objectContaining({ category: 'UNSTARTED', isDefault: false, name: '할 일' }),
      expect.objectContaining({ category: 'STARTED', isDefault: false, name: '진행 중' }),
      expect.objectContaining({ category: 'STARTED', isDefault: false, name: '검토' }),
      expect.objectContaining({ category: 'COMPLETED', isDefault: false, name: '완료' }),
      expect.objectContaining({ category: 'BACKLOG', isDefault: false, name: '보류' }),
      expect.objectContaining({ category: 'CANCELED', isDefault: false, name: '취소' }),
    ]);
    expect((await agent.get('/api/v1/auth/session').expect(200)).body.onboardingStep).toBe(
      'COMPLETE',
    );

    await agent
      .post('/api/v1/auth/password-resets/request')
      .set('Origin', WEB_ORIGIN)
      .send({ email })
      .expect(204);
    const firstResetToken = await database.client.oneTimeToken.findFirstOrThrow({
      orderBy: { createdAt: 'desc' },
      select: { id: true },
      where: { purpose: TokenPurpose.PASSWORD_RESET, userId: user.id },
    });
    const firstRawResetToken = createOneTimeToken(
      'PASSWORD_RESET',
      TOKEN_HMAC_KEY,
      firstResetToken.id,
    ).token;

    await agent
      .post('/api/v1/auth/password-resets/request')
      .set('Origin', WEB_ORIGIN)
      .send({ email })
      .expect(204);
    const secondResetToken = await database.client.oneTimeToken.findFirstOrThrow({
      orderBy: { createdAt: 'desc' },
      select: { id: true },
      where: { purpose: TokenPurpose.PASSWORD_RESET, userId: user.id },
    });
    expect(secondResetToken.id).not.toBe(firstResetToken.id);
    const secondRawResetToken = createOneTimeToken(
      'PASSWORD_RESET',
      TOKEN_HMAC_KEY,
      secondResetToken.id,
    ).token;

    const revokedReset = await agent
      .post('/api/v1/auth/password-resets/confirm')
      .set('Origin', WEB_ORIGIN)
      .send({ password: newPassword, token: firstRawResetToken })
      .expect(422);
    expect(revokedReset.body.code).toBe('TOKEN_INVALID');

    const reset = await agent
      .post('/api/v1/auth/password-resets/confirm')
      .set('Origin', WEB_ORIGIN)
      .send({ password: newPassword, token: secondRawResetToken })
      .expect(200);
    expect(reset.body).toEqual({ reset: true });
    expect(
      await database.client.session.count({ where: { revokedAt: null, userId: user.id } }),
    ).toBe(0);
    expect((await agent.get('/api/v1/auth/session').expect(200)).body).toEqual({
      authenticated: false,
    });

    const reusedReset = await agent
      .post('/api/v1/auth/password-resets/confirm')
      .set('Origin', WEB_ORIGIN)
      .send({ password: newPassword, token: secondRawResetToken })
      .expect(409);
    expect(reusedReset.body.code).toBe('TOKEN_ALREADY_USED');

    const oldPassword = await agent
      .post('/api/v1/auth/login')
      .set('Origin', WEB_ORIGIN)
      .send({ email, password })
      .expect(401);
    expect(oldPassword.body.code).toBe('INVALID_CREDENTIALS');

    const relogin = await agent
      .post('/api/v1/auth/login')
      .set('Origin', WEB_ORIGIN)
      .send({ email, password: newPassword })
      .expect(200);
    expect(relogin.body.onboardingStep).toBe('COMPLETE');

    await agent
      .post('/api/v1/auth/logout')
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', relogin.body.csrfToken as string)
      .expect(204);
    expect((await agent.get('/api/v1/auth/session').expect(200)).body).toEqual({
      authenticated: false,
    });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await agent
        .post('/api/v1/auth/login')
        .set('Origin', WEB_ORIGIN)
        .send({ email, password: '틀린 비밀번호지만 길이는 충분합니다' })
        .expect(401);
      expect(response.body.code).toBe('INVALID_CREDENTIALS');
    }

    const limited = await agent
      .post('/api/v1/auth/login')
      .set('Origin', WEB_ORIGIN)
      .send({ email, password: '틀린 비밀번호지만 길이는 충분합니다' })
      .expect(429);
    expect(limited.body.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });
});
