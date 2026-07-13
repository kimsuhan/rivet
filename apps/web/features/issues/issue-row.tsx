'use client';

import type { QueryKey } from '@tanstack/react-query';
import { AlertCircle, RotateCcw, UserRound } from 'lucide-react';

import type {
  IssueLabelSummaryResponseDto,
  IssueMemberSummaryResponseDto,
  IssueSummaryResponseDto,
  IssueWorkflowStateSummaryResponseDto,
  LabelResponseDto,
  MemberSummaryResponseDto,
  WorkflowStateResponseDto,
} from '@rivet/api-client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

import {
  ISSUE_PRIORITY_PRESENTATION,
  WORKFLOW_STATE_PRESENTATION,
} from './issue-attribute-presentation';
import { IssueFilterMenu } from './issue-filter-menu';
import { IssueInlineSelect } from './issue-inline-select';
import { IssueLabelChips } from './issue-label-chips';
import { ISSUE_PRIORITIES, type IssueListMode } from './issue-list-state';
import { useIssueInlineMutation } from './issue-mutations';
import type { TeamTaskIssue } from './issue-types';

export type IssueRowLabels = {
  assignee: string;
  conflictDescription: string;
  errorDescription: string;
  labels: string;
  noLabels: string;
  priorities: Record<(typeof ISSUE_PRIORITIES)[number], string>;
  priority: string;
  projectRoles: Record<'APP_FRONTEND' | 'BACKEND' | 'WEB_FRONTEND', string>;
  reapply: string;
  retry: string;
  state: string;
  unassigned: string;
};

function toIssueState(state: WorkflowStateResponseDto): IssueWorkflowStateSummaryResponseDto {
  return {
    category: state.category,
    id: state.id,
    isDefault: state.isDefault,
    name: state.name,
    position: state.position,
    version: state.version,
  };
}

