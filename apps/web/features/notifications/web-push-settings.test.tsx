import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@rivet/api-client';

import messages from '@/messages/ko.json';

import { WebPushSettings } from './web-push-settings';

const mocks = vi.hoisted(() => ({
  deactivate: vi.fn(),
  register: vi.fn(),
  requestTest: vi.fn(),
  subscriptions: [] as Array<{
    browser: 'CHROME';
    createdAt: string;
    expirationTime: string | null;
    id: string;
    isCurrentSession: boolean;
    lastFailedAt: string | null;
    lastSucceededAt: string | null;
    status: 'ACTIVE';
  }>,
}));

vi.mock('@rivet/api-client', () => ({
  ApiError: class ApiError extends Error {
    constructor(
      readonly status: number,
      readonly body: unknown,
      readonly requestId: string | null,
    ) {
      super(`API request failed with status ${status}`);
    }
  },
  getNotificationsControllerPushSubscriptionsQueryKey: () => [
    '/api/v1/notifications/push/subscriptions',
  ],
  useAuthControllerGetSession: () => ({
    data: {
      authenticated: true,
      membership: { id: 'membership-current' },
    },
  }),
  useNotificationsControllerDeactivatePushSubscription: () => ({
    isPending: false,
    mutateAsync: mocks.deactivate,
  }),
  useNotificationsControllerPushConfig: () => ({
    data: { enabled: true, publicKey: 'public-key' },
    isError: false,
    isPending: false,
  }),
  useNotificationsControllerPushSubscriptions: () => ({
    data: { items: mocks.subscriptions },
    isError: false,
    isPending: false,
  }),
  useNotificationsControllerRegisterPushSubscription: () => ({
    isPending: false,
    mutateAsync: mocks.register,
  }),
  useNotificationsControllerRequestPushTest: () => ({
    isPending: false,
    mutateAsync: mocks.requestTest,
  }),
}));

function mockBrowser(permission: NotificationPermission, subscription: PushSubscription | null) {
  const requestPermission = vi.fn().mockResolvedValue('denied');
  const subscribe = vi.fn();
  vi.stubGlobal('Notification', { permission, requestPermission });
  vi.stubGlobal('PushManager', class PushManager {});
  const registration = {
    pushManager: {
      getSubscription: vi.fn().mockResolvedValue(subscription),
      subscribe,
    },
    update: vi.fn().mockResolvedValue(undefined),
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      addEventListener: vi.fn(),
      register: vi.fn().mockResolvedValue(registration),
      removeEventListener: vi.fn(),
    },
  });
  return { registration, requestPermission, subscribe };
}

