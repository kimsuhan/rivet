export const FEATURE_WORK_QUEUES = [
  'ALL',
  'REVIEW_REQUIRED',
  'ASSIGNMENT_REQUIRED',
  'IN_PROGRESS',
  'COMPLETION_REQUIRED',
  'COMPLETED',
] as const;
export const FEATURE_ISSUE_STATUSES = [
  'UNSORTED',
  'TODO',
  'IN_PROGRESS',
  'REVIEW',
  'DONE',
  'PAUSED',
  'CANCELED',
] as const;
export const FEATURE_ISSUE_PRIORITIES = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export const FEATURE_PROJECT_ROLES = ['BACKEND', 'WEB_FRONTEND', 'APP_FRONTEND'] as const;
export const FEATURE_SORT_FIELDS = [
  'updatedAt',
  'createdAt',
  'status',
  'priority',
  'progress',
] as const;
export const FEATURE_SORT_DIRECTIONS = ['asc', 'desc'] as const;

export type FeatureWorkQueue = (typeof FEATURE_WORK_QUEUES)[number];
export type FeatureIssueStatus = (typeof FEATURE_ISSUE_STATUSES)[number];
export type FeatureIssuePriority = (typeof FEATURE_ISSUE_PRIORITIES)[number];
export type FeatureProjectRole = (typeof FEATURE_PROJECT_ROLES)[number];
export type FeatureSortField = (typeof FEATURE_SORT_FIELDS)[number];
export type FeatureSortDirection = (typeof FEATURE_SORT_DIRECTIONS)[number];

export type FeatureIssueListState = {
  activeProjectRoles: FeatureProjectRole[];
  createdByMembershipIds: string[];
  createdFrom: string;
  createdTo: string;
  cursor: string;
  featureStatuses: FeatureIssueStatus[];
  labelIds: string[];
  priorities: FeatureIssuePriority[];
  projectIds: string[];
  query: string;
  sort: FeatureSortField;
  sortDirection: FeatureSortDirection;
  unassigned: boolean;
  updatedFrom: string;
  updatedTo: string;
  workQueue: FeatureWorkQueue;
};

type SearchParamsReader = Pick<URLSearchParams, 'get'>;
type FeatureIssueSearchKey =
  | 'activeProjectRole'
  | 'createdByMembershipId'
  | 'createdFrom'
  | 'createdTo'
  | 'cursor'
  | 'featureStatus'
  | 'labelId'
  | 'priority'
  | 'projectId'
  | 'query'
  | 'sort'
  | 'sortDirection'
  | 'unassigned'
  | 'updatedFrom'
  | 'updatedTo'
  | 'workQueue';

function readCsv<T extends string>(value: string | null, allowed?: readonly T[]): T[] {
  if (!value) return [];

  return [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter((item): item is T => Boolean(item) && (!allowed || allowed.includes(item as T))),
    ),
  ];
}

function readOne<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value !== null && allowed.includes(value as T) ? (value as T) : fallback;
}

function readDate(value: string | null): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function localDateBoundary(value: string, endOfDay: boolean): string {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return new Date(
    year,
    month - 1,
    day,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  ).toISOString();
}

export function readFeatureIssueListState(searchParams: SearchParamsReader): FeatureIssueListState {
  return {
    activeProjectRoles: readCsv(searchParams.get('activeProjectRole'), FEATURE_PROJECT_ROLES),
    createdByMembershipIds: readCsv(searchParams.get('createdByMembershipId')),
    createdFrom: readDate(searchParams.get('createdFrom')),
    createdTo: readDate(searchParams.get('createdTo')),
    cursor: searchParams.get('cursor')?.trim() ?? '',
    featureStatuses: readCsv(searchParams.get('featureStatus'), FEATURE_ISSUE_STATUSES),
    labelIds: readCsv(searchParams.get('labelId')),
    priorities: readCsv(searchParams.get('priority'), FEATURE_ISSUE_PRIORITIES),
    projectIds: readCsv(searchParams.get('projectId')),
    query: searchParams.get('query')?.normalize('NFC').trim() ?? '',
    sort: readOne(searchParams.get('sort'), FEATURE_SORT_FIELDS, 'updatedAt'),
    sortDirection: readOne(searchParams.get('sortDirection'), FEATURE_SORT_DIRECTIONS, 'desc'),
    unassigned: searchParams.get('unassigned') === 'true',
    updatedFrom: readDate(searchParams.get('updatedFrom')),
    updatedTo: readDate(searchParams.get('updatedTo')),
    workQueue: readOne(searchParams.get('workQueue'), FEATURE_WORK_QUEUES, 'ALL'),
  };
}

