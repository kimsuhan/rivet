'use client';

import { type InfiniteData, useQueryClient } from '@tanstack/react-query';
import {
  AtSign,
  Bell,
  CircleCheck,
  CircleX,
  type LucideIcon,
  MessageSquare,
  Send,
  UserRoundCheck,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

import {
  getNotificationsControllerListQueryKey,
  getNotificationsControllerUnreadCountQueryKey,
  type NotificationListResponseDto,
  type NotificationResponseDto,
  type NotificationUnreadCountResponseDto,
  useNotificationsControllerReadAll,
  useNotificationsControllerUnreadCount,
  useNotificationsControllerUpdateRead,
} from '@rivet/api-client';

import { ContentEmpty } from '@/components/states/content-empty';
import { ContentError } from '@/components/states/content-error';
import { ContentLoading } from '@/components/states/content-loading';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UserAvatar } from '@/components/user-avatar';
import { useRouter } from '@/i18n/navigation';

import { issueWorkHref } from '../issues/issue-work-routing';
import { getNotificationPagesQueryKey, useNotificationPages } from './notification-queries';

const NOTIFICATION_ICONS: Record<NotificationResponseDto['type'], LucideIcon> = {
  API_HANDOFF_CREATED: Send,
  API_HANDOFF_FOLLOW_UP_CREATED: Send,
  COMMENT_ADDED: MessageSquare,
  TEAM_WORK_ASSIGNED: UserRoundCheck,
  ISSUE_CANCELED: CircleX,
  ISSUE_COMPLETED: CircleCheck,
  MENTIONED: AtSign,
};

type NotificationPages = InfiniteData<NotificationListResponseDto>;

function updateNotification(
  data: NotificationPages | undefined,
  notification: NotificationResponseDto,
): NotificationPages | undefined {
  if (!data) return data;

  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((item) => (item.id === notification.id ? notification : item)),
    })),
  };
}

function updateUnreadNotifications(
  data: NotificationPages | undefined,
  notification: NotificationResponseDto,
): NotificationPages | undefined {
  if (!data) return data;

  const pages = data.pages.map((page) => ({
    ...page,
    items: page.items.filter((item) => item.id !== notification.id),
  }));
  if (notification.readAt || pages.length === 0) return { ...data, pages };

  return {
    ...data,
    pages: pages.map((page, index) =>
      index === 0 ? { ...page, items: [notification, ...page.items] } : page,
    ),
  };
}

function notificationHref(notification: NotificationResponseDto): string {
  const issueHref = issueWorkHref(notification.issue.identifier, notification.teamWork?.identifier);
  if (notification.commentId) return `${issueHref}#comment-${notification.commentId}`;
  if (notification.handoffId) {
    return `${issueHref}&handoff=${encodeURIComponent(notification.handoffId)}#handoff-${notification.handoffId}`;
  }
  return issueHref;
}

