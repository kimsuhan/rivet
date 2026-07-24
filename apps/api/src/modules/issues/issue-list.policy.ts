import type { IssuePriority, IssueStatus } from '@rivet/database';

export const ISSUE_SORT_FIELDS = [
  'priority',
  'status',
  'updatedAt',
  'createdAt',
  'progress',
] as const;
export const ISSUE_SORT_DIRECTIONS = ['asc', 'desc'] as const;
export const MAX_ISSUE_SORTS = 3;
export const ISSUE_GROUP_FIELDS = [
  'assigneeMembershipId',
  'projectId',
  'status',
  'priority',
  'createdByMembershipId',
] as const;
export const TEAM_WORK_GROUP_FIELDS = [
  'projectId',
  'teamId',
  'stateCategory',
  'workflowStateId',
  'priority',
] as const;

export type IssueSortField = (typeof ISSUE_SORT_FIELDS)[number];
export type IssueSortDirection = (typeof ISSUE_SORT_DIRECTIONS)[number];
export type IssueGroupField = (typeof ISSUE_GROUP_FIELDS)[number];
export type TeamWorkGroupField = (typeof TEAM_WORK_GROUP_FIELDS)[number];

export type IssueSortClause = {
  direction: IssueSortDirection;
  field: IssueSortField;
};

export type IssueListFilters = {
  assigneeIds: string[];
  createdFrom?: Date;
  createdTo?: Date;
  creatorIds: string[];
  labelIds: string[];
  priorities: IssuePriority[];
  projectIds: string[];
  query?: string;
  statuses: IssueStatus[];
  unassigned: boolean;
  updatedFrom?: Date;
  updatedTo?: Date;
  workspaceId: string;
};

export type IssueGroupRow = {
  count: bigint;
  mainImageFileId: string | null;
  mainLabel: string;
  mainValue: string;
  subImageFileId: string | null;
  subLabel: string | null;
  subValue: string | null;
};

export type IssueListOrderRow = {
  createdAt: Date;
  id: string;
  priorityRank: number;
  progress: number;
  statusRank: number;
  updatedAt: Date;
};
