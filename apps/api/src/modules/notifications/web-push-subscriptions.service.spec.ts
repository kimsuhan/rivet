import type { ConfigType } from '@nestjs/config';

import type { DatabaseService } from '../../common/database/database.service';
import { apiConfig } from '../../config/api.config';
import { WebPushSubscriptionsService } from './web-push-subscriptions.service';

const context = {
  membershipId: '69b38d72-6a3b-4f3c-a2e7-2b2f6941c3dc',
  sessionId: '8e01c6e7-969a-437c-a20c-f4f41521349f',
  workspaceId: '7f5f6cb1-d957-438d-aafe-a9b51d01ad5b',
};
const subscriptionId = 'f57fa7be-1fe9-4744-a8db-704bf989a3cd';
const endpoint = 'https://push.example.test/subscription/secret';
const dto = {
  browser: 'CHROME' as const,
  endpoint,
  expirationTime: null,
  keys: {
    auth: Buffer.alloc(16, 1).toString('base64url'),
    p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 2)]).toString('base64url'),
  },
};
const row = {
  browser: 'CHROME' as const,
  createdAt: new Date('2026-07-16T01:00:00.000Z'),
  expirationTime: null,
  id: subscriptionId,
  lastFailedAt: null,
  lastSucceededAt: null,
  sessionId: context.sessionId,
  status: 'ACTIVE' as const,
};

