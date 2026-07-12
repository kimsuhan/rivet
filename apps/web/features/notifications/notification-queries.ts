'use client';

import {
  type InfiniteData,
  useInfiniteQuery,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';

import {
  type ApiError,
  type ApiErrorResponseDto,
  getNotificationsControllerListQueryKey,
  type NotificationListResponseDto,
  notificationsControllerList,
} from '@rivet/api-client';

export function getNotificationPagesQueryKey(read?: boolean) {
  const params = { limit: 50, ...(read === undefined ? {} : { read }) };
  return [...getNotificationsControllerListQueryKey(params), 'infinite'] as const;
}

export function useNotificationPages(
  read?: boolean,
): UseInfiniteQueryResult<
  InfiniteData<NotificationListResponseDto>,
  ApiError<ApiErrorResponseDto>
> {
  const params = { limit: 50, ...(read === undefined ? {} : { read }) };
  const queryKey = getNotificationPagesQueryKey(read);

  return useInfiniteQuery<
    NotificationListResponseDto,
    ApiError<ApiErrorResponseDto>,
    InfiniteData<NotificationListResponseDto>,
    typeof queryKey,
    string | undefined
  >({
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined,
    queryFn: ({ pageParam, signal }) =>
      notificationsControllerList(
        { ...params, ...(pageParam ? { cursor: pageParam } : {}) },
        { signal },
      ),
    queryKey,
    retry: false,
  });
}
