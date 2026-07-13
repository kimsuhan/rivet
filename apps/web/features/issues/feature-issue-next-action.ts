import type { FeatureProjectRole } from './feature-issue-list-state';

export type FeatureIssueNextAction =
  | 'START_WORK'
  | 'ASSIGN_TEAM_TASKS'
  | 'START_FROM_MY_TEAM'
  | 'OPEN_MY_WORK'
  | 'COMPLETE_ISSUE'
  | 'VIEW_DETAIL';

export type FeatureIssueAction = FeatureIssueNextAction | 'CLAIM';

export function featureIssueNextAction(input: {
  activeRoles: readonly FeatureProjectRole[];
  allTargetTasksCompleted: boolean;
  currentUserAssignedTeamTaskCount: number;
  currentUserTeamRoles: readonly FeatureProjectRole[];
  featureStatus: 'UNSORTED' | 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE' | 'PAUSED' | 'CANCELED';
  teamTaskCount: number;
  unassignedCount: number;
}): FeatureIssueNextAction {
  if (input.teamTaskCount === 0) return 'START_WORK';
  if (input.unassignedCount > 0) return 'ASSIGN_TEAM_TASKS';
  if (
    !input.allTargetTasksCompleted &&
    input.currentUserTeamRoles.some((role) => !input.activeRoles.includes(role))
  ) {
    return 'START_FROM_MY_TEAM';
  }
  if (input.currentUserAssignedTeamTaskCount > 0) return 'OPEN_MY_WORK';
  if (
    input.allTargetTasksCompleted &&
    input.featureStatus !== 'DONE' &&
    input.featureStatus !== 'CANCELED'
  ) {
    return 'COMPLETE_ISSUE';
  }
  return 'VIEW_DETAIL';
}
