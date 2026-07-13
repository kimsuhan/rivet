'use client';

import type { QueryKey } from '@tanstack/react-query';
import { AlertCircle, MoreHorizontal, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type {
  IssueLabelSummaryResponseDto,
  IssueSummaryResponseDto,
  LabelResponseDto,
} from '@rivet/api-client';

import { Button, buttonVariants } from '@/components/ui/button';
import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

import {
  FEATURE_ISSUE_LIST_GRID_CELL_CLASS,
  FEATURE_ISSUE_LIST_GRID_CLASS,
} from './feature-issue-list-layout';
import { FEATURE_ISSUE_PRIORITIES, type FeatureProjectRole } from './feature-issue-list-state';
import {
  type FeatureIssueAction,
  type FeatureIssueNextAction,
  featureIssueNextAction,
} from './feature-issue-next-action';
import {
  FEATURE_STATUS_PRESENTATION,
  ISSUE_PRIORITY_PRESENTATION,
} from './issue-attribute-presentation';
import { IssueFilterMenu } from './issue-filter-menu';
import { IssueInlineSelect } from './issue-inline-select';
import { IssueLabelChips } from './issue-label-chips';
import { useIssueInlineMutation } from './issue-mutations';

export type FeatureIssueListItem = IssueSummaryResponseDto & {
  assignee: null;
  status: IssueSummaryResponseDto['status'] & {
    featureStatus: NonNullable<IssueSummaryResponseDto['status']['featureStatus']>;
    workflowState: null;
  };
  team: null;
  type: 'FEATURE';
  workflowSummary: NonNullable<IssueSummaryResponseDto['workflowSummary']>;
};

function relativeUpdatedAt(value: string): { full: string; short: string } {
  const date = new Date(value);
  const differenceSeconds = Math.round((date.getTime() - Date.now()) / 1_000);
  const formatter = new Intl.RelativeTimeFormat('ko', { numeric: 'auto' });
  let short: string;

  if (Math.abs(differenceSeconds) < 60) short = formatter.format(0, 'second');
  else if (Math.abs(differenceSeconds) < 3_600)
    short = formatter.format(Math.round(differenceSeconds / 60), 'minute');
  else if (Math.abs(differenceSeconds) < 86_400)
    short = formatter.format(Math.round(differenceSeconds / 3_600), 'hour');
  else if (Math.abs(differenceSeconds) < 604_800)
    short = formatter.format(Math.round(differenceSeconds / 86_400), 'day');
  else short = new Intl.DateTimeFormat('ko-KR', { day: 'numeric', month: 'short' }).format(date);

  return {
    full: new Intl.DateTimeFormat('ko-KR', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date),
    short,
  };
}

function toIssueLabel(label: LabelResponseDto): IssueLabelSummaryResponseDto {
  return {
    archived: label.archived,
    color: label.color,
    id: label.id,
    name: label.name,
  };
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function FeatureIssuePrimaryAction({
  accessibleLabel,
  action,
  issue,
  onAction,
  visibleLabel,
}: {
  accessibleLabel: string;
  action: FeatureIssueNextAction;
  issue: FeatureIssueListItem;
  onAction: (action: FeatureIssueAction, issue: FeatureIssueListItem) => void;
  visibleLabel: string;
}) {
  const assignedTask = issue.workflowSummary.currentUserAssignedTeamTasks[0];
  const visualClassName =
    action === 'ASSIGN_TEAM_TASKS'
      ? 'bg-warning/10 text-warning group-hover/button:bg-warning/15'
      : action === 'COMPLETE_ISSUE'
        ? 'bg-success/10 text-success group-hover/button:bg-success/15'
        : action === 'START_WORK'
          ? 'bg-secondary/60 text-secondary-foreground group-hover/button:bg-secondary'
          : 'text-muted-foreground group-hover/button:bg-muted/60 group-hover/button:text-foreground';
  const visual = (
    <span
      data-slot="issue-action-visual"
      className={cn(
        'flex h-8 max-w-full items-center rounded-md px-2 text-[13px] font-medium transition-colors',
        visualClassName,
      )}
    >
      <span className="truncate">{visibleLabel}</span>
    </span>
  );

  if (action === 'VIEW_DETAIL') return null;

  if (action === 'OPEN_MY_WORK' && assignedTask) {
    return (
      <Link
        href={`/issues/${encodeURIComponent(assignedTask.identifier)}`}
        aria-label={accessibleLabel}
        title={accessibleLabel}
        className={cn(
          buttonVariants({ size: 'sm', variant: 'ghost' }),
          'pointer-events-auto relative z-10 min-h-11 min-w-0 bg-transparent p-0 hover:bg-transparent max-lg:flex-1 lg:min-h-10 dark:hover:bg-transparent',
        )}
      >
        {visual}
      </Link>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      aria-label={accessibleLabel}
      title={accessibleLabel}
      className="pointer-events-auto relative z-10 min-h-11 min-w-0 bg-transparent p-0 hover:bg-transparent max-lg:flex-1 lg:min-h-10 dark:hover:bg-transparent"
      onClick={() => onAction(action, issue)}
    >
      {visual}
    </Button>
  );
}

export function FeatureIssueRow({
  activeLabels,
  currentQueryKey,
  issue,
  onAction,
}: {
  activeLabels: LabelResponseDto[];
  currentQueryKey: QueryKey;
  issue: FeatureIssueListItem;
  onAction: (action: FeatureIssueAction, issue: FeatureIssueListItem) => void;
}) {
  const t = useTranslations('FeatureIssues');
  const mutation = useIssueInlineMutation({ currentQueryKey });
  const summary = issue.workflowSummary;
  const action = featureIssueNextAction({
    activeRoles: summary.activeRoles,
    allTargetTasksCompleted: summary.allTargetTasksCompleted,
    currentUserAssignedTeamTaskCount: summary.currentUserAssignedTeamTasks.length,
    currentUserTeamRoles: summary.currentUserTeamRoles,
    featureStatus: issue.status.featureStatus,
    teamTaskCount: summary.teamTaskCount,
    unassignedCount: summary.unassignedCount,
  });
  const labelOptions = uniqueById([...issue.labels, ...activeLabels.map(toIssueLabel)]);
  const updatedAt = relativeUpdatedAt(issue.updatedAt);
  const targetTaskCount = Math.max(0, summary.teamTaskCount - summary.canceledCount);
  const progress =
    targetTaskCount === 0 ? 0 : Math.round((summary.completedCount / targetTaskCount) * 100);
  const waitingOn = summary.waitingOn[0];
  const roleLabel = (role: FeatureProjectRole) => t(`roles.${role}`);
  const startableRoles = summary.currentUserTeamRoles.filter(
    (role) => !summary.activeRoles.includes(role),
  );
  const actionLabel =
    action === 'START_FROM_MY_TEAM' && startableRoles.length === 1
      ? t('actions.START_ROLE_WORK', { role: roleLabel(startableRoles[0]!) })
      : t(`actions.${action}`);
  const visibleActionLabel =
    action === 'START_FROM_MY_TEAM' && startableRoles.length === 1
      ? t('actions.START_WORK')
      : actionLabel;
  const currentWork =
    summary.teamTaskCount === 0
      ? t('row.analysis')
      : waitingOn
        ? summary.waitingOn.length > 1
          ? t('row.waitingOnMore', {
              count: summary.waitingOn.length - 1,
              identifier: waitingOn.identifier,
            })
          : t('row.waitingOn', { identifier: waitingOn.identifier })
        : summary.allTargetTasksCompleted
          ? t('row.allComplete')
          : summary.activeRoleTeams.length === 0
            ? t('row.noActiveWork')
            : summary.activeRoleTeams.length > 2
              ? t('row.parallelMore', {
                  count: summary.activeRoleTeams.length - 1,
                  role: roleLabel(summary.activeRoleTeams[0]!.projectRole),
                })
              : summary.activeRoleTeams.length > 1
                ? t('row.parallel', {
                    roles: summary.activeRoleTeams
                      .map(({ projectRole }) => roleLabel(projectRole))
                      .join(' · '),
                  })
                : summary.activeRoleTeams[0]?.unassignedCount
                  ? t('row.assignmentRequired', {
                      role: roleLabel(summary.activeRoleTeams[0].projectRole),
                    })
                  : t('row.inProgress', {
                      role: summary.activeRoleTeams[0]
                        ? roleLabel(summary.activeRoleTeams[0].projectRole)
                        : t('row.work'),
                    });
  const secondaryActions = [
    ...(summary.currentUserTeamRoles.some((role) => {
      const activeRole = summary.activeRoleTeams.find(({ projectRole }) => projectRole === role);
      return !summary.activeRoles.includes(role) || Boolean(activeRole?.unassignedCount);
    }) && !summary.allTargetTasksCompleted
      ? (['CLAIM'] as const)
      : []),
  ];

  const priorityBusy =
    mutation.isPendingFor?.(issue.id, 'priority') ??
    (mutation.isPending &&
      mutation.variables?.issue.id === issue.id &&
      mutation.variables.change.kind === 'priority');
  const labelsBusy =
    mutation.isPendingFor?.(issue.id, 'labels') ??
    (mutation.isPending &&
      mutation.variables?.issue.id === issue.id &&
      mutation.variables.change.kind === 'labels');

  function cellFailure(kind: 'labels' | 'priority') {
    const failure = mutation.failureFor?.(issue.id, kind);
    if (failure) return failure;

    const variables = mutation.variables;
    if (!variables || variables.issue.id !== issue.id || variables.change.kind !== kind) {
      return undefined;
    }
    if (!mutation.conflict && !mutation.isError) return undefined;

    return { isConflict: Boolean(mutation.conflict) };
  }

  function retryCell(kind: 'labels' | 'priority') {
    if (mutation.retryFor) mutation.retryFor(issue.id, kind);
    else mutation.retry();
  }

  function reapplyCellConflict(kind: 'labels' | 'priority') {
    if (mutation.reapplyConflictFor) void mutation.reapplyConflictFor(issue.id, kind);
    else void mutation.reapplyConflict();
  }

  const priorityFailure = cellFailure('priority');
  const priorityError = priorityFailure
    ? priorityFailure.isConflict
      ? {
          actionLabel: t('inline.reapply'),
          description: t('inline.conflict'),
          onAction: () => reapplyCellConflict('priority'),
        }
      : {
          actionLabel: t('retry'),
          description: t('inline.error'),
          onAction: () => retryCell('priority'),
        }
    : undefined;

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

  function statusEditor(className?: string) {
    const currentLabel = t(`statuses.${issue.status.featureStatus}`);
    const presentation = FEATURE_STATUS_PRESENTATION[issue.status.featureStatus];
    const Icon = presentation.icon;

    return (
      <span
        className={cn(
          'inline-flex min-h-7 items-center gap-1.5 text-xs font-medium whitespace-nowrap',
          className,
        )}
        aria-label={t('inline.currentValue', {
          identifier: issue.identifier,
          property: t('columns.status'),
          value: currentLabel,
        })}
      >
        <Icon aria-hidden="true" className={cn('size-4 shrink-0', presentation.iconClassName)} />
        {currentLabel}
      </span>
    );
  }

  function priorityEditor(className?: string) {
    const currentLabel = t(`priorities.${issue.priority}`);

    return (
      <IssueInlineSelect
        appearance="compact"
        ariaLabel={t('inline.currentValue', {
          identifier: issue.identifier,
          property: t('columns.priority'),
          value: currentLabel,
        })}
        disabled={priorityBusy}
        busy={priorityBusy}
        error={priorityError}
        onValueChange={(value) => {
          if (
            FEATURE_ISSUE_PRIORITIES.includes(value as (typeof FEATURE_ISSUE_PRIORITIES)[number])
          ) {
            mutation.mutate({
              change: {
                kind: 'priority',
                value: value as IssueSummaryResponseDto['priority'],
              },
              issue,
            });
          }
        }}
        options={FEATURE_ISSUE_PRIORITIES.map((priority) => ({
          ...ISSUE_PRIORITY_PRESENTATION[priority],
          label: t(`priorities.${priority}`),
          value: priority,
        }))}
        {...(className ? { triggerClassName: className } : {})}
        value={issue.priority}
      />
    );
  }

  function labelsEditor() {
    return (
      <IssueFilterMenu
        ariaLabel={t('inline.currentValue', {
          identifier: issue.identifier,
          property: t('columns.labels'),
          value: issue.labels.map((label) => label.name).join(', ') || t('filters.noOptions'),
        })}
        busy={labelsBusy}
        disabled={labelsBusy}
        emptyLabel={t('filters.noOptions')}
        label={t('columns.labels')}
        onChange={changeLabels}
        options={labelOptions.map((label) => ({
          id: label.id,
          label: label.name,
          swatch: label.color,
        }))}
        presentation="popover"
        selected={issue.labels.map((label) => label.id)}
        triggerClassName="hover:before:bg-muted/60 data-popup-open:before:bg-muted pointer-events-none relative isolate min-h-11 min-w-11 border-transparent bg-transparent px-0 opacity-0 before:absolute before:top-1/2 before:left-1/2 before:-z-10 before:size-8 before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-md before:bg-transparent before:transition-colors hover:bg-transparent data-popup-open:pointer-events-auto data-popup-open:bg-transparent data-popup-open:opacity-100 group-focus-within/issue-row:pointer-events-auto group-focus-within/issue-row:opacity-100 group-hover/issue-row:pointer-events-auto group-hover/issue-row:opacity-100 lg:min-h-10 lg:min-w-10 [&>span]:sr-only"
      />
    );
  }

  const labelFailure = cellFailure('labels');
  const notice = labelFailure?.isConflict ? (
    <div role="alert" className="bg-warning/10 flex items-center gap-2 border-t px-3 py-2 text-xs">
      <AlertCircle aria-hidden="true" className="text-warning size-4 shrink-0" />
      <span className="min-w-0 flex-1">{t('inline.conflict')}</span>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="hover:before:bg-muted/60 relative isolate min-h-11 bg-transparent px-2 before:absolute before:inset-x-0 before:top-1/2 before:-z-10 before:h-8 before:-translate-y-1/2 before:rounded-md before:bg-transparent hover:bg-transparent lg:min-h-10"
        disabled={labelsBusy}
        onClick={() => reapplyCellConflict('labels')}
      >
        <RotateCcw aria-hidden="true" data-icon="inline-start" />
        {t('inline.reapply')}
      </Button>
    </div>
  ) : labelFailure ? (
    <div
      role="alert"
      className="bg-destructive/10 text-destructive flex items-center gap-2 border-t px-3 py-2 text-xs"
    >
      <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">{t('inline.error')}</span>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="hover:before:bg-muted/60 relative isolate min-h-11 bg-transparent px-2 before:absolute before:inset-x-0 before:top-1/2 before:-z-10 before:h-8 before:-translate-y-1/2 before:rounded-md before:bg-transparent hover:bg-transparent lg:min-h-10"
        disabled={labelsBusy}
        onClick={() => retryCell('labels')}
      >
        <RotateCcw aria-hidden="true" data-icon="inline-start" />
        {t('retry')}
      </Button>
    </div>
  ) : null;

  const actionControls = (
    <div className="flex min-w-0 items-center justify-end gap-1 max-xl:w-full">
      <FeatureIssuePrimaryAction
        accessibleLabel={actionLabel}
        action={action}
        issue={issue}
        onAction={onAction}
        visibleLabel={visibleActionLabel}
      />
      {secondaryActions.length > 0 ? (
        <div className="pointer-events-auto relative z-10">
          <Select
            items={secondaryActions.map((value) => ({ label: t(`actions.${value}`), value }))}
            value={null}
            onValueChange={(value) => {
              if (value === 'CLAIM') onAction(value, issue);
            }}
          >
            <SelectTrigger
              size="sm"
              aria-label={t('actions.moreForIssue', { identifier: issue.identifier })}
              title={t('actions.moreForIssue', { identifier: issue.identifier })}
              className="hover:before:bg-muted/60 data-popup-open:before:bg-muted relative isolate min-h-11 min-w-11 justify-center border-transparent bg-transparent p-0 before:absolute before:top-1/2 before:left-1/2 before:-z-10 before:size-8 before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-md before:bg-transparent before:transition-colors hover:border-transparent hover:bg-transparent data-popup-open:border-transparent data-popup-open:bg-transparent lg:min-h-10 lg:min-w-10 dark:bg-transparent dark:hover:bg-transparent [&_[data-slot=select-value]]:sr-only [&>svg:last-child]:hidden"
            >
              <MoreHorizontal aria-hidden="true" />
              <SelectValue placeholder={t('actions.more')} />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {secondaryActions.map((value) => (
                  <SelectItem
                    className="data-selected:bg-accent/60 min-h-11 lg:min-h-9"
                    key={value}
                    value={value}
                  >
                    {t(`actions.${value}`)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </div>
  );

  return (
    <li
      data-testid="feature-issue-row"
      className="group/issue-row border-border/60 hover:bg-muted/40 focus-within:bg-muted/20 border-b transition-colors"
    >
      <div className="relative">
        <Link
          href={`/issues/${encodeURIComponent(issue.identifier)}`}
          aria-label={issue.title}
          className="focus-visible:ring-ring/50 absolute inset-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-inset"
        />
        <div
          data-layout="feature-issue-list-grid"
          className={cn(
            'pointer-events-none grid grid-cols-2 gap-x-3 gap-y-3 px-3 py-4 xl:min-h-20 xl:py-2',
            FEATURE_ISSUE_LIST_GRID_CLASS,
          )}
        >
          <div
            data-column="issue"
            className={cn('min-w-0', FEATURE_ISSUE_LIST_GRID_CELL_CLASS.issue)}
          >
            <div className="flex min-w-0 items-start gap-2 lg:items-baseline">
              <span className="text-muted-foreground shrink-0 font-mono text-xs">
                {issue.identifier}
              </span>
              <span
                className="min-w-0 text-sm font-semibold break-words xl:truncate"
                title={issue.title}
              >
                {issue.title}
              </span>
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-1">
              <span
                className="text-muted-foreground min-w-12 shrink truncate text-xs"
                title={issue.project?.name ?? undefined}
              >
                {issue.project?.name ?? t('row.noProject')}
              </span>
              <IssueLabelChips emptyLabel={t('filters.noOptions')} labels={issue.labels} />
              {labelOptions.length > 0 ? (
                <div className="pointer-events-auto relative z-10 shrink-0">{labelsEditor()}</div>
              ) : null}
            </div>
          </div>

          <div
            data-column="status"
            data-testid="feature-issue-status"
            className={cn('flex min-w-0 items-center', FEATURE_ISSUE_LIST_GRID_CELL_CLASS.status)}
          >
            {statusEditor('relative z-10 min-w-0 text-muted-foreground')}
          </div>

          <div
            data-column="priority"
            data-testid="feature-issue-priority"
            className={cn('min-w-0', FEATURE_ISSUE_LIST_GRID_CELL_CLASS.priority)}
          >
            {priorityEditor('pointer-events-auto relative z-10 w-full text-muted-foreground')}
          </div>

          <div
            data-column="current-work"
            className={cn('min-w-0', FEATURE_ISSUE_LIST_GRID_CELL_CLASS.currentWork)}
          >
            <p className="truncate text-sm font-medium tracking-[-0.01em]" title={currentWork}>
              {currentWork}
            </p>
            {summary.activeRoleTeams[0] ? (
              <p
                className="text-muted-foreground mt-1 flex min-w-0 items-center gap-1 text-xs"
                title={`${summary.activeRoleTeams
                  .map(({ projectRole, team }) => `${roleLabel(projectRole)} · ${team.key}`)
                  .join(', ')}${
                  summary.unassignedCount > 0
                    ? ` · ${t('row.unassigned', { count: summary.unassignedCount })}`
                    : ''
                }`}
              >
                {summary.unassignedCount > 0 ? (
                  <span className="text-warning shrink-0">
                    {t('row.unassigned', { count: summary.unassignedCount })}
                  </span>
                ) : null}
                {summary.unassignedCount > 0 ? <span aria-hidden="true">·</span> : null}
                <span className="min-w-0 truncate">
                  {summary.activeRoleTeams.length > 1
                    ? t('row.activeTeamMore', {
                        count: summary.activeRoleTeams.length - 1,
                        role: roleLabel(summary.activeRoleTeams[0].projectRole),
                        team: summary.activeRoleTeams[0].team.key,
                      })
                    : t('row.activeTeam', {
                        role: roleLabel(summary.activeRoleTeams[0].projectRole),
                        team: summary.activeRoleTeams[0].team.key,
                      })}
                </span>
              </p>
            ) : null}
          </div>

          <Progress
            value={progress}
            data-column="progress"
            className={cn(
              '[&_[data-slot=progress-track]]:bg-muted/60 w-full max-w-56 gap-1.5 xl:max-w-none',
              FEATURE_ISSUE_LIST_GRID_CELL_CLASS.progress,
            )}
            aria-label={t('row.progress', {
              completed: summary.completedCount,
              percentage: progress,
              total: targetTaskCount,
            })}
          >
            <ProgressLabel className="sr-only">{t('columns.progress')}</ProgressLabel>
            <ProgressValue className="text-foreground ml-0 text-xs font-medium whitespace-nowrap tabular-nums">
              {() => `${summary.completedCount}/${targetTaskCount} · ${progress}%`}
            </ProgressValue>
          </Progress>

          <time
            data-column="updated-at"
            className={cn(
              'text-muted-foreground text-xs xl:text-right',
              FEATURE_ISSUE_LIST_GRID_CELL_CLASS.updatedAt,
            )}
            dateTime={issue.updatedAt}
            title={updatedAt.full}
          >
            {updatedAt.short}
          </time>

          <div data-column="next-action" className={FEATURE_ISSUE_LIST_GRID_CELL_CLASS.nextAction}>
            {actionControls}
          </div>
        </div>
      </div>
      {notice}
    </li>
  );
}
