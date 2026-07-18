import type { ConfigType } from '@nestjs/config';
import type { PinoLogger } from 'nestjs-pino';
import * as webPush from 'web-push';

import type { DatabaseService } from '../../common/database/database.service';
import type { ObservabilityService } from '../../common/observability/observability.service';
import { workerConfig } from '../../config/worker.config';
import type { ClaimedOutboxEvent } from '../outbox/outbox.types';
import { PermanentOutboxError, RetryableOutboxError } from '../outbox/outbox-errors';
import { WebPushDeliveryService } from './web-push-delivery.service';

jest.mock('web-push', () => ({ sendNotification: jest.fn() }));

const event: ClaimedOutboxEvent = {
  actorMembershipId: '69b38d72-6a3b-4f3c-a2e7-2b2f6941c3dc',
  aggregateId: 'd5df34e8-7f55-4776-aa35-19456572c8f9',
  aggregateType: 'COMMENT',
  attemptCount: 1,
  availableAt: new Date('2026-07-16T01:00:00.000Z'),
  createdAt: new Date('2026-07-16T01:00:00.000Z'),
  eventType: 'COMMENT_CREATED',
  id: 'f57fa7be-1fe9-4744-a8db-704bf989a3cd',
  payload: { schemaVersion: 1 },
  workspaceId: '7f5f6cb1-d957-438d-aafe-a9b51d01ad5b',
};
const notificationId = '2be769a8-82cb-4a55-bcc6-2da2e81f1fbc';
const subscriptionId = '9d72f1f7-7ec5-4f51-bf82-9a3b5ddff99c';
const deliveryId = '1e9c0892-a6f8-4fd7-aa36-e654cab0b6af';
const commentId = '5cb38c29-d14f-4451-bd11-af837a6ac598';
const auth = Buffer.alloc(16, 1).toString('base64url');
const p256dh = Buffer.alloc(65, 2).toString('base64url');
const delivery = {
  id: deliveryId,
  notification: {
    commentId,
    handoffId: null,
    id: notificationId,
    issue: { identifier: 'API-42' },
    teamWork: { identifier: 'WEB-7' },
    type: 'MENTIONED' as const,
  },
  outboxEventId: null,
  subscription: {
    auth,
    endpoint: 'https://push.example.test/secret-endpoint',
    id: subscriptionId,
    membershipId: event.actorMembershipId!,
    p256dh,
    session: {
      absoluteExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
      idleExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
      revokedAt: null,
    },
    status: 'ACTIVE' as const,
    workspaceId: event.workspaceId!,
  },
};

