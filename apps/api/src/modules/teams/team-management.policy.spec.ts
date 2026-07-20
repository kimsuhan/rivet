import { HttpStatus } from '@nestjs/common';

import type { Prisma } from '@rivet/database';

import { TeamManagementPolicy } from './team-management.policy';

describe('TeamManagementPolicy', () => {
  const context = {
    membershipId: '2e0792d5-eac3-44c1-87c7-56f07ebaa620',
    role: 'MEMBER' as const,
    workspaceId: '3dc0b213-eafa-450c-ad12-49a7d927c7b8',
  };
  const teamId = '953685f0-4921-41cd-8422-d8a1ccc3f547';
  const transaction = { $queryRaw: jest.fn() };
  const policy = new TeamManagementPolicy();

  beforeEach(() => jest.clearAllMocks());

  it('allows a team lead to manage the locked active team', async () => {
    transaction.$queryRaw.mockResolvedValue([{ canManage: true }]);

    await expect(
      policy.assertCanManageTeam(
        transaction as unknown as Prisma.TransactionClient,
        context,
        teamId,
      ),
    ).resolves.toBeUndefined();
  });

  it('rejects a member who does not lead the requested team', async () => {
    transaction.$queryRaw.mockResolvedValue([{ canManage: false }]);

    await expect(
      policy.assertCanManageTeam(
        transaction as unknown as Prisma.TransactionClient,
        context,
        teamId,
      ),
    ).rejects.toMatchObject({ response: { code: 'FORBIDDEN' }, status: HttpStatus.FORBIDDEN });
  });

  it('does not reveal a missing, archived, or cross-workspace team', async () => {
    transaction.$queryRaw.mockResolvedValue([]);

    await expect(
      policy.assertCanManageTeam(
        transaction as unknown as Prisma.TransactionClient,
        context,
        teamId,
      ),
    ).rejects.toMatchObject({
      response: { code: 'RESOURCE_NOT_FOUND' },
      status: HttpStatus.NOT_FOUND,
    });
  });
});
