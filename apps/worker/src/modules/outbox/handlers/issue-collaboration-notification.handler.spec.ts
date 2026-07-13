import { Test } from '@nestjs/testing';

import { MembershipStatus, NotificationType } from '@rivet/database';

import { DatabaseService } from '../../../common/database/database.service';
import type { ClaimedOutboxEvent } from '../outbox.types';
import { IssueCollaborationNotificationHandler } from './issue-collaboration-notification.handler';

describe('IssueCollaborationNotificationHandler', () => {
  const actorMembershipId = '607629d0-53e6-469d-bbc8-eb86c50a0288';
  const firstRecipientMembershipId = 'c7223ce5-74b3-4495-ae66-a3d269017f6a';
  const secondRecipientMembershipId = '9d349d04-c7d5-43fb-bb57-b768e2bf0e86';
  const thirdRecipientMembershipId = 'e707e5a7-70b7-487e-a214-b0e7ecb23615';
  const workspaceId = '77a49ce9-f158-4f4d-b898-bb5b309e461f';
  const issueId = 'f57fa7be-1fe9-4744-a8db-704bf989a3cd';
  const commentId = 'de9d55e4-6181-4a8a-8fdf-f8faf536dc99';
  const event: ClaimedOutboxEvent = {
    actorMembershipId,
    aggregateId: issueId,
    aggregateType: 'ISSUE',
    attemptCount: 1,
    availableAt: new Date('2026-07-11T00:00:00.000Z'),
    createdAt: new Date('2026-07-11T00:00:00.000Z'),
    eventType: 'ISSUE_CHANGED',
    id: '98ab3a6d-0d24-484e-a36a-b8028dc00465',
    payload: {},
    workspaceId,
  };
  const transaction = {
    $executeRaw: jest.fn(),
    comment: { findFirst: jest.fn() },
    issue: { findFirst: jest.fn() },
    notification: { createManyAndReturn: jest.fn() },
    workspaceMembership: { findMany: jest.fn() },
  };
  const database = { client: { $transaction: jest.fn() } };
  let handler: IssueCollaborationNotificationHandler;

  beforeEach(async () => {
    jest.resetAllMocks();
    database.client.$transaction.mockImplementation(
      async (callback: (client: typeof transaction) => Promise<void>) => callback(transaction),
    );
    transaction.issue.findFirst.mockResolvedValue({
      createdByMembershipId: actorMembershipId,
      deletedAt: null,
    });
    transaction.comment.findFirst.mockResolvedValue({
      authorMembershipId: actorMembershipId,
      issue: { deletedAt: null },
    });
    transaction.workspaceMembership.findMany.mockImplementation(
      ({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(where.id.in.map((id) => ({ id }))),
    );
    transaction.notification.createManyAndReturn.mockImplementation(
      ({ data }: { data: Array<{ recipientMembershipId: string }> }) =>
        Promise.resolve(
          data.map(({ recipientMembershipId }, index) => ({
            id: `17bb3fd0-ff3c-4da5-89cb-45716d16008${index}`,
            recipientMembershipId,
          })),
        ),
    );

    const module = await Test.createTestingModule({
      providers: [
        IssueCollaborationNotificationHandler,
        { provide: DatabaseService, useValue: database },
      ],
    }).compile();
    handler = module.get(IssueCollaborationNotificationHandler);
  });

  it('prioritizes an issue-create mention over assignment and excludes the actor', async () => {
    await handler.handleIssueCreated(event, {
      assigneeMembershipId: firstRecipientMembershipId,
      issueId,
      mentionedMembershipIds: [actorMembershipId, firstRecipientMembershipId],
      schemaVersion: 1,
    });

    expect(transaction.workspaceMembership.findMany).toHaveBeenCalledWith({
      select: { id: true },
      where: {
        id: { in: [firstRecipientMembershipId] },
        status: MembershipStatus.ACTIVE,
        workspaceId,
      },
    });
    expect(transaction.notification.createManyAndReturn).toHaveBeenCalledWith({
      data: [
        {
          actorMembershipId,
          commentId: null,
          eventId: event.id,
          issueId,
          recipientMembershipId: firstRecipientMembershipId,
          type: NotificationType.MENTIONED,
          workspaceId,
        },
      ],
      select: { id: true, recipientMembershipId: true },
      skipDuplicates: true,
    });
  });

  it('does not notify the actor when they assign the issue to themselves', async () => {
    await handler.handleIssueChanged(event, {
      assigneeMembershipId: actorMembershipId,
      changedFields: ['ASSIGNEE'],
      issueId,
      mentionedMembershipIds: [],
      schemaVersion: 1,
      subscriberMembershipIds: [],
      terminalCategory: null,
    });

    expect(transaction.workspaceMembership.findMany).not.toHaveBeenCalled();
    expect(transaction.notification.createManyAndReturn).not.toHaveBeenCalled();
  });

  it('uses mention, assignment, then completed priority for issue changes', async () => {
    await handler.handleIssueChanged(event, {
      assigneeMembershipId: secondRecipientMembershipId,
      changedFields: ['ASSIGNEE', 'WORKFLOW_STATE'],
      issueId,
      mentionedMembershipIds: [firstRecipientMembershipId],
      schemaVersion: 1,
      subscriberMembershipIds: [
        firstRecipientMembershipId,
        secondRecipientMembershipId,
        thirdRecipientMembershipId,
      ],
      terminalCategory: 'COMPLETED',
    });

    expect(transaction.notification.createManyAndReturn.mock.calls[0]?.[0].data).toEqual([
      expect.objectContaining({
        recipientMembershipId: firstRecipientMembershipId,
        type: NotificationType.MENTIONED,
      }),
      expect.objectContaining({
        recipientMembershipId: secondRecipientMembershipId,
        type: NotificationType.ISSUE_ASSIGNED,
      }),
      expect.objectContaining({
        recipientMembershipId: thirdRecipientMembershipId,
        type: NotificationType.ISSUE_COMPLETED,
      }),
    ]);
    const changeEventIds = transaction.$executeRaw.mock.calls.map(
      (call) => (JSON.parse(call[1] as string) as { eventId: string }).eventId,
    );
    expect(changeEventIds).toHaveLength(3);
    expect(new Set(changeEventIds)).toHaveProperty('size', 3);
    expect(changeEventIds).not.toContain(event.id);
  });

  it('creates canceled notifications from the event-time subscriber snapshot', async () => {
    await handler.handleIssueChanged(event, {
      assigneeMembershipId: null,
      changedFields: ['FEATURE_STATUS'],
      issueId,
      mentionedMembershipIds: [],
      schemaVersion: 1,
      subscriberMembershipIds: [firstRecipientMembershipId],
      terminalCategory: 'CANCELED',
    });

    expect(transaction.workspaceMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: [firstRecipientMembershipId] } }),
      }),
    );
    expect(transaction.notification.createManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            recipientMembershipId: firstRecipientMembershipId,
            type: NotificationType.ISSUE_CANCELED,
          }),
        ],
      }),
    );
  });

  it('prioritizes comment mentions and keeps the comment anchor', async () => {
    await handler.handleCommentCreated(
      { ...event, aggregateId: commentId, aggregateType: 'COMMENT' },
      {
        commentId,
        hasMention: true,
        issueId,
        mentionedMembershipIds: [firstRecipientMembershipId],
        schemaVersion: 1,
        subscriberMembershipIds: [firstRecipientMembershipId, secondRecipientMembershipId],
      },
    );

    expect(transaction.notification.createManyAndReturn.mock.calls[0]?.[0].data).toEqual([
      expect.objectContaining({
        commentId,
        recipientMembershipId: firstRecipientMembershipId,
        type: NotificationType.MENTIONED,
      }),
      expect.objectContaining({
        commentId,
        recipientMembershipId: secondRecipientMembershipId,
        type: NotificationType.COMMENT_ADDED,
      }),
    ]);
  });

  it('creates only mentioned notifications for comment edits', async () => {
    await handler.handleCommentMentionsAdded(
      { ...event, aggregateId: commentId, aggregateType: 'COMMENT' },
      {
        commentId,
        issueId,
        mentionedMembershipIds: [firstRecipientMembershipId],
        schemaVersion: 1,
      },
    );

    expect(transaction.notification.createManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            commentId,
            recipientMembershipId: firstRecipientMembershipId,
            type: NotificationType.MENTIONED,
          }),
        ],
      }),
    );
  });

  it('filters inactive and cross-workspace recipients using the current membership query', async () => {
    transaction.workspaceMembership.findMany.mockResolvedValue([]);

    await handler.handleIssueChanged(event, {
      assigneeMembershipId: null,
      changedFields: ['TITLE'],
      issueId,
      mentionedMembershipIds: [firstRecipientMembershipId],
      schemaVersion: 1,
      subscriberMembershipIds: [],
      terminalCategory: null,
    });

    expect(transaction.workspaceMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: MembershipStatus.ACTIVE, workspaceId }),
      }),
    );
    expect(transaction.notification.createManyAndReturn).not.toHaveBeenCalled();
  });

  it('permanently rejects a missing issue or mismatched comment source', async () => {
    transaction.issue.findFirst.mockResolvedValue(null);
    await expect(
      handler.handleIssueChanged(event, {
        assigneeMembershipId: null,
        changedFields: ['TITLE'],
        issueId,
        mentionedMembershipIds: [],
        schemaVersion: 1,
        subscriberMembershipIds: [],
        terminalCategory: null,
      }),
    ).rejects.toMatchObject({ code: 'OUTBOX_EVENT_CONTRACT_INVALID' });

    transaction.comment.findFirst.mockResolvedValue({
      authorMembershipId: firstRecipientMembershipId,
    });
    await expect(
      handler.handleCommentMentionsAdded(
        { ...event, aggregateId: commentId, aggregateType: 'COMMENT' },
        {
          commentId,
          issueId,
          mentionedMembershipIds: [firstRecipientMembershipId],
          schemaVersion: 1,
        },
      ),
    ).rejects.toMatchObject({ code: 'OUTBOX_EVENT_CONTRACT_INVALID' });
  });

  it('treats a delayed event for a trashed issue as a successful no-op', async () => {
    transaction.issue.findFirst.mockResolvedValue({
      createdByMembershipId: actorMembershipId,
      deletedAt: new Date(),
    });

    await handler.handleIssueChanged(event, {
      assigneeMembershipId: null,
      changedFields: ['TITLE'],
      issueId,
      mentionedMembershipIds: [firstRecipientMembershipId],
      schemaVersion: 1,
      subscriberMembershipIds: [],
      terminalCategory: null,
    });

    expect(transaction.workspaceMembership.findMany).not.toHaveBeenCalled();
    expect(transaction.notification.createManyAndReturn).not.toHaveBeenCalled();
  });

  it('notifies only rows inserted during a partial idempotent replay', async () => {
    transaction.notification.createManyAndReturn.mockResolvedValue([
      {
        id: '17bb3fd0-ff3c-4da5-89cb-45716d160086',
        recipientMembershipId: secondRecipientMembershipId,
      },
    ]);

    await handler.handleCommentCreated(
      { ...event, aggregateId: commentId, aggregateType: 'COMMENT' },
      {
        commentId,
        hasMention: false,
        issueId,
        mentionedMembershipIds: [],
        schemaVersion: 1,
        subscriberMembershipIds: [firstRecipientMembershipId, secondRecipientMembershipId],
      },
    );

    expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
    const signal = JSON.parse(transaction.$executeRaw.mock.calls[0]?.[1] as string) as Record<
      string,
      unknown
    >;
    expect(signal).toEqual(
      expect.objectContaining({
        changeType: 'CREATED',
        eventId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        recipientMembershipId: secondRecipientMembershipId,
        resourceId: '17bb3fd0-ff3c-4da5-89cb-45716d160086',
        resourceType: 'NOTIFICATION',
        version: null,
        workspaceId,
      }),
    );
    expect(signal.eventId).not.toBe(event.id);
  });

  it('does not notify an idempotent replay that inserts no rows', async () => {
    transaction.notification.createManyAndReturn.mockResolvedValue([]);

    await handler.handleIssueCreated(event, {
      assigneeMembershipId: firstRecipientMembershipId,
      issueId,
      mentionedMembershipIds: [],
      schemaVersion: 1,
    });

    expect(transaction.$executeRaw).not.toHaveBeenCalled();
  });

  it('propagates NOTIFY failures so the transaction can roll back', async () => {
    transaction.$executeRaw.mockRejectedValue(new Error('notify failed'));

    await expect(
      handler.handleIssueCreated(event, {
        assigneeMembershipId: firstRecipientMembershipId,
        issueId,
        mentionedMembershipIds: [],
        schemaVersion: 1,
      }),
    ).rejects.toThrow('notify failed');
  });
});
