'use client';

import { useQueries } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  CircleOff,
  LayoutGrid,
  ListTodo,
  Plus,
  RotateCcw,
  SearchX,
  UserRound,
  X,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import {
  getMembersControllerListQueryKey,
  getTeamsControllerListWorkflowStatesQueryKey,
  membersControllerList,
  teamsControllerListWorkflowStates,
  useAuthControllerGetSession,
  useLabelsControllerList,
  useTeamsControllerList,
} from '@rivet/api-client';

import { PageHeading } from '@/components/layout/page-heading';
import { ContentEmpty } from '@/components/states/content-empty';
import { ContentError } from '@/components/states/content-error';
import { ContentLoading } from '@/components/states/content-loading';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

import {
  ISSUE_PRIORITY_PRESENTATION,
  WORKFLOW_STATE_PRESENTATION,
} from './issue-attribute-presentation';
import { IssueFilterMenu, type IssueFilterOption } from './issue-filter-menu';
import { getIssuePagesQueryKey, useIssuePages } from './issue-list-queries';
import {
  buildIssueListParams,
  clearIssueFilters,
  hasIssueFilters,
  ISSUE_PRIORITIES,
  ISSUE_SORT_DIRECTIONS,
  ISSUE_SORT_FIELDS,
  type IssueListMode,
  readIssueListState,
  replaceSearchParam,
  TEAM_ISSUE_TABS,
} from './issue-list-state';
import { IssueRow, type IssueRowLabels } from './issue-row';
import { isTeamTaskIssue } from './issue-types';

function uniqueOptions(options: IssueFilterOption[]): IssueFilterOption[] {
  return [...new Map(options.map((option) => [option.id, option])).values()];
}

