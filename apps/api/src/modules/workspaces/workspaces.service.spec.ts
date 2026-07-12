import { HttpStatus } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { Prisma } from '@rivet/database';

import { DatabaseService } from '../../common/database/database.service';
import { WorkspacesService } from './workspaces.service';

function uniqueConflict(target: string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    clientVersion: '7.8.0',
    code: 'P2002',
    meta: { target },
  });
}

describe('WorkspacesService', () => {
  const userId = '2e0792d5-eac3-44c1-87c7-56f07ebaa620';
  const workspaceId = '3dc0b213-eafa-450c-ad12-49a7d927c7b8';
  const transaction = {
    $queryRaw: jest.fn(),
    outboxEvent: { create: jest.fn() },
    workspace: { create: jest.fn() },
    workspaceMembership: { create: jest.fn(), findUnique: jest.fn() },
  };
  const database = {
    client: {
      $transaction: jest.fn(),
      workspace: { findFirst: jest.fn(), findUnique: jest.fn() },
      workspaceMembership: { findUnique: jest.fn() },
    },
  };
  let moduleRef: TestingModule;
  let service: WorkspacesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    transaction.$queryRaw.mockResolvedValue([{ id: userId }]);
    transaction.workspaceMembership.findUnique.mockResolvedValue(null);
    transaction.workspaceMembership.create.mockResolvedValue({ id: 'membership-id' });
    transaction.outboxEvent.create.mockResolvedValue({ id: 'outbox-id' });
    transaction.workspace.create.mockResolvedValue({
      id: workspaceId,
      name: '제품 개발팀',
      slug: 'product-team',
      version: 1,
    });
    database.client.$transaction.mockImplementation(
      async (operation: (client: typeof transaction) => Promise<unknown>) => operation(transaction),
    );
    database.client.workspace.findFirst.mockResolvedValue(null);
    database.client.workspace.findUnique.mockResolvedValue(null);
    database.client.workspaceMembership.findUnique.mockResolvedValue(null);

    moduleRef = await Test.createTestingModule({
      providers: [WorkspacesService, { provide: DatabaseService, useValue: database }],
    }).compile();
    service = moduleRef.get(WorkspacesService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('returns only the workspace selected by the session workspace scope', async () => {
    const response = {
      id: workspaceId,
      name: '제품 개발팀',
      slug: 'product-team',
      version: 1,
    };
    database.client.workspace.findFirst.mockResolvedValue(response);

    await expect(service.getCurrent(workspaceId)).resolves.toEqual(response);
    expect(database.client.workspace.findFirst).toHaveBeenCalledWith({
      select: { id: true, name: true, slug: true, version: true },
      where: { id: workspaceId },
    });
  });

  it.each([null, '89a939c5-29cd-4243-a728-edf79c56c92a'])(
    'returns RESOURCE_NOT_FOUND when the session workspace scope is missing or inaccessible: %s',
    async (requestedWorkspaceId) => {
      await expect(service.getCurrent(requestedWorkspaceId)).rejects.toMatchObject({
        response: { code: 'RESOURCE_NOT_FOUND' },
        status: HttpStatus.NOT_FOUND,
      });
    },
  );

  it('locks the user and atomically creates the normalized workspace and admin membership', async () => {
    await expect(
      service.create(userId, { name: '  제품 개발팀  ', slug: '  PRODUCT-TEAM  ' }),
    ).resolves.toEqual({
      id: workspaceId,
      name: '제품 개발팀',
      slug: 'product-team',
      version: 1,
    });

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(transaction.workspace.create).toHaveBeenCalledWith({
      data: {
        createdByUserId: userId,
        name: '제품 개발팀',
        normalizedSlug: 'product-team',
        slug: 'product-team',
      },
      select: { id: true, name: true, slug: true, version: true },
    });
    expect(transaction.workspaceMembership.create).toHaveBeenCalledWith({
      data: {
        role: 'ADMIN',
        status: 'ACTIVE',
        userId,
        workspaceId,
      },
      select: { id: true },
    });
    expect(transaction.outboxEvent.create).toHaveBeenCalledWith({
      data: {
        actorMembershipId: 'membership-id',
        aggregateId: workspaceId,
        aggregateType: 'WORKSPACE',
        eventType: 'WORKSPACE_CREATED',
        id: expect.any(String),
        payload: { acquisitionSource: 'direct', schemaVersion: 1 },
        workspaceId,
      },
    });
  });

  it('rejects an account that already has a membership before writing', async () => {
    transaction.workspaceMembership.findUnique.mockResolvedValue({ id: 'existing-membership' });

    await expect(
      service.create(userId, { name: '제품 개발팀', slug: 'product-team' }),
    ).rejects.toMatchObject({
      response: { code: 'WORKSPACE_LIMIT_REACHED' },
      status: HttpStatus.CONFLICT,
    });
    expect(transaction.workspace.create).not.toHaveBeenCalled();
  });

  it.each([
    [['user_id'], 'WORKSPACE_LIMIT_REACHED'],
    [['normalized_slug'], 'WORKSPACE_SLUG_IN_USE'],
  ])('maps the %s unique conflict to %s', async (target, code) => {
    database.client.$transaction.mockRejectedValue(uniqueConflict(target));

    await expect(
      service.create(userId, { name: '제품 개발팀', slug: 'product-team' }),
    ).rejects.toMatchObject({ response: { code }, status: HttpStatus.CONFLICT });
  });
});
