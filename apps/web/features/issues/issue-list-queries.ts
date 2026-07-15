'use client';

import {
  type InfiniteData,
  useInfiniteQuery,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';

import {
  type ApiError,
  type ApiErrorResponseDto,
  getIssuesControllerListQueryKey,
  getTeamWorksControllerListQueryKey,
  type IssueListResponseDto,
  issuesControllerList,
  type IssuesControllerListParams,
  type TeamWorkListResponseDto,
  teamWorksControllerList,
  type TeamWorksControllerListParams,
} from '@rivet/api-client';

export function getIssuePagesQueryKey(params: IssuesControllerListParams) {
  return [...getIssuesControllerListQueryKey(params), 'infinite'] as const;
}

export function getTeamWorkPagesQueryKey(params: TeamWorksControllerListParams) {
  return [...getTeamWorksControllerListQueryKey(params), 'infinite'] as const;
}

export function useTeamWorkPages(
  params: TeamWorksControllerListParams,
  enabled = true,
): UseInfiniteQueryResult<InfiniteData<TeamWorkListResponseDto>, ApiError<ApiErrorResponseDto>> {
  const queryKey = getTeamWorkPagesQueryKey(params);
  return useInfiniteQuery<
    TeamWorkListResponseDto,
    ApiError<ApiErrorResponseDto>,
    InfiniteData<TeamWorkListResponseDto>,
    typeof queryKey,
    string | undefined
  >({
    enabled,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined,
    queryFn: ({ pageParam, signal }) =>
      teamWorksControllerList({ ...params, ...(pageParam ? { cursor: pageParam } : {}) }, { signal }),
    queryKey,
    retry: false,
  });
}

export function useIssuePages(
  params: IssuesControllerListParams,
  enabled = true,
): UseInfiniteQueryResult<InfiniteData<IssueListResponseDto>, ApiError<ApiErrorResponseDto>> {
  const queryKey = getIssuePagesQueryKey(params);

  return useInfiniteQuery<
    IssueListResponseDto,
    ApiError<ApiErrorResponseDto>,
    InfiniteData<IssueListResponseDto>,
    typeof queryKey,
    string | undefined
  >({
    enabled,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined,
    queryFn: ({ pageParam, signal }) =>
      issuesControllerList({ ...params, ...(pageParam ? { cursor: pageParam } : {}) }, { signal }),
    queryKey,
    retry: false,
  });
}
