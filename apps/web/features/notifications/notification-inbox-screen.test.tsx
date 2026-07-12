import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getNotificationsControllerUnreadCountQueryKey,
  type NotificationResponseDto,
  useNotificationsControllerReadAll,
  useNotificationsControllerUnreadCount,
  useNotificationsControllerUpdateRead,
} from '@rivet/api-client';

import messages from '@/messages/ko.json';

import { NotificationInboxScreen } from './notification-inbox-screen';
import { getNotificationPagesQueryKey, useNotificationPages } from './notification-queries';

const mocks = vi.hoisted(() => ({
  fetchNextPage: vi.fn(),
  push: vi.fn(),
  readAll: vi.fn(),
  refetch: vi.fn(),
  refetchCount: vi.fn(),
  updateRead: vi.fn(),
}));

vi.mock('@rivet/api-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNotificationsControllerReadAll: vi.fn(),
  useNotificationsControllerUnreadCount: vi.fn(),
  useNotificationsControllerUpdateRead: vi.fn(),
}));

vi.mock('./notification-queries', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNotificationPages: vi.fn(),
}));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}));

const notification: NotificationResponseDto = {
  actor: {
    avatarFileId: null,
    displayName: '김백엔드',
    id: 'e6329ce7-9d38-4b79-b51a-33cb7852cb89',
  },
  commentId: 'a0114e2c-40f6-4a50-845c-ab11c209cdbc',
  createdAt: '2026-07-11T04:30:00.000Z',
  handoffId: null,
  id: '6bc55638-c359-488e-940e-dc61795d6b6f',
  issue: {
    id: '1ab1ac4d-b06e-4510-8dbf-d56399cc6d0c',
    identifier: 'WEB-42',
    title: '알림함 화면 연결',
  },
  readAt: null,
  type: 'MENTIONED',
};

let queryClient: QueryClient;

