import { HttpStatus } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { Prisma } from '@rivet/database';

import { DatabaseService } from '../../common/database/database.service';
import { TeamRepository } from './team.repository';
import { TeamManagementPolicy } from './team-management.policy';
import { TeamsService } from './teams.service';

function uniqueConflict(target: string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    clientVersion: '7.8.0',
    code: 'P2002',
    meta: { target },
  });
}

describe('TeamsService', () => {
  const context = {
    membershipId: '2e0792d5-eac3-44c1-87c7-56f07ebaa620',
    workspaceId: '3dc0b213-eafa-450c-ad12-49a7d927c7b8',
  };
  const memberId = 'dd151af4-f97e-4cf2-ab03-43be72bb2782';
  const teamId = '953685f0-4921-41cd-8422-d8a1ccc3f547';
  const transaction = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    team: { create: jest.fn() },
    teamMember: { createMany: jest.fn() },
    workflowState: { createManyAndReturn: jest.fn() },
  };
  const database = {
    client: {
      $transaction: jest.fn(),
      team: { findFirst: jest.fn(), findUnique: jest.fn() },
    },
  };
  let moduleRef: TestingModule;
  let service: TeamsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    transaction.$queryRaw.mockResolvedValue([
      { id: context.membershipId, role: 'ADMIN', status: 'ACTIVE' },
      { id: memberId, role: 'MEMBER', status: 'ACTIVE' },
    ]);
    transaction.team.create.mockResolvedValue({
      archivedAt: null,
      id: teamId,
      key: 'WEB',
      name: 'Frontend',
      version: 1,
    });
    transaction.teamMember.createMany.mockResolvedValue({ count: 2 });
    transaction.workflowState.createManyAndReturn.mockResolvedValue([
      {
        category: 'UNSTARTED',
        id: 'state-1',
        isDefault: false,
        name: '할 일',
        position: 1,
        version: 1,
      },
      {
        category: 'BACKLOG',
        id: 'state-0',
        isDefault: true,
        name: '미분류',
        position: 0,
        version: 1,
      },
    ]);
    database.client.$transaction.mockImplementation(
      async (operation: (client: typeof transaction) => Promise<unknown>) => operation(transaction),
    );
    database.client.team.findFirst.mockResolvedValue(null);
    database.client.team.findUnique.mockResolvedValue(null);

    moduleRef = await Test.createTestingModule({
      providers: [
        TeamRepository,
        TeamsService,
        { provide: DatabaseService, useValue: database },
        { provide: TeamManagementPolicy, useValue: { assertCanManageTeam: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(TeamsService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('locks memberships and creates the team, members, and seven default states atomically', async () => {
    const result = await service.create(context, {
      key: 'WEB',
      memberIds: [context.membershipId, memberId],
      name: '  Frontend  ',
    });

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(transaction.team.create).toHaveBeenCalledWith({
      data: {
        key: 'WEB',
        name: 'Frontend',
        normalizedName: 'frontend',
        workspaceId: context.workspaceId,
      },
      select: { archivedAt: true, id: true, key: true, name: true, version: true },
    });
    expect(transaction.teamMember.createMany).toHaveBeenCalledWith({
      data: [
        {
          membershipId: context.membershipId,
          teamId,
          workspaceId: context.workspaceId,
        },
        { membershipId: memberId, teamId, workspaceId: context.workspaceId },
      ],
    });
    const workflowData = transaction.workflowState.createManyAndReturn.mock.calls[0]?.[0].data;
    expect(workflowData).toHaveLength(7);
    expect(workflowData[0]).toMatchObject({
      category: 'BACKLOG',
      isDefault: true,
      name: '미분류',
      position: 0,
    });
    expect(workflowData.map(({ name }: { name: string }) => name)).toEqual([
      '미분류',
      '보류',
      '할 일',
      '진행 중',
      '검토',
      '완료',
      '취소',
    ]);
    expect(result.workflowStates.map(({ position }) => position)).toEqual([0, 1]);
  });

  it('rejects a requester that is not an active admin', async () => {
    transaction.$queryRaw.mockResolvedValue([
      { id: context.membershipId, role: 'MEMBER', status: 'ACTIVE' },
      { id: memberId, role: 'MEMBER', status: 'ACTIVE' },
    ]);

    await expect(
      service.create(context, {
        key: 'WEB',
        memberIds: [context.membershipId, memberId],
        name: 'Frontend',
      }),
    ).rejects.toMatchObject({
      response: { code: 'FORBIDDEN' },
      status: HttpStatus.FORBIDDEN,
    });
    expect(transaction.team.create).not.toHaveBeenCalled();
  });

  it('rejects inactive or cross-workspace initial members', async () => {
    transaction.$queryRaw.mockResolvedValue([
      { id: context.membershipId, role: 'ADMIN', status: 'ACTIVE' },
    ]);

    await expect(
      service.create(context, {
        key: 'WEB',
        memberIds: [context.membershipId, memberId],
        name: 'Frontend',
      }),
    ).rejects.toMatchObject({
      response: { code: 'RESOURCE_NOT_FOUND' },
      status: HttpStatus.NOT_FOUND,
    });
    expect(transaction.team.create).not.toHaveBeenCalled();
  });

  it('requires the onboarding creator in the initial team members', async () => {
    await expect(
      service.create(context, { key: 'WEB', memberIds: [memberId], name: 'Frontend' }),
    ).rejects.toMatchObject({
      response: { code: 'FORBIDDEN' },
      status: HttpStatus.FORBIDDEN,
    });
    expect(transaction.team.create).not.toHaveBeenCalled();
  });

  it.each([
    [['normalized_name'], 'TEAM_NAME_IN_USE'],
    [['workspace_id', 'key'], 'TEAM_KEY_IN_USE'],
  ])('maps the %s unique conflict to %s', async (target, code) => {
    database.client.$transaction.mockRejectedValue(uniqueConflict(target));

    await expect(
      service.create(context, { key: 'WEB', memberIds: [memberId], name: 'Frontend' }),
    ).rejects.toMatchObject({ response: { code }, status: HttpStatus.CONFLICT });
  });
});