export function buildFeatureIssueListParams(state: FeatureIssueListState): {
  activeProjectRole?: string;
  createdByMembershipId?: string;
  createdFrom?: string;
  createdTo?: string;
  cursor?: string;
  featureStatus?: string;
  labelId?: string;
  limit: number;
  priority?: string;
  projectId?: string;
  query?: string;
  sort: FeatureSortField;
  sortDirection: FeatureSortDirection;
  type: 'FEATURE';
  unassigned?: 'true';
  updatedFrom?: string;
  updatedTo?: string;
  workQueue?: Exclude<FeatureWorkQueue, 'ALL'>;
} {
  return {
    ...(state.activeProjectRoles.length > 0
      ? { activeProjectRole: state.activeProjectRoles.join(',') }
      : {}),
    ...(state.createdByMembershipIds.length > 0
      ? { createdByMembershipId: state.createdByMembershipIds.join(',') }
      : {}),
    ...(state.createdFrom ? { createdFrom: localDateBoundary(state.createdFrom, false) } : {}),
    ...(state.createdTo ? { createdTo: localDateBoundary(state.createdTo, true) } : {}),
    ...(state.cursor ? { cursor: state.cursor } : {}),
    ...(state.featureStatuses.length > 0 ? { featureStatus: state.featureStatuses.join(',') } : {}),
    ...(state.labelIds.length > 0 ? { labelId: state.labelIds.join(',') } : {}),
    limit: 50,
    ...(state.priorities.length > 0 ? { priority: state.priorities.join(',') } : {}),
    ...(state.projectIds.length > 0 ? { projectId: state.projectIds.join(',') } : {}),
    ...(state.query ? { query: state.query } : {}),
    sort: state.sort,
    sortDirection: state.sortDirection,
    type: 'FEATURE',
    ...(state.unassigned ? { unassigned: 'true' as const } : {}),
    ...(state.updatedFrom ? { updatedFrom: localDateBoundary(state.updatedFrom, false) } : {}),
    ...(state.updatedTo ? { updatedTo: localDateBoundary(state.updatedTo, true) } : {}),
    ...(state.workQueue === 'ALL' ? {} : { workQueue: state.workQueue }),
  };
}

export function replaceFeatureIssueSearchParam(
  current: Pick<URLSearchParams, 'get' | 'toString'>,
  key: FeatureIssueSearchKey,
  value: string | string[] | boolean | null,
): string {
  const next = new URLSearchParams(current.toString());
  const normalized = Array.isArray(value)
    ? value.filter(Boolean).join(',')
    : typeof value === 'boolean'
      ? value
        ? 'true'
        : ''
      : value?.trim();

  if (normalized) next.set(key, normalized);
  else next.delete(key);

  if (key !== 'cursor') next.delete('cursor');
  return next.toString();
}

export function clearFeatureIssueListState(current: Pick<URLSearchParams, 'toString'>): string {
  const next = new URLSearchParams(current.toString());
  for (const key of [
    'activeProjectRole',
    'createdByMembershipId',
    'createdFrom',
    'createdTo',
    'cursor',
    'featureStatus',
    'labelId',
    'priority',
    'projectId',
    'query',
    'sort',
    'sortDirection',
    'unassigned',
    'updatedFrom',
    'updatedTo',
    'workQueue',
  ] satisfies FeatureIssueSearchKey[]) {
    next.delete(key);
  }
  return next.toString();
}

export function clearFeatureIssueDetailFilters(current: Pick<URLSearchParams, 'toString'>): string {
  const next = new URLSearchParams(current.toString());
  for (const key of [
    'activeProjectRole',
    'createdByMembershipId',
    'createdFrom',
    'createdTo',
    'cursor',
    'featureStatus',
    'labelId',
    'priority',
    'projectId',
    'unassigned',
    'updatedFrom',
    'updatedTo',
  ] satisfies FeatureIssueSearchKey[]) {
    next.delete(key);
  }
  return next.toString();
}

export function hasFeatureIssueDetailFilters(state: FeatureIssueListState): boolean {
  return (
    state.projectIds.length > 0 ||
    state.featureStatuses.length > 0 ||
    state.priorities.length > 0 ||
    state.activeProjectRoles.length > 0 ||
    state.unassigned ||
    state.labelIds.length > 0 ||
    state.createdByMembershipIds.length > 0 ||
    Boolean(state.createdFrom || state.createdTo || state.updatedFrom || state.updatedTo)
  );
}

export function hasFeatureIssueFilters(state: FeatureIssueListState): boolean {
  return state.workQueue !== 'ALL' || Boolean(state.query) || hasFeatureIssueDetailFilters(state);
}
