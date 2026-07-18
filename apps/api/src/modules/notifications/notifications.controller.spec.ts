import type { ObservabilityService } from '../../common/observability/observability.service';
import type { AuthenticatedRequestContext } from '../auth/authentication.context';
import { NotificationsController } from './notifications.controller';
import type { NotificationsService } from './notifications.service';
import type { WebPushSubscriptionsService } from './web-push-subscriptions.service';

const authentication = {
  session: {
    membership: {
      id: '69b38d72-6a3b-4f3c-a2e7-2b2f6941c3dc',
      role: 'MEMBER',
      status: 'ACTIVE',
      workspaceId: '7f5f6cb1-d957-438d-aafe-a9b51d01ad5b',
    },
    workspace: { id: '7f5f6cb1-d957-438d-aafe-a9b51d01ad5b' },
  },
} as unknown as AuthenticatedRequestContext;

describe('NotificationsController analytics', () => {
  const list = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
  const unreadCount = jest.fn().mockResolvedValue({ count: 75 });
  const capture = jest.fn();
  const isProductAnalyticsEnabled = jest.fn().mockReturnValue(true);
  const controller = new NotificationsController(
    { list, unreadCount } as unknown as NotificationsService,
    {} as WebPushSubscriptionsService,
    { capture, isProductAnalyticsEnabled } as unknown as ObservabilityService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('captures the complete unread count only for the inbox first page', async () => {
    await controller.list(authentication, { limit: 50 });
    await controller.list(authentication, { cursor: 'next', limit: 50 });

    expect(unreadCount).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        membershipId: authentication.session.membership?.id,
        name: 'inbox_opened',
        properties: { unreadCount: 75 },
        workspaceId: authentication.session.workspace?.id,
      }),
    );
  });

  it('does not add the unread count query when analytics is disabled', async () => {
    isProductAnalyticsEnabled.mockReturnValueOnce(false);

    await controller.list(authentication, { limit: 50 });

    expect(unreadCount).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });
});
