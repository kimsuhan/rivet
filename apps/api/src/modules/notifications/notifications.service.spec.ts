import { NotificationType } from '@rivet/database';

import type { DatabaseService } from '../../common/database/database.service';
import type { ObservabilityService } from '../../common/observability/observability.service';
import { deterministicProductEventId } from '../../common/observability/product-event';
import { NotificationsService } from './notifications.service';

const ACTOR_USER_ID = '9a6ce41c-e921-4acd-90f1-692bb8e839fe';
const COMMENT_ID = 'f93998ef-fc8c-47e5-a6ad-e313638ca3e5';
const MEMBERSHIP_ID = 'db10c654-793f-451b-9a91-89d32dc40520';
const NOTIFICATION_ID = '9d72f1f7-7ec5-4f51-bf82-9a3b5ddff99c';
const OTHER_NOTIFICATION_ID = '94533b26-ef41-4ef1-8bce-d23a7874c8b0';
const ISSUE_ID = 'f6f82225-2e82-43fb-b019-752fa6e0ce54';
const WORKSPACE_ID = '71eaa72b-9f25-4d1b-91d3-a7d4b9a27f68';

function row(
  overrides: Partial<{
    createdAt: Date;
    id: string;
    readAt: Date | null;
    type: NotificationType;
  }> = {},
) {
  return {
    actorMembership: {
      user: {
        avatarFileId: null,
        displayName: '알림 행위자',
        id: ACTOR_USER_ID,
      },
    },
    commentId: COMMENT_ID,
    createdAt: new Date('2026-07-11T03:00:00.000Z'),
    handoffId: null,
    id: NOTIFICATION_ID,
    issue: { id: ISSUE_ID, identifier: 'API-42', title: '알림 API 구현' },
    readAt: null,
    type: NotificationType.MENTIONED,
    ...overrides,
  };
}

