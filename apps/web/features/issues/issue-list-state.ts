export const ISSUE_PRIORITIES = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export const ISSUE_SORT_FIELDS = ['createdAt', 'updatedAt', 'status', 'priority'] as const;
export const ISSUE_SORT_DIRECTIONS = ['asc', 'desc'] as const;
export const TEAM_ISSUE_TABS = ['all', 'progress', 'backlog'] as const;

export type IssuePriorityValue = (typeof ISSUE_PRIORITIES)[number];
export type IssueSortField = (typeof ISSUE_SORT_FIELDS)[number];
export type IssueSortDirection = (typeof ISSUE_SORT_DIRECTIONS)[number];
export type TeamIssueTab = (typeof TEAM_ISSUE_TABS)[number];
export type IssueListMode = 'my' | 'team';

export type IssueListState = {
  assigneeIds: string[];
  labelIds: string[];
  priority: IssuePriorityValue[];
  sort: IssueSortField;
  sortDirection: IssueSortDirection;
  stateIds: string[];
  tab: TeamIssueTab;
  teamIds: string[];
};

type SearchParamsReader = Pick<URLSearchParams, 'get'>;

function readCsv(value: string | null): string[] {
  if (!value) return [];

  return [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function isOneOf<T extends string>(value: string | null, values: readonly T[]): value is T {
  return value !== null && values.includes(value as T);
}

export function readIssueListState(
  searchParams: SearchParamsReader,
  mode: IssueListMode,
): IssueListState {
  const sortValue = searchParams.get('sort');
  const directionValue = searchParams.get('direction');
  const tabValue = searchParams.get('tab');

  return {
    assigneeIds: mode === 'team' ? readCsv(searchParams.get('assignee')) : [],
    labelIds: readCsv(searchParams.get('label')),
    priority: readCsv(searchParams.get('priority')).filter((value): value is IssuePriorityValue =>
      ISSUE_PRIORITIES.includes(value as IssuePriorityValue),
    ),
    sort: isOneOf(sortValue, ISSUE_SORT_FIELDS) ? sortValue : 'updatedAt',
    sortDirection: isOneOf(directionValue, ISSUE_SORT_DIRECTIONS) ? directionValue : 'desc',
    stateIds: readCsv(searchParams.get('status')),
    tab: mode === 'team' && isOneOf(tabValue, TEAM_ISSUE_TABS) ? tabValue : 'all',
    teamIds: mode === 'my' ? readCsv(searchParams.get('team')) : [],
  };
}

export function buildIssueListParams(
  state: IssueListState,
  context: { mode: IssueListMode; teamId?: string },
): {
  assigneeMembershipId?: string;
  labelId?: string;
  limit: number;
  priority?: string;
  sort: IssueSortField;
  sortDirection: IssueSortDirection;
  stateCategory?: string;
  teamId?: string;
  type: 'TEAM_TASK';
  workflowStateId?: string;
} {
  const params = {
    limit: 50,
    sort: state.sort,
    sortDirection: state.sortDirection,
    type: 'TEAM_TASK' as const,
  };

  if (context.mode === 'my') {
    return {
      ...params,
      assigneeMembershipId: 'me',
      ...(state.labelIds.length > 0 ? { labelId: state.labelIds.join(',') } : {}),
      ...(state.priority.length > 0 ? { priority: state.priority.join(',') } : {}),
      ...(state.stateIds.length > 0
        ? { workflowStateId: state.stateIds.join(',') }
        : { stateCategory: 'BACKLOG,UNSTARTED,STARTED' }),
      ...(state.teamIds.length > 0 ? { teamId: state.teamIds.join(',') } : {}),
    };
  }

  const stateCategory =
    state.tab === 'progress'
      ? 'UNSTARTED,STARTED'
      : state.tab === 'backlog'
        ? 'BACKLOG'
        : undefined;

  return {
    ...params,
    ...(state.assigneeIds.length > 0 ? { assigneeMembershipId: state.assigneeIds.join(',') } : {}),
    ...(state.labelIds.length > 0 ? { labelId: state.labelIds.join(',') } : {}),
    ...(state.priority.length > 0 ? { priority: state.priority.join(',') } : {}),
    ...(stateCategory ? { stateCategory } : {}),
    ...(state.stateIds.length > 0 ? { workflowStateId: state.stateIds.join(',') } : {}),
    ...(context.teamId ? { teamId: context.teamId } : {}),
  };
}

export function hasIssueFilters(state: IssueListState, mode: IssueListMode): boolean {
  return (
    state.labelIds.length > 0 ||
    state.priority.length > 0 ||
    state.stateIds.length > 0 ||
    (mode === 'my' ? state.teamIds.length > 0 : state.assigneeIds.length > 0)
  );
}

export function replaceSearchParam(
  current: SearchParamsReader & Pick<URLSearchParams, 'toString'>,
  key: 'assignee' | 'direction' | 'label' | 'priority' | 'sort' | 'status' | 'tab' | 'team',
  value: string | string[] | null,
): string {
  const next = new URLSearchParams(current.toString());
  const normalized = Array.isArray(value) ? value.filter(Boolean).join(',') : value;

  if (normalized) next.set(key, normalized);
  else next.delete(key);

  next.delete('cursor');
  return next.toString();
}

export function clearIssueFilters(
  current: SearchParamsReader & Pick<URLSearchParams, 'toString'>,
): string {
  const next = new URLSearchParams(current.toString());
  for (const key of ['assignee', 'label', 'priority', 'status', 'team', 'cursor']) {
    next.delete(key);
  }
  return next.toString();
}
