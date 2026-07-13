'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  Check,
  CircleDot,
  FileQuestion,
  FolderKanban,
  GitBranch,
  MoreHorizontal,
  RotateCcw,
  Send,
  Trash2,
  UserRound,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ComponentRef, type FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import {
  ApiError,
  type CreateIssueResponseDto,
  getIssueCollaborationControllerTimelineQueryKey,
  getIssuesControllerGetQueryKey,
  getIssuesControllerListQueryKey,
  getProjectsControllerGetQueryKey,
  getProjectsControllerListQueryKey,
  getSearchControllerIssuesQueryKey,
  getTrashControllerListQueryKey,
  type IssueDetailResponseDto,
  type IssueHandoffFlowResponseDto,
  type IssueLabelSummaryResponseDto,
  type IssueSummaryResponseDto,
  type IssueWorkflowRelationResponseDto,
  type IssueWorkflowStateSummaryResponseDto,
  type UpdateIssueResponseDto,
  useAuthControllerGetSession,
  useIssueCollaborationControllerCreateHandoff,
  useIssuesControllerGet,
  useIssuesControllerList,
  useIssuesControllerStart,
  useIssuesControllerTrash,
  useLabelsControllerList,
  useMembersControllerList,
  useProjectsControllerGet,
  useTeamsControllerListWorkflowStates,
} from '@rivet/api-client';

import { ContentEmpty } from '@/components/states/content-empty';
import { ContentError } from '@/components/states/content-error';
import { ContentLoading } from '@/components/states/content-loading';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UserAvatar } from '@/components/user-avatar';
import { MarkdownEditor, type MentionOption } from '@/features/collaboration/markdown-editor';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

import {
  FEATURE_ISSUE_PRIORITIES as PRIORITIES,
  FEATURE_ISSUE_STATUSES as FEATURE_STATUSES,
} from './feature-issue-list-state';
import { IssueAttachments } from './issue-attachments';
import {
  FEATURE_STATUS_PRESENTATION,
  ISSUE_PRIORITY_PRESENTATION,
  WORKFLOW_STATE_PRESENTATION,
} from './issue-attribute-presentation';
import { markdownEditorLabels } from './issue-collaboration-labels';
import { IssueDescription } from './issue-description';
import { IssueFilterMenu } from './issue-filter-menu';
import { IssueHandoffCard } from './issue-handoff-card';
import { HANDOFF_TEMPLATE, handoffBodyError } from './issue-handoff-validation';
import { IssueInlineSelect } from './issue-inline-select';
import { IssueLabelChips } from './issue-label-chips';
import { useIssueInlineMutation } from './issue-mutations';
import { IssueRelations } from './issue-relations';
import { IssueTimeline } from './issue-timeline';
import {
  type FeatureIssue,
  isFeatureIssue,
  isTeamTaskIssue,
  type TeamTaskIssue,
} from './issue-types';

const START_ROLES = ['BACKEND', 'WEB_FRONTEND', 'APP_FRONTEND'] as const;

type DetailMutation = ReturnType<typeof useIssueInlineMutation>;
type DetailTab = 'activity' | 'relations' | 'work';
type FrontendRole = 'APP_FRONTEND' | 'WEB_FRONTEND';

const DETAIL_TABS: DetailTab[] = ['work', 'relations', 'activity'];

function isDetailTab(value: string | null): value is DetailTab {
  return value !== null && DETAIL_TABS.includes(value as DetailTab);
}

function tabForHash(
  issue: FeatureIssue<IssueDetailResponseDto> | TeamTaskIssue<IssueDetailResponseDto>,
  hash: string,
): DetailTab | null {
  if (hash.startsWith('#comment-')) return 'work';
  if (hash.startsWith('#handoff-')) {
    return issue.type === 'TEAM_TASK' && issue.projectRole !== 'BACKEND' ? 'work' : 'relations';
  }
  if (
    hash === '#feature-progress-title' ||
    hash === '#handoff-history' ||
    hash === '#issue-relations-title' ||
    hash === '#issue-relations-empty-title' ||
    hash === '#parent-feature-title'
  ) {
    return 'relations';
  }
  return null;
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function orderWorkflowTasks(
  tasks: IssueSummaryResponseDto[],
  relations: IssueWorkflowRelationResponseDto[],
): IssueSummaryResponseDto[] {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const originalPosition = new Map(tasks.map((task, index) => [task.id, index]));
  const incomingCount = new Map(tasks.map((task) => [task.id, 0]));
  const downstreamIds = new Map(tasks.map((task) => [task.id, new Set<string>()]));

  for (const relation of relations) {
    if (!taskById.has(relation.blockingIssueId) || !taskById.has(relation.blockedIssueId)) {
      continue;
    }
    const downstream = downstreamIds.get(relation.blockingIssueId)!;
    if (downstream.has(relation.blockedIssueId)) continue;
    downstream.add(relation.blockedIssueId);
    incomingCount.set(
      relation.blockedIssueId,
      (incomingCount.get(relation.blockedIssueId) ?? 0) + 1,
    );
  }

  const ready = tasks.filter((task) => incomingCount.get(task.id) === 0);
  const ordered: IssueSummaryResponseDto[] = [];
  while (ready.length > 0) {
    ready.sort(
      (left, right) => (originalPosition.get(left.id) ?? 0) - (originalPosition.get(right.id) ?? 0),
    );
    const task = ready.shift()!;
    ordered.push(task);
    for (const downstreamId of downstreamIds.get(task.id) ?? []) {
      const nextCount = (incomingCount.get(downstreamId) ?? 1) - 1;
      incomingCount.set(downstreamId, nextCount);
      if (nextCount === 0) ready.push(taskById.get(downstreamId)!);
    }
  }

  return ordered.length === tasks.length ? ordered : tasks;
}

function affectedHandoffIssues(error: unknown): Array<{ identifier: string; title: string }> {
  if (!(error instanceof ApiError) || !error.body || typeof error.body !== 'object') return [];
  const details = (error.body as Record<string, unknown>).details;
  if (!details || typeof details !== 'object') return [];
  const issues = (details as Record<string, unknown>).issues;
  if (!Array.isArray(issues)) return [];

  return issues.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const { identifier, title } = value as Record<string, unknown>;
    return typeof identifier === 'string' && typeof title === 'string'
      ? [{ identifier, title }]
      : [];
  });
}

