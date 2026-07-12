import { Test } from '@nestjs/testing';

import { MembershipStatus, NotificationType } from '@rivet/database';
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
    downstreamIssueIds: ['98ab3a6d-0d24-484e-a36a-b8028dc00465'],
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

  beforeEach(async () => {
    jest.resetAllMocks();
    database.client.$transaction.mockImplementation(
      async (callback: (client: typeof transaction) => Promise<void>) => callback(transaction),
    );
    transaction.apiHandoff.findFirst.mockResolvedValue({
      authorMembershipId: actorMembershipId,
      issueId: payload.issueId,
      issue: { deletedAt: null },
      kind: 'INITIAL',
      workspaceId,
    });
    transaction.issue.findMany.mockResolvedValue(payload.downstreamIssueIds.map((id) => ({ id })));
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
          issueId: payload.issueId,
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
  });

  it('does not notify when an idempotent replay inserts no rows', async () => {
    transaction.apiHandoff.findFirst.mockResolvedValue({
      authorMembershipId: actorMembershipId,
      issueId: payload.issueId,
      issue: { deletedAt: null },
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
      issue: { deletedAt: new Date() },
      issueId: payload.issueId,
      kind: 'INITIAL',
      workspaceId,
    });

    await handler.handle(event, payload);

    expect(transaction.issue.findMany).not.toHaveBeenCalled();
    expect(transaction.notification.createManyAndReturn).not.toHaveBeenCalled();
  });
});
