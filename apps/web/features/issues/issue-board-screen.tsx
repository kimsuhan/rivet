'use client';

import {
  AlertCircle,
  Circle,
  CircleCheck,
  CircleDot,
  CircleOff,
  CircleX,
  Info,
  List,
  ListTodo,
  MonitorUp,
  Plus,
  RotateCcw,
  SearchX,
  UserRound,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type DragEvent, useState } from 'react';

import {
  type IssueDetailResponseDto,
  type LabelResponseDto,
  type MemberSummaryResponseDto,
  useLabelsControllerList,
  useMembersControllerList,
  useTeamsControllerList,
  useTeamsControllerListWorkflowStates,
  type WorkflowStateResponseDto,
} from '@rivet/api-client';

import { PageHeading } from '@/components/layout/page-heading';
import { ContentEmpty } from '@/components/states/content-empty';
import { ContentError } from '@/components/states/content-error';
import { ContentLoading } from '@/components/states/content-loading';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

import { buildTeamIssueViewHref, groupIssueBoardColumns } from './issue-board-state';
import { IssueFilterMenu } from './issue-filter-menu';
import { IssueInlineSelect } from './issue-inline-select';
import { getIssuePagesQueryKey, useIssuePages } from './issue-list-queries';
import {
  buildIssueListParams,
  clearIssueFilters,
  hasIssueFilters,
  ISSUE_PRIORITIES,
  ISSUE_SORT_DIRECTIONS,
  ISSUE_SORT_FIELDS,
  readIssueListState,
  replaceSearchParam,
  TEAM_ISSUE_TABS,
} from './issue-list-state';
import { type IssueOptimisticChange, useIssueInlineMutation } from './issue-mutations';
import { isTeamTaskIssue, type TeamTaskIssue } from './issue-types';

type IssueBoardCardLabels = {
  assignee: string;
  blocked: string;
  conflictDescription: string;
  conflictLatest: string;
  conflictMine: string;
  conflictTitle: string;
  conflictUnknown: string;
  dragHint: string;
  labelOptionsEmpty: string;
  labels: string;
  noLabels: string;
  errorDescription: string;
  errorTitle: string;
  priorities: Record<(typeof ISSUE_PRIORITIES)[number], string>;
  priority: string;
  reapply: string;
  retry: string;
  role: string;
  saving: string;
  state: string;
  unassigned: string;
};

function describeAttemptedChange(
  change: IssueOptimisticChange,
  labels: IssueBoardCardLabels,
): string {
  switch (change.kind) {
    case 'workflowState':
      return change.value.name;
    case 'assignee':
      return change.value?.user.displayName ?? labels.unassigned;
    case 'priority':
      return labels.priorities[change.value];
    case 'labels':
      return change.value.length > 0
        ? change.value.map((label) => label.name).join(', ')
        : labels.noLabels;
    default:
      return labels.conflictUnknown;
  }
}

function describeLatestChange(
  change: IssueOptimisticChange,
  latest: IssueDetailResponseDto | null,
  labels: IssueBoardCardLabels,
): string {
  if (!latest) return labels.conflictUnknown;

  switch (change.kind) {
    case 'workflowState':
      return latest.status.workflowState?.name ?? labels.conflictUnknown;
    case 'assignee':
      return latest.assignee?.user.displayName ?? labels.unassigned;
    case 'priority':
      return labels.priorities[latest.priority];
    case 'labels':
      return latest.labels.length > 0
        ? latest.labels.map((label) => label.name).join(', ')
        : labels.noLabels;
    default:
      return labels.conflictUnknown;
  }
}

function WorkflowStateMark({ category }: { category: WorkflowStateResponseDto['category'] }) {
  switch (category) {
    case 'BACKLOG':
      return <CircleOff aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />;
    case 'UNSTARTED':
      return <Circle aria-hidden="true" className="text-foreground size-4 shrink-0" />;
    case 'STARTED':
      return <CircleDot aria-hidden="true" className="text-primary size-4 shrink-0" />;
    case 'COMPLETED':
      return <CircleCheck aria-hidden="true" className="text-success size-4 shrink-0" />;
    case 'CANCELED':
      return <CircleX aria-hidden="true" className="text-disabled size-4 shrink-0" />;
  }
}