describe('WebPushSubscriptionsService', () => {
  const findFirst = jest.fn();
  const findMany = jest.fn();
  const updateMany = jest.fn();
  const upsert = jest.fn();
  const createOutbox = jest.fn();
  const consumeRateLimit = jest.fn();
  const transaction = { webPushSubscription: { upsert } };
  const database = {
    client: {
      $transaction: jest.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
      outboxEvent: { create: createOutbox },
      webPushSubscription: { findFirst, findMany, updateMany },
    },
  } as unknown as DatabaseService;
  const config = {
    webPush: {
      vapidPublicKey: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 3)]).toString('base64url'),
    },
  } as ConfigType<typeof apiConfig>;
  const rateLimits = { consume: consumeRateLimit };
  const service = new WebPushSubscriptionsService(
    database,
    rateLimits as never,
    { capture: jest.fn() } as never,
    config,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    consumeRateLimit.mockResolvedValue(undefined);
    findFirst.mockResolvedValue(null);
    updateMany.mockResolvedValue({ count: 1 });
    upsert.mockResolvedValue(row);
  });

  it('lists only public lifecycle metadata and marks the current session', async () => {
    findMany.mockResolvedValue([row]);

    await expect(service.list(context)).resolves.toEqual({
      items: [
        {
          browser: 'CHROME',
          createdAt: '2026-07-16T01:00:00.000Z',
          expirationTime: null,
          id: subscriptionId,
          isCurrentSession: true,
          lastFailedAt: null,
          lastSucceededAt: null,
          status: 'ACTIVE',
        },
      ],
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { membershipId: context.membershipId, workspaceId: context.workspaceId },
      }),
    );
    expect(JSON.stringify(findMany.mock.calls[0]?.[0].select)).not.toContain('endpoint');
    expect(JSON.stringify(findMany.mock.calls[0]?.[0].select)).not.toContain('p256dh');
    expect(JSON.stringify(findMany.mock.calls[0]?.[0].select)).not.toContain('auth');
  });

  it('registers one endpoint for the current membership and never returns key material', async () => {
    const response = await service.register(context, dto);

    expect(findFirst).toHaveBeenCalledWith({
      select: { membershipId: true },
      where: { endpointHash: expect.any(String), status: 'ACTIVE' },
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          endpoint,
          membershipId: context.membershipId,
          sessionId: context.sessionId,
        }),
      }),
    );
    expect(response).not.toHaveProperty('endpoint');
    expect(response).not.toHaveProperty('keys');
  });

  it('does not let another membership take over an active endpoint', async () => {
    findFirst.mockResolvedValue({ membershipId: '7a2f4c04-d972-4bd1-ae0b-e19fd89f4adb' });

    await expect(service.register(context, dto)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'WEB_PUSH_SUBSCRIPTION_IN_USE' }),
      status: 409,
    });

    expect(upsert).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('rejects malformed or already expired browser subscriptions', async () => {
    await expect(
      service.register(context, { ...dto, keys: { ...dto.keys, auth: 'short' } }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INVALID_WEB_PUSH_SUBSCRIPTION' }),
      status: 400,
    });
    await expect(
      service.register(context, {
        ...dto,
        keys: { ...dto.keys, p256dh: Buffer.alloc(65, 2).toString('base64url') },
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INVALID_WEB_PUSH_SUBSCRIPTION' }),
      status: 400,
    });
    await expect(
      service.register(context, { ...dto, expirationTime: Date.now() - 1_000 }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'WEB_PUSH_SUBSCRIPTION_EXPIRED' }),
      status: 409,
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('clears sensitive material when a subscription is deactivated', async () => {
    await expect(service.deactivate(context, subscriptionId)).resolves.toBeUndefined();
    expect(updateMany).toHaveBeenCalledWith({
      data: {
        auth: null,
        disabledAt: expect.any(Date),
        endpoint: null,
        p256dh: null,
        status: 'INACTIVE',
      },
      where: {
        id: subscriptionId,
        membershipId: context.membershipId,
        workspaceId: context.workspaceId,
      },
    });
  });

  it('does not deactivate a subscription owned by another membership or workspace', async () => {
    updateMany.mockResolvedValue({ count: 0 });

    await expect(service.deactivate(context, subscriptionId)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'RESOURCE_NOT_FOUND' }),
      status: 404,
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: subscriptionId,
          membershipId: context.membershipId,
          workspaceId: context.workspaceId,
        },
      }),
    );
  });

  it('queues a strict test event for an owned active subscription', async () => {
    findFirst.mockResolvedValue({ id: subscriptionId });
    createOutbox.mockResolvedValue({ id: expect.any(String) });

    const result = await service.requestTest(context, subscriptionId);

    expect(result).toEqual({ accepted: true, eventId: expect.any(String) });
    expect(consumeRateLimit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ scope: 'WEB_PUSH_TEST_MEMBERSHIP' }),
      context.membershipId,
    );
    expect(consumeRateLimit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ scope: 'WEB_PUSH_TEST_SUBSCRIPTION' }),
      `${context.membershipId}:${subscriptionId}`,
    );
    expect(createOutbox).toHaveBeenCalledWith({
      data: {
        actorMembershipId: context.membershipId,
        aggregateId: subscriptionId,
        aggregateType: 'WEB_PUSH_SUBSCRIPTION',
        eventType: 'WEB_PUSH_TEST_REQUESTED',
        id: result.eventId,
        payload: { schemaVersion: 1, subscriptionId },
        workspaceId: context.workspaceId,
      },
      select: { id: true },
    });
  });

  it('does not disclose or test a subscription owned by another membership or workspace', async () => {
    findFirst.mockResolvedValue(null);

    await expect(service.requestTest(context, subscriptionId)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'RESOURCE_NOT_FOUND' }),
      status: 404,
    });

    expect(consumeRateLimit).not.toHaveBeenCalled();
    expect(createOutbox).not.toHaveBeenCalled();
    expect(findFirst).toHaveBeenCalledWith({
      select: { id: true },
      where: {
        id: subscriptionId,
        membershipId: context.membershipId,
        status: 'ACTIVE',
        workspaceId: context.workspaceId,
      },
    });
  });

  it('does not enqueue a test event after the membership rate limit is exhausted', async () => {
    findFirst.mockResolvedValue({ id: subscriptionId });
    consumeRateLimit.mockRejectedValueOnce(new Error('rate limited'));

    await expect(service.requestTest(context, subscriptionId)).rejects.toThrow('rate limited');

    expect(createOutbox).not.toHaveBeenCalled();
  });
});
