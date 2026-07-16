import { HttpStatus } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { DatabaseService } from '../../common/database/database.service';
import { MembersService } from './members.service';

describe('MembersService', () => {
  const workspaceId = '3dc0b213-eafa-450c-ad12-49a7d927c7b8';
  const adminMembershipId = '2e0792d5-eac3-44c1-87c7-56f07ebaa620';
  const membershipId = 'dd151af4-f97e-4cf2-ab03-43be72bb2782';
  const memberUserId = '0f2a23cc-196f-4e6e-88a0-71e1272841e0';
  const teamId = '953685f0-4921-41cd-8422-d8a1ccc3f547';
  const joinedAt = new Date('2026-07-11T01:00:00.000Z');
  const member = {
    deactivatedAt: null,
    id: membershipId,
    joinedAt,
    role: 'MEMBER' as const,
    status: 'ACTIVE' as const,
    teamMemberships: [
      {
        team: { archivedAt: null, id: teamId, key: 'WEB', name: '프론트 웹' },
      },
    ],
    user: {
      avatarFileId: null,
      displayName: '김멤버',
      email: 'member@example.com',
      id: memberUserId,
    },
  };
  const transaction = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    session: { updateMany: jest.fn() },
    webPushSubscription: { updateMany: jest.fn() },
    workspaceMembership: { findFirst: jest.fn(), updateMany: jest.fn() },
  };
  const database = {
    client: {
      $transaction: jest.fn(),
      team: { findFirst: jest.fn() },
      workspaceMembership: { findFirst: jest.fn(), findMany: jest.fn() },
    },
  };
  let moduleRef: TestingModule;
  let service: MembersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    database.client.team.findFirst.mockResolvedValue({ id: teamId });
    database.client.workspaceMembership.findFirst.mockResolvedValue(member);
    database.client.workspaceMembership.findMany.mockResolvedValue([member]);
    transaction.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([
        { deactivatedAt: null, id: membershipId, status: 'ACTIVE', userId: 'member-user-id' },
      ])
      .mockResolvedValue([]);
    transaction.workspaceMembership.findFirst.mockResolvedValue({
      ...member,
      deactivatedAt: new Date('2026-07-11T02:00:00.000Z'),
      status: 'INACTIVE',
    });
    transaction.workspaceMembership.updateMany.mockResolvedValue({ count: 1 });
    transaction.session.updateMany.mockResolvedValue({ count: 2 });
    transaction.webPushSubscription.updateMany.mockResolvedValue({ count: 2 });
    database.client.$transaction.mockImplementation(
      async (operation: (client: typeof transaction) => Promise<unknown>) => operation(transaction),
    );

    moduleRef = await Test.createTestingModule({
      providers: [MembersService, { provide: DatabaseService, useValue: database }],
    }).compile();
    service = moduleRef.get(MembersService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('returns an opaque stable cursor and includes email only for an admin response', async () => {
    database.client.workspaceMembership.findMany.mockResolvedValue([
      member,
      { ...member, id: 'df084f56-659c-4fd5-be18-9c842a7022bd' },
    ]);

    const first = await service.list(
      { includeEmail: true, workspaceId },
      { limit: 1, status: 'ACTIVE,INACTIVE' },
    );
    expect(first.items).toEqual([
      expect.objectContaining({ email: 'member@example.com', id: membershipId }),
    ]);
    expect(first.nextCursor).toEqual(expect.any(String));
    if (!first.nextCursor) {
      throw new Error('다음 페이지 커서가 필요합니다.');
    }

    database.client.workspaceMembership.findMany.mockResolvedValue([member]);
    const second = await service.list(
      { includeEmail: false, workspaceId },
      { cursor: first.nextCursor, limit: 1 },
    );
    expect(second.items[0]).not.toHaveProperty('email');
    expect(database.client.workspaceMembership.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            {
              OR: [{ joinedAt: { gt: joinedAt } }, { id: { gt: membershipId }, joinedAt }],
            },
          ]),
          workspaceId,
        }),
      }),
    );
  });

  it('does not search email for a member but lets an admin search normalized email', async () => {
    await service.list(
      { includeEmail: false, workspaceId },
      { limit: 50, query: 'member@example.com' },
    );
    expect(
      JSON.stringify(database.client.workspaceMembership.findMany.mock.calls[0]?.[0].where),
    ).not.toContain('normalizedEmail');

    await service.list(
      { includeEmail: true, workspaceId },
      { limit: 50, query: 'MEMBER@EXAMPLE.COM' },
    );
    expect(
      JSON.stringify(database.client.workspaceMembership.findMany.mock.calls[1]?.[0].where),
    ).toContain('normalizedEmail');
  });

  it('validates status, cursor, and team scope before listing members', async () => {
    await expect(
      service.list({ includeEmail: false, workspaceId }, { limit: 50, status: 'UNKNOWN' }),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_QUERY' },
      status: HttpStatus.BAD_REQUEST,
    });
    await expect(
      service.list({ includeEmail: false, workspaceId }, { cursor: 'not-a-cursor', limit: 50 }),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_QUERY' },
      status: HttpStatus.BAD_REQUEST,
    });

    database.client.team.findFirst.mockResolvedValue(null);
    await expect(
      service.list({ includeEmail: false, workspaceId }, { limit: 50, teamId }),
    ).rejects.toMatchObject({
      response: { code: 'RESOURCE_NOT_FOUND' },
      status: HttpStatus.NOT_FOUND,
    });
    expect(database.client.workspaceMembership.findMany).not.toHaveBeenCalled();
  });

  it('returns a member detail with current team summaries and hides email from members', async () => {
    await expect(service.get({ includeEmail: false, workspaceId }, membershipId)).resolves.toEqual({
      deactivatedAt: null,
      id: membershipId,
      joinedAt: joinedAt.toISOString(),
      role: 'MEMBER',
      status: 'ACTIVE',
      teams: [{ archived: false, id: teamId, key: 'WEB', name: '프론트 웹' }],
      user: { avatarFileId: null, displayName: '김멤버', id: memberUserId },
    });
    expect(database.client.workspaceMembership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: membershipId, workspaceId } }),
    );
  });

  it('returns 404 for an inaccessible membership', async () => {
    database.client.workspaceMembership.findFirst.mockResolvedValue(null);

    await expect(
      service.get({ includeEmail: false, workspaceId }, membershipId),
    ).rejects.toMatchObject({
      response: { code: 'RESOURCE_NOT_FOUND' },
      status: HttpStatus.NOT_FOUND,
    });
  });

  it('deactivates the membership and revokes all target sessions in one transaction', async () => {
    const result = await service.deactivate(
      { membershipId: adminMembershipId, workspaceId },
      membershipId,
    );

    expect(transaction.workspaceMembership.updateMany).toHaveBeenCalledWith({
      data: { deactivatedAt: expect.any(Date), status: 'INACTIVE' },
      where: { id: membershipId, status: 'ACTIVE', workspaceId },
    });
    expect(transaction.session.updateMany).toHaveBeenCalledWith({
      data: { revokedAt: expect.any(Date) },
      where: { revokedAt: null, userId: 'member-user-id' },
    });
    expect(transaction.webPushSubscription.updateMany).toHaveBeenCalledWith({
      data: {
        auth: null,
        disabledAt: expect.any(Date),
        endpoint: null,
        p256dh: null,
        status: 'INACTIVE',
      },
      where: { session: { userId: 'member-user-id' }, status: 'ACTIVE' },
    });
    expect(result).toMatchObject({
      email: 'member@example.com',
      id: membershipId,
      status: 'INACTIVE',
    });
  });

  it('keeps the membership active while it owns an unfinished issue', async () => {
    const issue = {
      id: 'f6cc19d9-877c-44a9-ae41-4eac01301971',
      identifier: 'WEB-7',
      title: '초대 흐름 검증',
    };
    transaction.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([
        { deactivatedAt: null, id: membershipId, status: 'ACTIVE', userId: 'member-user-id' },
      ])
      .mockResolvedValueOnce([issue]);

    await expect(
      service.deactivate({ membershipId: adminMembershipId, workspaceId }, membershipId),
    ).rejects.toMatchObject({
      response: { code: 'MEMBER_HAS_OPEN_ASSIGNMENTS', details: { issues: [issue] } },
      status: HttpStatus.CONFLICT,
    });
    expect(transaction.workspaceMembership.updateMany).not.toHaveBeenCalled();
    expect(transaction.session.updateMany).not.toHaveBeenCalled();
    expect(transaction.webPushSubscription.updateMany).not.toHaveBeenCalled();
  });

  it('rejects cross-workspace IDs and administrator self-deactivation before writes', async () => {
    transaction.$queryRaw.mockReset().mockResolvedValue([]);
    await expect(
      service.deactivate({ membershipId: adminMembershipId, workspaceId }, membershipId),
    ).rejects.toMatchObject({
      response: { code: 'RESOURCE_NOT_FOUND' },
      status: HttpStatus.NOT_FOUND,
    });

    transaction.$queryRaw
      .mockReset()
      .mockResolvedValue([
        { deactivatedAt: null, id: adminMembershipId, status: 'ACTIVE', userId: 'admin-user-id' },
      ]);
    await expect(
      service.deactivate({ membershipId: adminMembershipId, workspaceId }, adminMembershipId),
    ).rejects.toMatchObject({
      response: { code: 'FORBIDDEN' },
      status: HttpStatus.FORBIDDEN,
    });
    expect(transaction.workspaceMembership.updateMany).not.toHaveBeenCalled();
    expect(transaction.session.updateMany).not.toHaveBeenCalled();
  });
});
