import { Test } from '@nestjs/testing';

import { MembershipStatus, NotificationType, ProjectRole } from '@rivet/database';
import type { ApiHandoffCreatedOutboxPayload } from '@rivet/event-contracts';

import { DatabaseService } from '../../../common/database/database.service';
import type { ClaimedOutboxEvent } from '../outbox.types';
import { ApiHandoffNotificationHandler } from './api-handoff-notification.handler';

describe('ApiHandoffNotificationHandler', () => {
  const actorMembershipId = '607629d0-53e6-469d-bbc8-eb86c50a0288';
  const activeRecipientMembershipId = 'c7223ce5-74b3-4495-ae66-a3d269017f6a';
  const inactiveRecipientMembershipId = '9d349d04-c7d5-43fb-bb57-b768e2bf0e86';
  const foreignRecipientMembershipId = 'e707e5a7-70b7-487e-a214-b0e7ecb23615';
  const workspaceId = '77a49ce9-f158-4f4d-b898-bb5b309e461f';
  const downstreamIssueId = '98ab3a6d-0d24-484e-a36a-b8028dc00465';
  const event: ClaimedOutboxEvent = {
    actorMembershipId,
    aggregateId: 'de9d55e4-6181-4a8a-8fdf-f8faf536dc99',
    aggregateType: 'API_HANDOFF',
    attemptCount: 1,
    availableAt: new Date('2026-07-11T00:00:00.000Z'),
    createdAt: new Date('2026-07-11T00:00:00.000Z'),
    eventType: 'API_HANDOFF_CREATED',
    id: 'f4dc62a4-50d7-4fba-a4f1-223ab9eefcd3',
    payload: {},
    workspaceId,
  };
  const payload: ApiHandoffCreatedOutboxPayload = {
    candidateRecipientMembershipIds: [
      actorMembershipId,
      activeRecipientMembershipId,
      inactiveRecipientMembershipId,
      foreignRecipientMembershipId,
    ],
    downstreamIssueIds: [downstreamIssueId],
    handoffId: event.aggregateId,
    issueId: 'f57fa7be-1fe9-4744-a8db-704bf989a3cd',
    kind: 'INITIAL',
    schemaVersion: 1,
  };
  const transaction = {
    $executeRaw: jest.fn(),
    apiHandoff: { findFirst: jest.fn() },
    issue: { findMany: jest.fn() },
    notification: { createManyAndReturn: jest.fn() },
    workspaceMembership: { findMany: jest.fn() },
  };
  const database = { client: { $transaction: jest.fn() } };
  let handler: ApiHandoffNotificationHandler;

  function downstreamIssue({
    assigneeMembershipId = null,
    deletedAt = null,
    id,
    identifier,
    projectRole,
    subscriberMembershipIds = [],
    teamMembershipIds = [],
  }: {
    assigneeMembershipId?: string | null;
    deletedAt?: Date | null;
    id: string;
    identifier: string;
    projectRole: ProjectRole;
    subscriberMembershipIds?: string[];
    teamMembershipIds?: string[];
  }) {
    return {
      assigneeMembershipId,
      deletedAt,
      id,
      identifier,
      projectRole,
      subscriptions: subscriberMembershipIds.map((membershipId) => ({ membershipId })),
      team: {
        teamMembers: teamMembershipIds.map((membershipId) => ({ membershipId })),
      },
    };
  }

  beforeEach(async () => {
    jest.resetAllMocks();
    database.client.$transaction.mockImplementation(
      async (callback: (client: typeof transaction) => Promise<void>) => callback(transaction),
    );
    transaction.apiHandoff.findFirst.mockResolvedValue({
      authorMembershipId: actorMembershipId,
      issueId: payload.issueId,
      issue: { deletedAt: null, parentIssueId: null },
      kind: 'INITIAL',
      workspaceId,
    });
    transaction.issue.findMany.mockResolvedValue([
      downstreamIssue({
        id: downstreamIssueId,
        identifier: 'WEB-42',
        projectRole: ProjectRole.WEB_FRONTEND,
        teamMembershipIds: [activeRecipientMembershipId],
      }),
    ]);
    transaction.workspaceMembership.findMany.mockResolvedValue([
      { id: activeRecipientMembershipId },
    ]);
    transaction.notification.createManyAndReturn.mockResolvedValue([
      {
        id: '17bb3fd0-ff3c-4da5-89cb-45716d160086',
        recipientMembershipId: activeRecipientMembershipId,
      },
    ]);

    const module = await Test.createTestingModule({
      providers: [ApiHandoffNotificationHandler, { provide: DatabaseService, useValue: database }],
    }).compile();
    handler = module.get(ApiHandoffNotificationHandler);
  });

  it('stores only active same-workspace non-actor recipients and notifies new rows', async () => {
    await handler.handle(event, payload);

    expect(transaction.workspaceMembership.findMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: [
            activeRecipientMembershipId,
            inactiveRecipientMembershipId,
            foreignRecipientMembershipId,
          ],
        },
        status: MembershipStatus.ACTIVE,
        workspaceId,
      },
      select: { id: true },
    });
    expect(transaction.notification.createManyAndReturn).toHaveBeenCalledWith({
      data: [
        {
          actorMembershipId,
          eventId: event.id,
          handoffId: payload.handoffId,
          issueId: downstreamIssueId,
          recipientMembershipId: activeRecipientMembershipId,
          type: NotificationType.API_HANDOFF_CREATED,
          workspaceId,
        },
      ],
      select: { id: true, recipientMembershipId: true },
      skipDuplicates: true,
    });
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
    const signal = JSON.parse(transaction.$executeRaw.mock.calls[0]?.[1] as string) as Record<
      string,
      unknown
    >;
    expect(signal).toEqual(
      expect.objectContaining({
        changeType: 'CREATED',
        eventId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        recipientMembershipId: activeRecipientMembershipId,
        resourceId: '17bb3fd0-ff3c-4da5-89cb-45716d160086',
        resourceType: 'NOTIFICATION',
        version: null,
        workspaceId,
      }),
    );
    expect(signal.eventId).not.toBe(event.id);
    expect(transaction.issue.findMany).toHaveBeenCalledTimes(1);
  });

  it('prefers the current assignee over subscribers and active team members', async () => {
    const assignedIssueId = '0ddb88a3-dce6-4c6a-a117-2ca3c6dff723';
    const subscribedIssueId = '0a9633a2-4e5a-4ea8-8bf0-dd0406b2338b';
    const teamIssueId = '576db6f5-d728-4f63-8075-d33751a0104b';
    transaction.issue.findMany.mockResolvedValue([
      downstreamIssue({
        id: teamIssueId,
        identifier: 'WEB-1',
        projectRole: ProjectRole.WEB_FRONTEND,
        teamMembershipIds: [activeRecipientMembershipId],
      }),
      downstreamIssue({
        id: subscribedIssueId,
        identifier: 'WEB-2',
        projectRole: ProjectRole.WEB_FRONTEND,
        subscriberMembershipIds: [activeRecipientMembershipId],
      }),
      downstreamIssue({
        assigneeMembershipId: activeRecipientMembershipId,
        id: assignedIssueId,
        identifier: 'APP-9',
        projectRole: ProjectRole.APP_FRONTEND,
      }),
    ]);

    await handler.handle(event, {
      ...payload,
      downstreamIssueIds: [teamIssueId, subscribedIssueId, assignedIssueId],
    });

    expect(transaction.notification.createManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ issueId: assignedIssueId })],
      }),
    );
  });

  it('prefers an automatic subscription over active target team membership', async () => {
    const subscribedIssueId = '9df3a7d9-1d60-4341-bcaf-9f56cc77f66d';
    const teamIssueId = '598ea445-cf8c-43fe-a45d-0259288bc7fa';
    transaction.issue.findMany.mockResolvedValue([
      downstreamIssue({
        id: teamIssueId,
        identifier: 'WEB-1',
        projectRole: ProjectRole.WEB_FRONTEND,
        teamMembershipIds: [activeRecipientMembershipId],
      }),
      downstreamIssue({
        id: subscribedIssueId,
        identifier: 'APP-9',
        projectRole: ProjectRole.APP_FRONTEND,
        subscriberMembershipIds: [activeRecipientMembershipId],
      }),
    ]);

    await handler.handle(event, {
      ...payload,
      downstreamIssueIds: [teamIssueId, subscribedIssueId],
    });

    expect(transaction.notification.createManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ issueId: subscribedIssueId })],
      }),
    );
  });

  it('uses project role, identifier, and id ordering for multiple targets at the same priority', async () => {
    const appIssueId = '6c641b9e-bb59-4490-9bd7-0dc3ce38e493';
    const laterWebIssueId = '8c770c29-0524-4a30-827a-44f08a3ef8af';
    const earlierWebIssueId = '35b6f486-6796-4cb0-bbe1-3fb81d3b55a0';
    transaction.issue.findMany.mockResolvedValue([
      downstreamIssue({
        assigneeMembershipId: activeRecipientMembershipId,
        id: appIssueId,
        identifier: 'APP-1',
        projectRole: ProjectRole.APP_FRONTEND,
      }),
      downstreamIssue({
        assigneeMembershipId: activeRecipientMembershipId,
        id: laterWebIssueId,
        identifier: 'WEB-2',
        projectRole: ProjectRole.WEB_FRONTEND,
      }),
      downstreamIssue({
        assigneeMembershipId: activeRecipientMembershipId,
        id: earlierWebIssueId,
        identifier: 'WEB-1',
        projectRole: ProjectRole.WEB_FRONTEND,
      }),
    ]);

    await handler.handle(event, {
      ...payload,
      downstreamIssueIds: [appIssueId, laterWebIssueId, earlierWebIssueId],
    });

    expect(transaction.notification.createManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ issueId: earlierWebIssueId })],
      }),
    );
  });

  it('falls back to the source parent when the recipient has no downstream connection', async () => {
    const parentIssueId = '26607c81-4939-4074-97c8-50d254483b5d';
    transaction.apiHandoff.findFirst.mockResolvedValue({
      authorMembershipId: actorMembershipId,
      issueId: payload.issueId,
      issue: { deletedAt: null, parentIssueId },
      kind: 'INITIAL',
      workspaceId,
    });
    transaction.issue.findMany.mockResolvedValue([
      downstreamIssue({
        id: downstreamIssueId,
        identifier: 'WEB-42',
        projectRole: ProjectRole.WEB_FRONTEND,
      }),
    ]);

    await handler.handle(event, payload);

    expect(transaction.notification.createManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ issueId: parentIssueId })],
      }),
    );
  });

  it('falls back to the source backend when it has no parent or connected downstream', async () => {
    transaction.issue.findMany.mockResolvedValue([]);

    await handler.handle(event, { ...payload, downstreamIssueIds: [] });

    expect(transaction.notification.createManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ issueId: payload.issueId })],
      }),
    );
  });

  it('does not notify when an idempotent replay inserts no rows', async () => {
    transaction.apiHandoff.findFirst.mockResolvedValue({
      authorMembershipId: actorMembershipId,
      issueId: payload.issueId,
      issue: { deletedAt: null, parentIssueId: null },
      kind: 'FOLLOW_UP',
      workspaceId,
    });
    transaction.notification.createManyAndReturn.mockResolvedValue([]);

    await handler.handle(event, { ...payload, kind: 'FOLLOW_UP' });

    expect(transaction.notification.createManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            type: NotificationType.API_HANDOFF_FOLLOW_UP_CREATED,
          }),
        ],
      }),
    );
    expect(transaction.$executeRaw).not.toHaveBeenCalled();
  });

  it('permanently rejects a missing handoff source', async () => {
    transaction.apiHandoff.findFirst.mockResolvedValue(null);

    await expect(handler.handle(event, payload)).rejects.toMatchObject({
      code: 'OUTBOX_EVENT_CONTRACT_INVALID',
    });
    expect(transaction.notification.createManyAndReturn).not.toHaveBeenCalled();
  });

  it('permanently rejects a downstream issue outside the event workspace', async () => {
    transaction.issue.findMany.mockResolvedValue([]);

    await expect(handler.handle(event, payload)).rejects.toMatchObject({
      code: 'OUTBOX_EVENT_CONTRACT_INVALID',
    });
    expect(transaction.workspaceMembership.findMany).not.toHaveBeenCalled();
    expect(transaction.notification.createManyAndReturn).not.toHaveBeenCalled();
  });

  it('treats a delayed handoff event for a trashed source issue as a successful no-op', async () => {
    transaction.apiHandoff.findFirst.mockResolvedValue({
      authorMembershipId: actorMembershipId,
      issue: { deletedAt: new Date(), parentIssueId: null },
      issueId: payload.issueId,
      kind: 'INITIAL',
      workspaceId,
    });

    await handler.handle(event, payload);

    expect(transaction.issue.findMany).not.toHaveBeenCalled();
    expect(transaction.notification.createManyAndReturn).not.toHaveBeenCalled();
  });
});
