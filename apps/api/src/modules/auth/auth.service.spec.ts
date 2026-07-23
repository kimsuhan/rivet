import { HttpStatus } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { argon2id, hash as argon2Hash } from 'argon2';

import { Prisma, TokenPurpose } from '@rivet/database';
import {
  AUTH_EMAIL_VERIFICATION_REQUESTED,
  AUTH_PASSWORD_RESET_REQUESTED,
} from '@rivet/event-contracts';

import { DatabaseService } from '../../common/database/database.service';
import { apiConfig } from '../../config/api.config';
import { AuthService } from './auth.service';
import { AuthAccountTokenService } from './auth-account-token.service';
import { AuthProfileService } from './auth-profile.service';
import { AUTH_RATE_LIMITS, AuthRateLimitService } from './auth-rate-limit.service';
import { type AuthSessionContext, AuthSessionService } from './auth-session.service';
import { createCsrfToken, createOneTimeToken } from './auth-token.crypto';
import { hashPassword } from './password.crypto';

const config: ConfigType<typeof apiConfig> = {
  database: {
    connectionTimeoutMs: 5_000,
    idleTimeoutMs: 10_000,
    poolMax: 10,
    url: 'postgresql://localhost/rivet',
  },
  environment: 'test',
  fileStorageRoot: '/tmp/rivet-files',
  observability: { posthogApiKey: null, slackAlertWebhookUrl: null },
  port: 4_000,
  releaseId: 'test',
  security: {
    csrfHmacKey: 'csrf-key-that-is-at-least-32-bytes-long',
    oneTimeTokenHmacKey: 'token-key-that-is-at-least-32-bytes-long',
    rateLimitHmacKey: 'rate-key-that-is-at-least-32-bytes-long',
  },
  webOrigin: 'http://localhost:3000',
  webPush: { vapidPublicKey: null },
};

const sessionContext = {
  membership: {
    id: '82d3fb00-a49a-43fb-b18d-95a2c0af7e0f',
    role: 'ADMIN',
    status: 'ACTIVE',
    workspaceId: '3482436b-ddac-49e8-835d-e290046557a9',
  },
  sessionId: 'eef85e04-f0fb-4f66-8620-69653853f268',
  user: {
    avatarFileId: null,
    displayName: '리벳 사용자',
    email: 'User@Example.com',
    emailVerifiedAt: new Date('2026-07-11T00:00:00.000Z'),
    id: 'f3b0a3f2-5c26-4904-b22d-e8b186cadbdf',
  },
  workspace: {
    id: '3482436b-ddac-49e8-835d-e290046557a9',
    name: '리벳',
    slug: 'rivet',
    version: 1,
  },
} as const satisfies AuthSessionContext;

function uniqueConflict(target: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    clientVersion: '7.8.0',
    code: 'P2002',
    meta: { target },
  });
}