function renderSettings(open = false) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider
        locale="ko"
        messages={{ Notifications: messages.Notifications }}
        timeZone="Asia/Seoul"
      >
        <WebPushSettings open={open} onOpenChange={vi.fn()} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe('WebPushSettings', () => {
  beforeEach(() => {
    mocks.deactivate.mockReset();
    mocks.register.mockReset();
    mocks.requestTest.mockReset();
    mocks.subscriptions = [];
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('requests notification permission only from the explicit enable action', async () => {
    const { requestPermission } = mockBrowser('default', null);
    const user = userEvent.setup();

    renderSettings();
    await waitFor(() =>
      expect(screen.getByText('브라우저 알림을 아직 선택하지 않았습니다')).toBeInTheDocument(),
    );
    expect(requestPermission).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '이 브라우저에서 알림 켜기' }));

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it('does not bind an existing browser subscription to another account without member opt-in', async () => {
    const existing = { toJSON: vi.fn() } as unknown as PushSubscription;
    const { requestPermission } = mockBrowser('granted', existing);

    renderSettings();

    await waitFor(() =>
      expect(screen.getByText('이 브라우저를 알림 수신에 연결해 주세요')).toBeInTheDocument(),
    );
    expect(requestPermission).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it('replaces a conflicting browser endpoint from the explicit enable action', async () => {
    const existing = {
      toJSON: vi.fn().mockReturnValue({
        endpoint: 'https://push.example.test/existing',
        expirationTime: null,
        keys: { auth: 'existing-auth', p256dh: 'existing-p256dh' },
      }),
      unsubscribe: vi.fn().mockResolvedValue(true),
    } as unknown as PushSubscription;
    const replacement = {
      toJSON: vi.fn().mockReturnValue({
        endpoint: 'https://push.example.test/replacement',
        expirationTime: null,
        keys: { auth: 'replacement-auth', p256dh: 'replacement-p256dh' },
      }),
      unsubscribe: vi.fn(),
    } as unknown as PushSubscription;
    const { subscribe } = mockBrowser('granted', existing);
    subscribe.mockResolvedValue(replacement);
    mocks.register
      .mockRejectedValueOnce(
        new ApiError(409, { code: 'WEB_PUSH_SUBSCRIPTION_IN_USE' }, 'request-conflict'),
      )
      .mockResolvedValueOnce({});
    const user = userEvent.setup();

    renderSettings(true);
    await user.click(await screen.findByRole('button', { name: '이 브라우저 연결' }));

    await waitFor(() => expect(existing.unsubscribe).toHaveBeenCalledTimes(1));
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(mocks.register).toHaveBeenCalledTimes(2);
    expect(mocks.register).toHaveBeenLastCalledWith({
      data: {
        browser: 'OTHER',
        endpoint: 'https://push.example.test/replacement',
        expirationTime: null,
        keys: { auth: 'replacement-auth', p256dh: 'replacement-p256dh' },
      },
    });
    expect(await screen.findByText('이 브라우저 연결을 새로 만들었습니다')).toBeInTheDocument();
    expect(
      screen.getByText(
        '이전에 다른 로그인에 연결된 브라우저 구독을 정리하고 현재 계정용 새 구독으로 연결했습니다.',
      ),
    ).toBeInTheDocument();
    expect(localStorage.getItem('rivet.web-push.enabled:membership-current')).toBe('true');
  });

  it('keeps the healthy state compact and exposes browser-level actions', async () => {
    const existing = { toJSON: vi.fn() } as unknown as PushSubscription;
    mockBrowser('granted', existing);
    mocks.subscriptions = [
      {
        browser: 'CHROME',
        createdAt: '2026-07-16T03:00:00.000Z',
        expirationTime: null,
        id: 'subscription-current',
        isCurrentSession: true,
        lastFailedAt: null,
        lastSucceededAt: '2026-07-16T03:46:00.000Z',
        status: 'ACTIVE',
      },
    ];
    mocks.requestTest.mockResolvedValue({ accepted: true });
    const user = userEvent.setup();

    renderSettings(true);

    await waitFor(() => expect(screen.getByText('권한 허용')).toBeInTheDocument());
    expect(screen.queryByText('이 브라우저를 알림 수신에 연결해 주세요')).not.toBeInTheDocument();
    expect(screen.getByText('등록된 브라우저 1개')).toBeInTheDocument();
    expect(screen.getByText('현재 브라우저')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '테스트 보내기' }));

    expect(mocks.requestTest).toHaveBeenCalledWith({ subscriptionId: 'subscription-current' });
    expect(
      await screen.findByText('테스트 알림을 전송 대기열에 추가했습니다.'),
    ).toBeInTheDocument();
  });

  it('asks for confirmation before disconnecting a browser', async () => {
    const existing = {
      toJSON: vi.fn(),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
    } as unknown as PushSubscription;
    mockBrowser('granted', existing);
    mocks.subscriptions = [
      {
        browser: 'CHROME',
        createdAt: '2026-07-16T03:00:00.000Z',
        expirationTime: null,
        id: 'subscription-current',
        isCurrentSession: true,
        lastFailedAt: null,
        lastSucceededAt: '2026-07-16T03:46:00.000Z',
        status: 'ACTIVE',
      },
    ];
    const user = userEvent.setup();

    renderSettings(true);

    await user.click(screen.getByRole('button', { name: '연결 해제' }));

    expect(screen.getByText('이 브라우저 연결을 해제할까요?')).toBeInTheDocument();
    expect(mocks.deactivate).not.toHaveBeenCalled();
  });
});