describe('NotificationsService', () => {
  const context = { membershipId: MEMBERSHIP_ID, workspaceId: WORKSPACE_ID };
  const count = jest.fn();
  const executeRaw = jest.fn().mockResolvedValue(1);
  const findFirst = jest.fn();
  const findMany = jest.fn();
  const queryRaw = jest.fn();
  const updateMany = jest.fn();
  const transaction = {
    $executeRaw: executeRaw,
    $queryRaw: queryRaw,
    notification: { findFirst, updateMany },
  };
  const database = {
    client: {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
      notification: { count, findMany },
    },
  } as unknown as DatabaseService;
  const capture = jest.fn();
  const service = new NotificationsService(database, {
    capture,
  } as unknown as ObservabilityService);

  beforeEach(() => {
    jest.clearAllMocks();
    executeRaw.mockResolvedValue(1);
  });

  it('lists only the recipient notifications with stable pagination and filters', async () => {
    const first = row();
    const second = row({
      createdAt: new Date('2026-07-11T02:00:00.000Z'),
      id: OTHER_NOTIFICATION_ID,
      readAt: new Date('2026-07-11T02:30:00.000Z'),
      type: NotificationType.COMMENT_ADDED,
    });
    findMany.mockResolvedValue([first, second]);

    const result = await service.list(context, {
      limit: 1,
      read: true,
      type: 'MENTIONED,COMMENT_ADDED,MENTIONED',
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 2,
        where: expect.objectContaining({
          readAt: { not: null },
          issue: { deletedAt: null },
          recipientMembershipId: MEMBERSHIP_ID,
          type: { in: [NotificationType.MENTIONED, NotificationType.COMMENT_ADDED] },
          workspaceId: WORKSPACE_ID,
        }),
      }),
    );
    expect(result.items).toEqual([
      expect.objectContaining({
        actor: {
          avatarFileId: null,
          displayName: '알림 행위자',
          id: ACTOR_USER_ID,
        },
        createdAt: '2026-07-11T03:00:00.000Z',
        id: NOTIFICATION_ID,
        readAt: null,
      }),
    ]);
    expect(result.nextCursor).toEqual(expect.any(String));

    findMany.mockResolvedValue([]);
    await service.list(context, { cursor: result.nextCursor!, limit: 1 });
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            {
              OR: [
                { createdAt: { lt: first.createdAt } },
                { createdAt: first.createdAt, id: { lt: first.id } },
              ],
            },
          ],
        }),
      }),
    );
  });

  it.each([
    [{ limit: 101 }, 'INVALID_QUERY'],
    [{ limit: 50, type: 'UNKNOWN' }, 'INVALID_QUERY'],
    [{ cursor: 'not-a-cursor', limit: 50 }, 'INVALID_QUERY'],
  ])('rejects invalid list input %#', async (query, code) => {
    await expect(service.list(context, query)).rejects.toMatchObject({
      response: expect.objectContaining({ code }),
      status: 400,
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('counts unread notifications only for the current recipient and workspace', async () => {
    count.mockResolvedValue(7);

    await expect(service.unreadCount(context)).resolves.toEqual({ count: 7 });
    expect(count).toHaveBeenCalledWith({
      where: {
        issue: { deletedAt: null },
        readAt: null,
        recipientMembershipId: MEMBERSHIP_ID,
        workspaceId: WORKSPACE_ID,
      },
    });
  });

  it('changes one owned notification and emits a recipient-only signal atomically', async () => {
    findFirst.mockResolvedValue(row());
    updateMany.mockResolvedValue({ count: 1 });

    const result = await service.updateRead(context, NOTIFICATION_ID, { read: true });

    expect(updateMany).toHaveBeenCalledWith({
      data: { readAt: expect.any(Date) },
      where: {
        id: NOTIFICATION_ID,
        readAt: null,
        recipientMembershipId: MEMBERSHIP_ID,
        workspaceId: WORKSPACE_ID,
      },
    });
    expect(result.readAt).toEqual(expect.any(String));
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: deterministicProductEventId(NOTIFICATION_ID, 'notification_read'),
        membershipId: MEMBERSHIP_ID,
        name: 'notification_read',
        properties: {
          notificationId: NOTIFICATION_ID,
          notificationType: NotificationType.MENTIONED,
        },
        workspaceId: WORKSPACE_ID,
      }),
    );
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(executeRaw.mock.calls[0]?.[1] as string) as Record<string, unknown>;
    expect(payload).toEqual({
      changeType: 'UPDATED',
      eventId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      recipientMembershipId: MEMBERSHIP_ID,
      resourceId: NOTIFICATION_ID,
      resourceType: 'NOTIFICATION',
      version: null,
      workspaceId: WORKSPACE_ID,
    });
  });

  it('keeps an already desired read state idempotent without another signal', async () => {
    const readAt = new Date('2026-07-11T04:00:00.000Z');
    findFirst.mockResolvedValue(row({ readAt }));

    await expect(service.updateRead(context, NOTIFICATION_ID, { read: true })).resolves.toEqual(
      expect.objectContaining({ readAt: readAt.toISOString() }),
    );
    expect(updateMany).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it('does not reveal another recipient notification', async () => {
    findFirst.mockResolvedValue(null);

    await expect(
      service.updateRead(context, NOTIFICATION_ID, { read: true }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'RESOURCE_NOT_FOUND' }),
      status: 404,
    });
    expect(updateMany).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('locks and reads all current notifications with one signal per changed row', async () => {
    queryRaw.mockResolvedValue([{ id: NOTIFICATION_ID }, { id: OTHER_NOTIFICATION_ID }]);
    updateMany.mockResolvedValue({ count: 2 });

    await expect(service.readAll(context)).resolves.toEqual({ updatedCount: 2 });

    expect(updateMany).toHaveBeenCalledWith({
      data: { readAt: expect.any(Date) },
      where: {
        id: { in: [NOTIFICATION_ID, OTHER_NOTIFICATION_ID] },
        readAt: null,
        recipientMembershipId: MEMBERSHIP_ID,
        workspaceId: WORKSPACE_ID,
      },
    });
    expect(executeRaw).toHaveBeenCalledTimes(2);
    const payloads = executeRaw.mock.calls.map(
      (call) => JSON.parse(call[1] as string) as Record<string, unknown>,
    );
    expect(payloads.map(({ resourceId }) => resourceId)).toEqual([
      NOTIFICATION_ID,
      OTHER_NOTIFICATION_ID,
    ]);
    expect(payloads[0]?.eventId).not.toBe(payloads[1]?.eventId);
  });

  it('does not emit a read-all signal when every notification is already read', async () => {
    queryRaw.mockResolvedValue([]);

    await expect(service.readAll(context)).resolves.toEqual({ updatedCount: 0 });
    expect(updateMany).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
  });
});
