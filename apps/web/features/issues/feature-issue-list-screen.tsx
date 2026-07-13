'use client';

import { ArrowDown, ArrowUp, Filter, ListTodo, Plus, Search, SearchX, X } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';

import {
  getIssuesControllerListQueryKey,
  type IssueSummaryResponseDto,
  useIssuesControllerList,
  useLabelsControllerList,
  useMembersControllerList,
  useProjectsControllerList,
} from '@rivet/api-client';

import { ContentEmpty } from '@/components/states/content-empty';
import { ContentError } from '@/components/states/content-error';
import { ContentLoading } from '@/components/states/content-loading';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group';
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

import { FeatureIssueActions } from './feature-issue-actions';
import {
  FEATURE_ISSUE_LIST_GRID_CLASS,
  FEATURE_ISSUE_LIST_GRID_ORDER,
} from './feature-issue-list-layout';
import {
  buildFeatureIssueListParams,
  clearFeatureIssueDetailFilters,
  clearFeatureIssueListState,
  FEATURE_ISSUE_PRIORITIES,
  FEATURE_ISSUE_STATUSES,
  FEATURE_PROJECT_ROLES,
  FEATURE_SORT_DIRECTIONS,
  FEATURE_SORT_FIELDS,
  FEATURE_WORK_QUEUES,
  hasFeatureIssueDetailFilters,
  hasFeatureIssueFilters,
  readFeatureIssueListState,
  replaceFeatureIssueSearchParam,
} from './feature-issue-list-state';
import type { FeatureIssueAction } from './feature-issue-next-action';
import { type FeatureIssueListItem, FeatureIssueRow } from './feature-issue-row';
import {
  FEATURE_STATUS_PRESENTATION,
  ISSUE_PRIORITY_PRESENTATION,
} from './issue-attribute-presentation';
import { IssueFilterMenu } from './issue-filter-menu';

type OpenAction = {
  action: Exclude<FeatureIssueAction, 'OPEN_MY_WORK' | 'VIEW_DETAIL'>;
  issue: FeatureIssueListItem;
};

