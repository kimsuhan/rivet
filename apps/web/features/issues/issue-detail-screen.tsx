'use client';

import { useQueryClient } from '@tanstack/react-query';
import { FileQuestion, GitBranch, RotateCcw, Send, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';

import {
  ApiError,
  getIssueCollaborationControllerTimelineQueryKey,
  getIssuesControllerGetQueryKey,
  getIssuesControllerListQueryKey,
  getProjectsControllerGetQueryKey,
  getProjectsControllerListQueryKey,
  getSearchControllerIssuesQueryKey,
  getTrashControllerListQueryKey,
  type IssueDetailResponseDto,
  type IssueLabelSummaryResponseDto,
  type IssueWorkflowStateSummaryResponseDto,
  useAuthControllerGetSession,
  useIssueCollaborationControllerCreateHandoff,
  useIssuesControllerGet,
  useIssuesControllerList,
  useIssuesControllerTrash,
  useLabelsControllerList,
  useMembersControllerList,
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
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { UserAvatar } from '@/components/user-avatar';
import { MarkdownEditor, type MentionOption } from '@/features/collaboration/markdown-editor';
import { Link, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

import { IssueAttachments } from './issue-attachments';
import { markdownEditorLabels } from './issue-collaboration-labels';
import { IssueDescription } from './issue-description';
import { HANDOFF_TEMPLATE, handoffBodyError } from './issue-handoff-validation';
import { useIssueInlineMutation } from './issue-mutations';
import { IssueRelations } from './issue-relations';
import { IssueTimeline } from './issue-timeline';
import {
  type FeatureIssue,
  isFeatureIssue,
  isTeamTaskIssue,
  type TeamTaskIssue,
} from './issue-types';

const PRIORITIES = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
const FEATURE_STATUSES = [
  'UNSORTED',
  'TODO',
  'IN_PROGRESS',
  'REVIEW',
  'DONE',
  'PAUSED',
  'CANCELED',
] as const;

type DetailMutation = ReturnType<typeof useIssueInlineMutation>;

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function PropertyRow({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="grid min-h-10 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
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

  return <IssueDetailContent issue={issue.data} onReload={() => void issue.refetch()} />;
}

function IssueDetailContent({
  issue,
  onReload,
}: {
  issue: FeatureIssue<IssueDetailResponseDto> | TeamTaskIssue<IssueDetailResponseDto>;
  onReload: () => void;
}) {
  const t = useTranslations('IssueDetail');
  const queryClient = useQueryClient();
  const router = useRouter();
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
          if (code === 'VERSION_CONFLICT') onReload();
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
          <Badge variant="secondary">
            {issue.type === 'FEATURE' ? t('feature') : t('teamTask')}
          </Badge>
          {issue.blocked ? <Badge variant="outline">{t('blocked')}</Badge> : null}
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

        <form className="mt-3 flex max-w-4xl items-start gap-2" onSubmit={submitTitle} noValidate>
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
                    ? '#feature-progress-title'
                    : '#issue-relations-title'
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
      mutationErrorCode !== 'HANDOFF_REQUIRES_COMPLETION' &&
      mutation.variables?.change.kind !== 'description' ? (
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

      {issue.type === 'FEATURE' ? (
        <FeatureIssueBody
          currentMembershipId={currentMembershipId}
          issue={issue}
          labelItems={labelItems}
          mentionOptions={mentionOptions}
          mutation={mutation}
        />
      ) : (
        <TeamTaskIssueBody
          currentMembershipId={currentMembershipId}
          issue={issue}
          labelItems={labelItems}
          mentionOptions={mentionOptions}
          mutation={mutation}
        />
      )}

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

  return (
    <details className="group/labels relative">
      <summary
        aria-label={t('labels')}
        className={cn(
          'border-input hover:bg-muted focus-visible:border-ring focus-visible:ring-ring/50 flex min-h-8 cursor-pointer list-none items-center rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-2 [&::-webkit-details-marker]:hidden',
          mutation.isPending && 'pointer-events-none opacity-50',
        )}
      >
        <span className="truncate">
          {issue.labels.map((label) => label.name).join(', ') || t('noLabels')}
        </span>
      </summary>
      <div className="bg-popover absolute right-0 z-20 mt-1 max-h-64 w-64 overflow-y-auto rounded-lg border p-2 shadow-md">
        {labelItems.map((label) => {
          const checked = issue.labels.some((selected) => selected.id === label.id);
          const disabled = label.archived && !checked;
          return (
            <label
              key={label.id}
              className={cn(
                'hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                disabled && 'text-muted-foreground cursor-not-allowed opacity-60',
              )}
            >
              <Checkbox
                checked={checked}
                disabled={disabled}
                aria-disabled={disabled}
                onCheckedChange={(nextChecked) =>
                  mutation.mutate({
                    change: {
                      kind: 'labels',
                      value: nextChecked
                        ? [...issue.labels, label]
                        : issue.labels.filter((item) => item.id !== label.id),
                    },
                    issue,
                  })
                }
              />
              <span className="size-2 rounded-full" style={{ backgroundColor: label.color }} />
              <span className="min-w-0 flex-1 truncate">{label.name}</span>
              {label.archived ? (
                <span className="text-muted-foreground text-xs">{t('archived')}</span>
              ) : null}
            </label>
          );
        })}
      </div>
    </details>
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
  return (
    <Select
      items={PRIORITIES.map((priority) => ({
        label: t(`priorities.${priority}`),
        value: priority,
      }))}
      value={issue.priority}
      onValueChange={(value) => {
        if (value && PRIORITIES.includes(value as (typeof PRIORITIES)[number])) {
          mutation.mutate({
            change: { kind: 'priority', value: value as (typeof PRIORITIES)[number] },
            issue,
          });
        }
      }}
    >
      <SelectTrigger aria-label={t('priority')} className="w-full" disabled={mutation.isPending}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        <SelectGroup>
          {PRIORITIES.map((priority) => (
            <SelectItem key={priority} value={priority}>
              {t(`priorities.${priority}`)}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function FeatureIssueBody({
  currentMembershipId,
  issue,
  labelItems,
  mentionOptions,
  mutation,
}: {
  currentMembershipId: string | null;
  issue: FeatureIssue<IssueDetailResponseDto>;
  labelItems: IssueLabelSummaryResponseDto[];
  mentionOptions: MentionOption[];
  mutation: DetailMutation;
}) {
  const t = useTranslations('IssueDetail');
  const children = useIssuesControllerList(
    { limit: 100, parentIssueId: issue.id, type: 'TEAM_TASK' },
    { query: { retry: false } },
  );

  return (
    <div className="grid gap-8 py-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0">
        <IssueDescription issue={issue} mentionOptions={mentionOptions} mutation={mutation} />
        <IssueAttachments issue={issue} />
        <IssueOverview issue={issue} />
        <section className="mt-8" aria-labelledby="feature-progress-title">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="feature-progress-title" className="text-base font-semibold">
              {t('children.title')}
            </h2>
            <span className="text-muted-foreground text-sm">
              {issue.progress
                ? t('children.progress', {
                    completed: issue.progress.completed,
                    percentage: issue.progress.percentage,
                    total: issue.progress.total,
                  })
                : t('children.progress', { completed: 0, percentage: 0, total: 0 })}
            </span>
          </div>
          <div className="bg-surface-2 mt-3 h-2 overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full"
              style={{ width: `${issue.progress?.percentage ?? 0}%` }}
            />
          </div>
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
          ) : (children.data?.items.length ?? 0) === 0 ? (
            <p className="text-muted-foreground mt-3 border-y py-4 text-sm">
              {t('children.empty')}
            </p>
          ) : (
            <ul className="mt-3 divide-y border-y">
              {children.data?.items.map((child) => (
                <li key={child.id} className="flex min-w-0 flex-wrap items-center gap-2 py-3">
                  <Link
                    href={`/issues/${encodeURIComponent(child.identifier)}`}
                    className="min-w-0 flex-1 truncate text-sm font-medium underline-offset-4 hover:underline"
                  >
                    {child.identifier} · {child.title}
                  </Link>
                  {child.projectRole ? (
                    <Badge variant="secondary">{child.projectRole}</Badge>
                  ) : null}
                  {child.blocked ? <Badge variant="outline">{t('blocked')}</Badge> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
        <IssueTimeline
          currentMembershipId={currentMembershipId}
          issueId={issue.id}
          mentionOptions={mentionOptions}
        />
      </div>

      <aside aria-labelledby="issue-properties-title" className="min-w-0 lg:border-l lg:pl-6">
        <h2 id="issue-properties-title" className="text-sm font-semibold">
          {t('properties')}
        </h2>
        <dl className="mt-3 space-y-1">
          <PropertyRow label={t('state')}>
            <Select
              items={FEATURE_STATUSES.map((status) => ({
                label: t(`featureStatuses.${status}`),
                value: status,
              }))}
              value={issue.status.featureStatus}
              onValueChange={(value) => {
                if (
                  value &&
                  FEATURE_STATUSES.includes(value as (typeof FEATURE_STATUSES)[number])
                ) {
                  mutation.mutate({
                    change: {
                      kind: 'featureStatus',
                      value: value as (typeof FEATURE_STATUSES)[number],
                    },
                    issue,
                  });
                }
              }}
            >
              <SelectTrigger
                aria-label={t('state')}
                className="w-full"
                disabled={mutation.isPending}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {FEATURE_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {t(`featureStatuses.${status}`)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </PropertyRow>
          <PropertyRow label={t('priority')}>
            <PriorityEditor issue={issue} mutation={mutation} />
          </PropertyRow>
          <PropertyRow label={t('project')}>
            <span className="block truncate text-sm font-medium">{issue.project?.name}</span>
          </PropertyRow>
          <PropertyRow label={t('labels')}>
            <IssueLabels issue={issue} labelItems={labelItems} mutation={mutation} />
          </PropertyRow>
        </dl>
      </aside>
    </div>
  );
}

function IssueOverview({ issue }: { issue: IssueDetailResponseDto }) {
  const t = useTranslations('IssueDetail');
  return (
    <section aria-labelledby="issue-overview-title" className="mt-8">
      <h2 id="issue-overview-title" className="text-base font-semibold">
        {t('overview')}
      </h2>
      <dl className="mt-4 grid gap-3 border-y py-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">{t('createdBy')}</dt>
          <dd className="mt-1 flex items-center gap-2 font-medium">
            <UserAvatar
              avatarFileId={issue.createdBy.user.avatarFileId}
              displayName={issue.createdBy.user.displayName}
              size="sm"
            />
            <span>{issue.createdBy.user.displayName}</span>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('createdAt')}</dt>
          <dd className="mt-1 font-medium">{formatDate(issue.createdAt)}</dd>
        </div>
      </dl>
    </section>
  );
}

function TeamTaskIssueBody({
  currentMembershipId,
  issue,
  labelItems,
  mentionOptions,
  mutation,
}: {
  currentMembershipId: string | null;
  issue: TeamTaskIssue<IssueDetailResponseDto>;
  labelItems: IssueLabelSummaryResponseDto[];
  mentionOptions: MentionOption[];
  mutation: DetailMutation;
}) {
  const t = useTranslations('IssueDetail');
  const markdownT = useTranslations('Markdown');
  const queryClient = useQueryClient();
  const states = useTeamsControllerListWorkflowStates(issue.team.id, { query: { retry: false } });
  const members = useMembersControllerList(
    { limit: 100, status: 'ACTIVE', teamId: issue.team.id },
    { query: { retry: false } },
  );
  const createHandoff = useIssueCollaborationControllerCreateHandoff();
  const [handoffMode, setHandoffMode] = useState<'COMPLETE' | 'CREATE' | null>(null);
  const [completionState, setCompletionState] =
    useState<IssueWorkflowStateSummaryResponseDto | null>(null);
  const [handoffBody, setHandoffBody] = useState(HANDOFF_TEMPLATE);
  const [handoffCanSubmit, setHandoffCanSubmit] = useState(true);
  const stateItems = uniqueById([issue.status.workflowState, ...(states.data?.items ?? [])]);
  const memberItems = uniqueById([
    ...(issue.assignee ? [issue.assignee] : []),
    ...(members.data?.items ?? []),
  ]);
  const needsInitialHandoff =
    issue.projectRole === 'BACKEND' &&
    issue.handoffSummary?.hasInitial !== true &&
    issue.blocking.some(
      ({ issue: downstream, resolved }) =>
        !resolved &&
        (downstream.projectRole === 'WEB_FRONTEND' || downstream.projectRole === 'APP_FRONTEND'),
    );
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
      : t('handoff.saveErrorDescription');

  function openHandoff(mode: 'COMPLETE' | 'CREATE', state?: IssueWorkflowStateSummaryResponseDto) {
    setCompletionState(state ?? null);
    setHandoffBody(HANDOFF_TEMPLATE);
    setHandoffCanSubmit(true);
    createHandoff.reset();
    mutation.reset();
    setHandoffMode(mode);
  }

  function changeState(state: IssueWorkflowStateSummaryResponseDto) {
    if (state.id === issue.status.workflowState.id || mutation.isPending) return;
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

  async function refreshHandoffs() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getIssuesControllerGetQueryKey(issue.id) }),
      queryClient.invalidateQueries({ queryKey: getIssuesControllerGetQueryKey(issue.identifier) }),
      queryClient.invalidateQueries({
        queryKey: getIssueCollaborationControllerTimelineQueryKey(issue.id),
      }),
    ]);
  }

  function submitHandoff() {
    if (bodyError || !handoffCanSubmit) return;

    if (handoffMode === 'COMPLETE' && completionState) {
      mutation.mutate(
        {
          change: {
            handoff: { bodyMarkdown: handoffBody },
            kind: 'workflowState',
            value: completionState,
          },
          issue,
        },
        {
          onError: (error) => {
            if (error instanceof ApiError && error.body.code === 'HANDOFF_REQUIRES_COMPLETION') {
              void Promise.allSettled([
                states.refetch(),
                queryClient.invalidateQueries({
                  queryKey: getIssuesControllerGetQueryKey(issue.id),
                }),
                queryClient.invalidateQueries({
                  queryKey: getIssuesControllerGetQueryKey(issue.identifier),
                }),
              ]);
            }
          },
          onSuccess: () => {
            setHandoffMode(null);
            void refreshHandoffs().catch(() => undefined);
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

  const optionsError = states.isError || members.isError;

  return (
    <>
      <div className="grid gap-8 py-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <IssueDescription issue={issue} mentionOptions={mentionOptions} mutation={mutation} />
          <IssueAttachments issue={issue} />
          <IssueOverview issue={issue} />
          {issue.parentIssue ? (
            <section className="mt-8" aria-labelledby="parent-feature-title">
              <h2 id="parent-feature-title" className="text-base font-semibold">
                {t('parentFeature')}
              </h2>
              <Link
                href={`/issues/${encodeURIComponent(issue.parentIssue.identifier)}`}
                className="mt-3 flex min-w-0 items-center gap-2 border-y py-3 text-sm font-medium underline-offset-4 hover:underline"
              >
                <GitBranch aria-hidden="true" className="text-muted-foreground size-4" />
                <span className="truncate">
                  {issue.parentIssue.identifier} · {issue.parentIssue.title}
                </span>
              </Link>
            </section>
          ) : null}

          <IssueRelations issue={issue} t={(key) => t(key as never)} />

          {issue.projectRole === 'BACKEND' ? (
            <section aria-labelledby="issue-handoff-title" className="mt-8">
              <div className="flex flex-wrap items-center gap-2">
                <Send aria-hidden="true" className="text-muted-foreground size-4" />
                <h2 id="issue-handoff-title" className="text-base font-semibold">
                  {t('handoff.title')}
                </h2>
                <Badge variant="secondary">
                  {t('handoff.count', { count: issue.handoffSummary?.count ?? 0 })}
                </Badge>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="ml-auto hidden lg:inline-flex"
                  onClick={() => openHandoff('CREATE')}
                >
                  {issue.handoffSummary?.hasInitial
                    ? t('handoff.addFollowUp')
                    : t('handoff.writeInitial')}
                </Button>
              </div>
              <p className="text-muted-foreground mt-1 text-sm">{t('handoff.description')}</p>
            </section>
          ) : null}

          <IssueTimeline
            currentMembershipId={currentMembershipId}
            issueId={issue.id}
            mentionOptions={mentionOptions}
          />
        </div>

        <aside aria-labelledby="issue-properties-title" className="min-w-0 lg:border-l lg:pl-6">
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
                  }}
                >
                  {t('retry')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          <dl className="mt-3 space-y-1">
            <PropertyRow label={t('state')}>
              <Select
                items={stateItems.map((state) => ({ label: state.name, value: state.id }))}
                value={issue.status.workflowState.id}
                onValueChange={(value) => {
                  const state = stateItems.find((item) => item.id === value);
                  if (state) changeState(state);
                }}
              >
                <SelectTrigger
                  aria-label={t('state')}
                  className="w-full"
                  disabled={states.isPending || mutation.isPending}
                >
                  <SelectValue placeholder={t('loadingOptions')} />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {stateItems.map((state) => (
                      <SelectItem key={state.id} value={state.id}>
                        {state.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </PropertyRow>
            <PropertyRow label={t('assignee')}>
              <div className="flex min-w-0 items-center gap-2">
                {issue.assignee ? (
                  <UserAvatar
                    avatarFileId={issue.assignee.user.avatarFileId}
                    displayName={issue.assignee.user.displayName}
                    size="sm"
                  />
                ) : null}
                <Select
                  items={[
                    { label: t('unassigned'), value: 'unassigned' },
                    ...memberItems.map((member) => ({
                      label: member.user.displayName,
                      value: member.id,
                    })),
                  ]}
                  value={issue.assignee?.id ?? 'unassigned'}
                  onValueChange={(value) => {
                    const assignee =
                      value === 'unassigned'
                        ? null
                        : (memberItems.find((item) => item.id === value) ?? null);
                    mutation.mutate({ change: { kind: 'assignee', value: assignee }, issue });
                  }}
                >
                  <SelectTrigger
                    aria-label={t('assignee')}
                    className="min-w-0 flex-1"
                    disabled={members.isPending || mutation.isPending}
                  >
                    <SelectValue placeholder={t('loadingOptions')} />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      <SelectItem value="unassigned">{t('unassigned')}</SelectItem>
                      {memberItems.map((member) => (
                        <SelectItem key={member.id} value={member.id}>
                          {member.user.displayName}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </PropertyRow>
            <PropertyRow label={t('priority')}>
              <PriorityEditor issue={issue} mutation={mutation} />
            </PropertyRow>
            <PropertyRow label={t('team')}>
              <span className="block truncate text-sm font-medium">
                {issue.team.name} ({issue.team.key})
              </span>
            </PropertyRow>
            {issue.project ? (
              <PropertyRow label={t('project')}>
                <span className="block truncate text-sm font-medium">{issue.project.name}</span>
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
            {bodyError ? (
              <p className="text-destructive mt-2 text-sm">
                {bodyError === 'link' ? t('handoff.linkError') : t('handoff.contentError')}
              </p>
            ) : null}
            {handoffMutationError && !handoffFieldError ? (
              <Alert variant="destructive" className="mt-3">
                <AlertTitle>{t('handoff.saveErrorTitle')}</AlertTitle>
                <AlertDescription>{handoffSaveErrorDescription}</AlertDescription>
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