function NotificationRow({
  actionFailed,
  isUpdating,
  notification,
  onOpen,
  onToggleRead,
}: {
  actionFailed: boolean;
  isUpdating: boolean;
  notification: NotificationResponseDto;
  onOpen: (notification: NotificationResponseDto) => void;
  onToggleRead: (notification: NotificationResponseDto) => void;
}) {
  const t = useTranslations('Notifications');
  const format = useFormatter();
  const Icon = NOTIFICATION_ICONS[notification.type];
  const actorName = notification.actor?.displayName ?? t('systemActor');
  const isUnread = notification.readAt === null;
  const createdAt = new Date(notification.createdAt);

  return (
    <li className="hover:bg-surface-1 border-b transition-colors">
      <div className="flex min-h-20 items-stretch sm:min-h-16">
        <button
          type="button"
          className="focus-visible:ring-ring flex min-w-0 flex-1 gap-3 rounded-md px-1 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset sm:items-center"
          aria-label={t('openNotification', {
            identifier: notification.issue.identifier,
            title: notification.issue.title,
          })}
          aria-describedby={`notification-${notification.id}-status`}
          onClick={() => onOpen(notification)}
        >
          <span className="flex w-4 shrink-0 justify-center pt-1 sm:pt-0">
            {isUnread ? (
              <span aria-hidden="true" className="bg-primary size-2 rounded-full" />
            ) : null}
            <span id={`notification-${notification.id}-status`} className="sr-only">
              {t(isUnread ? 'unreadStatus' : 'readStatus')}
            </span>
          </span>

          <span className="bg-surface-2 text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md">
            <Icon aria-hidden="true" className="size-4" strokeWidth={1.75} />
          </span>

          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-medium">{t(`types.${notification.type}`)}</span>
              <span className="text-muted-foreground font-mono text-xs">
                {notification.issue.identifier}
              </span>
              <span className="min-w-0 truncate text-sm">{notification.issue.title}</span>
            </span>
            <span className="text-muted-foreground text-sm">
              {t(`summaries.${notification.type}`)}
            </span>
            <span className="text-muted-foreground flex min-w-0 items-center gap-2 text-xs sm:hidden">
              {notification.actor ? (
                <UserAvatar
                  avatarFileId={notification.actor.avatarFileId}
                  displayName={notification.actor.displayName}
                  size="sm"
                />
              ) : null}
              <span className="truncate">{actorName}</span>
              <time dateTime={notification.createdAt} className="tabular-nums">
                {format.dateTime(createdAt, {
                  day: 'numeric',
                  hour: 'numeric',
                  minute: 'numeric',
                  month: 'numeric',
                })}
              </time>
            </span>
          </span>

          <span className="text-muted-foreground hidden w-40 shrink-0 items-center gap-2 text-xs sm:flex">
            {notification.actor ? (
              <UserAvatar
                avatarFileId={notification.actor.avatarFileId}
                displayName={notification.actor.displayName}
                size="sm"
              />
            ) : null}
            <span className="min-w-0 flex-1 truncate">{actorName}</span>
            <time dateTime={notification.createdAt} className="shrink-0 tabular-nums">
              {format.dateTime(createdAt, {
                day: 'numeric',
                hour: 'numeric',
                minute: 'numeric',
                month: 'numeric',
              })}
            </time>
          </span>
        </button>

        <div className="flex w-11 shrink-0 items-center justify-center">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={isUpdating}
            aria-label={t(isUnread ? 'markRead' : 'markUnread', {
              title: notification.issue.title,
            })}
            title={t(isUnread ? 'markReadShort' : 'markUnreadShort')}
            onClick={() => onToggleRead(notification)}
          >
            {isUpdating ? (
              <Spinner data-icon="inline-start" />
            ) : isUnread ? (
              <CircleCheck data-icon="inline-start" />
            ) : (
              <Bell data-icon="inline-start" />
            )}
          </Button>
        </div>
      </div>
      {actionFailed ? (
        <p role="alert" className="text-destructive px-12 pb-3 text-xs">
          {t('updateError')}
        </p>
      ) : null}
    </li>
  );
}

