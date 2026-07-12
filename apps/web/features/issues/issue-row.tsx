'use client';

import type { QueryKey } from '@tanstack/react-query';
import { AlertCircle, RotateCcw } from 'lucide-react';

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

import { IssueFilterMenu } from './issue-filter-menu';
import { IssueInlineSelect } from './issue-inline-select';
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
  ]);
  const memberOptions = uniqueById([
    ...(issue.assignee ? [issue.assignee] : []),
    ...members.map(toIssueMember),
  ]);
  const labelOptions = uniqueById([...issue.labels, ...activeLabels.map(toIssueLabel)]);
  const updatedAt = relativeUpdatedAt(issue.updatedAt);
  const isPending = mutation.isPending;

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
    return (
      <div className={className}>
        <IssueInlineSelect
          ariaLabel={`${issue.identifier} ${labels.state}`}
          disabled={isPending}
          onValueChange={(stateId) => {
            const state = stateOptions.find((candidate) => candidate.id === stateId);
            if (state) mutation.mutate({ change: { kind: 'workflowState', value: state }, issue });
          }}
          options={stateOptions.map((state) => ({ label: state.name, value: state.id }))}
          value={issue.status.workflowState.id}
        />
      </div>
    );
  }

  function assigneeEditor(className?: string) {
    return (
      <div className={className}>
        <IssueInlineSelect
          ariaLabel={`${issue.identifier} ${labels.assignee}`}
          disabled={isPending}
          onValueChange={(memberId) => {
            const assignee =
              memberId === 'unassigned'
                ? null
                : (memberOptions.find((candidate) => candidate.id === memberId) ?? null);
            mutation.mutate({ change: { kind: 'assignee', value: assignee }, issue });
          }}
          options={[
            { label: labels.unassigned, value: 'unassigned' },
            ...memberOptions.map((member) => ({
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
    return (
      <div className={className}>
        <IssueInlineSelect
          ariaLabel={`${issue.identifier} ${labels.priority}`}
          disabled={isPending}
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
            label: labels.priorities[priority],
            value: priority,
          }))}
          value={issue.priority}
        />
      </div>
    );
  }

  function labelsEditor(className?: string, compact = false) {
    return (
      <div className={cn('min-w-0', className)}>
        <IssueFilterMenu
          ariaLabel={`${issue.identifier} ${labels.labels}`}
          disabled={isPending}
          emptyLabel={labels.noLabels}
          label={labels.labels}
          onChange={changeLabels}
          options={labelOptions.map((label) => ({
            id: label.id,
            label: label.name,
            swatch: label.color,
          }))}
          selected={issue.labels.map((label) => label.id)}
          {...(compact ? { triggerClassName: 'h-6 border-transparent px-1.5 text-xs' } : {})}
        />
      </div>
    );
  }

  const notice = mutation.conflict ? (
    <div
      role="alert"
      className="bg-warning/10 text-foreground flex items-center gap-2 border-t px-3 py-2 text-xs"
    >
      <AlertCircle aria-hidden="true" className="text-warning size-4 shrink-0" />
      <span className="min-w-0 flex-1">{labels.conflictDescription}</span>
      <Button type="button" variant="outline" size="xs" onClick={mutation.reapplyConflict}>
        <RotateCcw aria-hidden="true" data-icon="inline-start" />
        {labels.reapply}
      </Button>
    </div>
  ) : mutation.isError ? (
    <div
      role="alert"
      className="bg-destructive/10 text-destructive flex items-center gap-2 border-t px-3 py-2 text-xs"
    >
      <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">{labels.errorDescription}</span>
      <Button type="button" variant="outline" size="xs" onClick={mutation.retry}>
        <RotateCcw aria-hidden="true" data-icon="inline-start" />
        {labels.retry}
      </Button>
    </div>
  ) : null;

  return (
    <li className="border-b" aria-busy={isPending || undefined}>
      <div
        className={cn(
          'hidden min-h-14 items-center gap-2 px-2 py-1.5 lg:grid',
          mode === 'my'
            ? 'grid-cols-[minmax(12rem,1fr)_5.5rem_7.5rem_8rem_6.5rem_5.5rem] xl:grid-cols-[minmax(16rem,1fr)_7rem_8.5rem_9rem_7rem_6rem]'
            : 'grid-cols-[minmax(16rem,1fr)_8.5rem_9rem_7rem_6rem]',
        )}
      >
        <div className="min-w-0">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="text-muted-foreground shrink-0 font-mono text-xs">
              {issue.identifier}
            </span>
            <Link
              href={`/issues/${encodeURIComponent(issue.identifier)}`}
              className="hover:text-primary min-w-0 truncate text-sm font-medium underline-offset-4 hover:underline"
            >
              {issue.title}
            </Link>
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-1">
            <div className="flex min-w-0 gap-1 overflow-hidden">
              {issue.labels.slice(0, 2).map((label) => (
                <Badge key={label.id} variant="outline" className="max-w-28 truncate px-1.5">
                  <span
                    aria-hidden="true"
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: label.color }}
                  />
                  {label.name}
                </Badge>
              ))}
              {issue.labels.length > 2 ? (
                <span className="text-muted-foreground text-xs">+{issue.labels.length - 2}</span>
              ) : null}
            </div>
            {labelsEditor('ml-auto shrink-0', true)}
          </div>
        </div>
        {mode === 'my' ? (
          <span className="text-muted-foreground truncate px-1.5 text-xs" title={issue.team.name}>
            {issue.team.key}
          </span>
        ) : null}
        {stateEditor()}
        {assigneeEditor()}
        {priorityEditor()}
        <time
          className="text-muted-foreground px-1.5 text-right text-xs"
          dateTime={issue.updatedAt}
          title={updatedAt.full}
        >
          {updatedAt.short}
        </time>
      </div>

      <article className="min-h-18 px-3 py-3 lg:hidden">
        <div className="flex min-w-0 items-start gap-2">
          <span className="text-muted-foreground shrink-0 pt-0.5 font-mono text-xs">
            {issue.identifier}
          </span>
          <Link
            href={`/issues/${encodeURIComponent(issue.identifier)}`}
            className="min-w-0 flex-1 text-sm leading-5 font-medium underline-offset-4 hover:underline"
          >
            {issue.title}
          </Link>
          <time
            className="text-muted-foreground shrink-0 text-xs"
            dateTime={issue.updatedAt}
            title={updatedAt.full}
          >
            {updatedAt.short}
          </time>
        </div>
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
          {mode === 'my' ? (
            <Badge variant="outline" title={issue.team.name}>
              {issue.team.key}
            </Badge>
          ) : null}
          {stateEditor('max-w-36')}
          {assigneeEditor('max-w-40')}
          {priorityEditor('max-w-28')}
          {labelsEditor('max-w-36')}
        </div>
        {issue.labels.length > 0 ? (
          <div className="mt-2 flex min-w-0 flex-wrap gap-1">
            {issue.labels.slice(0, 3).map((label) => (
              <Badge key={label.id} variant="outline" className="max-w-32 truncate">
                <span
                  aria-hidden="true"
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: label.color }}
                />
                {label.name}
              </Badge>
            ))}
            {issue.labels.length > 3 ? (
              <span className="text-muted-foreground text-xs">+{issue.labels.length - 3}</span>
            ) : null}
          </div>
        ) : null}
      </article>
      {notice}
    </li>
  );
}
