import { HttpStatus } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { DatabaseService } from '../../common/database/database.service';
import { apiConfig } from '../../config/api.config';
import { AuthRateLimitService } from '../auth/auth-rate-limit.service';
import { InvitationRepository } from './invitation.repository';
import { InvitationQueryService } from './invitation-query.service';
import { InvitationsService } from './invitations.service';

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

describe('InvitationsService', () => {
  const workspaceId = '3dc0b213-eafa-450c-ad12-49a7d927c7b8';
  const membershipId = '2e0792d5-eac3-44c1-87c7-56f07ebaa620';
  const invitationId = '953685f0-4921-41cd-8422-d8a1ccc3f547';
  const secondInvitationId = '05ed9724-f207-447d-9f18-7026f493d3fd';
  const thirdInvitationId = 'c5ef63e6-3f70-4caf-bb56-256486afbb84';
  const firstCreatedAt = new Date('2026-07-11T03:00:00.000Z');
  const secondCreatedAt = new Date('2026-07-11T02:00:00.000Z');
  const thirdCreatedAt = new Date('2026-07-11T01:00:00.000Z');
  const row = {
    acceptedAt: null,
    canceledAt: null,
    createdAt: firstCreatedAt,
    email: 'invitee@example.com',
    expiresAt: new Date('2099-07-18T03:00:00.000Z'),
    id: invitationId,
    invitedByDisplayName: '관리자',
    invitedByMembershipId: membershipId,
  };
  const transaction = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
  };
  const database = {
    client: {
      $queryRaw: jest.fn(),
      $transaction: jest.fn(),
      workspaceInvitation: { findFirst: jest.fn(), findMany: jest.fn() },
      workspaceMembership: { count: jest.fn(), findMany: jest.fn() },
    },
  };
  const rateLimits = {
    assertNotBlocked: jest.fn(),
    consume: jest.fn(),
  };
  let service: InvitationsService;
  let queries: InvitationQueryService;

  beforeEach(() => {
    jest.clearAllMocks();
    database.client.$transaction.mockImplementation(
      async (operation: (client: typeof transaction) => Promise<unknown>) => operation(transaction),
    );
    database.client.workspaceInvitation.findMany.mockResolvedValue([]);
    database.client.workspaceInvitation.findFirst.mockResolvedValue(null);
    database.client.workspaceMembership.count.mockResolvedValue(1);
    database.client.workspaceMembership.findMany.mockResolvedValue([]);
    rateLimits.assertNotBlocked.mockResolvedValue(undefined);
    rateLimits.consume.mockResolvedValue(undefined);
    transaction.$executeRaw.mockResolvedValue(1);
    transaction.$queryRaw.mockResolvedValue([]);

    service = new InvitationsService(
      database as unknown as DatabaseService,
      rateLimits as unknown as AuthRateLimitService,
      config,
    );
    queries = new InvitationQueryService(
      new InvitationRepository(database as unknown as DatabaseService),
    );
  });

  it('lists invitations with an opaque createdAt and id cursor', async () => {
    database.client.$queryRaw.mockResolvedValue([
      row,
      { ...row, createdAt: secondCreatedAt, id: secondInvitationId },
      { ...row, createdAt: thirdCreatedAt, id: thirdInvitationId },
    ]);

    const first = await queries.list(workspaceId, { limit: 2 });

    expect(first.items.map(({ id }) => id)).toEqual([invitationId, secondInvitationId]);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(first.nextCursor).not.toContain(secondInvitationId);
    if (!first.nextCursor) {
      throw new Error('다음 페이지 커서가 필요합니다.');
    }

    database.client.$queryRaw.mockResolvedValue([
      { ...row, createdAt: thirdCreatedAt, id: thirdInvitationId },
    ]);
    await queries.list(workspaceId, { cursor: first.nextCursor, limit: 2 });

    expect(database.client.$queryRaw.mock.calls[1]?.slice(1)).toEqual([
      workspaceId,
      true,
      false,
      false,
      false,
      false,
      secondCreatedAt,
      secondCreatedAt,
      secondCreatedAt,
      secondInvitationId,
      3,
    ]);
  });

  it('rejects a malformed invitation cursor as INVALID_QUERY', async () => {
    await expect(
      queries.list(workspaceId, { cursor: 'not+a+cursor', limit: 50 }),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_QUERY' },
      status: HttpStatus.BAD_REQUEST,
    });
    expect(database.client.$queryRaw).not.toHaveBeenCalled();
  });

  it('filters comma-separated invitation statuses in the derived SQL state', async () => {
    database.client.$queryRaw.mockResolvedValue([]);

    await queries.list(workspaceId, {
      limit: 50,
      status: ' PENDING,EXPIRED,PENDING ',
    });

    expect(database.client.$queryRaw.mock.calls[0]?.slice(1)).toEqual([
      workspaceId,
      false,
      false,
      false,
      true,
      true,
      null,
      null,
      null,
      null,
      51,
    ]);
  });

  it('rejects an unknown invitation status as INVALID_QUERY', async () => {
    await expect(
      queries.list(workspaceId, { limit: 50, status: 'PENDING,UNKNOWN' }),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_QUERY' },
      status: HttpStatus.BAD_REQUEST,
    });
    expect(database.client.$queryRaw).not.toHaveBeenCalled();
  });

  it('locks a pending invitation before checking membership during creation', async () => {
    const queries: string[] = [];
    database.client.workspaceInvitation.findMany.mockResolvedValue([
      { normalizedEmail: 'invitee@example.com' },
    ]);
    transaction.$queryRaw.mockImplementation((strings: readonly string[]) => {
      const statement = strings.join('?');
      queries.push(statement);

      if (statement.includes('FROM "workspace_invitations"')) {
        return Promise.resolve([{ expiresAt: row.expiresAt, id: invitationId }]);
      }
      if (statement.includes('INNER JOIN "workspace_memberships"')) {
        return Promise.resolve([{ id: membershipId }]);
      }
      return Promise.resolve([]);
    });

    await expect(
      service.create({ membershipId, workspaceId }, ['Invitee@Example.com']),
    ).resolves.toEqual({
      items: [{ email: 'Invitee@Example.com', invitationId: null, result: 'ALREADY_MEMBER' }],
    });
    expect(queries).toHaveLength(2);
    expect(queries[0]).toContain('FROM "workspace_invitations"');
    expect(queries[0]).toContain('FOR UPDATE');
    expect(queries[1]).toContain('INNER JOIN "workspace_memberships"');
    expect(transaction.$executeRaw).not.toHaveBeenCalled();
  });

  it('maps a concurrent terminal reissue unique failure to the effective pending invitation', async () => {
    database.client.workspaceInvitation.findFirst.mockResolvedValue({
      acceptedAt: firstCreatedAt,
      canceledAt: null,
      id: invitationId,
      normalizedEmail: row.email,
    });
    database.client.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: secondInvitationId }]);
    database.client.$transaction.mockRejectedValueOnce(new Error('partial unique conflict'));

    await expect(service.resend({ membershipId, workspaceId }, invitationId)).rejects.toMatchObject(
      {
        response: { code: 'INVITATION_ALREADY_PENDING' },
        status: HttpStatus.CONFLICT,
      },
    );
    expect(database.client.$transaction).toHaveBeenCalledTimes(1);
    expect(database.client.$queryRaw).toHaveBeenCalledTimes(2);
  });
});
