import { HttpStatus } from '@nestjs/common';

import { ApiError } from '../../common/errors/api-error';
import type { IssueListQueryDto } from './dto/issue-request.dto';
import {
  ISSUE_SORT_DIRECTIONS,
  ISSUE_SORT_FIELDS,
  type IssueSortClause,
  type IssueSortDirection,
  type IssueSortField,
  MAX_ISSUE_SORTS,
} from './issue-list.policy';

const ISSUE_SORT_FIELD_SET = new Set<string>(ISSUE_SORT_FIELDS);
const ISSUE_SORT_DIRECTION_SET = new Set<string>(ISSUE_SORT_DIRECTIONS);

export const DEFAULT_ISSUE_SORTS: readonly IssueSortClause[] = [
  { direction: 'desc', field: 'updatedAt' },
];

function invalidSorts(message = '정렬 조건이 올바르지 않습니다.'): never {
  throw new ApiError({ code: 'INVALID_QUERY', message, status: HttpStatus.BAD_REQUEST });
}

function isIssueSortField(value: string): value is IssueSortField {
  return ISSUE_SORT_FIELD_SET.has(value);
}

function isIssueSortDirection(value: string): value is IssueSortDirection {
  return ISSUE_SORT_DIRECTION_SET.has(value);
}

export function serializeIssueSorts(sorts: readonly IssueSortClause[]): string {
  return sorts.map(({ direction, field }) => `${field}:${direction}`).join(',');
}

export function parseIssueSorts(
  query: Pick<IssueListQueryDto, 'sort' | 'sortDirection' | 'sorts'>,
): IssueSortClause[] {
  if (
    query.sorts !== undefined &&
    (query.sort !== undefined || query.sortDirection !== undefined)
  ) {
    return invalidSorts('다중 정렬과 기존 단일 정렬 조건을 함께 사용할 수 없습니다.');
  }

  if (query.sorts === undefined) {
    return [
      {
        direction: query.sortDirection ?? DEFAULT_ISSUE_SORTS[0]!.direction,
        field: query.sort ?? DEFAULT_ISSUE_SORTS[0]!.field,
      },
    ];
  }

  const candidates = query.sorts.split(',');
  if (candidates.length === 0 || candidates.length > MAX_ISSUE_SORTS) {
    return invalidSorts(`정렬 조건은 1개 이상 ${MAX_ISSUE_SORTS}개 이하여야 합니다.`);
  }

  const fields = new Set<IssueSortField>();
  const sorts = candidates.map((candidate) => {
    const parts = candidate.split(':');
    if (parts.length !== 2) return invalidSorts();

    const [field, direction] = parts;
    if (!field || !direction || !isIssueSortField(field) || !isIssueSortDirection(direction)) {
      return invalidSorts();
    }
    if (fields.has(field)) {
      return invalidSorts('같은 정렬 필드를 중복해서 사용할 수 없습니다.');
    }
    fields.add(field);
    return { direction, field };
  });

  return sorts;
}
