import type { ProjectsControllerListParams } from '@rivet/api-client';

export const PROJECT_STATUSES = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELED'] as const;
export const PROJECT_SORT_FIELDS = ['updatedAt', 'targetDate'] as const;
export const PROJECT_SORT_DIRECTIONS = ['asc', 'desc'] as const;

export function readProjectListState(searchParams: URLSearchParams) {
  const status = searchParams.get('status');
  const sort = searchParams.get('sort');
  const sortDirection = searchParams.get('direction');

  return {
    cursor: searchParams.get('cursor') || null,
    includeArchived: searchParams.get('archived') === 'true',
    sort: PROJECT_SORT_FIELDS.includes(sort as (typeof PROJECT_SORT_FIELDS)[number])
      ? (sort as (typeof PROJECT_SORT_FIELDS)[number])
      : 'updatedAt',
    sortDirection: PROJECT_SORT_DIRECTIONS.includes(
      sortDirection as (typeof PROJECT_SORT_DIRECTIONS)[number],
    )
      ? (sortDirection as (typeof PROJECT_SORT_DIRECTIONS)[number])
      : 'desc',
    status: PROJECT_STATUSES.includes(status as (typeof PROJECT_STATUSES)[number])
      ? (status as (typeof PROJECT_STATUSES)[number])
      : null,
  };
}

export function buildProjectListParams(
  state: ReturnType<typeof readProjectListState>,
): ProjectsControllerListParams {
  return {
    includeArchived: state.includeArchived,
    limit: 50,
    sort: state.sort,
    sortDirection: state.sortDirection,
    ...(state.cursor ? { cursor: state.cursor } : {}),
    ...(state.status ? { status: state.status } : {}),
  };
}

export function replaceProjectListParam(
  searchParams: URLSearchParams,
  key: 'archived' | 'cursor' | 'direction' | 'sort' | 'status',
  value: string | null,
): string {
  const next = new URLSearchParams(searchParams.toString());

  if (value) next.set(key, value);
  else next.delete(key);

  if (key !== 'cursor') next.delete('cursor');
  return next.toString();
}

export function clearProjectListFilters(searchParams: URLSearchParams): string {
  const next = new URLSearchParams(searchParams.toString());
  next.delete('archived');
  next.delete('cursor');
  next.delete('status');
  return next.toString();
}
