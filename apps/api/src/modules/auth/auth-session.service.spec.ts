import { DatabaseService } from '../../common/database/database.service';
import { type AuthSessionContext, AuthSessionService } from './auth-session.service';
import { hashSessionToken } from './auth-token';

const sessionContext = {
  membership: {
    id: 'membership-id',
    role: 'ADMIN',
    status: 'ACTIVE',
    workspaceId: 'workspace-id',
  },
  sessionId: 'session-id',
  user: {
    avatarFileId: null,
    displayName: '리벳 사용자',
    email: 'user@example.com',
    emailVerifiedAt: new Date('2026-07-11T00:00:00.000Z'),
    id: 'user-id',
  },
  workspace: {
    id: 'workspace-id',
    name: '리벳',
    slug: 'rivet',
    version: 1,
  },
} as const satisfies AuthSessionContext;

describe('AuthSessionService', () => {
  const queryRaw = jest.fn();
  const executeRaw = jest.fn();
  let service: AuthSessionService;

  beforeEach(() => {
    queryRaw.mockReset();
    executeRaw.mockReset();
    service = new AuthSessionService({
      client: { $executeRaw: executeRaw, $queryRaw: queryRaw },
    } as unknown as DatabaseService);
  });

  it('creates a new session while storing only its hash', async () => {
    const absoluteExpiresAt = new Date('2026-08-10T00:00:00.000Z');
    queryRaw.mockResolvedValue([{ absoluteExpiresAt }]);
    const resolve = jest.spyOn(service, 'resolve').mockResolvedValue(sessionContext);

    const created = await service.create('user-id');

    expect(created).toEqual({ absoluteExpiresAt, context: sessionContext, token: created.token });
    expect(resolve).toHaveBeenCalledWith(created.token);
    expect(queryRaw.mock.calls[0]?.[2]).toBe('user-id');
    expect(queryRaw.mock.calls[0]?.[3]).toEqual(hashSessionToken(created.token));
    expect(queryRaw.mock.calls[0]).not.toContain(created.token);
  });

  it('resolves only an active session hash and refreshes its idle lifetime', async () => {
    const emailVerifiedAt = new Date('2026-07-11T00:00:00.000Z');
    queryRaw.mockResolvedValue([
      {
        avatarFileId: null,
        displayName: '리벳 사용자',
        email: 'user@example.com',
        emailVerifiedAt,
        membershipId: 'membership-id',
        membershipRole: 'ADMIN',
        membershipStatus: 'ACTIVE',
        sessionId: 'session-id',
        userId: 'user-id',
        workspaceId: 'workspace-id',
        workspaceName: '리벳',
        workspaceSlug: 'rivet',
        workspaceVersion: 1,
      },
    ]);
    executeRaw.mockResolvedValue(1);

    await expect(service.resolve('session-token')).resolves.toEqual(sessionContext);
    expect(queryRaw.mock.calls[0]?.slice(1)).toEqual([hashSessionToken('session-token')]);
    expect(queryRaw.mock.calls[0]).not.toContain('session-token');
    expect((queryRaw.mock.calls[0]?.[0] as readonly string[]).join('?')).toEqual(
      expect.stringContaining('session."revoked_at" IS NULL'),
    );
    expect((queryRaw.mock.calls[0]?.[0] as readonly string[]).join('?')).toEqual(
      expect.stringContaining('session."idle_expires_at" > NOW()'),
    );
    expect((queryRaw.mock.calls[0]?.[0] as readonly string[]).join('?')).toEqual(
      expect.stringContaining('session."absolute_expires_at" > NOW()'),
    );
    expect(executeRaw.mock.calls[0]?.slice(1)).toEqual(['session-id']);
  });

  it('returns null without refreshing an unknown, expired, or revoked session', async () => {
    queryRaw.mockResolvedValue([]);

    await expect(service.resolve('invalid-session')).resolves.toBeNull();
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('revokes the selected session idempotently', async () => {
    executeRaw.mockResolvedValue(1);

    await expect(service.revoke('session-id')).resolves.toBeUndefined();
    expect(executeRaw.mock.calls[0]?.slice(1)).toEqual(['session-id']);
    expect((executeRaw.mock.calls[0]?.[0] as readonly string[]).join('?')).toEqual(
      expect.stringContaining('COALESCE("revoked_at", NOW())'),
    );
  });
});
