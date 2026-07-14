import { Test } from '@nestjs/testing';

import type {
  IssuePurgeScheduledOutboxPayload,
  ProjectPurgeScheduledOutboxPayload,
} from '@rivet/event-contracts';

import { DatabaseService } from '../../../common/database/database.service';
import type { ClaimedOutboxEvent } from '../outbox.types';
import { CanceledOutboxError, RetryableOutboxError } from '../outbox-errors';
import { ResourcePurgeHandler } from './resource-purge.handler';

describe('ResourcePurgeHandler', () => {
  const workspaceId = '77a49ce9-f158-4f4d-b898-bb5b309e461f';
  const issueId = 'f57fa7be-1fe9-4744-a8db-704bf989a3cd';
  const projectId = 'de9d55e4-6181-4a8a-8fdf-f8faf536dc99';
  const purgeAt = '2026-08-10T00:00:00.000Z';
  const event: ClaimedOutboxEvent = {
    actorMembershipId: '607629d0-53e6-469d-bbc8-eb86c50a0288',
    aggregateId: issueId,
    aggregateType: 'ISSUE',
    attemptCount: 1,
    availableAt: new Date(purgeAt),
    createdAt: new Date('2026-07-11T00:00:00.000Z'),
    eventType: 'ISSUE_PURGE_SCHEDULED',
    id: 'c7223ce5-74b3-4495-ae66-a3d269017f6a',
    payload: {},
    workspaceId,
  };
  const issuePayload: IssuePurgeScheduledOutboxPayload = {
    issueId,
    purgeAt,
    schemaVersion: 1,
  };
  const projectPayload: ProjectPurgeScheduledOutboxPayload = {
    projectId,
    purgeAt,
    schemaVersion: 1,
  };
  const transaction = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    activityEvent: { deleteMany: jest.fn() },
    apiHandoff: { deleteMany: jest.fn() },
    comment: { deleteMany: jest.fn() },
    file: { updateMany: jest.fn() },
    issue: { deleteMany: jest.fn(), findFirst: jest.fn() },
    issueFileAttachment: { deleteMany: jest.fn(), findMany: jest.fn() },
    issueLabel: { deleteMany: jest.fn() },
    issueSubscription: { deleteMany: jest.fn() },
    mention: { deleteMany: jest.fn() },
    notification: { deleteMany: jest.fn() },
    project: { deleteMany: jest.fn() },
    projectRoleTeam: { deleteMany: jest.fn() },
  };
  const database = { client: { $transaction: jest.fn() } };
  let handler: ResourcePurgeHandler;

  beforeEach(async () => {
    jest.resetAllMocks();
    database.client.$transaction.mockImplementation(
      async (callback: (client: typeof transaction) => Promise<void>) => callback(transaction),
    );
    transaction.$queryRaw.mockResolvedValue([
      {
        databaseNow: new Date('2026-08-10T00:00:01.000Z'),
        deletedAt: new Date('2026-07-11T00:00:00.000Z'),
        purgeAt: new Date(purgeAt),
      },
    ]);
    transaction.issueFileAttachment.findMany.mockResolvedValue([
      { fileId: '98ab3a6d-0d24-484e-a36a-b8028dc00465' },
    ]);
    transaction.issue.deleteMany.mockResolvedValue({ count: 1 });
    transaction.project.deleteMany.mockResolvedValue({ count: 1 });
    transaction.issue.findFirst.mockResolvedValue(null);

    const module = await Test.createTestingModule({
      providers: [ResourcePurgeHandler, { provide: DatabaseService, useValue: database }],
    }).compile();
    handler = module.get(ResourcePurgeHandler);
  });

  it('unlinks files, removes issue-owned rows, and notifies after the final issue delete', async () => {
    await handler.handleIssue(event, issuePayload);

    expect(transaction.file.updateMany).toHaveBeenCalledWith({
      data: { unlinkedAt: new Date('2026-08-10T00:00:01.000Z') },
      where: {
        id: { in: ['98ab3a6d-0d24-484e-a36a-b8028dc00465'] },
        workspaceId,
      },
    });
    expect(transaction.notification.deleteMany).toHaveBeenCalled();
    expect(transaction.activityEvent.deleteMany).toHaveBeenCalled();
    expect(transaction.issue.deleteMany).toHaveBeenCalled();
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
    const signal = JSON.parse(transaction.$executeRaw.mock.calls[0]?.[1] as string) as Record<
      string,
      unknown
    >;
    expect(signal).toEqual(
      expect.objectContaining({
        changeType: 'DELETED',
        eventId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        resourceId: issueId,
        resourceType: 'ISSUE',
      }),
    );
  });

  it('cancels a restored, rescheduled, or early issue purge', async () => {
    for (const row of [
      { databaseNow: new Date(purgeAt), deletedAt: null, purgeAt: null },
      {
        databaseNow: new Date(purgeAt),
        deletedAt: new Date(),
        purgeAt: new Date('2026-08-11T00:00:00.000Z'),
      },
      {
        databaseNow: new Date('2026-08-09T23:59:59.999Z'),
        deletedAt: new Date(),
        purgeAt: new Date(purgeAt),
      },
    ]) {
      transaction.$queryRaw.mockResolvedValueOnce([row]);
      await expect(handler.handleIssue(event, issuePayload)).rejects.toEqual(
        new CanceledOutboxError('RESOURCE_PURGE_CANCELED'),
      );
    }
    expect(transaction.issue.deleteMany).not.toHaveBeenCalled();
  });

  it('treats an already purged issue as idempotent success', async () => {
    transaction.$queryRaw.mockResolvedValueOnce([]);
    await expect(handler.handleIssue(event, issuePayload)).resolves.toBeUndefined();
    expect(transaction.issueFileAttachment.findMany).not.toHaveBeenCalled();
  });

  it('retries project purge with PROJECT_PURGE_BLOCKED when any linked issue remains', async () => {
    transaction.issue.findFirst.mockResolvedValueOnce({ id: issueId });
    await expect(
      handler.handleProject(
        { ...event, aggregateId: projectId, aggregateType: 'PROJECT' },
        projectPayload,
      ),
    ).rejects.toEqual(new RetryableOutboxError('PROJECT_PURGE_BLOCKED'));
    expect(transaction.projectRoleTeam.deleteMany).not.toHaveBeenCalled();
  });

  it('removes project relations and emits its own deletion signal', async () => {
    await handler.handleProject(
      { ...event, aggregateId: projectId, aggregateType: 'PROJECT' },
      projectPayload,
    );
    expect(transaction.projectRoleTeam.deleteMany).toHaveBeenCalled();
    expect(transaction.activityEvent.deleteMany).toHaveBeenCalled();
    expect(transaction.project.deleteMany).toHaveBeenCalled();
    const signal = JSON.parse(transaction.$executeRaw.mock.calls[0]?.[1] as string) as Record<
      string,
      unknown
    >;
    expect(signal).toEqual(
      expect.objectContaining({ resourceId: projectId, resourceType: 'PROJECT' }),
    );
  });
});