describe('WebPushDeliveryService', () => {
  const notificationFindMany = jest.fn();
  const deliveryCreateMany = jest.fn();
  const deliveryCount = jest.fn();
  const deliveryFindMany = jest.fn();
  const deliveryUpdateMany = jest.fn();
  const deliveryUpdate = jest.fn();
  const subscriptionFindFirst = jest.fn();
  const subscriptionUpdateMany = jest.fn();
  const subscriptionUpdate = jest.fn();
  const database = {
    client: {
      $transaction: jest.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
      notification: { findMany: notificationFindMany },
      webPushDelivery: {
        count: deliveryCount,
        createMany: deliveryCreateMany,
        findMany: deliveryFindMany,
        update: deliveryUpdate,
        updateMany: deliveryUpdateMany,
      },
      webPushSubscription: {
        findFirst: subscriptionFindFirst,
        update: subscriptionUpdate,
        updateMany: subscriptionUpdateMany,
      },
    },
  } as unknown as DatabaseService;
  const logger = {
    error: jest.fn(),
    setContext: jest.fn(),
    warn: jest.fn(),
  } as unknown as PinoLogger;
  const observability = { capture: jest.fn() } as unknown as ObservabilityService;
  const config = {
    webPush: {
      privateKey: Buffer.alloc(32, 3).toString('base64url'),
      publicKey: Buffer.alloc(65, 4).toString('base64url'),
      subject: 'mailto:push@example.test',
    },
  } as ConfigType<typeof workerConfig>;
  const service = new WebPushDeliveryService(database, config, logger, observability);
  const sendNotification = jest.mocked(webPush.sendNotification);

  beforeEach(() => {
    jest.clearAllMocks();
    notificationFindMany.mockResolvedValue([
      {
        id: notificationId,
        recipientMembership: { webPushSubscriptions: [{ id: subscriptionId }] },
      },
    ]);
    deliveryCreateMany.mockResolvedValue({ count: 1 });
    deliveryCount.mockResolvedValue(0);
    deliveryFindMany.mockResolvedValue([delivery]);
    deliveryUpdateMany.mockResolvedValue({ count: 1 });
    deliveryUpdate.mockResolvedValue({ id: deliveryId });
    subscriptionUpdateMany.mockResolvedValue({ count: 0 });
    subscriptionUpdate.mockResolvedValue({ id: subscriptionId });
    sendNotification.mockResolvedValue({ body: '', headers: {}, statusCode: 201 });
  });

  it('delivers from the canonical notification with an exact target and minimal payload', async () => {
    await service.deliverNotifications(event);

    expect(deliveryCreateMany).toHaveBeenCalledWith({
      data: [{ notificationId, subscriptionId }],
      skipDuplicates: true,
    });
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(sendNotification.mock.calls[0]?.[1] as string) as Record<
      string,
      unknown
    >;
    expect(payload).toEqual({
      notificationId,
      targetPath: `/issues/API-42?tab=work&work=WEB-7#comment-${commentId}`,
      type: 'MENTIONED',
      version: 1,
    });
    expect(JSON.stringify(payload)).not.toContain('title');
    expect(JSON.stringify(payload)).not.toContain('email');
    expect(JSON.stringify(payload)).not.toContain('filename');
    expect(observability.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        membershipId: event.actorMembershipId,
        name: 'push_delivery_succeeded',
        properties: { notificationId },
        workspaceId: event.workspaceId,
      }),
    );
  });

  it.each([
    {
      commentId: null,
      expected: '/issues/API-42?tab=work&work=WEB-7',
      handoffId: null,
      teamWork: { identifier: 'WEB-7' },
      type: 'TEAM_WORK_ASSIGNED',
    },
    {
      commentId: null,
      expected:
        '/issues/API-42?tab=work&work=WEB-7&handoff=5cb38c29-d14f-4451-bd11-af837a6ac598#handoff-5cb38c29-d14f-4451-bd11-af837a6ac598',
      handoffId: '5cb38c29-d14f-4451-bd11-af837a6ac598',
      teamWork: { identifier: 'WEB-7' },
      type: 'API_HANDOFF_CREATED',
    },
    {
      commentId: null,
      expected: '/issues/API-42?tab=work',
      handoffId: null,
      teamWork: null,
      type: 'ISSUE_COMPLETED',
    },
    {
      commentId: '5cb38c29-d14f-4451-bd11-af837a6ac598',
      expected: '/issues/API-42?tab=work#comment-5cb38c29-d14f-4451-bd11-af837a6ac598',
      handoffId: null,
      teamWork: null,
      type: 'COMMENT_ADDED',
    },
  ] as const)('builds the exact $type deep link from notification anchors', async (variant) => {
    deliveryFindMany.mockResolvedValue([
      {
        ...delivery,
        notification: {
          ...delivery.notification,
          commentId: variant.commentId,
          handoffId: variant.handoffId,
          teamWork: variant.teamWork,
          type: variant.type,
        },
      },
    ]);

    await service.deliverNotifications(event);

    const payload = JSON.parse(sendNotification.mock.calls[0]?.[1] as string) as {
      targetPath: string;
    };
    expect(payload.targetPath).toBe(variant.expected);
  });

  it('does not send a duplicate when the notification-subscription delivery already exists', async () => {
    deliveryFindMany.mockResolvedValue([]);

    await service.deliverNotifications(event);

    expect(deliveryCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('queries canonical notifications through the outbox workspace boundary', async () => {
    notificationFindMany.mockResolvedValue([]);

    await service.deliverNotifications(event);

    expect(notificationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { eventId: event.id, workspaceId: event.workspaceId } }),
    );
    expect(deliveryCreateMany).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('selects only active subscriptions whose session remains valid', async () => {
    notificationFindMany.mockResolvedValue([]);

    await service.deliverNotifications(event);

    expect(notificationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          recipientMembership: {
            select: {
              webPushSubscriptions: expect.objectContaining({
                where: expect.objectContaining({
                  session: {
                    absoluteExpiresAt: { gt: expect.any(Date) },
                    idleExpiresAt: { gt: expect.any(Date) },
                    revokedAt: null,
                  },
                  status: 'ACTIVE',
                }),
              }),
            },
          },
        }),
      }),
    );
  });

  it('reclaims stale sending deliveries before claiming them again', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-16T01:10:00.000Z'));

    try {
      await service.deliverNotifications(event);

      expect(deliveryUpdateMany).toHaveBeenNthCalledWith(1, {
        data: {
          lastErrorCode: 'WEB_PUSH_DELIVERY_STALE_RECLAIMED',
          status: 'PENDING',
        },
        where: {
          notification: { eventId: event.id },
          status: 'SENDING',
          updatedAt: { lte: new Date('2026-07-16T01:05:00.000Z') },
        },
      });
      expect(sendNotification).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps a fresh sending delivery retryable instead of completing the outbox event', async () => {
    deliveryFindMany.mockResolvedValue([]);
    deliveryCount.mockResolvedValue(1);

    await expect(service.deliverNotifications(event)).rejects.toEqual(
      new RetryableOutboxError('WEB_PUSH_DELIVERY_IN_PROGRESS'),
    );
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('expires and scrubs a subscription after a 410 response', async () => {
    sendNotification.mockRejectedValue({
      body: 'endpoint details must not escape',
      statusCode: 410,
    });

    await expect(service.deliverNotifications(event)).resolves.toBeUndefined();

    expect(subscriptionUpdate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        auth: null,
        endpoint: null,
        p256dh: null,
        status: 'EXPIRED',
      }),
      where: { id: subscriptionId },
    });
    expect(deliveryUpdate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        lastErrorCode: 'WEB_PUSH_PROVIDER_410',
        status: 'FAILED',
      }),
      where: { id: deliveryId },
    });
    expect(observability.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'push_delivery_failed',
        properties: { errorCode: 'WEB_PUSH_PROVIDER_410', notificationId },
      }),
    );
  });

  it('does not deliver through an expired session and scrubs its subscription', async () => {
    deliveryFindMany.mockResolvedValue([
      {
        ...delivery,
        subscription: {
          ...delivery.subscription,
          session: {
            absoluteExpiresAt: new Date('2025-01-01T00:00:00.000Z'),
            idleExpiresAt: new Date('2025-01-01T00:00:00.000Z'),
            revokedAt: null,
          },
        },
      },
    ]);

    await service.deliverNotifications(event);

    expect(sendNotification).not.toHaveBeenCalled();
    expect(subscriptionUpdate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        auth: null,
        endpoint: null,
        lastErrorCode: 'WEB_PUSH_SESSION_INACTIVE',
        p256dh: null,
        status: 'EXPIRED',
      }),
      where: { id: subscriptionId },
    });
    expect(deliveryUpdate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        lastErrorCode: 'WEB_PUSH_SESSION_INACTIVE',
        status: 'FAILED',
      }),
      where: { id: deliveryId },
    });
  });

  it('retries provider throttling without changing the in-app notification', async () => {
    sendNotification.mockRejectedValue({ statusCode: 429 });

    await expect(service.deliverNotifications(event)).rejects.toEqual(
      new RetryableOutboxError('WEB_PUSH_PROVIDER_429'),
    );
    expect(deliveryUpdate).toHaveBeenCalledWith({
      data: { lastErrorCode: 'WEB_PUSH_PROVIDER_429', status: 'PENDING' },
      where: { id: deliveryId },
    });
    expect(database.client.notification).not.toHaveProperty('update');
    expect(observability.capture).not.toHaveBeenCalled();
  });

  it('retries only recognized network failures without exposing provider details', async () => {
    sendNotification.mockRejectedValue({ code: 'ECONNRESET' });

    await expect(service.deliverNotifications(event)).rejects.toEqual(
      new RetryableOutboxError('WEB_PUSH_NETWORK_ECONNRESET'),
    );
    expect(deliveryUpdate).toHaveBeenCalledWith({
      data: { lastErrorCode: 'WEB_PUSH_NETWORK_ECONNRESET', status: 'PENDING' },
      where: { id: deliveryId },
    });
  });

  it('fails a programming error once instead of consuming provider retries', async () => {
    sendNotification.mockRejectedValue(new TypeError('invalid payload'));

    await expect(service.deliverNotifications(event)).rejects.toEqual(
      new PermanentOutboxError('WEB_PUSH_PROVIDER_INTERNAL_ERROR'),
    );
    expect(deliveryUpdate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        lastErrorCode: 'WEB_PUSH_PROVIDER_INTERNAL_ERROR',
        status: 'FAILED',
      }),
      where: { id: deliveryId },
    });
    expect(subscriptionUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'INACTIVE' }) }),
    );
  });

  it('continues remaining deliveries before aggregating a permanent failure', async () => {
    const nextDeliveryId = '1345237a-8e29-4fd1-87a2-b8ccb1e0fb7e';
    const nextSubscriptionId = '00db8776-766f-4975-bdab-78192874af88';
    deliveryFindMany.mockResolvedValue([
      delivery,
      {
        ...delivery,
        id: nextDeliveryId,
        subscription: { ...delivery.subscription, id: nextSubscriptionId },
      },
    ]);
    sendNotification
      .mockRejectedValueOnce(new TypeError('invalid payload'))
      .mockResolvedValueOnce({ body: '', headers: {}, statusCode: 201 });

    await expect(service.deliverNotifications(event)).rejects.toEqual(
      new PermanentOutboxError('WEB_PUSH_PROVIDER_INTERNAL_ERROR'),
    );

    expect(sendNotification).toHaveBeenCalledTimes(2);
    expect(deliveryUpdate).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'SENT' }),
      where: { id: nextDeliveryId },
    });
    expect(subscriptionUpdate).toHaveBeenCalledWith({
      data: expect.objectContaining({ lastSucceededAt: expect.any(Date) }),
      where: { id: nextSubscriptionId },
    });
  });

  it('records the sent delivery before best-effort subscription metadata', async () => {
    subscriptionUpdate.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(service.deliverNotifications(event)).resolves.toBeUndefined();

    expect(deliveryUpdate).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'SENT' }),
      where: { id: deliveryId },
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: 'WEB_PUSH_SUBSCRIPTION_SUCCESS_METADATA_FAILED',
        result: 'sent',
      }),
      'Web Push 구독 성공 메타데이터 기록 실패',
    );
    expect(deliveryUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING' }) }),
    );
  });

  it('marks a sent-state write failure terminal without requeueing the provider call', async () => {
    deliveryUpdate.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(service.deliverNotifications(event)).rejects.toEqual(
      new PermanentOutboxError('WEB_PUSH_SENT_STATE_RECORD_FAILED'),
    );

    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(deliveryUpdateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        lastErrorCode: 'WEB_PUSH_SENT_STATE_RECORD_FAILED',
        status: 'FAILED',
      }),
      where: { id: deliveryId, status: 'SENDING' },
    });
    expect(deliveryUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING' }) }),
    );
  });

  it('sends a test event without a notification or business target', async () => {
    subscriptionFindFirst.mockResolvedValue({ id: subscriptionId });
    deliveryFindMany.mockResolvedValue([
      { ...delivery, notification: null, outboxEventId: event.id },
    ]);

    await service.deliverTest(event, { schemaVersion: 1, subscriptionId });

    const payload = JSON.parse(sendNotification.mock.calls[0]?.[1] as string) as Record<
      string,
      unknown
    >;
    expect(payload).toEqual({
      targetPath: '/inbox',
      testEventId: event.id,
      type: 'WEB_PUSH_TEST',
      version: 1,
    });
  });

  it('emits one structured warning when VAPID delivery is not configured', async () => {
    const unconfigured = new WebPushDeliveryService(
      database,
      { ...config, webPush: { privateKey: null, publicKey: null, subject: null } },
      logger,
      observability,
    );

    await unconfigured.deliverNotifications(event);
    await unconfigured.deliverNotifications(event);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      { errorCode: 'WEB_PUSH_NOT_CONFIGURED', result: 'skipped' },
      'Web Push 전달 설정 누락',
    );
    expect(notificationFindMany).not.toHaveBeenCalled();
  });
});
