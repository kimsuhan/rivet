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

export type IssueSortField = (typeof ISSUE_SORT_FIELDS)[number];
export type IssueSortDirection = (typeof ISSUE_SORT_DIRECTIONS)[number];

export type IssueSortClause = {
  direction: IssueSortDirection;
  field: IssueSortField;
};

export type IssueListFilters = {
  createdFrom?: Date;
  createdTo?: Date;
  creatorIds: string[];
  labelIds: string[];
  priorities: IssuePriority[];
  projectIds: string[];
  query?: string;
  statuses: IssueStatus[];
  updatedFrom?: Date;
  updatedTo?: Date;
  workspaceId: string;
};

export type IssueListOrderRow = {
  createdAt: Date;
  id: string;
  priorityRank: number;
  progress: number;
  statusRank: number;
  updatedAt: Date;
};