function FeatureIssueSearchForm({
  initialQuery,
  onChange,
}: {
  initialQuery: string;
  onChange: (value: string | null) => void;
}) {
  const t = useTranslations('FeatureIssues');
  const [draft, setDraft] = useState(initialQuery);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onChange(draft.normalize('NFC').trim() || null);
  }

  return (
    <form className="w-full min-w-0 sm:w-80 md:w-96" role="search" onSubmit={submit}>
      <InputGroup className="lg:h-10">
        <InputGroupAddon>
          <Search aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          aria-label={t('search.label')}
          placeholder={t('search.placeholder')}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        {draft ? (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              aria-label={t('search.clear')}
              className="h-11 px-2 lg:h-10"
              onClick={() => {
                setDraft('');
                onChange(null);
              }}
            >
              {t('search.clear')}
            </InputGroupButton>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
    </form>
  );
}

function isFeatureIssueListItem(issue: IssueSummaryResponseDto): issue is FeatureIssueListItem {
  const candidate = issue as Partial<FeatureIssueListItem>;
  return (
    issue.type === 'FEATURE' &&
    issue.status.featureStatus !== null &&
    candidate.createdBy !== undefined &&
    candidate.workflowSummary !== undefined &&
    candidate.workflowSummary !== null
  );
}

export function FeatureIssueListScreen() {
  const t = useTranslations('FeatureIssues');
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const state = readFeatureIssueListState(searchParams);
  const params = buildFeatureIssueListParams(state);
  const issues = useIssuesControllerList(params, { query: { retry: false } });
  const projects = useProjectsControllerList(
    { includeArchived: false, limit: 100, sort: 'updatedAt', sortDirection: 'desc' },
    { query: { retry: false } },
  );
  const labels = useLabelsControllerList(
    { includeArchived: false, limit: 100 },
    { query: { retry: false } },
  );
  const members = useMembersControllerList(
    { limit: 100, status: 'ACTIVE' },
    { query: { retry: false } },
  );
  const [filterOpen, setFilterOpen] = useState(false);
  const [openAction, setOpenAction] = useState<OpenAction | null>(null);
  const items = (issues.data?.items ?? []).filter(isFeatureIssueListItem);
  const totalCount = issues.data?.totalCount ?? 0;
  const workQueueCounts = issues.data?.workQueueCounts;
  const activeLabels = (labels.data?.items ?? []).filter((label) => !label.archived);
  const currentQueryKey = getIssuesControllerListQueryKey(params);
  const filtersActive = hasFeatureIssueFilters(state);
  const detailedFiltersActive = hasFeatureIssueDetailFilters(state);
  const optionError = projects.isError || labels.isError || members.isError;
  const createQuery = new URLSearchParams(searchParams.toString());
  createQuery.delete('cursor');
  createQuery.set('create', '1');
  const createHref = `${pathname}?${createQuery.toString()}`;

  function pushUrl(
    key: Parameters<typeof replaceFeatureIssueSearchParam>[1],
    value: string | string[] | boolean | null,
  ) {
    const query = replaceFeatureIssueSearchParam(searchParams, key, value);
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function resetFilters() {
    const query = clearFeatureIssueListState(searchParams);
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function resetDetailFilters() {
    const query = clearFeatureIssueDetailFilters(searchParams);
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function retryOptions() {
    if (projects.isError) void projects.refetch();
    if (labels.isError) void labels.refetch();
    if (members.isError) void members.refetch();
  }

  function handleAction(action: FeatureIssueAction, issue: FeatureIssueListItem) {
    if (action === 'VIEW_DETAIL') {
      router.push(`/issues/${encodeURIComponent(issue.identifier)}`);
      return;
    }
    if (action === 'OPEN_MY_WORK') {
      const task = issue.workflowSummary.currentUserAssignedTeamTasks[0];
      if (task) router.push(`/issues/${encodeURIComponent(task.identifier)}`);
      return;
    }
    setOpenAction({ action, issue });
  }

  const detailedFilterChips = [
    ...state.projectIds.map((id) => ({
      key: `project-${id}`,
      label: t('filters.chip', {
        name: t('filters.project'),
        value: projects.data?.items.find((project) => project.id === id)?.name ?? id,
      }),
      remove: () =>
        pushUrl(
          'projectId',
          state.projectIds.filter((value) => value !== id),
        ),
    })),
    ...state.featureStatuses.map((value) => ({
      key: `status-${value}`,
      label: t('filters.chip', {
        name: t('filters.status'),
        value: t(`statuses.${value}`),
      }),
      remove: () =>
        pushUrl(
          'featureStatus',
          state.featureStatuses.filter((status) => status !== value),
        ),
    })),
    ...state.priorities.map((value) => ({
      key: `priority-${value}`,
      label: t('filters.chip', {
        name: t('filters.priority'),
        value: t(`priorities.${value}`),
      }),
      remove: () =>
        pushUrl(
          'priority',
          state.priorities.filter((priority) => priority !== value),
        ),
    })),
    ...state.activeProjectRoles.map((value) => ({
      key: `role-${value}`,
      label: t('filters.chip', {
        name: t('filters.activeRole'),
        value: t(`roles.${value}`),
      }),
      remove: () =>
        pushUrl(
          'activeProjectRole',
          state.activeProjectRoles.filter((role) => role !== value),
        ),
    })),
    ...(state.unassigned
      ? [
          {
            key: 'unassigned',
            label: t('filters.unassigned'),
            remove: () => pushUrl('unassigned', false),
          },
        ]
      : []),
    ...state.labelIds.map((id) => ({
      key: `label-${id}`,
      label: t('filters.chip', {
        name: t('filters.label'),
        value: activeLabels.find((label) => label.id === id)?.name ?? id,
      }),
      remove: () =>
        pushUrl(
          'labelId',
          state.labelIds.filter((value) => value !== id),
        ),
    })),
    ...state.createdByMembershipIds.map((id) => ({
      key: `creator-${id}`,
      label: t('filters.chip', {
        name: t('filters.createdBy'),
        value: members.data?.items.find((member) => member.id === id)?.user.displayName ?? id,
      }),
      remove: () =>
        pushUrl(
          'createdByMembershipId',
          state.createdByMembershipIds.filter((value) => value !== id),
        ),
    })),
    ...(state.createdFrom
      ? [
          {
            key: 'created-from',
            label: t('filters.dateFromChip', {
              name: t('filters.createdRange'),
              value: state.createdFrom,
            }),
            remove: () => pushUrl('createdFrom', null),
          },
        ]
      : []),
    ...(state.createdTo
      ? [
          {
            key: 'created-to',
            label: t('filters.dateToChip', {
              name: t('filters.createdRange'),
              value: state.createdTo,
            }),
            remove: () => pushUrl('createdTo', null),
          },
        ]
      : []),
    ...(state.updatedFrom
      ? [
          {
            key: 'updated-from',
            label: t('filters.dateFromChip', {
              name: t('filters.updatedRange'),
              value: state.updatedFrom,
            }),
            remove: () => pushUrl('updatedFrom', null),
          },
        ]
      : []),
    ...(state.updatedTo
      ? [
          {
            key: 'updated-to',
            label: t('filters.dateToChip', {
              name: t('filters.updatedRange'),
              value: state.updatedTo,
            }),
            remove: () => pushUrl('updatedTo', null),
          },
        ]
      : []),
  ];

  const emptyTitle =
    state.workQueue === 'REVIEW_REQUIRED'
      ? t('empty.review')
      : state.workQueue === 'ASSIGNMENT_REQUIRED'
        ? t('empty.assignment')
        : filtersActive
          ? t('empty.filtered')
          : t('empty.initial');
  const emptyAction = filtersActive ? t('empty.showAll') : t('empty.create');

  return (
    <section
      className="mx-auto w-full max-w-[96rem] min-w-0"
      data-testid="feature-issue-list-content"
    >
      <header className="flex min-h-11 flex-wrap items-center gap-3 pb-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="text-xl leading-8 font-semibold tracking-[-0.01em]">{t('title')}</h1>
          <span aria-live="polite" className="text-muted-foreground text-sm tabular-nums">
            {t('resultCount', { count: totalCount })}
          </span>
        </div>
        <Link
          href={createHref}
          className={cn(buttonVariants({ size: 'sm' }), 'ml-auto h-11 sm:h-10')}
        >
          <Plus aria-hidden="true" data-icon="inline-start" />
          {t('create')}
        </Link>
      </header>

      <div
        className="flex min-w-0 flex-wrap items-center gap-2 py-2.5"
        data-testid="feature-issue-toolbar"
      >
        <FeatureIssueSearchForm
          key={state.query}
          initialQuery={state.query}
          onChange={(value) => pushUrl('query', value)}
        />

        <div className="w-full sm:hidden">
          <Select
            items={FEATURE_WORK_QUEUES.map((value) => ({
              label: t('queues.optionLabel', {
                count: workQueueCounts?.[value] ?? 0,
                queue: t(`queues.${value}`),
              }),
              value,
            }))}
            value={state.workQueue}
            onValueChange={(value) => pushUrl('workQueue', value === 'ALL' ? null : value)}
          >
            <SelectTrigger
              aria-label={t('queues.currentLabel', {
                count: workQueueCounts?.[state.workQueue] ?? 0,
                queue: t(`queues.${state.workQueue}`),
              })}
              className="min-h-11 w-full"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {FEATURE_WORK_QUEUES.map((value) => {
                  const count = workQueueCounts?.[value] ?? 0;
                  return (
                    <SelectItem
                      className="data-selected:bg-accent/60 min-h-11 lg:min-h-9"
                      key={value}
                      value={value}
                    >
                      <span className="flex w-full items-center justify-between gap-3">
                        <span>{t(`queues.${value}`)}</span>
                        <span className="text-muted-foreground tabular-nums">{count}</span>
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <Tabs className="hidden min-w-0 shrink-0 sm:flex" value={state.workQueue}>
          <TabsList
            variant="line"
            aria-label={t('queues.label')}
            className="p-0 group-data-horizontal/tabs:h-11"
          >
            {FEATURE_WORK_QUEUES.map((value) => {
              const count = workQueueCounts?.[value] ?? 0;
              const queueQuery = replaceFeatureIssueSearchParam(
                searchParams,
                'workQueue',
                value === 'ALL' ? null : value,
              );
              return (
                <TabsTrigger
                  key={value}
                  value={value}
                  nativeButton={false}
                  render={
                    <Link
                      href={queueQuery ? `${pathname}?${queueQuery}` : pathname}
                      scroll={false}
                    />
                  }
                  aria-label={t('queues.optionLabel', {
                    count,
                    queue: t(`queues.${value}`),
                  })}
                >
                  <span>{t(`queues.${value}`)}</span>
                  <span
                    className={cn(
                      'text-muted-foreground tabular-nums',
                      count === 0 && 'opacity-70',
                    )}
                  >
                    {count}
                  </span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>

        <div className="flex min-w-0 flex-wrap items-center gap-2 lg:ml-auto">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-expanded={filterOpen}
            aria-haspopup="dialog"
            aria-pressed={detailedFiltersActive}
            className={cn(
              'hover:before:bg-muted/60 focus-visible:ring-ring focus-visible:ring-offset-background relative isolate h-11 border-transparent bg-transparent px-2 text-[13px] before:absolute before:inset-x-0 before:top-1/2 before:-z-10 before:h-8 before:-translate-y-1/2 before:rounded-md before:bg-transparent hover:bg-transparent focus-visible:ring-offset-2 sm:h-10',
              (detailedFiltersActive || filterOpen) && 'text-foreground before:bg-muted',
            )}
            onClick={() => setFilterOpen(true)}
          >
            <Filter aria-hidden="true" data-icon="inline-start" />
            {detailedFiltersActive
              ? t('filters.detailCount', { count: detailedFilterChips.length })
              : t('filters.detail')}
          </Button>
          <Select
            items={FEATURE_SORT_FIELDS.map((value) => ({ label: t(`sort.${value}`), value }))}
            value={state.sort}
            onValueChange={(value) => pushUrl('sort', value === 'updatedAt' ? null : value)}
          >
            <SelectTrigger size="sm" variant="inline" aria-label={t('sort.field')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {FEATURE_SORT_FIELDS.map((value) => (
                  <SelectItem
                    className="data-selected:bg-accent/60 min-h-11 lg:min-h-9"
                    key={value}
                    value={value}
                  >
                    {t(`sort.${value}`)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select
            items={FEATURE_SORT_DIRECTIONS.map((value) => ({ label: t(`sort.${value}`), value }))}
            value={state.sortDirection}
            onValueChange={(value) => pushUrl('sortDirection', value === 'desc' ? null : value)}
          >
            <SelectTrigger
              size="sm"
              variant="inline"
              aria-label={t('sort.currentDirection', {
                direction: t(`sort.${state.sortDirection}`),
              })}
              title={t(`sort.${state.sortDirection}`)}
              className="min-w-11 justify-center p-0 sm:min-w-10 [&_[data-slot=select-value]]:sr-only [&>svg:last-child]:hidden"
            >
              {state.sortDirection === 'desc' ? (
                <ArrowDown aria-hidden="true" className="size-3.5" />
              ) : (
                <ArrowUp aria-hidden="true" className="size-3.5" />
              )}
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {FEATURE_SORT_DIRECTIONS.map((value) => (
                  <SelectItem
                    className="data-selected:bg-accent/60 min-h-11 lg:min-h-9"
                    key={value}
                    value={value}
                  >
                    {value === 'desc' ? (
                      <ArrowDown aria-hidden="true" className="size-3.5" />
                    ) : (
                      <ArrowUp aria-hidden="true" className="size-3.5" />
                    )}
                    {t(`sort.${value}`)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      {detailedFiltersActive ? (
        <div
          aria-label={t('filters.active')}
          role="group"
          className="flex min-w-0 flex-wrap items-center gap-1.5 pb-2"
        >
          <span className="text-muted-foreground text-xs font-medium">{t('filters.active')}</span>
          {detailedFilterChips.map((chip) => (
            <Button
              key={chip.key}
              type="button"
              size="sm"
              variant="ghost"
              className="before:bg-muted/50 hover:before:bg-muted relative isolate h-11 max-w-full gap-1 bg-transparent px-2 text-xs font-normal before:absolute before:inset-x-0 before:top-1/2 before:-z-10 before:h-8 before:-translate-y-1/2 before:rounded-md hover:bg-transparent sm:h-10"
              aria-label={t('filters.removeChip', { label: chip.label })}
              onClick={chip.remove}
            >
              <span className="truncate">{chip.label}</span>
              <X aria-hidden="true" />
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="hover:before:bg-muted/60 relative isolate h-11 bg-transparent px-2 text-xs before:absolute before:inset-x-0 before:top-1/2 before:-z-10 before:h-8 before:-translate-y-1/2 before:rounded-md before:bg-transparent hover:bg-transparent sm:h-10"
            onClick={resetDetailFilters}
          >
            {t('filters.clearDetails')}
          </Button>
        </div>
      ) : null}

      {issues.isPending ? (
        <ContentLoading label={t('loading')} />
      ) : issues.isError ? (
        <ContentError
          title={t('error.title')}
          description={t('error.description')}
          retryLabel={t('retry')}
          retryButtonClassName="min-h-11 sm:min-h-10"
          onRetry={() => void issues.refetch()}
        />
      ) : items.length === 0 ? (
        <ContentEmpty
          icon={filtersActive ? SearchX : ListTodo}
          title={emptyTitle}
          description={t('empty.description')}
        >
          {filtersActive ? (
            <Button type="button" variant="outline" className="h-11 sm:h-10" onClick={resetFilters}>
              {emptyAction}
            </Button>
          ) : (
            <Link
              href={createHref}
              className={cn(buttonVariants({ variant: 'outline' }), 'h-11 sm:h-10')}
            >
              {emptyAction}
            </Link>
          )}
        </ContentEmpty>
      ) : (
        <div className="min-w-0">
          <div
            aria-hidden="true"
            data-layout="feature-issue-list-grid"
            className={cn(
              'text-muted-foreground hidden min-h-9 border-b px-3 text-xs font-medium xl:grid',
              FEATURE_ISSUE_LIST_GRID_CLASS,
            )}
          >
            <span data-column="issue" className={FEATURE_ISSUE_LIST_GRID_ORDER.issue}>
              {t('columns.issue')}
            </span>
            <span data-column="status" className={FEATURE_ISSUE_LIST_GRID_ORDER.status}>
              {t('columns.status')}
            </span>
            <span data-column="priority" className={FEATURE_ISSUE_LIST_GRID_ORDER.priority}>
              {t('columns.priority')}
            </span>
            <span data-column="current-work" className={FEATURE_ISSUE_LIST_GRID_ORDER.currentWork}>
              {t('columns.currentWork')}
            </span>
            <span data-column="progress" className={FEATURE_ISSUE_LIST_GRID_ORDER.progress}>
              {t('columns.progress')}
            </span>
            <span
              data-column="updated-at"
              className={cn('text-right', FEATURE_ISSUE_LIST_GRID_ORDER.updatedAt)}
            >
              {t('columns.updatedAt')}
            </span>
            <span
              data-column="next-action"
              className={cn('text-right', FEATURE_ISSUE_LIST_GRID_ORDER.nextAction)}
            >
              {t('columns.nextAction')}
            </span>
          </div>
          <ul>
            {items.map((issue) => (
              <FeatureIssueRow
                key={issue.id}
                activeLabels={activeLabels}
                currentQueryKey={currentQueryKey}
                issue={issue}
                onAction={handleAction}
              />
            ))}
          </ul>
        </div>
      )}

      {issues.data && (state.cursor || issues.data.nextCursor) ? (
        <div className="mt-4 flex justify-end gap-2">
          {state.cursor ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-11 sm:h-10"
              onClick={() => pushUrl('cursor', null)}
            >
              {t('pagination.first')}
            </Button>
          ) : null}
          {issues.data.nextCursor ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-11 sm:h-10"
              onClick={() => pushUrl('cursor', issues.data.nextCursor)}
            >
              {t('pagination.next')}
            </Button>
          ) : null}
        </div>
      ) : null}

      <Dialog open={filterOpen} onOpenChange={setFilterOpen}>
        <DialogContent
          closeLabel={t('filters.close')}
          closeButtonClassName="min-h-11 min-w-11 sm:min-h-10 sm:min-w-10"
          className="inset-0 h-dvh max-w-none translate-x-0 translate-y-0 grid-rows-[auto_1fr] rounded-none border-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:border"
        >
          <DialogHeader>
            <DialogTitle>{t('filters.title')}</DialogTitle>
            <DialogDescription>{t('filters.description')}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto pr-1">
            {optionError ? (
              <Alert variant="destructive" className="mb-4">
                <AlertTitle>{t('filters.optionsErrorTitle')}</AlertTitle>
                <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                  <span>{t('filters.optionsErrorDescription')}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-11 sm:h-10"
                    onClick={retryOptions}
                  >
                    {t('retry')}
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
            <FieldGroup>
              <Field>
                <FieldLabel>{t('filters.project')}</FieldLabel>
                <IssueFilterMenu
                  emptyLabel={t('filters.noOptions')}
                  label={t('filters.project')}
                  onChange={(value) => pushUrl('projectId', value)}
                  options={(projects.data?.items ?? []).map((project) => ({
                    id: project.id,
                    label: project.name,
                  }))}
                  selected={state.projectIds}
                  triggerClassName="h-11 sm:h-10"
                />
              </Field>
              <Field>
                <FieldLabel>{t('filters.status')}</FieldLabel>
                <IssueFilterMenu
                  emptyLabel={t('filters.noOptions')}
                  label={t('filters.status')}
                  onChange={(value) => pushUrl('featureStatus', value)}
                  options={FEATURE_ISSUE_STATUSES.map((value) => ({
                    ...FEATURE_STATUS_PRESENTATION[value],
                    id: value,
                    label: t(`statuses.${value}`),
                  }))}
                  selected={state.featureStatuses}
                  triggerClassName="h-11 sm:h-10"
                />
              </Field>
              <Field>
                <FieldLabel>{t('filters.priority')}</FieldLabel>
                <IssueFilterMenu
                  emptyLabel={t('filters.noOptions')}
                  label={t('filters.priority')}
                  onChange={(value) => pushUrl('priority', value)}
                  options={FEATURE_ISSUE_PRIORITIES.map((value) => ({
                    ...ISSUE_PRIORITY_PRESENTATION[value],
                    id: value,
                    label: t(`priorities.${value}`),
                  }))}
                  selected={state.priorities}
                  triggerClassName="h-11 sm:h-10"
                />
              </Field>
              <Field>
                <FieldLabel>{t('filters.activeRole')}</FieldLabel>
                <IssueFilterMenu
                  emptyLabel={t('filters.noOptions')}
                  label={t('filters.activeRole')}
                  onChange={(value) => pushUrl('activeProjectRole', value)}
                  options={FEATURE_PROJECT_ROLES.map((value) => ({
                    id: value,
                    label: t(`roles.${value}`),
                  }))}
                  selected={state.activeProjectRoles}
                  triggerClassName="h-11 sm:h-10"
                />
              </Field>
              <Field orientation="horizontal" className="w-fit">
                <Checkbox
                  id="feature-unassigned"
                  checked={state.unassigned}
                  onCheckedChange={(value) => pushUrl('unassigned', value === true)}
                />
                <FieldLabel htmlFor="feature-unassigned">{t('filters.unassigned')}</FieldLabel>
              </Field>
              <Field>
                <FieldLabel>{t('filters.label')}</FieldLabel>
                <IssueFilterMenu
                  emptyLabel={t('filters.noOptions')}
                  label={t('filters.label')}
                  onChange={(value) => pushUrl('labelId', value)}
                  options={activeLabels.map((label) => ({
                    id: label.id,
                    label: label.name,
                    swatch: label.color,
                  }))}
                  selected={state.labelIds}
                  triggerClassName="h-11 sm:h-10"
                />
              </Field>
              <Field>
                <FieldLabel>{t('filters.createdBy')}</FieldLabel>
                <IssueFilterMenu
                  emptyLabel={t('filters.noOptions')}
                  label={t('filters.createdBy')}
                  onChange={(value) => pushUrl('createdByMembershipId', value)}
                  options={(members.data?.items ?? []).map((member) => ({
                    id: member.id,
                    label: member.user.displayName,
                  }))}
                  selected={state.createdByMembershipIds}
                  triggerClassName="h-11 sm:h-10"
                />
              </Field>
              <FieldSet>
                <FieldLegend>{t('filters.createdRange')}</FieldLegend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="feature-created-from">{t('filters.from')}</FieldLabel>
                    <Input
                      id="feature-created-from"
                      type="date"
                      value={state.createdFrom}
                      onChange={(event) => pushUrl('createdFrom', event.target.value || null)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="feature-created-to">{t('filters.to')}</FieldLabel>
                    <Input
                      id="feature-created-to"
                      type="date"
                      value={state.createdTo}
                      onChange={(event) => pushUrl('createdTo', event.target.value || null)}
                    />
                  </Field>
                </div>
              </FieldSet>
              <FieldSet>
                <FieldLegend>{t('filters.updatedRange')}</FieldLegend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="feature-updated-from">{t('filters.from')}</FieldLabel>
                    <Input
                      id="feature-updated-from"
                      type="date"
                      value={state.updatedFrom}
                      onChange={(event) => pushUrl('updatedFrom', event.target.value || null)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="feature-updated-to">{t('filters.to')}</FieldLabel>
                    <Input
                      id="feature-updated-to"
                      type="date"
                      value={state.updatedTo}
                      onChange={(event) => pushUrl('updatedTo', event.target.value || null)}
                    />
                  </Field>
                </div>
              </FieldSet>
            </FieldGroup>
          </div>
        </DialogContent>
      </Dialog>

      {openAction ? (
        <FeatureIssueActions
          key={`${openAction.issue.id}-${openAction.action}`}
          action={openAction.action}
          issue={openAction.issue}
          onClose={() => setOpenAction(null)}
        />
      ) : null}
    </section>
  );
}