export function IssueListScreen({ mode, teamKey }: { mode: IssueListMode; teamKey?: string }) {
  const t = useTranslations('Issues');
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const state = readIssueListState(searchParams, mode);
  const teams = useTeamsControllerList({ includeArchived: false }, { query: { retry: false } });
  const session = useAuthControllerGetSession({ query: { retry: false } });
  const labelsQuery = useLabelsControllerList(
    { includeArchived: false, limit: 100 },
    { query: { retry: false } },
  );
  const activeTeams = (teams.data?.items ?? []).filter((team) => !team.archived);
  const selectedTeam =
    mode === 'team'
      ? activeTeams.find((team) => team.key.toLocaleUpperCase() === teamKey?.toLocaleUpperCase())
      : undefined;
  const optionTeamIds =
    mode === 'team' ? (selectedTeam ? [selectedTeam.id] : []) : activeTeams.map((team) => team.id);
  const workflowStateQueries = useQueries({
    queries: optionTeamIds.map((teamId) => ({
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        teamsControllerListWorkflowStates(teamId, { signal }),
      queryKey: getTeamsControllerListWorkflowStatesQueryKey(teamId),
      retry: false,
    })),
  });
  const memberQueries = useQueries({
    queries: optionTeamIds.map((teamId) => {
      const params = { limit: 100, status: 'ACTIVE', teamId };
      return {
        queryFn: ({ signal }: { signal: AbortSignal }) => membersControllerList(params, { signal }),
        queryKey: getMembersControllerListQueryKey(params),
        retry: false,
      };
    }),
  });
  const listParams = buildIssueListParams(state, {
    mode,
    ...(selectedTeam ? { teamId: selectedTeam.id } : {}),
  });
  const issues = useIssuePages(listParams, mode === 'my' || Boolean(selectedTeam));
  const issueItems = (issues.data?.pages.flatMap((page) => page.items) ?? []).filter(
    isTeamTaskIssue,
  );
  const currentMembershipId =
    session.data?.authenticated && session.data.membership?.status === 'ACTIVE'
      ? session.data.membership.id
      : null;
  const activeLabels = (labelsQuery.data?.items ?? []).filter((label) => !label.archived);
  const filtersActive = hasIssueFilters(state, mode);
  const currentQueryKey = getIssuePagesQueryKey(listParams);
  const createSearchParams = new URLSearchParams(searchParams.toString());
  createSearchParams.set('create', '1');
  if (mode === 'team') createSearchParams.set('type', 'TEAM_TASK');
  else createSearchParams.delete('type');
  const createHref = `${pathname}?${createSearchParams.toString()}`;
  const rowLabels: IssueRowLabels = {
    assignee: t('columns.assignee'),
    conflictDescription: t('inline.conflictDescription'),
    errorDescription: t('inline.errorDescription'),
    labels: t('columns.labels'),
    noLabels: t('filters.noOptions'),
    priorities: {
      HIGH: t('priority.HIGH'),
      LOW: t('priority.LOW'),
      MEDIUM: t('priority.MEDIUM'),
      NONE: t('priority.NONE'),
      URGENT: t('priority.URGENT'),
    },
    priority: t('columns.priority'),
    projectRoles: {
      APP_FRONTEND: t('projectRoles.APP_FRONTEND'),
      BACKEND: t('projectRoles.BACKEND'),
      WEB_FRONTEND: t('projectRoles.WEB_FRONTEND'),
    },
    reapply: t('inline.reapply'),
    retry: t('retry'),
    state: t('columns.state'),
    unassigned: t('unassigned'),
  };

  const workflowStateOptions = uniqueOptions(
    optionTeamIds.flatMap((teamId, index) => {
      const team = activeTeams.find((candidate) => candidate.id === teamId);
      return (workflowStateQueries[index]?.data?.items ?? []).map((workflowState) => ({
        ...WORKFLOW_STATE_PRESENTATION[workflowState.category],
        id: workflowState.id,
        label: mode === 'my' && team ? `${workflowState.name} · ${team.key}` : workflowState.name,
      }));
    }),
  );
  const assigneeOptions = uniqueOptions(
    (memberQueries[0]?.data?.items ?? []).map((member) => ({
      icon: UserRound,
      iconClassName: 'text-muted-foreground',
      id: member.id,
      label: member.user.displayName,
    })),
  );
  const filterChips = [
    ...state.stateIds.map((id) => ({
      key: `state-${id}`,
      label: `${t('filters.state')}: ${workflowStateOptions.find((option) => option.id === id)?.label ?? id}`,
      remove: () =>
        replaceUrl(
          'status',
          state.stateIds.filter((value) => value !== id),
        ),
    })),
    ...(mode === 'my'
      ? state.teamIds.map((id) => ({
          key: `team-${id}`,
          label: `${t('filters.team')}: ${activeTeams.find((team) => team.id === id)?.name ?? id}`,
          remove: () =>
            replaceUrl(
              'team',
              state.teamIds.filter((value) => value !== id),
            ),
        }))
      : state.assigneeIds.map((id) => ({
          key: `assignee-${id}`,
          label: `${t('filters.assignee')}: ${assigneeOptions.find((option) => option.id === id)?.label ?? id}`,
          remove: () =>
            replaceUrl(
              'assignee',
              state.assigneeIds.filter((value) => value !== id),
            ),
        }))),
    ...state.priority.map((priority) => ({
      key: `priority-${priority}`,
      label: `${t('filters.priority')}: ${t(`priority.${priority}`)}`,
      remove: () =>
        replaceUrl(
          'priority',
          state.priority.filter((value) => value !== priority),
        ),
    })),
    ...state.labelIds.map((id) => ({
      key: `label-${id}`,
      label: `${t('filters.label')}: ${activeLabels.find((label) => label.id === id)?.name ?? id}`,
      remove: () =>
        replaceUrl(
          'label',
          state.labelIds.filter((value) => value !== id),
        ),
    })),
  ];

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

  function retryOptionsAndList() {
    if (teams.isError) void teams.refetch();
    if (session.isError) void session.refetch();
    if (labelsQuery.isError) void labelsQuery.refetch();
    for (const query of workflowStateQueries) if (query.isError) void query.refetch();
    for (const query of memberQueries) if (query.isError) void query.refetch();
    if (issues.isError) void issues.refetch();
  }

  if (teams.isPending || session.isPending || labelsQuery.isPending) {
    return <ContentLoading label={t('loading')} />;
  }

  if (teams.isError || session.isError || labelsQuery.isError) {
    return (
      <ContentError
        title={t('errorTitle')}
        description={t('errorDescription')}
        retryLabel={t('retry')}
        onRetry={retryOptionsAndList}
      />
    );
  }

  if (mode === 'team' && !selectedTeam) {
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

  const optionsPending =
    workflowStateQueries.some((query) => query.isPending) ||
    memberQueries.some((query) => query.isPending);
  const optionsError =
    workflowStateQueries.some((query) => query.isError) ||
    memberQueries.some((query) => query.isError);
  const initialError =
    teams.isError ||
    session.isError ||
    labelsQuery.isError ||
    optionsError ||
    (issues.isError && !issues.data);
  const title =
    mode === 'my' ? t('my.title') : t('team.title', { team: selectedTeam?.name ?? teamKey ?? '' });
  return (
    <section className="mx-auto w-full max-w-[96rem] min-w-0">
      <header className="flex min-h-11 flex-wrap items-center gap-3 pb-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="text-xl leading-8 font-semibold tracking-[-0.01em]">{title}</h1>
          <span aria-live="polite" className="text-muted-foreground text-sm tabular-nums">
            {t('resultCount', { count: issueItems.length, more: issues.hasNextPage ? '+' : '' })}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {mode === 'team' && selectedTeam ? (
            <Link
              href={`/teams/${encodeURIComponent(selectedTeam.key)}/board${searchParams.toString() ? `?${searchParams.toString()}` : ''}`}
              className={cn(buttonVariants({ size: 'sm', variant: 'ghost' }), 'h-11 sm:h-10')}
            >
              <LayoutGrid aria-hidden="true" data-icon="inline-start" />
              {t('team.viewBoard')}
            </Link>
          ) : null}
          <Link href={createHref} className={cn(buttonVariants({ size: 'sm' }), 'h-11 sm:h-10')}>
            <Plus aria-hidden="true" data-icon="inline-start" />
            {mode === 'my' ? t('createIssue') : t('create')}
          </Link>
        </div>
      </header>

      {mode === 'team' ? (
        <Tabs
          className="mt-1"
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
      ) : null}

      <div className="flex min-w-0 flex-wrap items-center gap-2 py-2.5">
        <IssueFilterMenu
          emptyLabel={t('filters.noOptions')}
          label={t('filters.state')}
          onChange={(selected) => replaceUrl('status', selected)}
          options={workflowStateOptions}
          selected={state.stateIds}
          variant="compact"
        />
        {mode === 'my' ? (
          <IssueFilterMenu
            emptyLabel={t('filters.noOptions')}
            label={t('filters.team')}
            onChange={(selected) => replaceUrl('team', selected)}
            options={activeTeams.map((team) => ({
              id: team.id,
              label: `${team.name} (${team.key})`,
            }))}
            selected={state.teamIds}
            variant="compact"
          />
        ) : (
          <IssueFilterMenu
            emptyLabel={t('filters.noOptions')}
            label={t('filters.assignee')}
            onChange={(selected) => replaceUrl('assignee', selected)}
            options={assigneeOptions}
            selected={state.assigneeIds}
            variant="compact"
          />
        )}
        <IssueFilterMenu
          emptyLabel={t('filters.noOptions')}
          label={t('filters.priority')}
          onChange={(selected) => replaceUrl('priority', selected)}
          options={ISSUE_PRIORITIES.map((priority) => ({
            ...ISSUE_PRIORITY_PRESENTATION[priority],
            id: priority,
            label: t(`priority.${priority}`),
          }))}
          selected={state.priority}
          variant="compact"
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
          variant="compact"
        />
        <div className="ml-auto flex items-center gap-2">
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
            <SelectTrigger size="sm" variant="inline" aria-label={t('sort.fieldLabel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {ISSUE_SORT_FIELDS.map((sort) => (
                  <SelectItem
                    className="data-selected:bg-accent/60 min-h-11 lg:min-h-9"
                    key={sort}
                    value={sort}
                  >
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
            <SelectTrigger
              size="sm"
              variant="inline"
              aria-label={`${t('sort.directionLabel')}: ${t(`sort.${state.sortDirection}`)}`}
              title={t(`sort.${state.sortDirection}`)}
              className="min-w-11 justify-center p-0 [&_[data-slot=select-value]]:sr-only [&>svg:last-child]:hidden"
            >
              {state.sortDirection === 'desc' ? (
                <ArrowDown aria-hidden="true" />
              ) : (
                <ArrowUp aria-hidden="true" />
              )}
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {ISSUE_SORT_DIRECTIONS.map((direction) => (
                  <SelectItem
                    className="data-selected:bg-accent/60 min-h-11 lg:min-h-9"
                    key={direction}
                    value={direction}
                  >
                    {t(`sort.${direction}`)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      {filterChips.length > 0 ? (
        <div
          role="group"
          aria-label={t('filters.active')}
          className="flex min-w-0 flex-wrap items-center gap-1.5 pb-2"
        >
          <span className="text-muted-foreground text-xs font-medium">{t('filters.active')}</span>
          {filterChips.map((chip) => (
            <Button
              key={chip.key}
              type="button"
              size="sm"
              variant="ghost"
              className="before:bg-muted/50 hover:before:bg-muted relative isolate h-11 max-w-full gap-1 bg-transparent px-2 text-xs font-normal before:absolute before:inset-x-0 before:top-1/2 before:-z-10 before:h-8 before:-translate-y-1/2 before:rounded-md hover:bg-transparent sm:h-10"
              aria-label={t('filters.remove', { label: chip.label })}
              onClick={chip.remove}
            >
              <span className="truncate">{chip.label}</span>
              <X aria-hidden="true" data-icon="inline-end" />
            </Button>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="hover:before:bg-muted/60 relative isolate h-11 bg-transparent px-2 text-xs before:absolute before:inset-x-0 before:top-1/2 before:-z-10 before:h-8 before:-translate-y-1/2 before:rounded-md before:bg-transparent hover:bg-transparent sm:h-10"
            onClick={clearFilters}
          >
            <RotateCcw aria-hidden="true" data-icon="inline-start" />
            {t('filters.reset')}
          </Button>
        </div>
      ) : null}

      {initialError ? (
        <div className="py-6">
          <ContentError
            title={t('errorTitle')}
            description={t('errorDescription')}
            retryLabel={t('retry')}
            onRetry={retryOptionsAndList}
          />
        </div>
      ) : issues.isPending || optionsPending ? (
        <ContentLoading label={t('loading')} />
      ) : issueItems.length === 0 ? (
        <ContentEmpty
          icon={filtersActive ? SearchX : ListTodo}
          title={filtersActive ? t('empty.filteredTitle') : t(`${mode}.emptyTitle`)}
          description={
            filtersActive ? t('empty.filteredDescription') : t(`${mode}.emptyDescription`)
          }
        >
          {filtersActive ? (
            <Button type="button" variant="outline" onClick={clearFilters}>
              {t('filters.reset')}
            </Button>
          ) : (
            <Link href={createHref} className={buttonVariants({ variant: 'outline' })}>
              <Plus aria-hidden="true" data-icon="inline-start" />
              {mode === 'my' ? t('createIssue') : t('create')}
            </Link>
          )}
        </ContentEmpty>
      ) : (
        <div className="min-w-0">
          <div
            aria-hidden="true"
            className={
              mode === 'my'
                ? 'text-muted-foreground hidden min-h-9 grid-cols-[minmax(12rem,1fr)_7rem_7.5rem_8rem_6.5rem_5.5rem] items-center gap-2 border-b px-2 text-xs font-medium lg:grid xl:grid-cols-[minmax(16rem,1fr)_8rem_8.5rem_9rem_7rem_6rem]'
                : 'text-muted-foreground hidden min-h-9 grid-cols-[minmax(16rem,1fr)_8.5rem_9rem_7rem_6rem] items-center gap-2 border-b px-2 text-xs font-medium lg:grid'
            }
          >
            <span>{t('columns.issue')}</span>
            {mode === 'my' ? <span>{t('columns.team')}</span> : null}
            <span>{t('columns.state')}</span>
            <span>{t('columns.assignee')}</span>
            <span>{t('columns.priority')}</span>
            <span className="text-right">{t('columns.updatedAt')}</span>
          </div>
          <ul>
            {issueItems.map((issue) => {
              const teamIndex = optionTeamIds.indexOf(issue.team.id);
              return (
                <IssueRow
                  key={issue.id}
                  activeLabels={activeLabels}
                  currentMembershipId={currentMembershipId}
                  currentQueryKey={currentQueryKey}
                  issue={issue}
                  labels={rowLabels}
                  members={memberQueries[teamIndex]?.data?.items ?? []}
                  mode={mode}
                  workflowStates={workflowStateQueries[teamIndex]?.data?.items ?? []}
                />
              );
            })}
          </ul>
          {issues.isFetchNextPageError ? (
            <Alert variant="destructive" className="mt-4 pr-28">
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
                  {t('retry')}
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
                {issues.isFetchingNextPage ? t('pagination.loading') : t('pagination.more')}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