export function NotificationInboxScreen() {
  const t = useTranslations('Notifications');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'all' | 'unread'>('unread');
  const [failedNotificationId, setFailedNotificationId] = useState<string | null>(null);
  const notifications = useNotificationPages(tab === 'unread' ? false : undefined);
  const unreadCount = useNotificationsControllerUnreadCount({ query: { retry: false } });
  const updateRead = useNotificationsControllerUpdateRead();
  const readAll = useNotificationsControllerReadAll();
  const items = notifications.data?.pages.flatMap((page) => page.items) ?? [];
  const visibleUnreadCount = unreadCount.data?.count ?? items.filter((item) => !item.readAt).length;

  function refreshNotificationCaches(): void {
    void Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: getNotificationsControllerListQueryKey() }),
      queryClient.invalidateQueries({
        queryKey: getNotificationsControllerUnreadCountQueryKey(),
      }),
    ]);
  }

  async function changeRead(notification: NotificationResponseDto, read: boolean): Promise<void> {
    const updated = await updateRead.mutateAsync({
      data: { read },
      notificationId: notification.id,
    });

    queryClient.setQueryData<NotificationPages>(getNotificationPagesQueryKey(), (data) =>
      updateNotification(data, updated),
    );
    queryClient.setQueryData<NotificationPages>(getNotificationPagesQueryKey(false), (data) =>
      updateUnreadNotifications(data, updated),
    );
    queryClient.setQueryData<NotificationUnreadCountResponseDto>(
      getNotificationsControllerUnreadCountQueryKey(),
      (count) => {
        if (!count || Boolean(notification.readAt) === Boolean(updated.readAt)) return count;
        return { count: Math.max(0, count.count + (updated.readAt ? -1 : 1)) };
      },
    );
  }

  async function openNotification(notification: NotificationResponseDto): Promise<void> {
    let changed = false;
    if (!notification.readAt) {
      try {
        await changeRead(notification, true);
        changed = true;
      } catch {
        // 읽음 변경 실패가 접근 가능한 이슈로의 이동을 막지 않는다.
      }
    }

    router.push(notificationHref(notification));
    if (changed) refreshNotificationCaches();
  }

  async function toggleRead(notification: NotificationResponseDto): Promise<void> {
    setFailedNotificationId(null);
    try {
      await changeRead(notification, notification.readAt === null);
      refreshNotificationCaches();
    } catch {
      setFailedNotificationId(notification.id);
    }
  }

  async function markAllRead(): Promise<void> {
    try {
      await readAll.mutateAsync();
      const readAt = new Date().toISOString();
      queryClient.setQueryData<NotificationPages>(getNotificationPagesQueryKey(), (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                items: page.items.map((item) => (item.readAt ? item : { ...item, readAt })),
              })),
            }
          : data,
      );
      queryClient.setQueryData<NotificationPages>(getNotificationPagesQueryKey(false), (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((page) => ({ ...page, items: [] })),
            }
          : data,
      );
      queryClient.setQueryData<NotificationUnreadCountResponseDto>(
        getNotificationsControllerUnreadCountQueryKey(),
        { count: 0 },
      );
      refreshNotificationCaches();
    } catch {
      // 모두 읽음 mutation의 오류 상태를 헤더에 유지해 재시도 경로를 제공한다.
    }
  }

  return (
    <section aria-labelledby="notification-inbox-title">
      <header className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1
            id="notification-inbox-title"
            className="text-xl leading-8 font-semibold tracking-[-0.01em]"
          >
            {t('title')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm leading-6">
            {unreadCount.isError
              ? t('unreadCountError')
              : t('unreadCount', { count: visibleUnreadCount })}
          </p>
          {unreadCount.isError ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="mt-1"
              onClick={() => void unreadCount.refetch()}
            >
              {t('retryCount')}
            </Button>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={readAll.isPending || visibleUnreadCount === 0}
          onClick={() => void markAllRead()}
        >
          {readAll.isPending ? <Spinner data-icon="inline-start" /> : null}
          {t('readAll')}
        </Button>
      </header>

      {readAll.isError ? (
        <div className="pt-4">
          <ContentError
            title={t('readAllErrorTitle')}
            description={t('readAllErrorDescription')}
            retryLabel={t('retry')}
            onRetry={() => void markAllRead()}
          />
        </div>
      ) : null}

      <Tabs
        value={tab}
        className="pt-4"
        onValueChange={(value) => {
          if (value === 'all' || value === 'unread') {
            setFailedNotificationId(null);
            setTab(value);
          }
        }}
      >
        <TabsList aria-label={t('filtersLabel')}>
          <TabsTrigger value="unread">{t('unreadTab')}</TabsTrigger>
          <TabsTrigger value="all">{t('allTab')}</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-3">
          {notifications.isPending ? <ContentLoading label={t('loading')} /> : null}

          {notifications.isError && !notifications.data ? (
            <ContentError
              title={t('errorTitle')}
              description={t('errorDescription')}
              retryLabel={t('retry')}
              onRetry={() => void notifications.refetch()}
            />
          ) : null}

          {!notifications.isPending && !notifications.isError && items.length === 0 ? (
            <ContentEmpty
              icon={Bell}
              title={t(tab === 'unread' ? 'unreadEmptyTitle' : 'emptyTitle')}
              description={t(tab === 'unread' ? 'unreadEmptyDescription' : 'emptyDescription')}
            >
              {tab === 'unread' ? (
                <Button type="button" variant="outline" onClick={() => setTab('all')}>
                  {t('showAll')}
                </Button>
              ) : null}
            </ContentEmpty>
          ) : null}

          {items.length > 0 ? (
            <ul className="border-t" aria-label={t('listLabel')}>
              {items.map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  actionFailed={failedNotificationId === notification.id}
                  isUpdating={
                    updateRead.isPending && updateRead.variables?.notificationId === notification.id
                  }
                  onOpen={(item) => void openNotification(item)}
                  onToggleRead={(item) => void toggleRead(item)}
                />
              ))}
            </ul>
          ) : null}

          {notifications.isFetchNextPageError ? (
            <div className="pt-4">
              <ContentError
                title={t('loadMoreErrorTitle')}
                description={t('loadMoreErrorDescription')}
                retryLabel={t('retry')}
                onRetry={() => void notifications.fetchNextPage()}
              />
            </div>
          ) : null}

          {notifications.hasNextPage && !notifications.isFetchNextPageError ? (
            <div className="flex justify-center pt-4">
              <Button
                type="button"
                variant="outline"
                disabled={notifications.isFetchingNextPage}
                onClick={() => void notifications.fetchNextPage()}
              >
                {notifications.isFetchingNextPage ? <Spinner data-icon="inline-start" /> : null}
                {t('loadMore')}
              </Button>
            </div>
          ) : null}
        </TabsContent>
      </Tabs>
    </section>
  );
}