function IssueBoardLoading({ label }: { label: string }) {
  return (
    <section aria-busy="true" aria-label={label} className="py-5">
      <span role="status" className="sr-only">
        {label}
      </span>
      <div aria-hidden="true" className="flex gap-3 overflow-hidden">
        {Array.from({ length: 4 }, (_, columnIndex) => (
          <div key={columnIndex} className="bg-surface-1 w-66 shrink-0 rounded-xl border xl:w-70">
            <div className="flex min-h-10 items-center gap-2 border-b px-3">
              <Skeleton className="size-4 motion-reduce:animate-none" />
              <Skeleton className="h-3.5 w-20 motion-reduce:animate-none" />
            </div>
            <div className="flex flex-col gap-2 p-2">
              {Array.from({ length: 3 }, (_, cardIndex) => (
                <div key={cardIndex} className="bg-surface-2 rounded-xl p-3">
                  <Skeleton className="h-3 w-16 motion-reduce:animate-none" />
                  <Skeleton className="mt-3 h-4 w-full motion-reduce:animate-none" />
                  <Skeleton className="mt-2 h-4 w-2/3 motion-reduce:animate-none" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function IssueBoardCard({
  activeLabels,
  issue,
  labels,
  members,
  mutation,
  onDragEnd,
  onDragStart,
  onMove,
  workflowStates,
}: {
  activeLabels: LabelResponseDto[];
  issue: TeamTaskIssue;
  labels: IssueBoardCardLabels;
  members: MemberSummaryResponseDto[];
  mutation: ReturnType<typeof useIssueInlineMutation>;
  onDragEnd: () => void;
  onDragStart: (issueId: string) => void;
  onMove: (issue: TeamTaskIssue, state: WorkflowStateResponseDto) => void;
  workflowStates: WorkflowStateResponseDto[];
}) {
  const isCurrentMutation = mutation.variables?.issue.id === issue.id;
  const isPending = isCurrentMutation && mutation.isPending;
  const conflict = mutation.conflict?.issueRef === issue.identifier ? mutation.conflict : null;
  const attemptedChange = conflict
    ? describeAttemptedChange(conflict.attemptedChange, labels)
    : labels.conflictUnknown;
  const latestChange = conflict
    ? describeLatestChange(conflict.attemptedChange, conflict.latest, labels)
    : labels.conflictUnknown;
  const hasError = isCurrentMutation && mutation.isError && !conflict;
  const memberOptions = [
    ...new Map(
      [...(issue.assignee ? [issue.assignee] : []), ...members].map((member) => [
        member.id,
        member,
      ]),
    ).values(),
  ];
  const labelOptions = [
    ...new Map([...issue.labels, ...activeLabels].map((label) => [label.id, label])).values(),
  ];

  function changeLabels(ids: string[]) {
    mutation.mutate({
      change: {
        kind: 'labels',
        value: ids.flatMap((id) => {
          const label = labelOptions.find((candidate) => candidate.id === id);
          return label ? [label] : [];
        }),
      },
      issue,
    });
  }

  function startDragging(event: DragEvent<HTMLDivElement>) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', issue.id);
    onDragStart(issue.id);
  }

  return (
    <Card
      size="sm"
      draggable={!mutation.isPending}
      aria-busy={isPending || undefined}
      title={labels.dragHint}
      onDragStart={startDragging}
      onDragEnd={onDragEnd}
      className="min-h-22 cursor-grab active:cursor-grabbing"
    >
      <CardHeader>
        <CardDescription className="font-mono text-xs">{issue.identifier}</CardDescription>
        <CardTitle>
          <Link
            href={`/issues/${encodeURIComponent(issue.identifier)}`}
            className="hover:text-primary line-clamp-2 underline-offset-4 hover:underline"
          >
            {issue.title}
          </Link>
        </CardTitle>
        <CardAction>
          <Select
            items={workflowStates.map((state) => ({ label: state.name, value: state.id }))}
            value={issue.status.workflowState.id}
            onValueChange={(stateId) => {
              const nextState = workflowStates.find((state) => state.id === stateId);
              if (nextState) onMove(issue, nextState);
            }}
          >
            <SelectTrigger
              size="sm"
              aria-label={`${issue.identifier} ${labels.state}`}
              disabled={mutation.isPending}
              className="max-w-28"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {workflowStates.map((state) => (
                  <SelectItem key={state.id} value={state.id}>
                    {state.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-2">
        <div className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
          <span className="flex min-w-0 flex-1 items-center gap-1">
            <UserRound aria-hidden="true" className="size-3.5 shrink-0" />
            <IssueInlineSelect
              ariaLabel={`${issue.identifier} ${labels.assignee}`}
              disabled={mutation.isPending}
              onValueChange={(memberId) => {
                const assignee =
                  memberId === 'unassigned'
                    ? null
                    : (memberOptions.find((member) => member.id === memberId) ?? null);
                mutation.mutate({ change: { kind: 'assignee', value: assignee }, issue });
              }}
              options={[
                { label: labels.unassigned, value: 'unassigned' },
                ...memberOptions.map((member) => ({
                  label: member.user.displayName,
                  value: member.id,
                })),
              ]}
              triggerClassName="h-6 text-xs"
              value={issue.assignee?.id ?? 'unassigned'}
            />
          </span>
          <IssueInlineSelect
            ariaLabel={`${issue.identifier} ${labels.priority}`}
            disabled={mutation.isPending}
            onValueChange={(priority) => {
              if (ISSUE_PRIORITIES.includes(priority as (typeof ISSUE_PRIORITIES)[number])) {
                mutation.mutate({
                  change: { kind: 'priority', value: priority as TeamTaskIssue['priority'] },
                  issue,
                });
              }
            }}
            options={ISSUE_PRIORITIES.map((priority) => ({
              label: labels.priorities[priority],
              value: priority,
            }))}
            triggerClassName="h-6 max-w-20 text-xs"
            value={issue.priority}
          />
          {issue.projectRole ? (
            <Badge variant="secondary" aria-label={`${labels.role}: ${issue.projectRole}`}>
              {issue.projectRole}
            </Badge>
          ) : null}
          {issue.blocked ? <Badge variant="outline">{labels.blocked}</Badge> : null}
        </div>

        <div className="flex min-w-0 items-center gap-1">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
            {issue.labels.slice(0, 2).map((label) => (
              <Badge key={label.id} variant="outline" className="max-w-24 truncate">
                <span
                  aria-hidden="true"
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: label.color }}
                />
                {label.name}
              </Badge>
            ))}
            {issue.labels.length > 2 ? (
              <span className="text-muted-foreground shrink-0 text-xs">
                +{issue.labels.length - 2}
              </span>
            ) : null}
          </div>
          <IssueFilterMenu
            ariaLabel={`${issue.identifier} ${labels.labels}`}
            disabled={mutation.isPending}
            emptyLabel={labels.labelOptionsEmpty}
            label={labels.labels}
            onChange={changeLabels}
            options={labelOptions.map((label) => ({
              id: label.id,
              label: label.name,
              swatch: label.color,
            }))}
            selected={issue.labels.map((label) => label.id)}
            triggerClassName="h-6 shrink-0 border-transparent px-1.5 text-xs"
          />
        </div>

        {isPending ? (
          <span role="status" className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <Spinner aria-hidden="true" className="size-3" />
            {labels.saving}
          </span>
        ) : null}

        {conflict ? (
          <Alert className="mt-1">
            <AlertCircle aria-hidden="true" />
            <AlertTitle>{labels.conflictTitle}</AlertTitle>
            <AlertDescription className="flex flex-col gap-1">
              <span>{labels.conflictDescription}</span>
              <span>
                {labels.conflictLatest}: {latestChange}
              </span>
              <span>
                {labels.conflictMine}: {attemptedChange}
              </span>
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="mt-1 w-fit"
                disabled={mutation.isPending}
                onClick={() => void mutation.reapplyConflict()}
              >
                <RotateCcw aria-hidden="true" data-icon="inline-start" />
                {labels.reapply}
              </Button>
            </AlertDescription>
          </Alert>
        ) : hasError ? (
          <Alert variant="destructive" className="mt-1">
            <AlertCircle aria-hidden="true" />
            <AlertTitle>{labels.errorTitle}</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <span>{labels.errorDescription}</span>
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="w-fit"
                disabled={mutation.isPending}
                onClick={mutation.retry}
              >
                <RotateCcw aria-hidden="true" data-icon="inline-start" />
                {labels.retry}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function IssueBoardScreen({ teamKey }: { teamKey: string }) {
  const t = useTranslations('Issues');
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [draggedIssueId, setDraggedIssueId] = useState<string | null>(null);
  const [dragOverStateId, setDragOverStateId] = useState<string | null>(null);
  const state = readIssueListState(searchParams, 'team');
  const teams = useTeamsControllerList({ includeArchived: false }, { query: { retry: false } });
  const activeTeams = (teams.data?.items ?? []).filter((team) => !team.archived);
  const selectedTeam = activeTeams.find(
    (team) => team.key.toLocaleUpperCase() === teamKey.toLocaleUpperCase(),
  );
  const teamId = selectedTeam?.id ?? '';
  const workflowStates = useTeamsControllerListWorkflowStates(teamId, {
    query: { enabled: Boolean(selectedTeam), retry: false },
  });
  const members = useMembersControllerList(
    { limit: 100, status: 'ACTIVE', teamId },
    { query: { enabled: Boolean(selectedTeam), retry: false } },
  );
  const labels = useLabelsControllerList(
    { includeArchived: false, limit: 100 },
    { query: { enabled: Boolean(selectedTeam), retry: false } },
  );
  const listParams = buildIssueListParams(state, {
    mode: 'team',
    ...(selectedTeam ? { teamId } : {}),
  });
  const issues = useIssuePages(listParams, Boolean(selectedTeam));
  const mutation = useIssueInlineMutation({ currentQueryKey: getIssuePagesQueryKey(listParams) });
  const issueItems = (issues.data?.pages.flatMap((page) => page.items) ?? []).filter(
    isTeamTaskIssue,
  );
  const sortedStates = (workflowStates.data?.items ?? []).toSorted(
    (left, right) => left.position - right.position,
  );
  const columns = groupIssueBoardColumns(sortedStates, issueItems);
  const activeLabels = (labels.data?.items ?? []).filter((label) => !label.archived);
  const filtersActive = hasIssueFilters(state, 'team');
  const hasActiveConditions = filtersActive || state.tab !== 'all';
  const listHref = buildTeamIssueViewHref(teamKey, 'issues', searchParams);
  const createSearchParams = new URLSearchParams(searchParams.toString());
  createSearchParams.delete('cursor');
  createSearchParams.set('create', '1');
  createSearchParams.set('type', 'TEAM_TASK');
  const createHref = `${pathname}?${createSearchParams.toString()}`;
  const cardLabels: IssueBoardCardLabels = {
    assignee: t('columns.assignee'),
    blocked: t('board.blocked'),
    conflictDescription: t('board.conflictDescription'),
    conflictLatest: t('board.conflictLatest'),
    conflictMine: t('board.conflictMine'),
    conflictTitle: t('board.conflictTitle'),
    conflictUnknown: t('board.conflictUnknown'),
    dragHint: t('board.dragHint'),
    labelOptionsEmpty: t('filters.noOptions'),
    labels: t('columns.labels'),
    noLabels: t('board.noLabels'),
    errorDescription: t('board.saveErrorDescription'),
    errorTitle: t('board.saveErrorTitle'),
    priorities: {
      HIGH: t('priority.HIGH'),
      LOW: t('priority.LOW'),
      MEDIUM: t('priority.MEDIUM'),
      NONE: t('priority.NONE'),
      URGENT: t('priority.URGENT'),
    },
    priority: t('columns.priority'),
    reapply: t('board.reapply'),
    retry: t('retry'),
    role: t('board.role'),
    saving: t('board.saving'),
    state: t('columns.state'),
    unassigned: t('unassigned'),
  };

  function replaceUrl(
    key: Parameters<typeof replaceSearchParam>[1],
    value: string | string[] | null,
  ) {
    const query = replaceSearchParam(searchParams, key, value);
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function clearFilters() {
    const query = clearIssueFilters(searchParams);
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function clearAllConditions() {
    const next = new URLSearchParams(clearIssueFilters(searchParams));
    next.delete('tab');
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function retryBoard() {
    if (workflowStates.isError) void workflowStates.refetch();
    if (members.isError) void members.refetch();
    if (labels.isError) void labels.refetch();
    if (issues.isError) void issues.refetch();
  }

  function moveIssue(issue: TeamTaskIssue, nextState: WorkflowStateResponseDto) {
    if (mutation.isPending || issue.status.workflowState.id === nextState.id) return;
    mutation.mutate({ change: { kind: 'workflowState', value: nextState }, issue });
  }

  function dropIssue(event: DragEvent<HTMLElement>, nextState: WorkflowStateResponseDto) {
    event.preventDefault();
    const issueId = draggedIssueId ?? event.dataTransfer.getData('text/plain');
    const issue = issueItems.find((candidate) => candidate.id === issueId);
    setDraggedIssueId(null);
    setDragOverStateId(null);
    if (issue) moveIssue(issue, nextState);
  }

  if (teams.isPending) return <ContentLoading label={t('board.loading')} />;

  if (teams.isError) {
    return (
      <ContentError
        title={t('board.errorTitle')}
        description={t('board.errorDescription')}
        retryLabel={t('retry')}
        onRetry={() => void teams.refetch()}
        headingLevel={1}
      />
    );
  }

  if (!selectedTeam) {
    return (
      <>
        <PageHeading title={t('team.missingTitle')} description={t('team.missingDescription')} />
        <ContentEmpty
          icon={CircleOff}
          title={t('team.missingTitle')}
          description={t('team.missingDescription')}
        />
      </>
    );
  }

  const optionsPending = workflowStates.isPending || members.isPending || labels.isPending;
  const initialError =
    workflowStates.isError || members.isError || labels.isError || (issues.isError && !issues.data);

  return (
    <section className="min-w-0">
      <PageHeading
        title={t('board.title', { team: selectedTeam.name })}
        description={t('board.description', { team: selectedTeam.name })}
      />

      <div className="lg:hidden">
        <ContentEmpty
          icon={MonitorUp}
          title={t('board.mobileTitle')}
          description={t('board.mobileDescription')}
        >
          <Link href={listHref} className={buttonVariants({ size: 'lg', variant: 'outline' })}>
            <List aria-hidden="true" data-icon="inline-start" />
            {t('board.viewList')}
          </Link>
        </ContentEmpty>
      </div>

      <div className="hidden lg:block">
        <div className="mt-4 flex items-center justify-between gap-4">
          <Tabs
            value={state.tab}
            onValueChange={(value) => {
              if (TEAM_ISSUE_TABS.includes(value as (typeof TEAM_ISSUE_TABS)[number])) {
                replaceUrl('tab', value === 'all' ? null : value);
              }
            }}
          >
            <TabsList variant="line" aria-label={t('tabs.label')}>
              <TabsTrigger value="all">{t('tabs.all')}</TabsTrigger>
              <TabsTrigger value="progress">{t('tabs.progress')}</TabsTrigger>
              <TabsTrigger value="backlog">{t('tabs.backlog')}</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-2">
            <Link href={listHref} className={buttonVariants({ size: 'sm', variant: 'outline' })}>
              <List aria-hidden="true" data-icon="inline-start" />
              {t('board.viewList')}
            </Link>
            <Link href={createHref} className={buttonVariants({ size: 'sm' })}>
              <Plus aria-hidden="true" data-icon="inline-start" />
              {t('create')}
            </Link>
          </div>
        </div>

        <div className="mt-4 flex min-w-0 flex-wrap items-center gap-2 border-y py-3">
          <IssueFilterMenu
            emptyLabel={t('filters.noOptions')}
            label={t('filters.state')}
            onChange={(selected) => replaceUrl('status', selected)}
            options={sortedStates.map((workflowState) => ({
              id: workflowState.id,
              label: workflowState.name,
            }))}
            selected={state.stateIds}
          />
          <IssueFilterMenu
            emptyLabel={t('filters.noOptions')}
            label={t('filters.assignee')}
            onChange={(selected) => replaceUrl('assignee', selected)}
            options={(members.data?.items ?? []).map((member) => ({
              id: member.id,
              label: member.user.displayName,
            }))}
            selected={state.assigneeIds}
          />
          <IssueFilterMenu
            emptyLabel={t('filters.noOptions')}
            label={t('filters.priority')}
            onChange={(selected) => replaceUrl('priority', selected)}
            options={ISSUE_PRIORITIES.map((priority) => ({
              id: priority,
              label: t(`priority.${priority}`),
            }))}
            selected={state.priority}
          />
          <IssueFilterMenu
            emptyLabel={t('filters.noOptions')}
            label={t('filters.label')}
            onChange={(selected) => replaceUrl('label', selected)}
            options={activeLabels.map((label) => ({
              id: label.id,
              label: label.name,
              swatch: label.color,
            }))}
            selected={state.labelIds}
          />
          {filtersActive ? (
            <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
              <RotateCcw aria-hidden="true" data-icon="inline-start" />
              {t('filters.reset')}
            </Button>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-muted-foreground hidden text-xs xl:inline">
              {t('resultCount', { count: issueItems.length, more: issues.hasNextPage ? '+' : '' })}
            </span>
            <Select
              items={ISSUE_SORT_FIELDS.map((sort) => ({
                label: t(`sort.${sort}`),
                value: sort,
              }))}
              value={state.sort}
              onValueChange={(value) => {
                if (
                  value &&
                  ISSUE_SORT_FIELDS.includes(value as (typeof ISSUE_SORT_FIELDS)[number])
                ) {
                  replaceUrl('sort', value === 'updatedAt' ? null : value);
                }
              }}
            >
              <SelectTrigger size="sm" aria-label={t('sort.fieldLabel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {ISSUE_SORT_FIELDS.map((sort) => (
                    <SelectItem key={sort} value={sort}>
                      {t(`sort.${sort}`)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select
              items={ISSUE_SORT_DIRECTIONS.map((direction) => ({
                label: t(`sort.${direction}`),
                value: direction,
              }))}
              value={state.sortDirection}
              onValueChange={(value) => {
                if (
                  value &&
                  ISSUE_SORT_DIRECTIONS.includes(value as (typeof ISSUE_SORT_DIRECTIONS)[number])
                ) {
                  replaceUrl('direction', value === 'desc' ? null : value);
                }
              }}
            >
              <SelectTrigger size="sm" aria-label={t('sort.directionLabel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {ISSUE_SORT_DIRECTIONS.map((direction) => (
                    <SelectItem key={direction} value={direction}>
                      {t(`sort.${direction}`)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Alert className="mt-4">
          <Info aria-hidden="true" />
          <AlertTitle>{t('board.helpTitle')}</AlertTitle>
          <AlertDescription>{t('board.helpDescription')}</AlertDescription>
        </Alert>

        {initialError ? (
          <div className="py-6">
            <ContentError
              title={t('board.errorTitle')}
              description={t('board.errorDescription')}
              retryLabel={t('retry')}
              onRetry={retryBoard}
            />
          </div>
        ) : optionsPending || issues.isPending ? (
          <IssueBoardLoading label={t('board.loading')} />
        ) : sortedStates.length === 0 ? (
          <ContentEmpty
            icon={CircleOff}
            title={t('board.noStatesTitle')}
            description={t('board.noStatesDescription')}
          />
        ) : issueItems.length === 0 ? (
          <ContentEmpty
            icon={hasActiveConditions ? SearchX : ListTodo}
            title={hasActiveConditions ? t('board.filteredEmptyTitle') : t('board.emptyTitle')}
            description={
              hasActiveConditions
                ? t('board.filteredEmptyDescription')
                : t('board.emptyDescription')
            }
          >
            {hasActiveConditions ? (
              <Button type="button" variant="outline" onClick={clearAllConditions}>
                {t('board.resetView')}
              </Button>
            ) : null}
          </ContentEmpty>
        ) : (
          <>
            <div
              role="region"
              aria-label={t('board.columnsLabel')}
              className="mt-4 flex gap-3 overflow-x-auto pb-4"
            >
              {columns.map((column) => {
                const columnId = `issue-board-column-${column.state.id}`;
                const isDropTarget = dragOverStateId === column.state.id;

                return (
                  <section
                    key={column.state.id}
                    aria-labelledby={columnId}
                    onDragOver={(event) => {
                      if (!draggedIssueId || mutation.isPending) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                      setDragOverStateId(column.state.id);
                    }}
                    onDragLeave={(event) => {
                      const relatedTarget = event.relatedTarget;
                      if (
                        !(relatedTarget instanceof Node) ||
                        !event.currentTarget.contains(relatedTarget)
                      ) {
                        setDragOverStateId(null);
                      }
                    }}
                    onDrop={(event) => dropIssue(event, column.state)}
                    className={cn(
                      'bg-surface-1 w-66 shrink-0 rounded-xl border transition-colors xl:w-70',
                      isDropTarget && 'border-ring ring-ring/50 ring-2',
                    )}
                  >
                    <header className="flex min-h-10 items-center gap-2 border-b px-3">
                      <WorkflowStateMark category={column.state.category} />
                      <h2 id={columnId} className="min-w-0 flex-1 truncate text-sm font-medium">
                        {column.state.name}
                      </h2>
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {t('board.stateCount', { count: column.issues.length })}
                      </span>
                    </header>
                    {column.issues.length === 0 ? (
                      <p className="text-muted-foreground min-h-24 px-3 py-4 text-xs">
                        {t('board.emptyColumn')}
                      </p>
                    ) : (
                      <ul className="flex min-h-24 flex-col gap-2 p-2">
                        {column.issues.map((issue) => (
                          <li key={issue.id}>
                            <IssueBoardCard
                              activeLabels={activeLabels}
                              issue={issue}
                              labels={cardLabels}
                              members={members.data?.items ?? []}
                              mutation={mutation}
                              workflowStates={sortedStates}
                              onMove={moveIssue}
                              onDragStart={setDraggedIssueId}
                              onDragEnd={() => {
                                setDraggedIssueId(null);
                                setDragOverStateId(null);
                              }}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>

            {issues.isFetchNextPageError ? (
              <Alert variant="destructive" className="mt-2 pr-28">
                <AlertCircle aria-hidden="true" />
                <AlertTitle>{t('pagination.errorTitle')}</AlertTitle>
                <AlertDescription>{t('pagination.errorDescription')}</AlertDescription>
                <AlertAction>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={issues.isFetchingNextPage}
                    onClick={() => void issues.fetchNextPage()}
                  >
                    {issues.isFetchingNextPage ? (
                      <Spinner aria-hidden="true" data-icon="inline-start" />
                    ) : (
                      <RotateCcw aria-hidden="true" data-icon="inline-start" />
                    )}
                    {issues.isFetchingNextPage ? t('pagination.loading') : t('retry')}
                  </Button>
                </AlertAction>
              </Alert>
            ) : issues.hasNextPage ? (
              <div className="flex justify-center py-5">
                <Button
                  type="button"
                  variant="outline"
                  disabled={issues.isFetchingNextPage}
                  onClick={() => void issues.fetchNextPage()}
                >
                  {issues.isFetchingNextPage ? (
                    <Spinner aria-hidden="true" data-icon="inline-start" />
                  ) : null}
                  {issues.isFetchingNextPage ? t('pagination.loading') : t('pagination.more')}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