function toIssueMember(member: MemberSummaryResponseDto): IssueMemberSummaryResponseDto {
  return {
    id: member.id,
    role: member.role,
    status: member.status,
    user: member.user,
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

export function IssueRow({
  activeLabels,
  currentMembershipId,
  currentQueryKey,
  issue,
  labels,
  members,
  mode,
  workflowStates,
}: {
  activeLabels: LabelResponseDto[];
  currentMembershipId: string | null;
  currentQueryKey: QueryKey;
  issue: TeamTaskIssue;
  labels: IssueRowLabels;
  members: MemberSummaryResponseDto[];
  mode: IssueListMode;
  workflowStates: WorkflowStateResponseDto[];
}) {
  const mutation = useIssueInlineMutation({
    currentQueryKey,
    ...(mode === 'my'
      ? {
          removeAfterSuccess: (updated: IssueSummaryResponseDto) =>
            updated.assignee?.id !== currentMembershipId ||
            updated.status.category === 'COMPLETED' ||
            updated.status.category === 'CANCELED',
        }
      : {}),
  });
  const stateOptions = uniqueById([
    issue.status.workflowState,
    ...workflowStates.map(toIssueState),
  ]).sort((left, right) => left.position - right.position);
  const memberOptions = uniqueById([
    ...(issue.assignee ? [issue.assignee] : []),
    ...members.map(toIssueMember),
  ]);
  const labelOptions = uniqueById([...issue.labels, ...activeLabels.map(toIssueLabel)]);
  const updatedAt = relativeUpdatedAt(issue.updatedAt);

  function isPendingFor(kind: 'assignee' | 'labels' | 'priority' | 'workflowState') {
    return (
      mutation.isPendingFor?.(issue.id, kind) ??
      (mutation.isPending &&
        mutation.variables?.issue.id === issue.id &&
        mutation.variables.change.kind === kind)
    );
  }

  function cellFailure(kind: 'assignee' | 'labels' | 'priority' | 'workflowState') {
    const failure = mutation.failureFor?.(issue.id, kind);
    if (failure) return failure;

    const variables = mutation.variables;
    if (!variables || variables.issue.id !== issue.id || variables.change.kind !== kind) {
      return undefined;
    }
    if (!mutation.conflict && !mutation.isError) return undefined;

    return { isConflict: Boolean(mutation.conflict) };
  }

  function retryCell(kind: 'assignee' | 'labels' | 'priority' | 'workflowState') {
    if (mutation.retryFor) mutation.retryFor(issue.id, kind);
    else mutation.retry();
  }

  function reapplyCellConflict(kind: 'assignee' | 'labels' | 'priority' | 'workflowState') {
    if (mutation.reapplyConflictFor) void mutation.reapplyConflictFor(issue.id, kind);
    else void mutation.reapplyConflict();
  }

  function errorFor(kind: 'assignee' | 'priority' | 'workflowState') {
    const failure = cellFailure(kind);
    if (!failure) return undefined;

    if (failure.isConflict) {
      return {
        actionLabel: labels.reapply,
        description: labels.conflictDescription,
        onAction: () => reapplyCellConflict(kind),
      };
    }

    return {
      actionLabel: labels.retry,
      description: labels.errorDescription,
      onAction: () => retryCell(kind),
    };
  }

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

  function stateEditor(className?: string) {
    const currentState = issue.status.workflowState;
    const busy = isPendingFor('workflowState');
    return (
      <div className={cn('pointer-events-auto relative z-10', className)}>
        <IssueInlineSelect
          appearance="compact"
          ariaLabel={`${issue.identifier} ${labels.state}: ${currentState.name}`}
          busy={busy}
          disabled={busy}
          error={errorFor('workflowState')}
          onValueChange={(stateId) => {
            const state = stateOptions.find((candidate) => candidate.id === stateId);
            if (state) mutation.mutate({ change: { kind: 'workflowState', value: state }, issue });
          }}
          options={stateOptions.map((state) => ({
            ...WORKFLOW_STATE_PRESENTATION[state.category],
            label: state.name,
            value: state.id,
          }))}
          value={currentState.id}
        />
      </div>
    );
  }

  function assigneeEditor(className?: string) {
    const currentAssignee = issue.assignee?.user.displayName ?? labels.unassigned;
    const busy = isPendingFor('assignee');
    return (
      <div className={cn('pointer-events-auto relative z-10', className)}>
        <IssueInlineSelect
          appearance="compact"
          ariaLabel={`${issue.identifier} ${labels.assignee}: ${currentAssignee}`}
          busy={busy}
          disabled={busy}
          error={errorFor('assignee')}
          onValueChange={(memberId) => {
            const assignee =
              memberId === 'unassigned'
                ? null
                : (memberOptions.find((candidate) => candidate.id === memberId) ?? null);
            mutation.mutate({ change: { kind: 'assignee', value: assignee }, issue });
          }}
          options={[
            {
              icon: UserRound,
              iconClassName: 'text-muted-foreground',
              label: labels.unassigned,
              value: 'unassigned',
            },
            ...memberOptions.map((member) => ({
              icon: UserRound,
              iconClassName: 'text-muted-foreground',
              label: member.user.displayName,
              value: member.id,
            })),
          ]}
          value={issue.assignee?.id ?? 'unassigned'}
        />
      </div>
    );
  }

  function priorityEditor(className?: string) {
    const currentPriority = labels.priorities[issue.priority];
    const busy = isPendingFor('priority');
    return (
      <div className={cn('pointer-events-auto relative z-10', className)}>
        <IssueInlineSelect
          appearance="compact"
          ariaLabel={`${issue.identifier} ${labels.priority}: ${currentPriority}`}
          busy={busy}
          disabled={busy}
          error={errorFor('priority')}
          onValueChange={(priority) => {
            if (ISSUE_PRIORITIES.includes(priority as (typeof ISSUE_PRIORITIES)[number])) {
              mutation.mutate({
                change: {
                  kind: 'priority',
                  value: priority as IssueSummaryResponseDto['priority'],
                },
                issue,
              });
            }
          }}
          options={ISSUE_PRIORITIES.map((priority) => ({
            ...ISSUE_PRIORITY_PRESENTATION[priority],
            label: labels.priorities[priority],
            value: priority,
          }))}
          value={issue.priority}
        />
      </div>
    );
  }

  function labelsEditor(className?: string, interactionOnly = false) {
    const busy = isPendingFor('labels');
    return (
      <div className={cn('pointer-events-auto relative z-10 min-w-0', className)}>
        <IssueFilterMenu
          ariaLabel={`${issue.identifier} ${labels.labels}: ${issue.labels.map((label) => label.name).join(', ') || labels.noLabels}`}
          busy={busy}
          disabled={busy}
          emptyLabel={labels.noLabels}
          label={labels.labels}
          onChange={changeLabels}
          options={labelOptions.map((label) => ({
            id: label.id,
            label: label.name,
            swatch: label.color,
          }))}
          presentation="popover"
          selected={issue.labels.map((label) => label.id)}
          triggerClassName={cn(
            'border-transparent bg-transparent px-1.5 text-xs [&>span]:sr-only',
            interactionOnly &&
              'pointer-events-none opacity-0 data-popup-open:pointer-events-auto data-popup-open:opacity-100 group-focus-within/issue-row:pointer-events-auto group-focus-within/issue-row:opacity-100 group-hover/issue-row:pointer-events-auto group-hover/issue-row:opacity-100',
          )}
        />
      </div>
    );
  }

  const labelFailure = cellFailure('labels');
  const notice = labelFailure?.isConflict ? (
    <div
      role="alert"
      className="bg-warning/10 text-foreground flex items-center gap-2 border-t px-3 py-2 text-xs"
    >
      <AlertCircle aria-hidden="true" className="text-warning size-4 shrink-0" />
      <span className="min-w-0 flex-1">{labels.conflictDescription}</span>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="hover:before:bg-muted/60 relative isolate min-h-11 bg-transparent px-2 before:absolute before:inset-x-0 before:top-1/2 before:-z-10 before:h-8 before:-translate-y-1/2 before:rounded-md before:bg-transparent hover:bg-transparent lg:min-h-10"
        disabled={isPendingFor('labels')}
        onClick={() => reapplyCellConflict('labels')}
      >
        <RotateCcw aria-hidden="true" data-icon="inline-start" />
        {labels.reapply}
      </Button>
    </div>
  ) : labelFailure ? (
    <div
      role="alert"
      className="bg-destructive/10 text-destructive flex items-center gap-2 border-t px-3 py-2 text-xs"
    >
      <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">{labels.errorDescription}</span>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="hover:before:bg-muted/60 relative isolate min-h-11 bg-transparent px-2 before:absolute before:inset-x-0 before:top-1/2 before:-z-10 before:h-8 before:-translate-y-1/2 before:rounded-md before:bg-transparent hover:bg-transparent lg:min-h-10"
        disabled={isPendingFor('labels')}
        onClick={() => retryCell('labels')}
      >
        <RotateCcw aria-hidden="true" data-icon="inline-start" />
        {labels.retry}
      </Button>
    </div>
  ) : null;

  return (
    <li className="group/issue-row border-border/60 hover:bg-muted/40 focus-within:bg-muted/20 border-b transition-colors">
      <div className="relative">
        <Link
          href={`/issues/${encodeURIComponent(issue.identifier)}`}
          aria-label={issue.title}
          className="focus-visible:ring-ring/50 absolute inset-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-inset"
        />
        <div
          className={cn(
            'pointer-events-none hidden min-h-14 items-center gap-2 px-2 py-1.5 lg:grid',
            mode === 'my'
              ? 'grid-cols-[minmax(12rem,1fr)_7rem_7.5rem_8rem_6.5rem_5.5rem] xl:grid-cols-[minmax(16rem,1fr)_8rem_8.5rem_9rem_7rem_6rem]'
              : 'grid-cols-[minmax(16rem,1fr)_8.5rem_9rem_7rem_6rem]',
          )}
        >
          <div className="min-w-0">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="text-muted-foreground shrink-0 font-mono text-xs">
                {issue.identifier}
              </span>
              <span className="min-w-0 truncate text-sm font-medium">{issue.title}</span>
            </div>
            <div className="text-muted-foreground mt-1 flex min-w-0 items-center gap-1 text-xs">
              {issue.project ? (
                <span className="max-w-32 truncate">{issue.project.name}</span>
              ) : null}
              {issue.parentIssue ? (
                <span className="max-w-24 truncate">{issue.parentIssue.identifier}</span>
              ) : null}
              <IssueLabelChips emptyLabel={labels.noLabels} labels={issue.labels} />
              {labelOptions.length > 0 ? labelsEditor('ml-auto shrink-0', true) : null}
            </div>
          </div>
          {mode === 'my' ? (
            <span className="text-muted-foreground truncate px-1 text-xs" title={issue.team.name}>
              {issue.team.key}
              {issue.projectRole ? ` · ${labels.projectRoles[issue.projectRole]}` : ''}
            </span>
          ) : null}
          {stateEditor()}
          {assigneeEditor()}
          {priorityEditor()}
          <time
            className="text-muted-foreground px-1 text-right text-xs"
            dateTime={issue.updatedAt}
            title={updatedAt.full}
          >
            {updatedAt.short}
          </time>
        </div>

        <article className="pointer-events-none min-h-18 px-3 py-3 lg:hidden">
          <div className="flex min-w-0 items-start gap-2">
            <span className="text-muted-foreground shrink-0 pt-0.5 font-mono text-xs">
              {issue.identifier}
            </span>
            <span className="min-w-0 flex-1 text-sm leading-5 font-medium">{issue.title}</span>
            <time
              className="text-muted-foreground shrink-0 text-xs"
              dateTime={issue.updatedAt}
              title={updatedAt.full}
            >
              {updatedAt.short}
            </time>
          </div>
          <div className="text-muted-foreground mt-1 flex min-w-0 items-center gap-1 text-xs">
            {issue.project ? <span className="max-w-40 truncate">{issue.project.name}</span> : null}
            {issue.parentIssue ? <span>{issue.parentIssue.identifier}</span> : null}
            <IssueLabelChips emptyLabel={labels.noLabels} labels={issue.labels} limit={1} />
          </div>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
            {mode === 'my' ? (
              <Badge variant="outline" title={issue.team.name}>
                {issue.team.key}
                {issue.projectRole ? ` · ${labels.projectRoles[issue.projectRole]}` : ''}
              </Badge>
            ) : null}
            {stateEditor('max-w-36')}
            {assigneeEditor('max-w-40')}
            {priorityEditor('max-w-28')}
            {labelOptions.length > 0 ? labelsEditor(undefined, true) : null}
          </div>
        </article>
      </div>
      {notice}
    </li>
  );
}
