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
  const logoFileId = '8a7bdbbb-bec5-42f2-9ce5-34eef061f2c4';
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
    file: { update: jest.fn(), updateMany: jest.fn() },
    issue: { deleteMany: jest.fn(), findFirst: jest.fn() },
    issueFileAttachment: { deleteMany: jest.fn(), findMany: jest.fn() },
    issueLabel: { deleteMany: jest.fn() },
    issueSubscription: { deleteMany: jest.fn() },
    issueTemplate: { updateMany: jest.fn() },
    mention: { deleteMany: jest.fn() },
    notification: { deleteMany: jest.fn() },
    project: { deleteMany: jest.fn(), update: jest.fn() },
    projectTeam: { deleteMany: jest.fn() },
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
        logoFileId,
        purgeAt: new Date(purgeAt),
      },
    ]);
    transaction.issueFileAttachment.findMany.mockResolvedValue([
      { fileId: '98ab3a6d-0d24-484e-a36a-b8028dc00465' },
    ]);
    transaction.issue.deleteMany.mockResolvedValue({ count: 1 });
    transaction.project.deleteMany.mockResolvedValue({ count: 1 });
    transaction.issue.findFirst.mockResolvedValue(null);
    transaction.issueTemplate.updateMany.mockResolvedValue({ count: 0 });

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
    expect(transaction.issueTemplate.updateMany).not.toHaveBeenCalled();
    expect(transaction.projectTeam.deleteMany).not.toHaveBeenCalled();
  });

  it('cancels project purge when the project is restored after the due snapshot', async () => {
    transaction.$queryRaw
      .mockResolvedValueOnce([
        {
          databaseNow: new Date('2026-08-10T00:00:01.000Z'),
          deletedAt: new Date('2026-07-11T00:00:00.000Z'),
          purgeAt: new Date(purgeAt),
        },
      ])
      .mockResolvedValueOnce([{ id: 'e24340c4-ddf6-4ae6-9168-c24094bb0271' }])
      .mockResolvedValueOnce([
        {
          databaseNow: new Date('2026-08-10T00:00:01.000Z'),
          deletedAt: null,
          purgeAt: null,
        },
      ]);

    await expect(
      handler.handleProject(
        { ...event, aggregateId: projectId, aggregateType: 'PROJECT' },
        projectPayload,
      ),
    ).rejects.toEqual(new CanceledOutboxError('RESOURCE_PURGE_CANCELED'));
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(3);
    expect(transaction.issue.findFirst).not.toHaveBeenCalled();
    expect(transaction.issueTemplate.updateMany).not.toHaveBeenCalled();
    expect(transaction.project.deleteMany).not.toHaveBeenCalled();
  });

  it('detaches template defaults before removing project relations and emits deletion signal', async () => {
    await handler.handleProject(
      { ...event, aggregateId: projectId, aggregateType: 'PROJECT' },
      projectPayload,
    );
    expect(transaction.issueTemplate.updateMany).toHaveBeenCalledWith({
      data: {
        initialProjectTeamId: null,
        projectId: null,
        version: { increment: 1 },
      },
      where: { projectId, workspaceId },
    });
    const sqlStatements = transaction.$queryRaw.mock.calls.map(([strings]) =>
      (strings as TemplateStringsArray).join(' '),
    );
    expect(sqlStatements).toHaveLength(3);
    expect(sqlStatements[0]).toContain('FROM "projects"');
    expect(sqlStatements[0]).not.toContain('FOR UPDATE');
    expect(sqlStatements[1]).toContain('FROM "issue_templates"');
    expect(sqlStatements[1]).toContain('ORDER BY "id"');
    expect(sqlStatements[1]).toContain('FOR UPDATE');
    expect(sqlStatements[2]).toContain('FROM "projects"');
    expect(sqlStatements[2]).toContain('FOR UPDATE');
    expect(transaction.$queryRaw.mock.invocationCallOrder[2] ?? Infinity).toBeLessThan(
      transaction.issueTemplate.updateMany.mock.invocationCallOrder[0] ?? -Infinity,
    );
    expect(transaction.projectTeam.deleteMany).toHaveBeenCalled();
    expect(
      transaction.issueTemplate.updateMany.mock.invocationCallOrder[0] ?? Infinity,
    ).toBeLessThan(transaction.projectTeam.deleteMany.mock.invocationCallOrder[0] ?? -Infinity);
    expect(transaction.activityEvent.deleteMany).toHaveBeenCalled();
    expect(transaction.project.update).toHaveBeenCalledWith({
      data: { logoFileId: null },
      where: { workspaceId_id: { id: projectId, workspaceId } },
    });
    expect(transaction.file.update).toHaveBeenCalledWith({
      data: { unlinkedAt: new Date('2026-08-10T00:00:01.000Z') },
      where: { id: logoFileId },
    });
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