describe('AuthService', () => {
  const transaction = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    user: { create: jest.fn() },
  };
  const client = {
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
    team: { findFirst: jest.fn() },
    teamMember: { findMany: jest.fn() },
    user: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  };
  const rateLimits = {
    assertNotBlocked: jest.fn(),
    clear: jest.fn(),
    consume: jest.fn(),
  };
  const sessions = {
    create: jest.fn(),
    resolve: jest.fn(),
    revoke: jest.fn(),
  };
  let accountTokens: AuthAccountTokenService;
  let profile: AuthProfileService;
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    transaction.$executeRaw.mockResolvedValue(1);
    transaction.$queryRaw.mockResolvedValue([]);
    transaction.user.create.mockResolvedValue({ id: sessionContext.user.id });
    client.$queryRaw.mockResolvedValue([]);
    client.$transaction.mockImplementation(
      async (operation: (value: typeof transaction) => Promise<unknown>) => operation(transaction),
    );
    client.team.findFirst.mockResolvedValue(null);
    client.teamMember.findMany.mockResolvedValue([]);
    client.user.findUnique.mockResolvedValue(null);
    client.user.update.mockResolvedValue({
      avatarFileId: null,
      displayName: '바뀐 사용자',
      email: sessionContext.user.email,
      id: sessionContext.user.id,
    });
    client.user.updateMany.mockResolvedValue({ count: 1 });
    rateLimits.assertNotBlocked.mockResolvedValue(undefined);
    rateLimits.clear.mockResolvedValue(undefined);
    rateLimits.consume.mockResolvedValue(undefined);
    sessions.create.mockResolvedValue({
      absoluteExpiresAt: new Date('2026-08-10T00:00:00.000Z'),
      context: sessionContext,
      token: 'session-token',
    });
    sessions.resolve.mockResolvedValue(sessionContext);
    sessions.revoke.mockResolvedValue(undefined);

    accountTokens = new AuthAccountTokenService(
      { client } as unknown as DatabaseService,
      rateLimits as unknown as AuthRateLimitService,
      config,
    );
    service = new AuthService(
      accountTokens,
      { client } as unknown as DatabaseService,
      rateLimits as unknown as AuthRateLimitService,
      sessions as unknown as AuthSessionService,
      { capture: jest.fn() } as never,
      config,
    );
    profile = new AuthProfileService({ client } as unknown as DatabaseService);
  });

  it('normalizes and updates the current user display name', async () => {
    await expect(
      profile.update(sessionContext, { displayName: '  바뀐 사용자  ' }),
    ).resolves.toEqual({
      avatarFileId: null,
      displayName: '바뀐 사용자',
      email: sessionContext.user.email,
      id: sessionContext.user.id,
    });
    expect(client.user.update).toHaveBeenCalledWith({
      data: { displayName: '바뀐 사용자' },
      select: { avatarFileId: true, displayName: true, email: true, id: true },
      where: { id: sessionContext.user.id },
    });
  });

  it('rejects an invalid current user display name without updating the account', async () => {
    await expect(profile.update(sessionContext, { displayName: '   ' })).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'VALIDATION_ERROR',
        fieldErrors: { displayName: ['표시 이름을 확인해 주세요.'] },
      }),
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });
    expect(client.user.update).not.toHaveBeenCalled();
  });

  it('creates a new account, token, and email outbox atomically while preserving email casing', async () => {
    await expect(
      service.signUp(
        {
          displayName: '  리벳 사용자  ',
          email: '  User@Example.COM  ',
          password: 'a sufficiently long phrase',
        },
        '127.0.0.1',
      ),
    ).resolves.toEqual({
      accepted: true,
      emailMasked: 'Us***@Example.COM',
      nextStep: 'VERIFY_EMAIL',
    });

    expect(transaction.user.create).toHaveBeenCalledWith({
      data: {
        displayName: '리벳 사용자',
        email: 'User@Example.COM',
        normalizedEmail: 'user@example.com',
        passwordHash: expect.stringMatching(/^\$argon2id\$/),
      },
      select: { id: true },
    });
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(4);
    expect(transaction.$executeRaw.mock.calls.flat()).toContain(AUTH_EMAIL_VERIFICATION_REQUESTED);
  });

  it('returns the same accepted response for an existing verified account without changing it', async () => {
    transaction.$queryRaw.mockResolvedValue([
      { emailVerifiedAt: new Date('2026-07-11T00:00:00.000Z'), id: sessionContext.user.id },
    ]);

    await expect(
      service.signUp(
        {
          displayName: '다른 표시 이름',
          email: 'User@Example.com',
          password: 'another secure phrase',
        },
        '127.0.0.1',
      ),
    ).resolves.toEqual({
      accepted: true,
      emailMasked: 'Us***@Example.com',
      nextStep: 'VERIFY_EMAIL',
    });
    expect(transaction.user.create).not.toHaveBeenCalled();
    expect(transaction.$executeRaw).not.toHaveBeenCalled();
  });

  it('revokes an unverified account previous token and pending outbox before reissuing', async () => {
    transaction.$queryRaw.mockResolvedValue([
      { emailVerifiedAt: null, id: sessionContext.user.id },
    ]);

    await expect(
      accountTokens.resendEmailVerification({ email: 'User@Example.com' }, '127.0.0.1'),
    ).resolves.toEqual({
      accepted: true,
      emailMasked: 'Us***@Example.com',
      nextStep: 'VERIFY_EMAIL',
    });

    const statements = transaction.$executeRaw.mock.calls.map((call) =>
      (call[0] as readonly string[]).join('?'),
    );
    expect(statements[0]).toContain('UPDATE "one_time_tokens"');
    expect(statements[0]).toContain('SET "revoked_at" = NOW()');
    expect(statements[1]).toContain('UPDATE "outbox_events"');
    expect(statements[1]).toContain('SET "canceled_at" = NOW()');
    expect(statements[2]).toContain('INSERT INTO "one_time_tokens"');
    expect(statements[3]).toContain('INSERT INTO "outbox_events"');
  });

  it('only hides a concurrent normalized-email conflict', async () => {
    client.$transaction.mockRejectedValueOnce(uniqueConflict('users_normalized_email_key'));
    client.user.findUnique.mockResolvedValueOnce({ id: sessionContext.user.id });

    await expect(
      service.signUp(
        {
          displayName: '리벳 사용자',
          email: 'User@Example.com',
          password: 'another secure phrase',
        },
        '127.0.0.1',
      ),
    ).resolves.toEqual(expect.objectContaining({ accepted: true }));

    client.$transaction.mockRejectedValueOnce(uniqueConflict('one_time_tokens_token_hash_key'));
    await expect(
      service.signUp(
        {
          displayName: '리벳 사용자',
          email: 'other@example.com',
          password: 'another secure phrase',
        },
        '127.0.0.1',
      ),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('uses a matching invitation continuation as email proof without issuing verification mail', async () => {
    transaction.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: '6f6b9772-f15c-4c5b-adac-706e60f477bb',
        invitationEmail: 'user@example.com',
        userId: null,
      },
    ]);

    await expect(
      service.signUp(
        {
          displayName: '초대 사용자',
          email: 'User@Example.com',
          password: 'another secure phrase',
        },
        '127.0.0.1',
        'invitation-continuation-token',
      ),
    ).resolves.toEqual({
      accepted: true,
      emailMasked: 'Us***@Example.com',
      nextStep: 'LOGIN',
    });

    const statements = transaction.$executeRaw.mock.calls.map((call) =>
      (call[0] as readonly string[]).join('?'),
    );
    expect(statements).toEqual(
      expect.arrayContaining([
        expect.stringContaining('SET "email_verified_at" = COALESCE'),
        expect.stringContaining('UPDATE "workspace_invitation_continuations"'),
      ]),
    );
    expect(
      statements.some(
        (statement) =>
          statement.includes('INSERT INTO "one_time_tokens"') ||
          statement.includes('INSERT INTO "outbox_events"'),
      ),
    ).toBe(false);
  });

  it('uses a locked token once with DB time and invalidates other verification links', async () => {
    const token = createOneTimeToken(
      'EMAIL_VERIFICATION',
      config.security.oneTimeTokenHmacKey,
      '9d395176-a814-4a10-9905-24432d9b7655',
    );
    transaction.$queryRaw.mockResolvedValue([
      {
        isExpired: false,
        purpose: TokenPurpose.EMAIL_VERIFICATION,
        revokedAt: null,
        tokenHash: token.tokenHash,
        usedAt: null,
        userId: sessionContext.user.id,
      },
    ]);

    await expect(accountTokens.verifyEmail({ token: token.token }, '127.0.0.1')).resolves.toEqual({
      verified: true,
    });

    const sql = transaction.$executeRaw.mock.calls
      .map((call) => (call[0] as readonly string[]).join('?'))
      .join('\n');
    expect(sql).toContain('SET "used_at" = NOW()');
    expect(sql).toContain('SET "email_verified_at" = COALESCE("email_verified_at", NOW())');
    expect(sql).toContain('SET "revoked_at" = NOW()');
    expect(sql).toContain('SET "canceled_at" = NOW()');
  });

  it('maps a reused token safely and records both failure limits', async () => {
    const token = createOneTimeToken(
      'EMAIL_VERIFICATION',
      config.security.oneTimeTokenHmacKey,
      '9d395176-a814-4a10-9905-24432d9b7655',
    );
    transaction.$queryRaw.mockResolvedValue([
      {
        isExpired: false,
        purpose: TokenPurpose.EMAIL_VERIFICATION,
        revokedAt: null,
        tokenHash: token.tokenHash,
        usedAt: new Date('2026-07-11T00:00:00.000Z'),
        userId: sessionContext.user.id,
      },
    ]);

    await expect(
      accountTokens.verifyEmail({ token: token.token }, '127.0.0.1'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'TOKEN_ALREADY_USED' }),
      status: HttpStatus.CONFLICT,
    });
    expect(rateLimits.consume).toHaveBeenCalledTimes(2);
  });

  it('applies one token rate-limit bucket to MAC variants with the same token ID', async () => {
    const token = createOneTimeToken(
      'EMAIL_VERIFICATION',
      config.security.oneTimeTokenHmacKey,
      '9d395176-a814-4a10-9905-24432d9b7655',
    ).token;
    const encodedId = token.split('.')[0];

    for (const submittedToken of [`${encodedId}.changed-mac`, `${encodedId}.another-mac`]) {
      await expect(
        accountTokens.verifyEmail({ token: submittedToken }, '127.0.0.1'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'TOKEN_INVALID' }),
      });
    }

    const assertedKeys = rateLimits.assertNotBlocked.mock.calls
      .filter(([rule]) => rule === AUTH_RATE_LIMITS.tokenValue)
      .map(([, key]) => key);
    const consumedKeys = rateLimits.consume.mock.calls
      .filter(([rule]) => rule === AUTH_RATE_LIMITS.tokenValue)
      .map(([, key]) => key);

    expect(new Set(assertedKeys).size).toBe(1);
    expect(new Set(consumedKeys).size).toBe(1);
    expect(assertedKeys).toEqual(consumedKeys);
  });

  it('performs a dummy Argon2 verification and returns one credential error for an unknown login', async () => {
    await expect(
      service.login(
        { email: 'missing@example.com', password: 'a sufficiently long phrase' },
        '127.0.0.1',
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INVALID_CREDENTIALS' }),
      status: HttpStatus.UNAUTHORIZED,
    });
    expect(sessions.create).not.toHaveBeenCalled();
    expect(rateLimits.consume).toHaveBeenCalledTimes(2);
  });

  it('creates a fresh session, CSRF token, and derives CREATE_TEAM after a valid login', async () => {
    const password = 'a sufficiently long phrase';
    const passwordHash = await hashPassword(password);
    client.user.findUnique.mockResolvedValue({
      emailVerifiedAt: sessionContext.user.emailVerifiedAt,
      id: sessionContext.user.id,
      membership: { status: 'ACTIVE' },
      passwordHash,
    });

    const result = await service.login({ email: 'User@Example.com', password }, '127.0.0.1');

    expect(result.response).toEqual(
      expect.objectContaining({
        authenticated: true,
        csrfToken: createCsrfToken('session-token', config.security.csrfHmacKey),
        onboardingStep: 'CREATE_TEAM',
      }),
    );
    expect(rateLimits.clear).toHaveBeenCalledTimes(1);
    expect(sessions.create).toHaveBeenCalledWith(sessionContext.user.id);
  });

  it('uses a matching invitation as email proof after password authentication', async () => {
    const password = 'a sufficiently long phrase';
    const passwordHash = await hashPassword(password);
    client.user.findUnique.mockResolvedValue({
      emailVerifiedAt: null,
      id: sessionContext.user.id,
      membership: null,
      passwordHash,
    });
    transaction.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: '6f6b9772-f15c-4c5b-adac-706e60f477bb',
        invitationEmail: 'user@example.com',
        userId: null,
      },
    ]);
    client.$queryRaw.mockResolvedValue([{ id: '6f6b9772-f15c-4c5b-adac-706e60f477bb' }]);

    const result = await service.login(
      { email: 'User@Example.com', password },
      '127.0.0.1',
      'invitation-continuation-token',
    );

    expect(result.response.onboardingStep).toBe('ACCEPT_INVITATION');
    expect(
      transaction.$executeRaw.mock.calls
        .map((call) => (call[0] as readonly string[]).join('?'))
        .join('\n'),
    ).toContain('SET "email_verified_at" = COALESCE');
    expect(sessions.create).toHaveBeenCalledWith(sessionContext.user.id);
  });

  it('rehashes a valid login only when the stored Argon2 parameters are weaker', async () => {
    const password = 'a sufficiently long phrase';
    const passwordHash = await argon2Hash(password, {
      memoryCost: 12 * 1_024,
      parallelism: 1,
      timeCost: 2,
      type: argon2id,
    });
    client.user.findUnique.mockResolvedValue({
      emailVerifiedAt: sessionContext.user.emailVerifiedAt,
      id: sessionContext.user.id,
      membership: { status: 'ACTIVE' },
      passwordHash,
    });

    await service.login({ email: 'User@Example.com', password }, '127.0.0.1');

    expect(client.user.updateMany).toHaveBeenCalledWith({
      data: { passwordHash: expect.stringMatching(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/) },
      where: { id: sessionContext.user.id, passwordHash },
    });
  });

  it('returns unauthenticated without a session and COMPLETE when the workspace has a team', async () => {
    await expect(service.getSession(null)).resolves.toEqual({ authenticated: false });
    client.team.findFirst.mockResolvedValue({ id: 'team-id' });
    client.teamMember.findMany.mockResolvedValue([
      { role: 'MEMBER', teamId: 'member-team-id' },
      { role: 'LEAD', teamId: 'lead-team-id' },
    ]);

    await expect(service.getSession('session-token')).resolves.toEqual(
      expect.objectContaining({
        authenticated: true,
        membership: expect.objectContaining({
          ledTeamIds: ['lead-team-id'],
          teamIds: ['member-team-id', 'lead-team-id'],
        }),
        onboardingStep: 'COMPLETE',
      }),
    );
    expect(client.teamMember.findMany).toHaveBeenCalledWith({
      orderBy: { teamId: 'asc' },
      select: { role: true, teamId: true },
      where: {
        membershipId: sessionContext.membership.id,
        removedAt: null,
        team: { archivedAt: null },
        workspaceId: sessionContext.workspace.id,
      },
    });
  });

  it('prioritizes an active invitation continuation over workspace and team onboarding', async () => {
    client.$queryRaw.mockResolvedValue([{ id: 'continuation-id' }]);

    await expect(service.getSession('session-token', 'continuation-token')).resolves.toEqual(
      expect.objectContaining({ authenticated: true, onboardingStep: 'ACCEPT_INVITATION' }),
    );
    expect(client.team.findFirst).not.toHaveBeenCalled();
  });

  it('issues a reset email only for a verified account with a generic empty result', async () => {
    transaction.$queryRaw.mockResolvedValue([
      { emailVerifiedAt: sessionContext.user.emailVerifiedAt, id: sessionContext.user.id },
    ]);

    await expect(
      accountTokens.requestPasswordReset({ email: 'User@Example.com' }, '127.0.0.1'),
    ).resolves.toBeUndefined();
    expect(transaction.$executeRaw.mock.calls.flat()).toContain(AUTH_PASSWORD_RESET_REQUESTED);
  });

  it('resets the password, consumes one token, and revokes all sessions and sibling links', async () => {
    const token = createOneTimeToken(
      'PASSWORD_RESET',
      config.security.oneTimeTokenHmacKey,
      '9d395176-a814-4a10-9905-24432d9b7655',
    );
    transaction.$queryRaw.mockResolvedValue([
      {
        isExpired: false,
        normalizedEmail: 'user@example.com',
        purpose: TokenPurpose.PASSWORD_RESET,
        revokedAt: null,
        tokenHash: token.tokenHash,
        usedAt: null,
        userId: sessionContext.user.id,
      },
    ]);

    await expect(
      accountTokens.confirmPasswordReset(
        { password: 'a new sufficiently long phrase', token: token.token },
        '127.0.0.1',
      ),
    ).resolves.toEqual({ reset: true });

    const sql = transaction.$executeRaw.mock.calls
      .map((call) => (call[0] as readonly string[]).join('?'))
      .join('\n');
    expect(sql).toContain('SET "password_hash" = ?');
    expect(sql).toContain('UPDATE "sessions"');
    expect(sql).toContain('SET "revoked_at" = NOW()');
    expect(sql).toContain('SET "canceled_at" = NOW()');
  });

  it.each([
    {
      code: 'TOKEN_ALREADY_USED',
      isExpired: false,
      status: HttpStatus.CONFLICT,
      usedAt: new Date('2026-07-11T00:00:00.000Z'),
    },
    { code: 'TOKEN_EXPIRED', isExpired: true, status: HttpStatus.GONE, usedAt: null },
  ])(
    'returns $code before validating or hashing a weak password',
    async ({ code, isExpired, status, usedAt }) => {
      const token = createOneTimeToken(
        'PASSWORD_RESET',
        config.security.oneTimeTokenHmacKey,
        '9d395176-a814-4a10-9905-24432d9b7655',
      );
      transaction.$queryRaw.mockResolvedValue([
        {
          isExpired,
          normalizedEmail: 'user@example.com',
          purpose: TokenPurpose.PASSWORD_RESET,
          revokedAt: null,
          tokenHash: token.tokenHash,
          usedAt,
          userId: sessionContext.user.id,
        },
      ]);

      await expect(
        accountTokens.confirmPasswordReset({ password: 'short', token: token.token }, '127.0.0.1'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code }),
        status,
      });
      expect(client.$transaction).toHaveBeenCalledTimes(1);
      expect(transaction.$executeRaw).not.toHaveBeenCalled();
    },
  );

  it('maps password policy failures without echoing the submitted password', async () => {
    const password = 'short';
    let thrown: unknown;

    try {
      await service.signUp(
        { displayName: '리벳 사용자', email: 'user@example.com', password },
        '127.0.0.1',
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      response: expect.objectContaining({ code: 'VALIDATION_ERROR' }),
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });
    expect(JSON.stringify(thrown)).not.toContain(password);
  });
});
