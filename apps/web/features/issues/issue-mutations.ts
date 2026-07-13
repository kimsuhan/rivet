'use client';

import {
  type InfiniteData,
  type QueryKey,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useRef, useState } from 'react';

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
      action: 'CANCEL' | 'COMPLETE' | 'PAUSE' | 'REOPEN' | 'RESUME';
      value: NonNullable<IssueSummaryResponseDto['status']['featureStatus']>;
    }
  | { kind: 'assignee'; value: IssueSummaryResponseDto['assignee'] }
  | { kind: 'priority'; value: IssueSummaryResponseDto['priority'] }
  | { kind: 'labels'; value: IssueSummaryResponseDto['labels'] };

type IssueMutationVariables = {
  change: IssueOptimisticChange;
  issue: IssueSummaryResponseDto;
  mutationId: number;
};

type IssueMutationContext = {
  optimisticVersion: number;
  mutationId: number;
};

type ConflictState = {
  attemptedChange: IssueOptimisticChange;
  issueRef: string;
  latest: IssueDetailResponseDto | null;
};

type IssueOptimisticOperation = {
  change: IssueOptimisticChange;
  id: number;
  optimisticVersion: number;
};

type IssueOptimisticPipeline = {
  base: IssueSummaryResponseDto;
  maxVersion: number;
  operations: IssueOptimisticOperation[];
};

type IssueMutationFailure = {
  attemptedChange: IssueOptimisticChange;
  isConflict: boolean;
  issue: IssueSummaryResponseDto;
  issueId: string;
  issueRef: string;
  latest: IssueDetailResponseDto | null;
  mutationId: number;
};

type IssueRequestQueueEntry = {
  previous?: Promise<void>;
  mutationId: number;
  resolve: () => void;
  settled: Promise<void>;
};

const ISSUE_INLINE_MUTATION_KEY = ['issue-inline'] as const;

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
        featureStatusAction: change.action,
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

function findIssueInListCache(
  data: InfiniteData<IssueListResponseDto> | IssueListResponseDto | undefined,
  issueId: string,
): IssueSummaryResponseDto | undefined {
  if (!data) return undefined;
  if ('pages' in data) {
    return data.pages.flatMap((page) => page.items).find((issue) => issue.id === issueId);
  }

  return data.items.find((issue) => issue.id === issueId);
}

function findCachedIssue(
  queryClient: ReturnType<typeof useQueryClient>,
  fallback: IssueSummaryResponseDto,
): IssueSummaryResponseDto {
  for (const issueRef of [fallback.id, fallback.identifier]) {
    const detail = queryClient.getQueryData<IssueDetailResponseDto>(
      getIssuesControllerGetQueryKey(issueRef),
    );
    if (detail) return detail;
  }

  for (const [, data] of queryClient.getQueriesData<
    InfiniteData<IssueListResponseDto> | IssueListResponseDto
  >({ queryKey: getIssuesControllerListQueryKey() })) {
    const issue = findIssueInListCache(data, fallback.id);
    if (issue) return issue;
  }

  return fallback;
}

function setIssueInCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  issue: IssueDetailResponseDto,
) {
  queryClient.setQueriesData<InfiniteData<IssueListResponseDto> | IssueListResponseDto>(
    { queryKey: getIssuesControllerListQueryKey() },
    (data) =>
      updateIssueListCache(data, issue.id, (current) =>
        current.version > issue.version ? current : issue,
      ),
  );
  for (const issueRef of [issue.id, issue.identifier]) {
    queryClient.setQueryData<IssueDetailResponseDto>(
      getIssuesControllerGetQueryKey(issueRef),
      (current) => {
        if (current && current.version > issue.version) return current;

        return {
          ...issue,
          ...(issue.handoffFlows === undefined && current?.handoffFlows !== undefined
            ? { handoffFlows: current.handoffFlows }
            : {}),
          ...(issue.workflowRelations === undefined && current?.workflowRelations !== undefined
            ? { workflowRelations: current.workflowRelations }
            : {}),
        };
      },
    );
  }
}

function setOptimisticIssueInCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  issue: IssueSummaryResponseDto,
  maxVersion: number,
) {
  queryClient.setQueriesData<InfiniteData<IssueListResponseDto> | IssueListResponseDto>(
    { queryKey: getIssuesControllerListQueryKey() },
    (data) =>
      updateIssueListCache(data, issue.id, (current) =>
        current.version > maxVersion ? current : { ...current, ...issue },
      ),
  );
  for (const issueRef of [issue.id, issue.identifier]) {
    queryClient.setQueryData<IssueDetailResponseDto>(
      getIssuesControllerGetQueryKey(issueRef),
      (current) =>
        current && current.id === issue.id && current.version <= maxVersion
          ? { ...current, ...issue }
          : current,
    );
  }
}

function deriveOptimisticIssue(pipeline: IssueOptimisticPipeline): IssueSummaryResponseDto {
  return [...pipeline.operations]
    .sort((left, right) => left.id - right.id)
    .reduce((current, operation) => {
      if (operation.optimisticVersion <= current.version) return current;

      return {
        ...applyIssueChange(current, operation.change),
        version: operation.optimisticVersion,
      };
    }, pipeline.base);
}

function mutationCellKey(issueId: string, change: IssueOptimisticChange['kind']) {
  return `${issueId}:${change}`;
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
  const nextMutationId = useRef(0);
  const pipelines = useRef(new Map<string, IssueOptimisticPipeline>());
  const latestMutationByCell = useRef(new Map<string, number>());
  const requestQueues = useRef(new Map<string, IssueRequestQueueEntry>());
  const queuedMutations = useRef(new Map<number, IssueRequestQueueEntry>());
  const [pendingMutations, setPendingMutations] = useState<
    Array<{ change: IssueOptimisticChange['kind']; id: number; issueId: string }>
  >([]);
  const [failures, setFailures] = useState<IssueMutationFailure[]>([]);

  function synchronizePipeline(issueId: string) {
    const pipeline = pipelines.current.get(issueId);
    if (!pipeline) return undefined;

    const optimisticIssue = deriveOptimisticIssue(pipeline);
    setOptimisticIssueInCaches(queryClient, optimisticIssue, pipeline.maxVersion);
    if (pipeline.operations.length === 0) pipelines.current.delete(issueId);

    return optimisticIssue;
  }

  function removeOperation(issueId: string, mutationId: number) {
    const pipeline = pipelines.current.get(issueId);
    if (!pipeline) return;

    pipeline.operations = pipeline.operations.filter((operation) => operation.id !== mutationId);
  }

  function applyServerIssue(updated: IssueDetailResponseDto) {
    const pipeline = pipelines.current.get(updated.id);
    if (pipeline) {
      if (updated.version >= pipeline.base.version) pipeline.base = updated;
      pipeline.maxVersion = Math.max(pipeline.maxVersion, updated.version);
    }

    setIssueInCaches(queryClient, updated);
    return synchronizePipeline(updated.id) ?? updated;
  }

  function isLatestMutation(variables: IssueMutationVariables) {
    return (
      latestMutationByCell.current.get(
        mutationCellKey(variables.issue.id, variables.change.kind),
      ) === variables.mutationId
    );
  }

  function clearFailure(issueId: string, change: IssueOptimisticChange['kind']) {
    setFailures((current) =>
      current.filter(
        (failure) => failure.issueId !== issueId || failure.attemptedChange.kind !== change,
      ),
    );
  }

  function setFailure(failure: IssueMutationFailure) {
    setFailures((current) => [
      ...current.filter(
        (currentFailure) =>
          currentFailure.issueId !== failure.issueId ||
          currentFailure.attemptedChange.kind !== failure.attemptedChange.kind,
      ),
      failure,
    ]);
  }

  const mutation = useMutation<
    UpdateIssueResponseDto,
    ApiError<ApiErrorResponseDto>,
    IssueMutationVariables,
    IssueMutationContext
  >({
    mutationKey: ISSUE_INLINE_MUTATION_KEY,
    mutationFn: async ({ change, issue, mutationId }) => {
      const previous = queuedMutations.current.get(mutationId)?.previous;
      if (previous) await previous;
      const requestIssue =
        pipelines.current.get(issue.id)?.base ?? findCachedIssue(queryClient, issue);
      return issuesControllerUpdate(issue.id, changeToDto(change, requestIssue.version));
    },
    onMutate: async ({ issue, mutationId }) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: getIssuesControllerListQueryKey() }),
        queryClient.cancelQueries({ queryKey: getIssuesControllerGetQueryKey(issue.id) }),
        queryClient.cancelQueries({ queryKey: getIssuesControllerGetQueryKey(issue.identifier) }),
      ]);

      const operation = pipelines.current
        .get(issue.id)
        ?.operations.find((candidate) => candidate.id === mutationId);
      synchronizePipeline(issue.id);

      return {
        mutationId,
        optimisticVersion: operation?.optimisticVersion ?? issue.version + 1,
      };
    },
    onError: async (error, variables, context) => {
      removeOperation(variables.issue.id, context?.mutationId ?? variables.mutationId);
      synchronizePipeline(variables.issue.id);

      const versionConflict = isVersionConflict(error);
      const projectImmutable = isProjectImmutable(error);
      let latest: IssueDetailResponseDto | null = null;
      let recoveryFailed = false;
      if (versionConflict || projectImmutable) {
        try {
          latest = await issuesControllerGet(variables.issue.identifier);
          applyServerIssue(latest);
        } catch {
          recoveryFailed = projectImmutable;
          // Version conflicts keep the attempted change available for a later detail-read retry.
        }
      }

      if (!isLatestMutation(variables)) return;

      setFailure({
        attemptedChange: variables.change,
        isConflict: versionConflict,
        issue: variables.issue,
        issueId: variables.issue.id,
        issueRef: variables.issue.identifier,
        latest,
        mutationId: variables.mutationId,
      });
      setConflict(
        versionConflict
          ? {
              attemptedChange: variables.change,
              issueRef: variables.issue.identifier,
              latest,
            }
          : null,
      );
      setLatestRecoveryFailed(recoveryFailed);
    },
    onSuccess: (updated, variables, context) => {
      removeOperation(updated.id, context?.mutationId ?? variables.mutationId);
      applyServerIssue(updated);
      if (isLatestMutation(variables)) {
        clearFailure(variables.issue.id, variables.change.kind);
        setConflict(null);
        setLatestRecoveryFailed(false);
      }
      if (currentQueryKey && removeAfterSuccess?.(updated)) {
        queryClient.setQueryData<InfiniteData<IssueListResponseDto>>(currentQueryKey, (data) => {
          const current = findIssueInListCache(data, updated.id);
          return current && current.version > updated.version
            ? data
            : updateInfiniteIssue(data, updated.id, (issue) => issue, true);
        });
      }
    },
    onSettled: (_data, _error, variables) => {
      setPendingMutations((current) =>
        current.filter((pending) => pending.id !== variables.mutationId),
      );
      queuedMutations.current.get(variables.mutationId)?.resolve();
      queuedMutations.current.delete(variables.mutationId);
      if (requestQueues.current.get(variables.issue.id)?.mutationId === variables.mutationId) {
        requestQueues.current.delete(variables.issue.id);
      }
      if (queryClient.isMutating({ mutationKey: ISSUE_INLINE_MUTATION_KEY }) === 1) {
        void queryClient
          .invalidateQueries({ queryKey: getIssuesControllerListQueryKey() })
          .catch(() => undefined);
      }
    },
  });

  function mutate(
    variables: Omit<IssueMutationVariables, 'mutationId'>,
    options?: Parameters<typeof mutation.mutate>[1],
  ) {
    const cached = findCachedIssue(queryClient, variables.issue);
    let pipeline = pipelines.current.get(variables.issue.id);
    if (!pipeline) {
      pipeline = { base: cached, maxVersion: cached.version, operations: [] };
      pipelines.current.set(variables.issue.id, pipeline);
    }
    const issue = deriveOptimisticIssue(pipeline);
    const mutationId = ++nextMutationId.current;
    const optimisticVersion = issue.version + 1;
    pipeline.operations.push({
      change: variables.change,
      id: mutationId,
      optimisticVersion,
    });
    pipeline.maxVersion = Math.max(pipeline.maxVersion, optimisticVersion);
    latestMutationByCell.current.set(mutationCellKey(issue.id, variables.change.kind), mutationId);
    const previous = requestQueues.current.get(issue.id)?.settled;
    let resolveSettled: () => void = () => undefined;
    const settled = new Promise<void>((resolve) => {
      resolveSettled = resolve;
    });
    const queuedMutation: IssueRequestQueueEntry = {
      mutationId,
      resolve: resolveSettled,
      settled,
      ...(previous ? { previous } : {}),
    };
    requestQueues.current.set(issue.id, queuedMutation);
    queuedMutations.current.set(mutationId, queuedMutation);
    setPendingMutations((current) => [
      ...current,
      { change: variables.change.kind, id: mutationId, issueId: issue.id },
    ]);
    clearFailure(issue.id, variables.change.kind);
    setConflict(null);
    setLatestRecoveryFailed(false);
    mutation.mutate({ ...variables, issue, mutationId }, options);
  }

  function isPendingFor(issueId: string, change?: IssueOptimisticChange['kind']) {
    return pendingMutations.some(
      (pending) =>
        pending.issueId === issueId && (change === undefined || pending.change === change),
    );
  }

  function failureFor(issueId: string, change: IssueOptimisticChange['kind']) {
    return failures.find(
      (failure) => failure.issueId === issueId && failure.attemptedChange.kind === change,
    );
  }

  function retryFor(issueId: string, change: IssueOptimisticChange['kind']) {
    const failure = failureFor(issueId, change);
    if (!failure || isPendingFor(issueId, change)) return;

    mutate({
      change: failure.attemptedChange,
      issue: findCachedIssue(queryClient, failure.issue),
    });
  }

  async function reapplyConflictFor(issueId: string, change: IssueOptimisticChange['kind']) {
    const failure = failureFor(issueId, change);
    if (!failure?.isConflict || isPendingFor(issueId, change)) return;

    try {
      const latest = failure.latest ?? (await issuesControllerGet(failure.issueRef));
      if (
        latestMutationByCell.current.get(mutationCellKey(issueId, change)) !== failure.mutationId
      ) {
        return;
      }
      applyServerIssue(latest);
      mutate({ change: failure.attemptedChange, issue: latest });
    } catch {
      // The conflict notice stays visible so the user can retry the detail read.
    }
  }

  async function reapplyConflict() {
    if (!conflict) return;

    const failedMutation = failures.find(
      (failure) =>
        failure.isConflict &&
        failure.issueRef === conflict.issueRef &&
        failure.attemptedChange.kind === conflict.attemptedChange.kind,
    );
    if (failedMutation) {
      await reapplyConflictFor(failedMutation.issueId, failedMutation.attemptedChange.kind);
      return;
    }

    const variables = mutation.variables;
    if (variables && isPendingFor(variables.issue.id, variables.change.kind)) {
      return;
    }

    try {
      const latest = conflict.latest ?? (await issuesControllerGet(conflict.issueRef));
      applyServerIssue(latest);
      mutate({ change: conflict.attemptedChange, issue: latest });
    } catch {
      // The conflict notice stays visible so the user can retry the detail read.
    }
  }

  async function refreshLatest() {
    const issueRef = mutation.variables?.issue.identifier;
    const variables = mutation.variables;
    if (!issueRef || !variables || isPendingFor(variables.issue.id, variables.change.kind)) {
      return;
    }

    try {
      const latest = await issuesControllerGet(issueRef);
      applyServerIssue(latest);
      setLatestRecoveryFailed(false);
    } catch {
      setLatestRecoveryFailed(true);
    }
  }

  function retry() {
    if (
      mutation.variables &&
      !isPendingFor(mutation.variables.issue.id, mutation.variables.change.kind)
    ) {
      mutate({ change: mutation.variables.change, issue: mutation.variables.issue });
    }
  }

  return {
    ...mutation,
    conflict,
    failureFor,
    isPendingFor,
    latestRecoveryFailed,
    mutate,
    reapplyConflict,
    reapplyConflictFor,
    refreshLatest,
    retry,
    retryFor,
  };
}
