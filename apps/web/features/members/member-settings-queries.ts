'use client';

import {
  type InfiniteData,
  useInfiniteQuery,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';

import {
  type ApiError,
  type ApiErrorResponseDto,
  getInvitationsControllerListQueryKey,
  getMembersControllerListQueryKey,
  type InvitationListResponseDto,
  invitationsControllerList,
  type MemberListResponseDto,
  membersControllerList,
} from '@rivet/api-client';

export function useMemberPages(
  status: 'ACTIVE' | 'INACTIVE',
): UseInfiniteQueryResult<InfiniteData<MemberListResponseDto>, ApiError<ApiErrorResponseDto>> {
  const params = { limit: 100, status };
  const queryKey = [...getMembersControllerListQueryKey(params), 'infinite'] as const;

  return useInfiniteQuery<
    MemberListResponseDto,
    ApiError<ApiErrorResponseDto>,
    InfiniteData<MemberListResponseDto>,
    typeof queryKey,
    string | undefined
  >({
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined,
    queryFn: ({ pageParam, signal }) =>
      membersControllerList({ ...params, ...(pageParam ? { cursor: pageParam } : {}) }, { signal }),
    queryKey,
    retry: false,
  });
}

export function useInvitationPages(
  status: 'PENDING' | 'ACCEPTED,CANCELED,EXPIRED',
): UseInfiniteQueryResult<InfiniteData<InvitationListResponseDto>, ApiError<ApiErrorResponseDto>> {
  const params = { limit: 100, status };
  const queryKey = [...getInvitationsControllerListQueryKey(params), 'infinite'] as const;

  return useInfiniteQuery<
    InvitationListResponseDto,
    ApiError<ApiErrorResponseDto>,
    InfiniteData<InvitationListResponseDto>,
    typeof queryKey,
    string | undefined
  >({
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined,
    queryFn: ({ pageParam, signal }) =>
      invitationsControllerList(
        { ...params, ...(pageParam ? { cursor: pageParam } : {}) },
        { signal },
      ),
    queryKey,
    retry: false,
  });
}