function PropertyRow({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="grid min-h-11 grid-cols-[6rem_minmax(0,1fr)] items-center gap-3">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function isPropertyMutation(mutation: DetailMutation): boolean {
  const change = mutation.variables?.change;
  if (!change || (change.kind === 'workflowState' && change.handoff)) return false;
  return ['assignee', 'featureStatus', 'labels', 'priority', 'workflowState'].includes(change.kind);
}

function PropertyMutationError({ mutation }: { mutation: DetailMutation }) {
  const t = useTranslations('IssueDetail');
  if (!mutation.isError || mutation.conflict || !isPropertyMutation(mutation)) return null;
  const errorCode = mutation.error instanceof ApiError ? mutation.error.body.code : null;

  return (
    <Alert variant="destructive" className="mt-3">
      <AlertTitle>
        {errorCode === 'ISSUE_PROJECT_IMMUTABLE'
          ? t('projectImmutableErrorTitle')
          : t('saveErrorTitle')}
      </AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
        <span>
          {errorCode === 'ISSUE_PROJECT_IMMUTABLE'
            ? t('projectImmutableErrorDescription')
            : t('saveErrorDescription')}
        </span>
        {errorCode === 'ISSUE_PROJECT_IMMUTABLE' && mutation.latestRecoveryFailed ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-11 lg:min-h-9"
            onClick={() => void mutation.refreshLatest()}
          >
            {t('refreshLatest')}
          </Button>
        ) : errorCode !== 'ISSUE_PROJECT_IMMUTABLE' ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-11 lg:min-h-9"
            onClick={mutation.retry}
          >
            {t('retry')}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(new Date(value));
}

export function IssueDetailScreen({ issueRef }: { issueRef: string }) {
  const t = useTranslations('IssueDetail');
  const issue = useIssuesControllerGet(issueRef, { query: { retry: false } });

  if (issue.isPending) return <ContentLoading label={t('loading')} />;

  if (issue.isError) {
    if (issue.error instanceof ApiError && issue.error.status === 404) {
      return (
        <ContentEmpty
          icon={FileQuestion}
          headingLevel={1}
          title={t('notFoundTitle')}
          description={t('notFoundDescription')}
        >
          <Link href="/my-issues" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            {t('backToMyIssues')}
          </Link>
        </ContentEmpty>
      );
    }

    return (
      <ContentError
        headingLevel={1}
        title={t('errorTitle')}
        description={t('errorDescription')}
        retryLabel={t('retry')}
        onRetry={() => void issue.refetch()}
      />
    );
  }

  if (!isTeamTaskIssue(issue.data) && !isFeatureIssue(issue.data)) {
    return (
      <ContentError
        headingLevel={1}
        title={t('invalidContractTitle')}
        description={t('invalidContractDescription')}
        retryLabel={t('retry')}
        onRetry={() => void issue.refetch()}
      />
    );
  }

  return (
    <IssueDetailContent issue={issue.data} onReload={async () => (await issue.refetch()).data} />
  );
}

function IssueDetailContent({
  issue,
  onReload,
}: {
  issue: FeatureIssue<IssueDetailResponseDto> | TeamTaskIssue<IssueDetailResponseDto>;
  onReload: () => Promise<IssueDetailResponseDto | undefined>;
}) {
  const t = useTranslations('IssueDetail');
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const requestedTab = searchParams.get('tab');
  const [locationHash, setLocationHash] = useState('');
  const [optimisticTab, setOptimisticTab] = useState<{
    sourceSearch: string;
    value: DetailTab;
  } | null>(null);
  const hashTab = tabForHash(issue, locationHash);
  const activeTab =
    hashTab ??
    (optimisticTab?.sourceSearch === search
      ? optimisticTab.value
      : isDetailTab(requestedTab)
        ? requestedTab
        : 'work');
  const collaborationMembers = useMembersControllerList(
    { limit: 100, status: 'ACTIVE' },
    { query: { retry: false } },
  );
  const session = useAuthControllerGetSession({ query: { retry: false } });
  const mutation = useIssueInlineMutation();
  const trash = useIssuesControllerTrash();
  const labels = useLabelsControllerList(
    { includeArchived: true, limit: 100 },
    { query: { retry: false } },
  );
  const [titleDraft, setTitleDraft] = useState<{ submitted: boolean; value: string } | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashError, setTrashError] = useState<
    'BLOCKS_OTHERS' | 'CONFLICT' | 'ERROR' | 'HAS_CHILDREN' | null
  >(null);
  const showSubmittedTitle =
    titleDraft?.submitted === true &&
    mutation.variables?.change.kind === 'title' &&
    (mutation.isPending || mutation.isError);
  const titleValue =
    titleDraft && (!titleDraft.submitted || showSubmittedTitle) ? titleDraft.value : issue.title;
  const trimmedTitle = titleValue.trim();
  const titleError =
    trimmedTitle.length === 0
      ? t('titleRequired')
      : trimmedTitle.length > 500
        ? t('titleTooLong')
        : null;
  const labelItems = uniqueById([...issue.labels, ...(labels.data?.items ?? [])]);
  const mentionOptions = (collaborationMembers.data?.items ?? []).map((member) => ({
    displayName: member.user.displayName,
    membershipId: member.id,
  }));
  const currentMembershipId = session.data?.authenticated
    ? (session.data.membership?.id ?? null)
    : null;
  const mutationErrorCode = mutation.error instanceof ApiError ? mutation.error.body.code : null;
  const isHandoffMutation =
    mutation.variables?.change.kind === 'workflowState' &&
    Boolean(mutation.variables.change.handoff);

  const tabHref = useCallback(
    (tab: DetailTab, anchor?: string): string => {
      const next = new URLSearchParams(search);
      next.set('tab', tab);
      const query = next.toString();
      return `${pathname}${query ? `?${query}` : ''}${anchor ? `#${anchor}` : ''}`;
    },
    [pathname, search],
  );

  useEffect(() => {
    const syncHash = () => setLocationHash(window.location.hash);
    const syncClickedHash = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>('a[href*="#"]');
      if (!link) return;

      const url = new URL(link.href, window.location.href);
      if (url.origin === window.location.origin && url.pathname === window.location.pathname) {
        setLocationHash(url.hash);
      }
    };

    syncHash();
    window.addEventListener('hashchange', syncHash);
    window.addEventListener('popstate', syncHash);
    document.addEventListener('click', syncClickedHash);
    return () => {
      window.removeEventListener('hashchange', syncHash);
      window.removeEventListener('popstate', syncHash);
      document.removeEventListener('click', syncClickedHash);
    };
  }, []);

  useEffect(() => {
    if (hashTab) {
      if (requestedTab !== hashTab) {
        router.replace(tabHref(hashTab, locationHash.slice(1)), { scroll: false });
      }
      return;
    }

    if (isDetailTab(requestedTab)) {
      return;
    }

    if (requestedTab !== null) {
      router.replace(tabHref('work'), { scroll: false });
    }
  }, [hashTab, locationHash, requestedTab, router, tabHref]);

  useEffect(() => {
    if (!locationHash) return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(locationHash.slice(1));
      if (target && !target.closest('[hidden]')) {
        target.querySelector('details')?.setAttribute('open', '');
        target.scrollIntoView?.({ block: 'center' });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [activeTab, issue.id, locationHash]);

  useEffect(() => {
    if (!optimisticTab || optimisticTab.sourceSearch === search) return;
    const frame = requestAnimationFrame(() => setOptimisticTab(null));
    return () => cancelAnimationFrame(frame);
  }, [optimisticTab, search]);

  function changeTab(value: string): void {
    if (!isDetailTab(value)) return;
    setOptimisticTab({ sourceSearch: search, value });
    setLocationHash('');
    router.replace(tabHref(value), { scroll: false });
  }

  function submitTitle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (titleError || trimmedTitle === issue.title || mutation.isPending) return;

    setTitleDraft({ submitted: true, value: trimmedTitle });
    mutation.mutate(
      { change: { kind: 'title', value: trimmedTitle }, issue },
      { onSuccess: () => setTitleDraft(null) },
    );
  }

  async function finishTrash(): Promise<void> {
    const invalidations = [
      queryClient.invalidateQueries({ queryKey: getIssuesControllerListQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getProjectsControllerListQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getSearchControllerIssuesQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getTrashControllerListQueryKey() }),
    ];
    if (issue.project?.id) {
      invalidations.push(
        queryClient.invalidateQueries({
          queryKey: getProjectsControllerGetQueryKey(issue.project.id),
        }),
      );
    }
    await Promise.allSettled(invalidations);
    queryClient.removeQueries({ queryKey: getIssuesControllerGetQueryKey(issue.id) });
    queryClient.removeQueries({ queryKey: getIssuesControllerGetQueryKey(issue.identifier) });
    router.push('/my-issues');
  }

  function moveToTrash(): void {
    trash.mutate(
      { data: { version: issue.version }, issueId: issue.id },
      {
        onError: (error) => {
          const code = error.body.code;
          setTrashOpen(false);
          setTrashError(
            code === 'VERSION_CONFLICT'
              ? 'CONFLICT'
              : code === 'ISSUE_HAS_CHILDREN'
                ? 'HAS_CHILDREN'
                : code === 'ISSUE_BLOCKS_OTHERS'
                  ? 'BLOCKS_OTHERS'
                  : 'ERROR',
          );
          if (code === 'VERSION_CONFLICT') void onReload();
        },
        onSuccess: finishTrash,
      },
    );
  }

  function latestValue(source: IssueDetailResponseDto | null): string {
    const change = mutation.conflict?.attemptedChange;
    if (!source || !change) return t('conflict.unknown');

    switch (change.kind) {
      case 'title':
        return source.title;
      case 'description':
        return source.descriptionMarkdown ?? t('description.emptyValue');
      case 'workflowState':
        return source.status.workflowState?.name ?? t('conflict.unknown');
      case 'featureStatus':
        return source.status.featureStatus
          ? t(`featureStatuses.${source.status.featureStatus}`)
          : t('conflict.unknown');
      case 'assignee':
        return source.assignee?.user.displayName ?? t('unassigned');
      case 'priority':
        return t(`priorities.${source.priority}`);
      case 'labels':
        return source.labels.map((label) => label.name).join(', ') || t('noLabels');
    }
  }

  function attemptedValue(): string {
    const change = mutation.conflict?.attemptedChange;
    if (!change) return t('conflict.unknown');

    switch (change.kind) {
      case 'title':
        return change.value;
      case 'description':
        return change.value ?? t('description.emptyValue');
      case 'workflowState':
        return change.value.name;
      case 'featureStatus':
        return t(`featureStatuses.${change.value}`);
      case 'assignee':
        return change.value?.user.displayName ?? t('unassigned');
      case 'priority':
        return t(`priorities.${change.value}`);
      case 'labels':
        return change.value.map((label) => label.name).join(', ') || t('noLabels');
    }
  }

  return (
    <article aria-busy={mutation.isPending} className="mx-auto w-full max-w-6xl overflow-x-hidden">
      <header className="border-b pb-5">
        <h1 className="sr-only">
          {issue.identifier}: {issue.title}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-sm font-medium tracking-wide">
            {issue.identifier}
          </span>
          {issue.type === 'TEAM_TASK' ? <Badge variant="secondary">{t('teamTask')}</Badge> : null}
          {mutation.isPending ? (
            <span
              role="status"
              className="text-muted-foreground inline-flex items-center gap-1.5 text-xs"
            >
              <Spinner className="size-3.5" />
              {t('saving')}
            </span>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className="ml-auto min-h-11 lg:min-h-8"
            disabled={mutation.isPending || trash.isPending}
            onClick={() => {
              trash.reset();
              setTrashError(null);
              setTrashOpen(true);
            }}
          >
            <Trash2 aria-hidden="true" data-icon="inline-start" />
            {t('trash.action')}
          </Button>
        </div>

        {issue.type === 'TEAM_TASK' && issue.parentIssue ? (
          <nav aria-label={t('parentFeature')} className="mt-3">
            <Link
              href={`/issues/${encodeURIComponent(issue.parentIssue.identifier)}?tab=relations`}
              className="text-muted-foreground hover:text-foreground inline-flex max-w-full items-center gap-1.5 truncate text-sm underline-offset-4 hover:underline"
            >
              <GitBranch aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">
                {issue.parentIssue.identifier} · {issue.parentIssue.title}
              </span>
            </Link>
          </nav>
        ) : null}

        <form className="mt-2 flex max-w-4xl items-start gap-2" onSubmit={submitTitle} noValidate>
          <div className="min-w-0 flex-1">
            <label htmlFor="issue-detail-title" className="sr-only">
              {t('titleLabel')}
            </label>
            <Input
              id="issue-detail-title"
              className="h-auto border-transparent px-0 py-1 text-xl leading-8 font-semibold shadow-none focus-visible:border-transparent focus-visible:ring-0 sm:text-2xl"
              aria-invalid={Boolean(titleError)}
              aria-errormessage={titleError ? 'issue-detail-title-error' : undefined}
              autoComplete="off"
              disabled={mutation.isPending}
              maxLength={500}
              value={titleValue}
              onChange={(event) => setTitleDraft({ submitted: false, value: event.target.value })}
            />
            {titleError ? (
              <p id="issue-detail-title-error" className="text-destructive mt-1 text-sm">
                {titleError}
              </p>
            ) : null}
          </div>
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={Boolean(titleError) || trimmedTitle === issue.title || mutation.isPending}
          >
            {t('saveTitle')}
          </Button>
        </form>
      </header>

      {trashError ? (
        <Alert variant="destructive" className="mt-5">
          <AlertTitle>
            {trashError === 'CONFLICT'
              ? t('trash.conflictTitle')
              : trashError === 'HAS_CHILDREN'
                ? t('trash.childrenTitle')
                : trashError === 'BLOCKS_OTHERS'
                  ? t('trash.blocksTitle')
                  : t('trash.errorTitle')}
          </AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>
              {trashError === 'CONFLICT'
                ? t('trash.conflictDescription')
                : trashError === 'HAS_CHILDREN'
                  ? t('trash.childrenDescription')
                  : trashError === 'BLOCKS_OTHERS'
                    ? t('trash.blocksDescription')
                    : t('trash.errorDescription')}
            </span>
            {trashError === 'HAS_CHILDREN' || trashError === 'BLOCKS_OTHERS' ? (
              <a
                href={
                  trashError === 'HAS_CHILDREN'
                    ? tabHref('relations', 'feature-progress-title')
                    : tabHref('relations', 'issue-relations-title')
                }
                className={buttonVariants({ size: 'sm', variant: 'outline' })}
              >
                {trashError === 'HAS_CHILDREN' ? t('trash.openChildren') : t('trash.openRelations')}
              </a>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {mutation.conflict ? (
        <Alert className="mt-5 border-amber-500/40 bg-amber-500/10">
          <RotateCcw aria-hidden="true" />
          <AlertTitle>{t('conflict.title')}</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{t('conflict.description')}</p>
            <dl className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="font-medium">{t('conflict.latest')}</dt>
                <dd className="mt-0.5 break-words">{latestValue(mutation.conflict.latest)}</dd>
              </div>
              <div>
                <dt className="font-medium">{t('conflict.mine')}</dt>
                <dd className="mt-0.5 break-words">{attemptedValue()}</dd>
              </div>
            </dl>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => void mutation.reapplyConflict()}
            >
              {t('conflict.reapply')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {mutation.isError &&
      !mutation.conflict &&
      !isHandoffMutation &&
      mutationErrorCode !== 'HANDOFF_REQUIRES_COMPLETION' &&
      mutation.variables?.change.kind !== 'description' &&
      !isPropertyMutation(mutation) ? (
        <Alert variant="destructive" className="mt-5">
          <AlertTitle>
            {mutationErrorCode === 'ISSUE_PROJECT_IMMUTABLE'
              ? t('projectImmutableErrorTitle')
              : t('saveErrorTitle')}
          </AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>
              {mutationErrorCode === 'ISSUE_PROJECT_IMMUTABLE'
                ? t('projectImmutableErrorDescription')
                : t('saveErrorDescription')}
            </span>
            {mutationErrorCode === 'ISSUE_PROJECT_IMMUTABLE' && mutation.latestRecoveryFailed ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void mutation.refreshLatest()}
              >
                {t('refreshLatest')}
              </Button>
            ) : mutationErrorCode !== 'ISSUE_PROJECT_IMMUTABLE' ? (
              <Button type="button" size="sm" variant="outline" onClick={mutation.retry}>
                {t('retry')}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {collaborationMembers.isError ? (
        <Alert variant="destructive" className="mt-5">
          <AlertTitle>{t('collaborationMembersErrorTitle')}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{t('collaborationMembersErrorDescription')}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void collaborationMembers.refetch()}
            >
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs value={activeTab} onValueChange={changeTab} className="mt-5 gap-0">
        <TabsList
          activateOnFocus
          aria-label={t('tabs.label')}
          variant="line"
          className="grid h-11 w-full grid-cols-3 border-b p-0 sm:flex sm:w-fit"
        >
          <TabsTrigger className="min-h-11 px-4 sm:min-h-9" value="work">
            {t('tabs.work')}
          </TabsTrigger>
          <TabsTrigger className="min-h-11 px-4 sm:min-h-9" value="relations">
            {t('tabs.relations')}
          </TabsTrigger>
          <TabsTrigger className="min-h-11 px-4 sm:min-h-9" value="activity">
            {t('tabs.activity')}
          </TabsTrigger>
        </TabsList>

        {issue.type === 'FEATURE' ? (
          <FeatureIssueBody
            currentMembershipId={currentMembershipId}
            issue={issue}
            labelItems={labelItems}
            mentionOptions={mentionOptions}
            mutation={mutation}
            tabHref={tabHref}
          />
        ) : (
          <TeamTaskIssueBody
            currentMembershipId={currentMembershipId}
            issue={issue}
            labelItems={labelItems}
            mentionOptions={mentionOptions}
            mutation={mutation}
            onReload={onReload}
            tabHref={tabHref}
          />
        )}
      </Tabs>

      <AlertDialog
        open={trashOpen}
        onOpenChange={(open) => {
          if (!trash.isPending) setTrashOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('trash.title')}</AlertDialogTitle>
            <AlertDialogDescription className="flex flex-col gap-2 text-left">
              <strong className="text-foreground font-medium">
                {issue.identifier} · {issue.title}
              </strong>
              <span>{t('trash.description')}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={trash.isPending}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              variant="destructive"
              disabled={trash.isPending}
              onClick={moveToTrash}
            >
              {trash.isPending ? (
                <Spinner aria-hidden="true" data-icon="inline-start" />
              ) : (
                <Trash2 aria-hidden="true" data-icon="inline-start" />
              )}
              {t('trash.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
          {trash.isPending ? (
            <span role="status" className="sr-only">
              {t('trash.moving')}
            </span>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}

function IssueLabels({
  issue,
  labelItems,
  mutation,
}: {
  issue: FeatureIssue<IssueDetailResponseDto> | TeamTaskIssue<IssueDetailResponseDto>;
  labelItems: IssueLabelSummaryResponseDto[];
  mutation: DetailMutation;
}) {
  const t = useTranslations('IssueDetail');
  const selectedIds = issue.labels.map((label) => label.id);

  return (
    <div className="flex min-w-0 items-center gap-1">
      <div className="min-w-0 flex-1">
        <IssueLabelChips emptyLabel={t('noLabels')} labels={issue.labels} showEmpty />
      </div>
      {labelItems.length > 0 ? (
        <IssueFilterMenu
          ariaLabel={`${t('labels')}: ${issue.labels.map((label) => label.name).join(', ') || t('noLabels')}`}
          busy={mutation.isPending && mutation.variables?.change.kind === 'labels'}
          disabled={mutation.isPending}
          emptyLabel={t('noLabels')}
          label={t('labels')}
          onChange={(ids) => {
            mutation.mutate({
              change: {
                kind: 'labels',
                value: ids.flatMap((id) => {
                  const label = labelItems.find((item) => item.id === id);
                  return label ? [label] : [];
                }),
              },
              issue,
            });
          }}
          options={labelItems.map((label) => ({
            disabled: label.archived && !selectedIds.includes(label.id),
            id: label.id,
            label: label.name,
            ...(label.archived ? { suffix: t('archived') } : {}),
            swatch: label.color,
          }))}
          presentation="popover"
          selected={selectedIds}
          triggerClassName="shrink-0 border-transparent bg-transparent px-1.5 [&>span]:sr-only"
        />
      ) : null}
    </div>
  );
}

function PriorityEditor({
  issue,
  mutation,
}: {
  issue: IssueDetailResponseDto;
  mutation: DetailMutation;
}) {
  const t = useTranslations('IssueDetail');
  const currentLabel = t(`priorities.${issue.priority}`);
  return (
    <IssueInlineSelect
      appearance="comfortable"
      ariaLabel={`${t('priority')}: ${currentLabel}`}
      busy={mutation.isPending && mutation.variables?.change.kind === 'priority'}
      disabled={mutation.isPending}
      value={issue.priority}
      onValueChange={(value) => {
        if (PRIORITIES.includes(value as (typeof PRIORITIES)[number])) {
          mutation.mutate({
            change: { kind: 'priority', value: value as (typeof PRIORITIES)[number] },
            issue,
          });
        }
      }}
      options={PRIORITIES.map((priority) => ({
        ...ISSUE_PRIORITY_PRESENTATION[priority],
        label: t(`priorities.${priority}`),
        value: priority,
      }))}
      triggerClassName="min-w-36 max-w-full"
    />
  );
}

function WorkflowTaskStep({
  current,
  orderLabel,
  ordered,
  task,
}: {
  current: boolean;
  orderLabel: string | undefined;
  ordered: boolean;
  task: IssueSummaryResponseDto;
}) {
  const t = useTranslations('IssueDetail');
  const role = task.projectRole ? t(`projectRoles.${task.projectRole}`) : t('workflow.teamTask');
  const state = task.status.workflowState?.name ?? t(`stateCategories.${task.status.category}`);
  const completed = task.status.category === 'COMPLETED';
  const stage = current
    ? t('workflow.current')
    : completed
      ? t('workflow.completed')
      : t('workflow.canceled');

  return (
    <li className={cn('relative', ordered && 'border-border border-l pl-6')}>
      {ordered ? (
        <span
          aria-hidden="true"
          className={cn(
            'border-border bg-background absolute top-3 -left-2 flex size-4 items-center justify-center rounded-full border',
            current && 'border-primary text-primary',
            !current && completed && 'border-success/60 text-success',
            !current && !completed && 'text-muted-foreground',
          )}
        >
          {completed ? <Check className="size-2.5" /> : <CircleDot className="size-2.5" />}
        </span>
      ) : null}
      <div
        className={cn(
          'min-w-0 rounded-lg border px-3 py-2',
          current ? 'bg-surface-1' : 'bg-background',
        )}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant={current ? 'secondary' : 'outline'}>{stage}</Badge>
          <span className="text-sm font-medium">{role}</span>
          <span className="text-muted-foreground text-xs">{state}</span>
          {orderLabel ? <Badge variant="outline">{orderLabel}</Badge> : null}
        </div>
        <Link
          href={`/issues/${encodeURIComponent(task.identifier)}`}
          className="mt-1 block min-w-0 truncate text-sm font-medium underline-offset-4 hover:underline"
        >
          {task.identifier} · {task.title}
        </Link>
        <p className="text-muted-foreground mt-1 text-xs">
          {task.assignee?.user.displayName ?? t('unassigned')}
        </p>
      </div>
    </li>
  );
}

function FeatureIssueBody({
  currentMembershipId,
  issue,
  labelItems,
  mentionOptions,
  mutation,
  tabHref,
}: {
  currentMembershipId: string | null;
  issue: FeatureIssue<IssueDetailResponseDto>;
  labelItems: IssueLabelSummaryResponseDto[];
  mentionOptions: MentionOption[];
  mutation: DetailMutation;
  tabHref: (tab: DetailTab, anchor?: string) => string;
}) {
  const t = useTranslations('IssueDetail');
  const queryClient = useQueryClient();
  const router = useRouter();
  const projectId = issue.project?.id ?? null;
  const children = useIssuesControllerList(
    { limit: 100, parentIssueId: issue.id, type: 'TEAM_TASK' },
    { query: { retry: false } },
  );
  const project = useProjectsControllerGet(projectId ?? '', {
    query: { enabled: Boolean(projectId), retry: false },
  });
  const start = useIssuesControllerStart();
  const firstStartRoleRef = useRef<ComponentRef<typeof Checkbox>>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [startRoles, setStartRoles] = useState<Array<'APP_FRONTEND' | 'BACKEND' | 'WEB_FRONTEND'>>(
    [],
  );
  const childItems = children.data?.items ?? [];
  const workflowRelations = issue.workflowRelations ?? [];
  const orderedChildItems = orderWorkflowTasks(childItems, workflowRelations);
  const completedTasks = orderedChildItems.filter(
    (task) => task.status.category === 'COMPLETED' || task.status.category === 'CANCELED',
  );
  const currentTasks = orderedChildItems.filter(
    (task) => task.status.category !== 'COMPLETED' && task.status.category !== 'CANCELED',
  );
  const backendInProgress = currentTasks.some((task) => task.projectRole === 'BACKEND');
  const hasFrontendTask = childItems.some(
    (task) => task.projectRole === 'WEB_FRONTEND' || task.projectRole === 'APP_FRONTEND',
  );
  const availableStartRoles = (project.data?.roleTeams ?? []).map(({ role }) => role);
  const startRoleOptions = START_ROLES.filter(
    (role) => availableStartRoles.includes(role) || startRoles.includes(role),
  );
  const handoffFlows = issue.handoffFlows ?? [];
  const taskById = new Map(childItems.map((task) => [task.id, task]));
  const orderedTaskIds = new Set(workflowRelations.map(({ blockedIssueId }) => blockedIssueId));
  const expectedRoles =
    backendInProgress && !hasFrontendTask && handoffFlows.length === 0
      ? (project.data?.roleTeams ?? []).map(({ role }) => role).filter((role) => role !== 'BACKEND')
      : [];
  const allTasksComplete =
    Boolean(issue.progress?.total) && issue.progress?.completed === issue.progress?.total;
  const startErrorMessage =
    start.isError && start.error instanceof ApiError
      ? (start.error.body.fieldErrors.initialRoles?.[0] ?? t('workflow.startErrorDescription'))
      : start.isError
        ? t('workflow.startErrorDescription')
        : null;

  function taskOrderLabel(task: IssueSummaryResponseDto): string | undefined {
    const incoming = workflowRelations.filter(({ blockedIssueId }) => blockedIssueId === task.id);
    const active = incoming.filter(({ resolved }) => !resolved);
    if (active.length === 1) {
      const blocker = taskById.get(active[0]!.blockingIssueId);
      if (blocker) return t('workflow.waitForTask', { identifier: blocker.identifier });
    }
    if (active.length > 0 || (task.blocked && incoming.length === 0)) {
      return t('workflow.waitForPredecessors');
    }
    if (incoming.length > 0) return t('workflow.available');
    return undefined;
  }

  function openStart() {
    setStartRoles([]);
    start.reset();
    setStartOpen(true);
  }

  function startFirstTasks() {
    if (start.isPending || startRoles.length === 0) return;
    start.mutate(
      { data: { initialRoles: startRoles }, issueId: issue.id },
      {
        onError: () => {
          void project.refetch();
          firstStartRoleRef.current?.focus();
        },
        onSuccess: (result: CreateIssueResponseDto) => {
          setStartOpen(false);
          const updatedIssue = result.issue;
          queryClient.setQueryData(getIssuesControllerGetQueryKey(issue.id), updatedIssue);
          queryClient.setQueryData(getIssuesControllerGetQueryKey(issue.identifier), updatedIssue);
          void Promise.allSettled([
            queryClient.invalidateQueries({ queryKey: getIssuesControllerListQueryKey() }),
            issue.project
              ? queryClient.invalidateQueries({
                  queryKey: getProjectsControllerGetQueryKey(issue.project.id),
                })
              : Promise.resolve(),
          ]);
        },
      },
    );
  }

  return (
    <>
      <div className="grid gap-8 py-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <TabsContent value="work" keepMounted className="data-[hidden]:hidden">
            <section aria-labelledby="current-work-summary-title">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="current-work-summary-title" className="text-base font-semibold">
                  {t('workSummary.title')}
                </h2>
                {issue.progress && issue.progress.total > 0 ? (
                  <span className="text-muted-foreground text-sm tabular-nums">
                    {t('workflow.progress', {
                      completed: issue.progress.completed,
                      percentage: issue.progress.percentage,
                      total: issue.progress.total,
                    })}
                  </span>
                ) : null}
              </div>
              {issue.progress && issue.progress.total > 0 ? (
                <Progress
                  value={issue.progress.percentage}
                  aria-label={t('workflow.progress', {
                    completed: issue.progress.completed,
                    percentage: issue.progress.percentage,
                    total: issue.progress.total,
                  })}
                  className="mt-3 w-full gap-1.5"
                >
                  <ProgressLabel className="sr-only">
                    {t('workflow.progress', {
                      completed: issue.progress.completed,
                      percentage: issue.progress.percentage,
                      total: issue.progress.total,
                    })}
                  </ProgressLabel>
                  <ProgressValue className="sr-only" />
                </Progress>
              ) : null}
              {allTasksComplete && issue.status.featureStatus !== 'DONE' ? (
                <Alert className="mt-4">
                  <Check aria-hidden="true" />
                  <AlertTitle>{t('workflow.allComplete')}</AlertTitle>
                  <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                    <span>{t('workflow.allCompleteDescription')}</span>
                    <Button
                      type="button"
                      size="sm"
                      disabled={mutation.isPending}
                      onClick={() =>
                        mutation.mutate({ change: { kind: 'featureStatus', value: 'DONE' }, issue })
                      }
                    >
                      {t('workflow.completeIssue')}
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : null}
              {children.isError ? (
                <Alert variant="destructive" className="mt-3">
                  <AlertTitle>{t('children.errorTitle')}</AlertTitle>
                  <AlertDescription>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void children.refetch()}
                    >
                      {t('retry')}
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : children.isPending ? (
                <p role="status" className="text-muted-foreground mt-4 text-sm">
                  {t('workflow.loading')}
                </p>
              ) : childItems.length === 0 ? (
                <ContentEmpty
                  icon={GitBranch}
                  headingLevel={3}
                  title={t('workflow.emptyTitle')}
                  description={t('workflow.emptyDescription')}
                >
                  <Button
                    type="button"
                    disabled={
                      project.isPending || project.isError || availableStartRoles.length === 0
                    }
                    onClick={openStart}
                  >
                    {t('workflow.start')}
                  </Button>
                </ContentEmpty>
              ) : (
                <div className="mt-4 space-y-4">
                  <p className="text-muted-foreground text-sm">
                    {t('workSummary.completed', {
                      completed: issue.progress?.completed ?? completedTasks.length,
                      total: issue.progress?.total ?? childItems.length,
                    })}
                  </p>
                  {currentTasks.length > 0 ? (
                    <ul className="flex flex-col gap-2">
                      {currentTasks.map((task) => (
                        <WorkflowTaskStep
                          key={task.id}
                          current
                          orderLabel={taskOrderLabel(task)}
                          ordered={false}
                          task={task}
                        />
                      ))}
                    </ul>
                  ) : null}
                  <Link
                    href={tabHref('relations', 'feature-progress-title')}
                    className={buttonVariants({ size: 'sm', variant: 'outline' })}
                  >
                    {t('workSummary.openRelations')}
                  </Link>
                </div>
              )}
            </section>
            <div className="mt-8">
              <IssueDescription issue={issue} mentionOptions={mentionOptions} mutation={mutation} />
            </div>
            <IssueAttachments issue={issue} />
            <IssueTimeline
              currentMembershipId={currentMembershipId}
              issueId={issue.id}
              issueIdentifier={issue.identifier}
              mentionOptions={mentionOptions}
              mode="comments"
            />
          </TabsContent>

          <TabsContent value="relations" keepMounted className="data-[hidden]:hidden">
            <section className="scroll-mt-6" aria-labelledby="feature-progress-title">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="feature-progress-title" className="text-base font-semibold">
                  {t('workflow.title')}
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  {issue.progress && issue.progress.total > 0 ? (
                    <span className="text-muted-foreground text-sm tabular-nums">
                      {t('workflow.progress', {
                        completed: issue.progress.completed,
                        percentage: issue.progress.percentage,
                        total: issue.progress.total,
                      })}
                    </span>
                  ) : null}
                  {projectId ? (
                    <Select
                      items={[{ label: t('workflow.addTask'), value: 'TEAM_TASK' }]}
                      value={null}
                      onValueChange={(value) => {
                        if (value === 'TEAM_TASK') {
                          router.push(
                            `/issues/${encodeURIComponent(issue.identifier)}?tab=relations&create=1&type=TEAM_TASK&projectId=${encodeURIComponent(projectId)}&parentIssueId=${encodeURIComponent(issue.id)}#feature-progress-title`,
                          );
                        }
                      }}
                    >
                      <SelectTrigger
                        size="sm"
                        variant="inline"
                        aria-label={t('workflow.moreActions')}
                        title={t('workflow.moreActions')}
                        className="min-w-11 justify-center p-0 [&_[data-slot=select-value]]:sr-only [&>svg:last-child]:hidden"
                      >
                        <MoreHorizontal aria-hidden="true" />
                        <SelectValue placeholder={t('workflow.moreActions')} />
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false}>
                        <SelectGroup>
                          <SelectItem
                            className="data-selected:bg-accent/60 min-h-11 lg:min-h-9"
                            value="TEAM_TASK"
                          >
                            {t('workflow.addTask')}
                          </SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  ) : null}
                </div>
              </div>
              {issue.progress && issue.progress.total > 0 ? (
                <Progress
                  value={issue.progress.percentage}
                  aria-label={t('workflow.progress', {
                    completed: issue.progress.completed,
                    percentage: issue.progress.percentage,
                    total: issue.progress.total,
                  })}
                  className="mt-3 w-full gap-1.5"
                >
                  <ProgressLabel className="sr-only">
                    {t('workflow.progress', {
                      completed: issue.progress.completed,
                      percentage: issue.progress.percentage,
                      total: issue.progress.total,
                    })}
                  </ProgressLabel>
                  <ProgressValue className="sr-only" />
                </Progress>
              ) : null}
              {children.isError ? (
                <Alert variant="destructive" className="mt-3">
                  <AlertTitle>{t('children.errorTitle')}</AlertTitle>
                  <AlertDescription>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void children.refetch()}
                    >
                      {t('retry')}
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : children.isPending ? (
                <p role="status" className="text-muted-foreground mt-4 text-sm">
                  {t('workflow.loading')}
                </p>
              ) : childItems.length === 0 ? (
                <ContentEmpty
                  icon={GitBranch}
                  headingLevel={3}
                  title={t('workflow.emptyTitle')}
                  description={t('workflow.emptyDescription')}
                >
                  <Button
                    type="button"
                    disabled={
                      project.isPending || project.isError || availableStartRoles.length === 0
                    }
                    onClick={openStart}
                  >
                    {t('workflow.start')}
                  </Button>
                </ContentEmpty>
              ) : (
                <div className="mt-5 flex flex-col gap-5">
                  {completedTasks.length > 0 ? (
                    <section aria-labelledby="workflow-completed-title">
                      <h3
                        id="workflow-completed-title"
                        className="text-muted-foreground mb-2 text-sm font-medium"
                      >
                        {t('workflow.completedWork')}
                      </h3>
                      <ul className="flex flex-col gap-2">
                        {completedTasks.map((task) => (
                          <WorkflowTaskStep
                            key={task.id}
                            current={false}
                            orderLabel={taskOrderLabel(task)}
                            ordered={orderedTaskIds.has(task.id)}
                            task={task}
                          />
                        ))}
                      </ul>
                    </section>
                  ) : null}

                  {handoffFlows.length > 0 ? (
                    <section aria-labelledby="workflow-handoffs-title">
                      <h3
                        id="workflow-handoffs-title"
                        className="text-muted-foreground mb-2 text-sm font-medium"
                      >
                        {t('workflow.handoffs')}
                      </h3>
                      <div className="flex flex-col gap-3">
                        {handoffFlows.map((flow) => {
                          const ordered = flow.downstreamIssues.some((downstream) =>
                            workflowRelations.some(
                              (relation) =>
                                relation.blockingIssueId === flow.sourceIssue.id &&
                                relation.blockedIssueId === downstream.id,
                            ),
                          );
                          return (
                            <div
                              key={flow.sourceIssue.id}
                              className={cn(
                                'flex flex-col gap-3',
                                ordered && 'border-border border-l pl-5',
                              )}
                            >
                              {flow.handoffs.map((handoff) => (
                                <IssueHandoffCard
                                  key={handoff.id}
                                  downstreamIssues={flow.downstreamIssues}
                                  handoff={handoff}
                                  headingLevel={4}
                                  sourceIssue={flow.sourceIssue}
                                />
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ) : null}

                  {currentTasks.length > 0 ? (
                    <section aria-labelledby="workflow-current-title">
                      <h3
                        id="workflow-current-title"
                        className="text-muted-foreground mb-2 text-sm font-medium"
                      >
                        {t('workflow.currentWork')}
                      </h3>
                      <ul className="flex flex-col gap-2">
                        {currentTasks.map((task) => (
                          <WorkflowTaskStep
                            key={task.id}
                            current
                            orderLabel={taskOrderLabel(task)}
                            ordered={orderedTaskIds.has(task.id)}
                            task={task}
                          />
                        ))}
                      </ul>
                    </section>
                  ) : null}

                  {expectedRoles.length > 0 ? (
                    <section aria-labelledby="workflow-expected-title">
                      <h3
                        id="workflow-expected-title"
                        className="text-muted-foreground mb-2 text-sm font-medium"
                      >
                        {t('workflow.expectedWork')}
                      </h3>
                      <ul className="flex flex-col gap-2">
                        {expectedRoles.map((role) => (
                          <li
                            key={role}
                            className="border-border text-muted-foreground relative border-l border-dashed pl-6"
                          >
                            <span
                              aria-hidden="true"
                              className="border-border bg-background absolute top-3 -left-2 size-4 rounded-full border border-dashed"
                            />
                            <div className="flex min-h-10 flex-wrap items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm">
                              <Badge variant="outline">{t(`projectRoles.${role}`)}</Badge>
                              <span>{t('workflow.expected')}</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                </div>
              )}
              {project.isError ? (
                <Alert variant="destructive" className="mt-4">
                  <AlertTitle>{t('workflow.projectErrorTitle')}</AlertTitle>
                  <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                    <span>{t('workflow.projectErrorDescription')}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void project.refetch()}
                    >
                      {t('retry')}
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : null}
            </section>
          </TabsContent>

          <TabsContent value="activity" keepMounted className="data-[hidden]:hidden">
            <IssueTimeline
              currentMembershipId={currentMembershipId}
              issueId={issue.id}
              issueIdentifier={issue.identifier}
              mentionOptions={mentionOptions}
              mode="activity"
            />
          </TabsContent>
        </div>

        <aside
          aria-labelledby="issue-properties-title"
          className="min-w-0 border-t pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6"
        >
          <h2 id="issue-properties-title" className="text-sm font-semibold">
            {t('properties')}
          </h2>
          <dl className="mt-3 grid gap-1">
            <PropertyRow label={t('state')}>
              <IssueInlineSelect
                appearance="comfortable"
                ariaLabel={`${t('state')}: ${t(`featureStatuses.${issue.status.featureStatus}`)}`}
                busy={mutation.isPending && mutation.variables?.change.kind === 'featureStatus'}
                disabled={mutation.isPending}
                value={issue.status.featureStatus}
                onValueChange={(value) => {
                  if (FEATURE_STATUSES.includes(value as (typeof FEATURE_STATUSES)[number])) {
                    mutation.mutate({
                      change: {
                        kind: 'featureStatus',
                        value: value as (typeof FEATURE_STATUSES)[number],
                      },
                      issue,
                    });
                  }
                }}
                options={FEATURE_STATUSES.map((status) => ({
                  ...FEATURE_STATUS_PRESENTATION[status],
                  label: t(`featureStatuses.${status}`),
                  value: status,
                }))}
                triggerClassName="min-w-36 max-w-full"
              />
            </PropertyRow>
            <PropertyRow label={t('priority')}>
              <PriorityEditor issue={issue} mutation={mutation} />
            </PropertyRow>
            <PropertyRow label={t('project')}>
              <span className="flex min-w-0 items-center gap-2 text-sm">
                <FolderKanban
                  aria-hidden="true"
                  className="text-muted-foreground size-4 shrink-0"
                />
                <span className="truncate">{issue.project?.name}</span>
              </span>
            </PropertyRow>
            <PropertyRow label={t('labels')}>
              <IssueLabels issue={issue} labelItems={labelItems} mutation={mutation} />
            </PropertyRow>
          </dl>
          <PropertyMutationError mutation={mutation} />
          <IssueInformation issue={issue} />
        </aside>
      </div>

      <Dialog
        open={startOpen}
        onOpenChange={(open) => {
          if (!start.isPending) setStartOpen(open);
        }}
      >
        <DialogContent closeLabel={t('workflow.startClose')}>
          <DialogHeader>
            <DialogTitle>{t('workflow.startTitle')}</DialogTitle>
            <DialogDescription>{t('workflow.startDialogDescription')}</DialogDescription>
          </DialogHeader>
          <FieldSet data-invalid={Boolean(startErrorMessage)}>
            <FieldLegend variant="label">{t('workflow.startRolesLabel')}</FieldLegend>
            <FieldDescription>{t('workflow.startRolesDescription')}</FieldDescription>
            <div className="grid gap-2 sm:grid-cols-3">
              {startRoleOptions.map((role) => {
                const checked = startRoles.includes(role);
                return (
                  <Field key={role} orientation="horizontal" className="rounded-lg border p-3">
                    <Checkbox
                      ref={role === startRoleOptions[0] ? firstStartRoleRef : undefined}
                      id={`issue-start-role-${role}`}
                      checked={checked}
                      aria-invalid={Boolean(startErrorMessage)}
                      aria-errormessage={startErrorMessage ? 'issue-start-roles-error' : undefined}
                      onCheckedChange={(nextChecked) => {
                        setStartRoles((current) =>
                          nextChecked
                            ? [...new Set([...current, role])]
                            : current.filter((value) => value !== role),
                        );
                      }}
                    />
                    <FieldLabel htmlFor={`issue-start-role-${role}`}>
                      <span>{t(`projectRoles.${role}`)}</span>
                      {checked ? (
                        <span className="text-muted-foreground text-xs">
                          {t('workflow.roleSelected')}
                        </span>
                      ) : null}
                    </FieldLabel>
                  </Field>
                );
              })}
            </div>
            <FieldError id="issue-start-roles-error">{startErrorMessage}</FieldError>
          </FieldSet>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setStartOpen(false)}>
              {t('cancel')}
            </Button>
            <Button
              type="button"
              disabled={startRoles.length === 0 || start.isPending}
              onClick={startFirstTasks}
            >
              {start.isPending ? <Spinner aria-hidden="true" data-icon="inline-start" /> : null}
              {t('workflow.start')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function IssueInformation({ issue }: { issue: IssueDetailResponseDto }) {
  const t = useTranslations('IssueDetail');
  return (
    <section aria-labelledby="issue-information-title" className="mt-4 border-t pt-4">
      <h3 id="issue-information-title" className="text-sm font-semibold">
        {t('information')}
      </h3>
      <dl className="mt-2 grid gap-0.5">
        <PropertyRow label={t('createdBy')}>
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <UserAvatar
              avatarFileId={issue.createdBy.user.avatarFileId}
              displayName={issue.createdBy.user.displayName}
              size="sm"
            />
            <span className="truncate">{issue.createdBy.user.displayName}</span>
          </span>
        </PropertyRow>
        <PropertyRow label={t('createdAt')}>
          <time dateTime={issue.createdAt} className="text-sm">
            {formatDate(issue.createdAt)}
          </time>
        </PropertyRow>
        <PropertyRow label={t('updatedAt')}>
          <time dateTime={issue.updatedAt} className="text-sm">
            {formatDate(issue.updatedAt)}
          </time>
        </PropertyRow>
      </dl>
    </section>
  );
}

function ReceivedHandoffSummary({
  flows,
  parentIssue,
  tabHref,
}: {
  flows: IssueHandoffFlowResponseDto[];
  parentIssue: IssueDetailResponseDto['parentIssue'];
  tabHref: (tab: DetailTab, anchor?: string) => string;
}) {
  const t = useTranslations('IssueDetail');
  const initialHandoffs = flows.flatMap((flow) => {
    const initial = flow.handoffs.find((handoff) => handoff.kind === 'INITIAL');
    return initial ? [{ flow, handoff: initial }] : [];
  });
  const followUpCount = flows.reduce(
    (count, flow) => count + flow.handoffs.filter((handoff) => handoff.kind === 'FOLLOW_UP').length,
    0,
  );

  return (
    <section aria-labelledby="received-handoff-title">
      <div className="flex items-center gap-2">
        <Send aria-hidden="true" className="text-muted-foreground size-4" />
        <h2 id="received-handoff-title" className="text-base font-semibold">
          {t('handoff.receivedTitle')}
        </h2>
      </div>
      <p className="text-muted-foreground mt-1 text-sm">{t('handoff.receivedDescription')}</p>
      <div className="mt-4 flex flex-col gap-4">
        {initialHandoffs.map(({ flow, handoff }) => (
          <IssueHandoffCard
            key={handoff.id}
            handoff={handoff}
            parentIssue={parentIssue}
            sourceIssue={flow.sourceIssue}
          />
        ))}
        {followUpCount > 0 ? (
          <div className="rounded-xl border px-3 py-2.5">
            <p className="text-sm font-medium">
              {t('handoff.followUpNotice', { count: followUpCount })}
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              {t('handoff.followUpHistoryDescription')}
            </p>
          </div>
        ) : null}
        <Link
          href={tabHref('relations', 'handoff-history')}
          className={buttonVariants({ size: 'sm', variant: 'outline' })}
        >
          {t('handoff.openHistory')}
        </Link>
      </div>
    </section>
  );
}

function TeamTaskIssueBody({
  currentMembershipId,
  issue,
  labelItems,
  mentionOptions,
  mutation,
  onReload,
  tabHref,
}: {
  currentMembershipId: string | null;
  issue: TeamTaskIssue<IssueDetailResponseDto>;
  labelItems: IssueLabelSummaryResponseDto[];
  mentionOptions: MentionOption[];
  mutation: DetailMutation;
  onReload: () => Promise<IssueDetailResponseDto | undefined>;
  tabHref: (tab: DetailTab, anchor?: string) => string;
}) {
  const t = useTranslations('IssueDetail');
  const markdownT = useTranslations('Markdown');
  const queryClient = useQueryClient();
  const router = useRouter();
  const states = useTeamsControllerListWorkflowStates(issue.team.id, { query: { retry: false } });
  const members = useMembersControllerList(
    { limit: 100, status: 'ACTIVE', teamId: issue.team.id },
    { query: { retry: false } },
  );
  const project = useProjectsControllerGet(issue.project?.id ?? '', {
    query: { enabled: Boolean(issue.project?.id), retry: false },
  });
  const createHandoff = useIssueCollaborationControllerCreateHandoff();
  const [handoffMode, setHandoffMode] = useState<'COMPLETE' | 'CREATE' | null>(null);
  const [completionState, setCompletionState] =
    useState<IssueWorkflowStateSummaryResponseDto | null>(null);
  const [handoffBody, setHandoffBody] = useState(HANDOFF_TEMPLATE);
  const [handoffCanSubmit, setHandoffCanSubmit] = useState(true);
  const [destinationRoles, setDestinationRoles] = useState<FrontendRole[]>([]);
  const [destinationError, setDestinationError] = useState(false);
  const stateItems = uniqueById([
    ...(states.data?.items ?? []),
    issue.status.workflowState,
  ]).toSorted((left, right) => left.position - right.position);
  const memberItems = uniqueById([
    ...(issue.assignee ? [issue.assignee] : []),
    ...(members.data?.items ?? []),
  ]);
  const frontendRoles = (project.data?.roleTeams ?? [])
    .map(({ role }) => role)
    .filter((role): role is FrontendRole => role !== 'BACKEND');
  const completionTarget = stateItems.find((state) => state.category === 'COMPLETED') ?? null;
  const needsInitialHandoff =
    issue.projectRole === 'BACKEND' &&
    issue.parentIssue !== null &&
    issue.handoffSummary?.hasInitial !== true &&
    frontendRoles.length > 0;
  const showBackendHandoff =
    issue.projectRole === 'BACKEND' &&
    (issue.handoffSummary?.hasInitial === true || needsInitialHandoff);
  const bodyError = handoffBodyError(handoffBody);
  const handoffMutationError = createHandoff.isError
    ? createHandoff.error
    : handoffMode === 'COMPLETE' && mutation.isError
      ? mutation.error
      : null;
  const handoffErrorCode =
    handoffMutationError instanceof ApiError ? handoffMutationError.body.code : null;
  const handoffFieldError =
    handoffErrorCode === 'MARKDOWN_INVALID'
      ? t('handoff.contentError')
      : handoffErrorCode === 'MENTION_INVALID'
        ? t('handoff.mentionError')
        : handoffErrorCode?.startsWith('FILE_')
          ? t('handoff.fileError')
          : null;
  const handoffSaveErrorDescription =
    handoffErrorCode === 'HANDOFF_REQUIRES_COMPLETION'
      ? t('handoff.completionRequiredError')
      : handoffErrorCode === 'PROJECT_FRONTEND_ROLE_REQUIRED'
        ? t('handoff.projectRoleError')
        : handoffErrorCode === 'DOWNSTREAM_TASK_SCOPE_CONFLICT'
          ? t('handoff.scopeConflictError')
          : handoffErrorCode === 'DOWNSTREAM_TASK_ALREADY_CLOSED'
            ? t('handoff.closedTaskError')
            : handoffErrorCode === 'ISSUE_VERSION_CONFLICT'
              ? t('handoff.versionConflictError')
              : t('handoff.saveErrorDescription');
  const handoffAffectedIssues =
    handoffErrorCode === 'DOWNSTREAM_TASK_SCOPE_CONFLICT' ||
    handoffErrorCode === 'DOWNSTREAM_TASK_ALREADY_CLOSED'
      ? affectedHandoffIssues(handoffMutationError)
      : [];
  const receivedHandoffFlows = issue.projectRole === 'BACKEND' ? [] : (issue.handoffFlows ?? []);
  const activeBlockers = issue.blockers.filter(({ resolved }) => !resolved);
  const waitingMessage =
    activeBlockers.length === 1
      ? t('workflow.waitForTask', { identifier: activeBlockers[0]!.issue.identifier })
      : activeBlockers.length > 1 || issue.blocked
        ? t('workflow.waitForPredecessors')
        : null;

  function openHandoff(mode: 'COMPLETE' | 'CREATE', state?: IssueWorkflowStateSummaryResponseDto) {
    setCompletionState(state ?? null);
    setHandoffBody(HANDOFF_TEMPLATE);
    setHandoffCanSubmit(true);
    setDestinationRoles(mode === 'COMPLETE' ? frontendRoles : []);
    setDestinationError(false);
    createHandoff.reset();
    mutation.reset();
    setHandoffMode(mode);
  }

  function changeState(state: IssueWorkflowStateSummaryResponseDto) {
    if (state.id === issue.status.workflowState.id || mutation.isPending) return;
    if (
      state.category === 'COMPLETED' &&
      issue.projectRole === 'BACKEND' &&
      issue.parentIssue !== null &&
      issue.handoffSummary?.hasInitial !== true &&
      project.isPending
    ) {
      return;
    }
    if (state.category === 'COMPLETED' && needsInitialHandoff) {
      openHandoff('COMPLETE', state);
      return;
    }

    mutation.mutate(
      { change: { kind: 'workflowState', value: state }, issue },
      {
        onError: (error) => {
          if (error instanceof ApiError && error.body.code === 'HANDOFF_REQUIRED') {
            openHandoff('COMPLETE', state);
          }
        },
      },
    );
  }

  async function refreshHandoffs(extraIssues: Array<{ id: string; identifier: string }> = []) {
    const detailRefs = new Set([issue.id, issue.identifier]);
    for (const relatedIssue of [
      ...(issue.parentIssue ? [issue.parentIssue] : []),
      ...issue.blocking.map((relation) => relation.issue),
      ...(issue.handoffFlows ?? []).flatMap((flow) => flow.downstreamIssues),
      ...extraIssues,
    ]) {
      detailRefs.add(relatedIssue.id);
      detailRefs.add(relatedIssue.identifier);
    }

    await Promise.allSettled([
      ...[...detailRefs].map((issueRef) =>
        queryClient.invalidateQueries({ queryKey: getIssuesControllerGetQueryKey(issueRef) }),
      ),
      queryClient.invalidateQueries({ queryKey: getIssuesControllerListQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getProjectsControllerListQueryKey() }),
      queryClient.invalidateQueries({
        queryKey: getIssueCollaborationControllerTimelineQueryKey(issue.id),
      }),
      issue.project
        ? queryClient.invalidateQueries({
            queryKey: getProjectsControllerGetQueryKey(issue.project.id),
          })
        : Promise.resolve(),
    ]);
  }

  function focusFirstDestination() {
    const firstRole = frontendRoles[0];
    if (firstRole) document.getElementById(`handoff-destination-${firstRole}`)?.focus();
  }

  function submitHandoff() {
    if (bodyError || !handoffCanSubmit) return;

    if (handoffMode === 'COMPLETE' && completionState) {
      if (destinationRoles.length === 0) {
        setDestinationError(true);
        requestAnimationFrame(focusFirstDestination);
        return;
      }
      setDestinationError(false);
      mutation.mutate(
        {
          change: {
            handoff: { bodyMarkdown: handoffBody, destinationRoles },
            kind: 'workflowState',
            value: completionState,
          },
          issue,
        },
        {
          onError: (error) => {
            if (!(error instanceof ApiError)) return;
            if (error.body.code === 'HANDOFF_DESTINATION_REQUIRED') {
              setDestinationError(true);
              requestAnimationFrame(focusFirstDestination);
            }
            if (error.body.code === 'PROJECT_FRONTEND_ROLE_REQUIRED') {
              void project.refetch().then(({ data }) => {
                setDestinationRoles(
                  (data?.roleTeams ?? [])
                    .map(({ role }) => role)
                    .filter((role): role is FrontendRole => role !== 'BACKEND'),
                );
              });
            }
            if (error.body.code === 'HANDOFF_REQUIRES_COMPLETION') {
              void Promise.allSettled([states.refetch(), project.refetch()]);
              void onReload();
            }
            if (error.body.code === 'ISSUE_VERSION_CONFLICT') {
              void Promise.allSettled([states.refetch(), project.refetch()]);
              void onReload().then((latest) => {
                if (
                  latest?.type !== 'TEAM_TASK' ||
                  latest.status.category !== 'COMPLETED' ||
                  latest.handoffSummary?.hasInitial !== true
                ) {
                  return;
                }

                setHandoffMode(null);
                void refreshHandoffs();
                const parent = latest.parentIssue ?? issue.parentIssue;
                if (parent) {
                  router.push(
                    `/issues/${encodeURIComponent(parent.identifier)}?tab=relations#feature-progress-title`,
                  );
                }
              });
            }
          },
          onSuccess: (response: UpdateIssueResponseDto) => {
            setHandoffMode(null);
            const parent = response.updatedParentIssue ?? issue.parentIssue;
            void refreshHandoffs([
              ...(parent ? [parent] : []),
              ...(response.downstreamTeamTasks ?? []),
            ]);
            if (parent) {
              router.push(
                `/issues/${encodeURIComponent(parent.identifier)}?tab=relations#feature-progress-title`,
              );
            }
          },
        },
      );
      return;
    }

    createHandoff.mutate(
      {
        data: {
          bodyMarkdown: handoffBody,
          kind: issue.handoffSummary?.hasInitial ? 'FOLLOW_UP' : 'INITIAL',
        },
        issueId: issue.id,
      },
      {
        onSuccess: () => {
          setHandoffMode(null);
          void refreshHandoffs().catch(() => undefined);
        },
      },
    );
  }

  const optionsError = states.isError || members.isError || project.isError;

  return (
    <>
      <div className="grid gap-8 py-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <TabsContent value="work" keepMounted className="data-[hidden]:hidden">
            {waitingMessage ? (
              <Alert>
                <CircleDot aria-hidden="true" />
                <AlertTitle>{waitingMessage}</AlertTitle>
                <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                  <span>{t('workSummary.waitingDescription')}</span>
                  <Link
                    href={tabHref('relations', 'issue-relations-title')}
                    className={buttonVariants({ size: 'sm', variant: 'outline' })}
                  >
                    {t('workSummary.openOrder')}
                  </Link>
                </AlertDescription>
              </Alert>
            ) : null}

            {receivedHandoffFlows.length > 0 ? (
              <div className={waitingMessage ? 'mt-6' : undefined}>
                <ReceivedHandoffSummary
                  flows={receivedHandoffFlows}
                  parentIssue={issue.parentIssue}
                  tabHref={tabHref}
                />
              </div>
            ) : null}

            {showBackendHandoff ? (
              <section
                aria-labelledby="issue-handoff-title"
                className={waitingMessage ? 'mt-6' : undefined}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Send aria-hidden="true" className="text-muted-foreground size-4" />
                  <h2 id="issue-handoff-title" className="text-base font-semibold">
                    {t('handoff.title')}
                  </h2>
                  <Badge variant="secondary">
                    {t('handoff.count', { count: issue.handoffSummary?.count ?? 0 })}
                  </Badge>
                  {issue.handoffSummary?.hasInitial || needsInitialHandoff ? (
                    <Button
                      type="button"
                      size="sm"
                      variant={issue.handoffSummary?.hasInitial ? 'outline' : 'default'}
                      className="ml-auto hidden lg:inline-flex"
                      disabled={
                        mutation.isPending ||
                        states.isPending ||
                        project.isPending ||
                        (!issue.handoffSummary?.hasInitial && !completionTarget)
                      }
                      onClick={() => {
                        if (issue.handoffSummary?.hasInitial) openHandoff('CREATE');
                        else if (completionTarget) openHandoff('COMPLETE', completionTarget);
                      }}
                    >
                      {issue.handoffSummary?.hasInitial
                        ? t('handoff.addFollowUp')
                        : t('handoff.submitAndComplete')}
                    </Button>
                  ) : null}
                </div>
                <p className="text-muted-foreground mt-1 text-sm">{t('handoff.description')}</p>
                <p className="text-muted-foreground mt-2 text-sm lg:hidden">
                  {t('handoff.mobileWrite')}
                </p>
                {issue.handoffSummary?.hasInitial ? (
                  <>
                    <IssueTimeline
                      currentMembershipId={currentMembershipId}
                      issueId={issue.id}
                      issueIdentifier={issue.identifier}
                      mentionOptions={mentionOptions}
                      mode="latest-handoff"
                    />
                    <Link
                      href={tabHref('relations', 'handoff-history')}
                      className={buttonVariants({ size: 'sm', variant: 'outline' })}
                    >
                      {t('handoff.openHistory')}
                    </Link>
                  </>
                ) : null}
              </section>
            ) : null}

            <div
              className={
                waitingMessage || receivedHandoffFlows.length > 0 || showBackendHandoff
                  ? 'mt-8'
                  : undefined
              }
            >
              <IssueDescription issue={issue} mentionOptions={mentionOptions} mutation={mutation} />
            </div>
            <IssueAttachments issue={issue} />
            <IssueTimeline
              currentMembershipId={currentMembershipId}
              issueId={issue.id}
              issueIdentifier={issue.identifier}
              mentionOptions={mentionOptions}
              mode="comments"
            />
          </TabsContent>

          <TabsContent value="relations" keepMounted className="data-[hidden]:hidden">
            {issue.parentIssue || issue.project || issue.projectRole ? (
              <section aria-labelledby="parent-feature-title">
                <h2 id="parent-feature-title" className="text-base font-semibold">
                  {t('relations.contextTitle')}
                </h2>
                <dl className="mt-3 divide-y border-y text-sm">
                  {issue.parentIssue ? (
                    <div className="grid gap-1 py-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3">
                      <dt className="text-muted-foreground">{t('parentFeature')}</dt>
                      <dd className="min-w-0">
                        <Link
                          href={`/issues/${encodeURIComponent(issue.parentIssue.identifier)}?tab=relations`}
                          className="block truncate font-medium underline-offset-4 hover:underline"
                        >
                          {issue.parentIssue.identifier} · {issue.parentIssue.title}
                        </Link>
                      </dd>
                    </div>
                  ) : null}
                  {issue.project ? (
                    <div className="grid gap-1 py-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3">
                      <dt className="text-muted-foreground">{t('project')}</dt>
                      <dd className="font-medium">{issue.project.name}</dd>
                    </div>
                  ) : null}
                  {issue.projectRole ? (
                    <div className="grid gap-1 py-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3">
                      <dt className="text-muted-foreground">{t('projectRole')}</dt>
                      <dd>
                        <Badge variant="secondary">{t(`projectRoles.${issue.projectRole}`)}</Badge>
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </section>
            ) : null}

            <IssueRelations issue={issue} t={(key) => t(key as never)} />

            {receivedHandoffFlows.length > 0 ? (
              <section
                id="handoff-history"
                className="mt-8 scroll-mt-20"
                aria-labelledby="handoff-history-title"
              >
                <div className="flex items-center gap-2">
                  <Send aria-hidden="true" className="text-muted-foreground size-4" />
                  <h2 id="handoff-history-title" className="text-base font-semibold">
                    {t('handoff.historyTitle')}
                  </h2>
                </div>
                <div className="mt-4 flex flex-col gap-4">
                  {receivedHandoffFlows.map((flow) => (
                    <div key={flow.sourceIssue.id} className="flex flex-col gap-3">
                      {flow.handoffs.map((handoff) => (
                        <IssueHandoffCard
                          key={handoff.id}
                          anchor={false}
                          handoff={handoff}
                          parentIssue={issue.parentIssue}
                          sourceIssue={flow.sourceIssue}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </section>
            ) : issue.projectRole === 'BACKEND' && issue.handoffSummary?.hasInitial ? (
              <IssueTimeline
                currentMembershipId={currentMembershipId}
                issueId={issue.id}
                issueIdentifier={issue.identifier}
                mentionOptions={mentionOptions}
                mode="handoffs"
              />
            ) : null}
          </TabsContent>

          <TabsContent value="activity" keepMounted className="data-[hidden]:hidden">
            <IssueTimeline
              currentMembershipId={currentMembershipId}
              issueId={issue.id}
              issueIdentifier={issue.identifier}
              mentionOptions={mentionOptions}
              mode="activity"
            />
          </TabsContent>
        </div>

        <aside
          aria-labelledby="issue-properties-title"
          className="min-w-0 border-t pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6"
        >
          <h2 id="issue-properties-title" className="text-sm font-semibold">
            {t('properties')}
          </h2>
          {optionsError ? (
            <Alert variant="destructive" className="mt-3">
              <AlertTitle>{t('optionsErrorTitle')}</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>{t('optionsErrorDescription')}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (states.isError) void states.refetch();
                    if (members.isError) void members.refetch();
                    if (project.isError) void project.refetch();
                  }}
                >
                  {t('retry')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          <dl className="mt-3 grid gap-1">
            <PropertyRow label={t('state')}>
              <IssueInlineSelect
                appearance="comfortable"
                ariaLabel={`${t('state')}: ${issue.status.workflowState.name}`}
                busy={mutation.isPending && mutation.variables?.change.kind === 'workflowState'}
                disabled={
                  states.isPending ||
                  mutation.isPending ||
                  (issue.projectRole === 'BACKEND' &&
                    issue.parentIssue !== null &&
                    issue.handoffSummary?.hasInitial !== true &&
                    project.isPending)
                }
                value={issue.status.workflowState.id}
                onValueChange={(value) => {
                  const state = stateItems.find((item) => item.id === value);
                  if (state) changeState(state);
                }}
                options={stateItems.map((state) => ({
                  ...WORKFLOW_STATE_PRESENTATION[state.category],
                  label: state.name,
                  value: state.id,
                }))}
                triggerClassName="min-w-36 max-w-full"
              />
            </PropertyRow>
            <PropertyRow label={t('assignee')}>
              <IssueInlineSelect
                appearance="comfortable"
                ariaLabel={`${t('assignee')}: ${issue.assignee?.user.displayName ?? t('unassigned')}`}
                busy={mutation.isPending && mutation.variables?.change.kind === 'assignee'}
                disabled={members.isPending || mutation.isPending}
                options={[
                  {
                    icon: UserRound,
                    iconClassName: 'text-muted-foreground',
                    label: t('unassigned'),
                    value: 'unassigned',
                  },
                  ...memberItems.map((member) => ({
                    icon: UserRound,
                    iconClassName: 'text-muted-foreground',
                    label: member.user.displayName,
                    value: member.id,
                  })),
                ]}
                onValueChange={(value) => {
                  const assignee =
                    value === 'unassigned'
                      ? null
                      : (memberItems.find((item) => item.id === value) ?? null);
                  mutation.mutate({ change: { kind: 'assignee', value: assignee }, issue });
                }}
                triggerClassName="min-w-36 max-w-full"
                value={issue.assignee?.id ?? 'unassigned'}
              />
            </PropertyRow>
            <PropertyRow label={t('priority')}>
              <PriorityEditor issue={issue} mutation={mutation} />
            </PropertyRow>
            <PropertyRow label={t('team')}>
              <span className="block truncate text-sm">
                {issue.team.name} ({issue.team.key})
              </span>
            </PropertyRow>
            {issue.project ? (
              <PropertyRow label={t('project')}>
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <FolderKanban
                    aria-hidden="true"
                    className="text-muted-foreground size-4 shrink-0"
                  />
                  <span className="truncate">{issue.project.name}</span>
                </span>
              </PropertyRow>
            ) : null}
            {issue.projectRole ? (
              <PropertyRow label={t('projectRole')}>
                <Badge variant="secondary">{t(`projectRoles.${issue.projectRole}`)}</Badge>
              </PropertyRow>
            ) : null}
            <PropertyRow label={t('labels')}>
              <IssueLabels issue={issue} labelItems={labelItems} mutation={mutation} />
            </PropertyRow>
          </dl>
          <PropertyMutationError mutation={mutation} />
          <IssueInformation issue={issue} />
        </aside>
      </div>

      <Dialog open={handoffMode !== null} onOpenChange={(open) => !open && setHandoffMode(null)}>
        <DialogContent className="sm:max-w-2xl" closeLabel={t('handoff.close')}>
          <DialogHeader>
            <DialogTitle>
              {handoffMode === 'COMPLETE'
                ? t('handoff.completeTitle')
                : issue.handoffSummary?.hasInitial
                  ? t('handoff.followUpTitle')
                  : t('handoff.initialTitle')}
            </DialogTitle>
            <DialogDescription>
              {handoffMode === 'COMPLETE'
                ? t('handoff.completeDescription')
                : t('handoff.editorDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="hidden lg:block">
            <p className="text-sm font-medium">{t('handoff.bodyLabel')}</p>
            <MarkdownEditor
              charLimit={50_000}
              className="mt-2"
              disabled={createHandoff.isPending || mutation.isPending}
              error={handoffFieldError}
              labels={markdownEditorLabels(
                (key) => markdownT(key as never),
                (key) => String(markdownT.raw(key as never)),
              )}
              mentionsEnabled={false}
              status={createHandoff.isPending || mutation.isPending ? t('handoff.saving') : null}
              value={handoffBody}
              onCanSubmitChange={setHandoffCanSubmit}
              onChange={setHandoffBody}
            />
            {handoffMode === 'COMPLETE' ? (
              <FieldSet className="mt-4" data-invalid={destinationError}>
                <FieldLegend variant="label">{t('handoff.destinationLabel')}</FieldLegend>
                <FieldDescription>{t('handoff.destinationDescription')}</FieldDescription>
                <div className="grid gap-2 sm:grid-cols-2">
                  {frontendRoles.map((role) => {
                    const checked = destinationRoles.includes(role);
                    const disabled = frontendRoles.length === 1;
                    return (
                      <Field
                        key={role}
                        orientation="horizontal"
                        data-disabled={disabled}
                        className="rounded-lg border p-3"
                      >
                        <Checkbox
                          id={`handoff-destination-${role}`}
                          checked={checked}
                          disabled={disabled}
                          aria-invalid={destinationError}
                          aria-errormessage={
                            destinationError ? 'handoff-destination-error' : undefined
                          }
                          onCheckedChange={(nextChecked) => {
                            setDestinationError(false);
                            setDestinationRoles((current) =>
                              nextChecked
                                ? [...new Set([...current, role])]
                                : current.filter((value) => value !== role),
                            );
                          }}
                        />
                        <FieldLabel htmlFor={`handoff-destination-${role}`}>
                          {t(`projectRoles.${role}`)}
                        </FieldLabel>
                      </Field>
                    );
                  })}
                </div>
                <FieldError id="handoff-destination-error">
                  {destinationError ? t('handoff.destinationRequired') : null}
                </FieldError>
              </FieldSet>
            ) : null}
            {bodyError ? (
              <p className="text-destructive mt-2 text-sm">
                {bodyError === 'link' ? t('handoff.linkError') : t('handoff.contentError')}
              </p>
            ) : null}
            {handoffMutationError && !handoffFieldError ? (
              <Alert variant="destructive" className="mt-3">
                <AlertTitle>{t('handoff.saveErrorTitle')}</AlertTitle>
                <AlertDescription>
                  <p>{handoffSaveErrorDescription}</p>
                  {handoffAffectedIssues.length > 0 ? (
                    <ul className="mt-2 flex flex-col gap-1">
                      {handoffAffectedIssues.map((affectedIssue) => (
                        <li key={affectedIssue.identifier}>
                          <Link href={`/issues/${encodeURIComponent(affectedIssue.identifier)}`}>
                            {affectedIssue.identifier} · {affectedIssue.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
          <p className="text-muted-foreground py-6 text-sm lg:hidden">{t('handoff.mobileWrite')}</p>
          <DialogFooter className="hidden lg:flex">
            <Button type="button" variant="outline" onClick={() => setHandoffMode(null)}>
              {t('cancel')}
            </Button>
            <Button
              type="button"
              disabled={
                Boolean(bodyError) ||
                !handoffCanSubmit ||
                createHandoff.isPending ||
                mutation.isPending
              }
              onClick={submitHandoff}
            >
              {handoffMode === 'COMPLETE' ? t('handoff.submitAndComplete') : t('handoff.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
