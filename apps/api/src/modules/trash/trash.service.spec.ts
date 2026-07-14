import { Test } from '@nestjs/testing';

import { MembershipRole, MembershipStatus } from '@rivet/database';
import { ISSUE_PURGE_SCHEDULED } from '@rivet/event-contracts';

import { DatabaseService } from '../../common/database/database.service';
import { TrashService } from './trash.service';

describe('TrashService', () => {
  const workspaceId = '77a49ce9-f158-4f4d-b898-bb5b309e461f';
  const membershipId = '607629d0-53e6-469d-bbc8-eb86c50a0288';
  const issueId = 'f57fa7be-1fe9-4744-a8db-704bf989a3cd';
  const projectId = 'de9d55e4-6181-4a8a-8fdf-f8faf536dc99';
  const deletedAt = new Date('2026-07-11T00:00:00.000Z');
  const purgeAt = new Date('2026-08-10T00:00:00.000Z');
  const transaction = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    activityEvent: { create: jest.fn() },
    issue: { findFirst: jest.fn(), update: jest.fn() },
    outboxEvent: { updateMany: jest.fn() },
    project: { findFirst: jest.fn(), update: jest.fn() },
    team: { findFirst: jest.fn() },
    teamWork: { findFirst: jest.fn(), updateMany: jest.fn() },
  };
  const database = {
    client: {
      $transaction: jest.fn(),
      issue: { findMany: jest.fn() },
      project: { findMany: jest.fn() },
    },
  };
  let service: TrashService;

  beforeEach(async () => {
    jest.resetAllMocks();
    database.client.$transaction.mockImplementation(
      async (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction),
    );
    const module = await Test.createTestingModule({
      providers: [TrashService, { provide: DatabaseService, useValue: database }],
    }).compile();
    service = module.get(TrashService);
  });

  it('lists only requested trash resources with deletion and original connection summaries', async () => {
    database.client.issue.findMany.mockResolvedValue([
      {
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        deletedAt,
        deletedByMembership: {
          id: membershipId,
          user: { avatarFileId: null, displayName: '관리자' },
        },
        id: issueId,
        identifier: 'API-1',
        project: { id: projectId, name: '프로젝트' },
        purgeAt,
        title: '삭제된 작업',
        version: 2,
      },
    ]);

    await expect(
      service.list(workspaceId, { limit: 50, query: '삭제', resourceType: 'ISSUE' }),
    ).resolves.toEqual({
      items: [
        expect.objectContaining({
          deletedAt: deletedAt.toISOString(),
          deletedBy: expect.objectContaining({ id: membershipId }),
          id: issueId,
          project: { id: projectId, name: '프로젝트' },
          purgeAt: purgeAt.toISOString(),
          resourceType: 'ISSUE',
        }),
      ],
      nextCursor: null,
    });
    expect(database.client.project.findMany).not.toHaveBeenCalled();
    expect(database.client.issue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: { not: null }, workspaceId }),
      }),
    );
  });

  it('restores an issue, cancels its pending purge, and reports archived relations', async () => {
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: workspaceId }])
      .mockResolvedValueOnce([{ role: MembershipRole.ADMIN, status: MembershipStatus.ACTIVE }])
      .mockResolvedValueOnce([
        {
          databaseNow: new Date('2026-07-12T00:00:00.000Z'),
          deletedAt,
          projectId,
          purgeAt,
          version: 2,
        },
      ]);
    transaction.project.findFirst.mockResolvedValue({ archivedAt: new Date(), deletedAt: null });

    await expect(service.restoreIssue({ membershipId, workspaceId }, issueId, 2)).resolves.toEqual({
      id: issueId,
      resourceType: 'ISSUE',
      version: 3,
      warnings: ['PROJECT_ARCHIVED'],
    });
    expect(transaction.issue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deletedAt: null,
          deletedByMembershipId: null,
          purgeAt: null,
        }),
      }),
    );
    expect(transaction.outboxEvent.updateMany).toHaveBeenCalledWith({
      data: { canceledAt: expect.any(Date) },
      where: {
        aggregateId: issueId,
        canceledAt: null,
        eventType: ISSUE_PURGE_SCHEDULED,
        processedAt: null,
        workspaceId,
      },
    });
    const signal = JSON.parse(transaction.$executeRaw.mock.calls[0]?.[2] as string) as Record<
      string,
      unknown
    >;
    expect(signal).toEqual(
      expect.objectContaining({ changeType: 'RESTORED', resourceId: issueId, version: 3 }),
    );
  });

  it('rejects a restore with a stale version before changing the resource', async () => {
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: workspaceId }])
      .mockResolvedValueOnce([{ role: MembershipRole.ADMIN, status: MembershipStatus.ACTIVE }])
      .mockResolvedValueOnce([
        {
          databaseNow: new Date('2026-07-12T00:00:00.000Z'),
          deletedAt,
          projectId: null,
          purgeAt,
          version: 3,
        },
      ]);

    await expect(
      service.restoreIssue({ membershipId, workspaceId }, issueId, 2),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'VERSION_CONFLICT', currentVersion: 3 }),
    });
    expect(transaction.issue.update).not.toHaveBeenCalled();
    expect(transaction.outboxEvent.updateMany).not.toHaveBeenCalled();
  });

  it('does not restore a resource once the database purge deadline has arrived', async () => {
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: workspaceId }])
      .mockResolvedValueOnce([{ role: MembershipRole.ADMIN, status: MembershipStatus.ACTIVE }])
      .mockResolvedValueOnce([
        {
          databaseNow: purgeAt,
          deletedAt,
          projectId: null,
          purgeAt,
          version: 2,
        },
      ]);

    await expect(
      service.restoreIssue({ membershipId, workspaceId }, issueId, 2),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'RESOURCE_NOT_FOUND' }),
    });
    expect(transaction.issue.update).not.toHaveBeenCalled();
  });

});