function notificationPages(
  items: NotificationResponseDto[] = [notification],
  options: { error?: boolean; fetchNextPageError?: boolean; hasNextPage?: boolean } = {},
) {
  return {
    data: options.error
      ? undefined
      : {
          pageParams: [undefined],
          pages: [{ items, nextCursor: options.hasNextPage ? 'next-page' : null }],
        },
    error: options.error ? new Error('failed') : null,
    fetchNextPage: mocks.fetchNextPage,
    hasNextPage: options.hasNextPage ?? false,
    isError: options.error ?? false,
    isFetchNextPageError: options.fetchNextPageError ?? false,
    isFetchingNextPage: false,
    isPending: false,
    refetch: mocks.refetch,
  };
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="ko" messages={messages} timeZone="Asia/Seoul">
        {children}
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

function renderScreen() {
  return render(<NotificationInboxScreen />, { wrapper: Wrapper });
}

describe('NotificationInboxScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(getNotificationsControllerUnreadCountQueryKey(), { count: 1 });
    queryClient.setQueryData(getNotificationPagesQueryKey(false), notificationPages().data);
    queryClient.setQueryData(getNotificationPagesQueryKey(), notificationPages().data);

    vi.mocked(useNotificationPages).mockReturnValue(notificationPages() as never);
    vi.mocked(useNotificationsControllerUnreadCount).mockReturnValue({
      data: { count: 1 },
      error: null,
      isError: false,
      isPending: false,
      refetch: mocks.refetchCount,
    } as never);
    vi.mocked(useNotificationsControllerUpdateRead).mockReturnValue({
      isPending: false,
      mutateAsync: mocks.updateRead,
      variables: undefined,
    } as never);
    vi.mocked(useNotificationsControllerReadAll).mockReturnValue({
      isError: false,
      isPending: false,
      mutateAsync: mocks.readAll,
    } as never);
    mocks.updateRead.mockResolvedValue({
      ...notification,
      readAt: '2026-07-11T05:00:00.000Z',
    });
    mocks.readAll.mockResolvedValue({ updatedCount: 1 });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
  });

  it('읽지 않은 상태, 유형, 행위자, 현재 이슈와 시각을 함께 표시한다', () => {
    const { container } = renderScreen();

    expect(screen.getByRole('heading', { level: 1, name: '알림함' })).toBeVisible();
    expect(screen.getByText('읽지 않은 알림 1개')).toBeVisible();
    expect(screen.getByText('멘션')).toBeVisible();
    expect(screen.getAllByText('김백엔드')).toHaveLength(2);
    expect(screen.getByText('WEB-42')).toBeVisible();
    expect(screen.getByText('알림함 화면 연결')).toBeVisible();
    expect(screen.getAllByText('읽지 않음')).toHaveLength(2);
    expect(
      screen.getByRole('button', { name: 'WEB-42 알림함 화면 연결 알림 열기' }),
    ).toHaveAccessibleDescription('읽지 않음');
    const times = container.querySelectorAll('time');
    expect(times).toHaveLength(2);
    for (const time of times) {
      expect(time).toHaveAttribute('datetime', notification.createdAt);
      expect(time).not.toHaveTextContent(/^\s*$/);
    }
  });

  it('항목을 선택하면 읽음 변경을 먼저 마친 뒤 댓글 앵커로 이동하고 무효화 실패와 분리한다', async () => {
    const user = userEvent.setup();
    vi.spyOn(queryClient, 'invalidateQueries').mockRejectedValue(new Error('invalidate failed'));
    renderScreen();

    await user.click(screen.getByRole('button', { name: 'WEB-42 알림함 화면 연결 알림 열기' }));

    await waitFor(() => {
      expect(mocks.updateRead).toHaveBeenCalledWith({
        data: { read: true },
        notificationId: notification.id,
      });
      expect(mocks.push).toHaveBeenCalledWith(
        '/issues/WEB-42#comment-a0114e2c-40f6-4a50-845c-ab11c209cdbc',
      );
    });
    expect(mocks.updateRead.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.push.mock.invocationCallOrder[0]!,
    );
  });

  it('작업 전달 알림을 선택하면 해당 작업 전달 앵커로 이동한다', async () => {
    const user = userEvent.setup();
    const handoffNotification: NotificationResponseDto = {
      ...notification,
      commentId: null,
      handoffId: 'handoff-id',
      type: 'API_HANDOFF_CREATED',
    };
    vi.mocked(useNotificationPages).mockReturnValue(
      notificationPages([handoffNotification]) as never,
    );
    mocks.updateRead.mockResolvedValue({
      ...handoffNotification,
      readAt: '2026-07-11T05:00:00.000Z',
    });
    renderScreen();

    await user.click(screen.getByRole('button', { name: 'WEB-42 알림함 화면 연결 알림 열기' }));

    await waitFor(() => {
      expect(mocks.updateRead).toHaveBeenCalledWith({
        data: { read: true },
        notificationId: handoffNotification.id,
      });
      expect(mocks.push).toHaveBeenCalledWith('/issues/WEB-42#handoff-handoff-id');
    });
  });

  it('개별 읽음 처리 성공을 읽지 않음 목록과 전역 개수 캐시에 즉시 반영한다', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: '알림함 화면 연결 알림 읽음 처리' }));

    await waitFor(() => {
      expect(mocks.updateRead).toHaveBeenCalledWith({
        data: { read: true },
        notificationId: notification.id,
      });
    });
    expect(queryClient.getQueryData(getNotificationsControllerUnreadCountQueryKey())).toEqual({
      count: 0,
    });
    expect(
      queryClient.getQueryData<{ pages: Array<{ items: NotificationResponseDto[] }> }>(
        getNotificationPagesQueryKey(false),
      )?.pages[0]?.items,
    ).toEqual([]);
  });

  it('읽은 알림을 다시 읽지 않음으로 바꾸면 목록과 전역 개수에 되돌려 놓는다', async () => {
    const user = userEvent.setup();
    const readNotification = {
      ...notification,
      readAt: '2026-07-11T05:00:00.000Z',
    };
    queryClient.setQueryData(getNotificationsControllerUnreadCountQueryKey(), { count: 0 });
    queryClient.setQueryData(getNotificationPagesQueryKey(false), notificationPages([]).data);
    queryClient.setQueryData(
      getNotificationPagesQueryKey(),
      notificationPages([readNotification]).data,
    );
    vi.mocked(useNotificationPages).mockImplementation(
      (read) =>
        (read === false ? notificationPages([]) : notificationPages([readNotification])) as never,
    );
    vi.mocked(useNotificationsControllerUnreadCount).mockReturnValue({
      data: { count: 0 },
      error: null,
      isError: false,
      isPending: false,
      refetch: mocks.refetchCount,
    } as never);
    mocks.updateRead.mockResolvedValue({ ...readNotification, readAt: null });
    renderScreen();

    await user.click(screen.getByRole('tab', { name: '모든 알림' }));
    await user.click(screen.getByRole('button', { name: '알림함 화면 연결 알림 읽지 않음 처리' }));

    await waitFor(() => {
      expect(mocks.updateRead).toHaveBeenCalledWith({
        data: { read: false },
        notificationId: notification.id,
      });
    });
    expect(queryClient.getQueryData(getNotificationsControllerUnreadCountQueryKey())).toEqual({
      count: 1,
    });
    expect(
      queryClient.getQueryData<{ pages: Array<{ items: NotificationResponseDto[] }> }>(
        getNotificationPagesQueryKey(false),
      )?.pages[0]?.items,
    ).toEqual([{ ...readNotification, readAt: null }]);
  });

  it('모두 읽음 성공을 캐시에 반영하고 목록 재검증은 비동기로 시작한다', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: '모두 읽음' }));

    await waitFor(() => expect(mocks.readAll).toHaveBeenCalledTimes(1));
    expect(queryClient.getQueryData(getNotificationsControllerUnreadCountQueryKey())).toEqual({
      count: 0,
    });
    expect(
      queryClient.getQueryData<{ pages: Array<{ items: NotificationResponseDto[] }> }>(
        getNotificationPagesQueryKey(false),
      )?.pages[0]?.items,
    ).toEqual([]);
  });

  it('읽지 않은 알림이 없으면 모든 알림으로 전환할 수 있다', async () => {
    const user = userEvent.setup();
    vi.mocked(useNotificationPages).mockReturnValue(notificationPages([]) as never);
    vi.mocked(useNotificationsControllerUnreadCount).mockReturnValue({
      data: { count: 0 },
      error: null,
      isError: false,
      isPending: false,
      refetch: mocks.refetchCount,
    } as never);
    renderScreen();

    expect(screen.getByText('읽지 않은 알림이 없습니다')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '모든 알림 보기' }));

    expect(useNotificationPages).toHaveBeenLastCalledWith(undefined);
  });

  it('목록 오류를 다시 시도하고 다음 커서가 있으면 더 불러온다', async () => {
    const user = userEvent.setup();
    vi.mocked(useNotificationPages).mockReturnValue(
      notificationPages([], { error: true }) as never,
    );
    const { rerender } = renderScreen();

    await user.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);

    vi.mocked(useNotificationPages).mockReturnValue(
      notificationPages([notification], { hasNextPage: true }) as never,
    );
    rerender(<NotificationInboxScreen />);
    await user.click(screen.getByRole('button', { name: '알림 더 보기' }));
    expect(mocks.fetchNextPage).toHaveBeenCalledTimes(1);
  });
});
