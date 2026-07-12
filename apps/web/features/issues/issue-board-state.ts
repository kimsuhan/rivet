import type { IssueSummaryResponseDto, WorkflowStateResponseDto } from '@rivet/api-client';

import { isTeamTaskIssue, type TeamTaskIssue } from './issue-types';

export function buildTeamIssueViewHref(
  teamKey: string,
  view: 'board' | 'issues',
  searchParams: Pick<URLSearchParams, 'toString'>,
): string {
  const query = new URLSearchParams(searchParams.toString());
  query.delete('cursor');
  const suffix = query.toString();
  const pathname = `/teams/${encodeURIComponent(teamKey)}/${view}`;

  return suffix ? `${pathname}?${suffix}` : pathname;
}

export function groupIssueBoardColumns(
  workflowStates: WorkflowStateResponseDto[],
  issues: IssueSummaryResponseDto[],
): Array<{ issues: TeamTaskIssue[]; state: WorkflowStateResponseDto }> {
  const teamTasks = issues.filter(isTeamTaskIssue);
  return workflowStates
    .toSorted((left, right) => left.position - right.position)
    .map((state) => ({
      issues: teamTasks.filter((issue) => issue.status.workflowState.id === state.id),
      state,
    }));
}
