'use client';

import {
  type InfiniteData,
  type QueryKey,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useState } from 'react';

import {
  ApiError,
  type ApiErrorResponseDto,
  getIssuesControllerGetQueryKey,
  getIssuesControllerListQueryKey,
  type IssueDetailResponseDto,
  type IssueListResponseDto,
  issuesControllerGet,
  issuesControllerUpdate,
  type IssueSummaryResponseDto,
  type IssueWorkflowStateSummaryResponseDto,
  type UpdateIssueDto,
  type UpdateIssueResponseDto,
} from '@rivet/api-client';

export type IssueOptimisticChange =
  | { kind: 'title'; value: string }
  | { kind: 'description'; value: string | null }
  | {
      kind: 'workflowState';
      handoff?: {
        bodyMarkdown: string;
        destinationRoles?: Array<'APP_FRONTEND' | 'WEB_FRONTEND'>;
      };
      value: IssueWorkflowStateSummaryResponseDto;
    }
  | {
      kind: 'featureStatus';
      requireCompletedTeamTasks?: boolean;
      value: NonNullable<IssueSummaryResponseDto['status']['featureStatus']>;
    }
  | { kind: 'assignee'; value: IssueSummaryResponseDto['assignee'] }
  | { kind: 'priority'; value: IssueSummaryResponseDto['priority'] }
  | { kind: 'labels'; value: IssueSummaryResponseDto['labels'] };

type IssueMutationVariables = {
  change: IssueOptimisticChange;
  issue: IssueSummaryResponseDto;
};

type IssueMutationContext = {
  detailSnapshots: Array<[QueryKey, IssueDetailResponseDto | undefined]>;
  listSnapshots: Array<
    [QueryKey, InfiniteData<IssueListResponseDto> | IssueListResponseDto | undefined]
  >;
};

type ConflictState = {
  attemptedChange: IssueOptimisticChange;
  issueRef: string;
  latest: IssueDetailResponseDto | null;
};

function changeToDto(change: IssueOptimisticChange, version: number): UpdateIssueDto {
  switch (change.kind) {
    case 'title':
      return { title: change.value, version };
    case 'description':
      return { descriptionMarkdown: change.value, version };
    case 'workflowState':
      return {
        ...(change.handoff ? { handoff: change.handoff } : {}),
        version,
        workflowStateId: change.value.id,
      };
    case 'featureStatus':
      return {
        featureStatus: change.value,
        ...(change.requireCompletedTeamTasks ? { requireCompletedTeamTasks: true } : {}),
        version,
      };
    case 'assignee':
      return { assigneeMembershipId: change.value?.id ?? null, version };
    case 'priority':
      return { priority: change.value, version };
    case 'labels':
      return { labelIds: change.value.map((label) => label.id), version };
  }
}

export function applyIssueChange<T extends IssueSummaryResponseDto>(
  issue: T,
  change: IssueOptimisticChange,
  optimistic = true,
): T {
  const common = optimistic
    ? { updatedAt: new Date().toISOString(), version: issue.version + 1 }
    : {};

  switch (change.kind) {
    case 'title':
      return { ...issue, ...common, title: change.value };
    case 'description':
      return {
        ...issue,
        ...common,
        ...('descriptionMarkdown' in issue ? { descriptionMarkdown: change.value } : {}),
      };
    case 'workflowState':
      return {
        ...issue,
        ...common,
        status: {
          category: change.value.category,
          featureStatus: null,
          workflowState: change.value,
        },
      };
    case 'featureStatus':
      return {
        ...issue,
        ...common,
        status: {
          category:
            change.value === 'DONE'
              ? 'COMPLETED'
              : change.value === 'CANCELED'
                ? 'CANCELED'
                : change.value === 'IN_PROGRESS' || change.value === 'REVIEW'
                  ? 'STARTED'
                  : change.value === 'TODO'
                    ? 'UNSTARTED'
                    : 'BACKLOG',
          featureStatus: change.value,
          workflowState: null,
        },
      };
    case 'assignee':
      return { ...issue, ...common, assignee: change.value };
    case 'priority':
      return { ...issue, ...common, priority: change.value };
    case 'labels':
      return { ...issue, ...common, labels: change.value };
  }
}

function updateInfiniteIssue(
  data: InfiniteData<IssueListResponseDto> | undefined,
  issueId: string,
  update: (issue: IssueSummaryResponseDto) => IssueSummaryResponseDto,
  remove = false,
): InfiniteData<IssueListResponseDto> | undefined {
  if (!data) return data;

  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.flatMap((issue) => {
        if (issue.id !== issueId) return [issue];
        return remove ? [] : [update(issue)];
      }),
    })),
  };
}

function updateIssueListCache(
  data: InfiniteData<IssueListResponseDto> | IssueListResponseDto | undefined,
  issueId: string,
  update: (issue: IssueSummaryResponseDto) => IssueSummaryResponseDto,
): InfiniteData<IssueListResponseDto> | IssueListResponseDto | undefined {
  if (!data) return data;
  if ('pages' in data) return updateInfiniteIssue(data, issueId, update);

  return {
    ...data,
    items: data.items.map((issue) => (issue.id === issueId ? update(issue) : issue)),
  };
}

function setIssueInCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  issue: IssueDetailResponseDto,
) {
  queryClient.setQueriesData<InfiniteData<IssueListResponseDto> | IssueListResponseDto>(
    { queryKey: getIssuesControllerListQueryKey() },
    (data) => updateIssueListCache(data, issue.id, () => issue),
  );
  for (const issueRef of [issue.id, issue.identifier]) {
    queryClient.setQueryData<IssueDetailResponseDto>(
      getIssuesControllerGetQueryKey(issueRef),
      (current) => ({
        ...issue,
        ...(issue.handoffFlows === undefined && current?.handoffFlows !== undefined
          ? { handoffFlows: current.handoffFlows }
          : {}),
        ...(issue.workflowRelations === undefined && current?.workflowRelations !== undefined
          ? { workflowRelations: current.workflowRelations }
          : {}),
      }),
    );
  }
}

function isVersionConflict(error: unknown): error is ApiError<ApiErrorResponseDto> {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    (error.body.code === 'VERSION_CONFLICT' || error.body.code === 'ISSUE_VERSION_CONFLICT')
  );
}

function isProjectImmutable(error: unknown): error is ApiError<ApiErrorResponseDto> {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    error.body.code === 'ISSUE_PROJECT_IMMUTABLE'
  );
}

export function useIssueInlineMutation({
  currentQueryKey,
  removeAfterSuccess,
}: {
  currentQueryKey?: QueryKey;
  removeAfterSuccess?: (issue: IssueDetailResponseDto) => boolean;
} = {}) {
  const queryClient = useQueryClient();
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [latestRecoveryFailed, setLatestRecoveryFailed] = useState(false);
  const mutation = useMutation<
    UpdateIssueResponseDto,
    ApiError<ApiErrorResponseDto>,
    IssueMutationVariables,
    IssueMutationContext
  >({
    mutationFn: ({ change, issue }) =>
      issuesControllerUpdate(issue.id, changeToDto(change, issue.version)),
    onMutate: async ({ change, issue }) => {
      setConflict(null);
      setLatestRecoveryFailed(false);
      await Promise.all([
        queryClient.cancelQueries({ queryKey: getIssuesControllerListQueryKey() }),
        queryClient.cancelQueries({ queryKey: getIssuesControllerGetQueryKey(issue.id) }),
        queryClient.cancelQueries({ queryKey: getIssuesControllerGetQueryKey(issue.identifier) }),
      ]);

      const listSnapshots = queryClient.getQueriesData<
        InfiniteData<IssueListResponseDto> | IssueListResponseDto
      >({ queryKey: getIssuesControllerListQueryKey() });
      const detailKeys = [
        getIssuesControllerGetQueryKey(issue.id),
        getIssuesControllerGetQueryKey(issue.identifier),
      ];
      const detailSnapshots = detailKeys.map(
        (queryKey) =>
          [queryKey, queryClient.getQueryData<IssueDetailResponseDto>(queryKey)] as const,
      );

      queryClient.setQueriesData<InfiniteData<IssueListResponseDto> | IssueListResponseDto>(
        { queryKey: getIssuesControllerListQueryKey() },
        (data) => updateIssueListCache(data, issue.id, (item) => applyIssueChange(item, change)),
      );
      for (const queryKey of detailKeys) {
        queryClient.setQueryData<IssueDetailResponseDto>(queryKey, (detail) =>
          detail ? applyIssueChange(detail, change) : detail,
        );
      }

      return {
        detailSnapshots: detailSnapshots.map(([key, value]) => [key, value]),
        listSnapshots,
      };
    },
    onError: async (error, variables, context) => {
      for (const [queryKey, data] of context?.listSnapshots ?? []) {
        queryClient.setQueryData(queryKey, data);
      }
      for (const [queryKey, data] of context?.detailSnapshots ?? []) {
        queryClient.setQueryData(queryKey, data);
      }

      const versionConflict = isVersionConflict(error);
      const projectImmutable = isProjectImmutable(error);
      if (!versionConflict && !projectImmutable) return;

      let latest: IssueDetailResponseDto | null = null;
      try {
        latest = await issuesControllerGet(variables.issue.identifier);
        setIssueInCaches(queryClient, latest);
      } catch {
        if (projectImmutable) setLatestRecoveryFailed(true);
        // Version conflicts keep the attempted change available for a later detail-read retry.
      }
      if (!versionConflict) return;

      setConflict({
        attemptedChange: variables.change,
        issueRef: variables.issue.identifier,
        latest,
      });
    },
    onSuccess: (updated) => {
      setIssueInCaches(queryClient, updated);
      if (currentQueryKey && removeAfterSuccess?.(updated)) {
        queryClient.setQueryData<InfiniteData<IssueListResponseDto>>(currentQueryKey, (data) =>
          updateInfiniteIssue(data, updated.id, (issue) => issue, true),
        );
      }
      void queryClient
        .invalidateQueries({ queryKey: getIssuesControllerListQueryKey() })
        .catch(() => undefined);
    },
  });

  async function reapplyConflict() {
    if (!conflict || mutation.isPending) return;

    try {
      const latest = conflict.latest ?? (await issuesControllerGet(conflict.issueRef));
      setIssueInCaches(queryClient, latest);
      mutation.mutate({ change: conflict.attemptedChange, issue: latest });
    } catch {
      // The conflict notice stays visible so the user can retry the detail read.
    }
  }

  async function refreshLatest() {
    const issueRef = mutation.variables?.issue.identifier;
    if (!issueRef || mutation.isPending) return;

    try {
      const latest = await issuesControllerGet(issueRef);
      setIssueInCaches(queryClient, latest);
      setLatestRecoveryFailed(false);
    } catch {
      setLatestRecoveryFailed(true);
    }
  }

  function retry() {
    if (mutation.variables && !mutation.isPending) mutation.mutate(mutation.variables);
  }

  return { ...mutation, conflict, latestRecoveryFailed, reapplyConflict, refreshLatest, retry };
}
