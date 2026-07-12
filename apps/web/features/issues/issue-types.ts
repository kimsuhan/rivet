import type { IssueSummaryResponseDto } from '@rivet/api-client';

export type TeamTaskIssue<T extends IssueSummaryResponseDto = IssueSummaryResponseDto> = T & {
  type: 'TEAM_TASK';
  team: NonNullable<T['team']>;
  status: T['status'] & {
    featureStatus: null;
    workflowState: NonNullable<T['status']['workflowState']>;
  };
};

export type FeatureIssue<T extends IssueSummaryResponseDto = IssueSummaryResponseDto> = T & {
  type: 'FEATURE';
  assignee: null;
  team: null;
  status: T['status'] & {
    featureStatus: NonNullable<T['status']['featureStatus']>;
    workflowState: null;
  };
};

export function isTeamTaskIssue<T extends IssueSummaryResponseDto>(
  issue: T,
): issue is TeamTaskIssue<T> {
  return issue.type === 'TEAM_TASK' && issue.team !== null && issue.status.workflowState !== null;
}

export function isFeatureIssue<T extends IssueSummaryResponseDto>(
  issue: T,
): issue is FeatureIssue<T> {
  return issue.type === 'FEATURE' && issue.team === null && issue.status.featureStatus !== null;
}
