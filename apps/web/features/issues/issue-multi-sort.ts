export const ISSUE_SORT_FIELDS = [
  'priority',
  'status',
  'updatedAt',
  'createdAt',
  'progress',
] as const;
export const MAX_ISSUE_SORTS = 3;

export type IssueSortField = (typeof ISSUE_SORT_FIELDS)[number];
export type IssueSortDirection = 'asc' | 'desc';
export type IssueSortClause = {
  direction: IssueSortDirection;
  field: IssueSortField;
};

export const DEFAULT_ISSUE_SORTS: readonly IssueSortClause[] = [
  { direction: 'desc', field: 'updatedAt' },
];

const ISSUE_SORT_FIELD_SET = new Set<string>(ISSUE_SORT_FIELDS);

function isSortField(value: unknown): value is IssueSortField {
  return typeof value === 'string' && ISSUE_SORT_FIELD_SET.has(value);
}

function isSortDirection(value: unknown): value is IssueSortDirection {
  return value === 'asc' || value === 'desc';
}

export function serializeIssueSorts(sorts: readonly IssueSortClause[]): string {
  return sorts.map(({ direction, field }) => `${field}:${direction}`).join(',');
}

export function normalizeIssueSorts(value: unknown): IssueSortClause[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ISSUE_SORTS) return null;

  const fields = new Set<IssueSortField>();
  const sorts: IssueSortClause[] = [];
  for (const item of value) {
    if (
      typeof item !== 'object' ||
      item === null ||
      !('field' in item) ||
      !isSortField(item.field) ||
      !('direction' in item) ||
      !isSortDirection(item.direction) ||
      fields.has(item.field)
    ) {
      return null;
    }
    fields.add(item.field);
    sorts.push({ direction: item.direction, field: item.field });
  }
  return sorts;
}

export function parseIssueSortsParameter(value: string | null): IssueSortClause[] | null {
  if (!value) return null;
  return normalizeIssueSorts(
    value.split(',').map((clause) => {
      const [field, direction, extra] = clause.split(':');
      return extra === undefined ? { direction, field } : null;
    }),
  );
}

export function issueSortsFromSearchParams(searchParams: {
  get(name: string): string | null;
}): IssueSortClause[] {
  const sorts = parseIssueSortsParameter(searchParams.get('sorts'));
  if (sorts) return sorts;

  const legacyField = searchParams.get('sort');
  const legacyDirection = searchParams.get('sortDirection');
  return [
    {
      direction: isSortDirection(legacyDirection) ? legacyDirection : 'desc',
      field: isSortField(legacyField) ? legacyField : 'updatedAt',
    },
  ];
}
