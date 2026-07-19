import { createHash } from 'node:crypto';

import { HttpStatus } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { ApiError } from '../../common/errors/api-error';
import type {
  IssueListFilters,
  IssueListOrderRow,
  IssueSortClause,
  IssueSortField,
} from './issue-list.policy';
import { serializeIssueSorts } from './issue-list-sort.parser';

const ISSUE_CURSOR_VERSION = 1;

export type IssueListCursor = {
  id: string;
  values: Array<Date | number>;
};

function invalidCursor(message = '커서를 확인해 주세요.'): never {
  throw new ApiError({ code: 'INVALID_QUERY', message, status: HttpStatus.BAD_REQUEST });
}

function sortValue(row: IssueListOrderRow, field: IssueSortField): string | number {
  switch (field) {
    case 'createdAt':
      return row.createdAt.toISOString();
    case 'priority':
      return row.priorityRank;
    case 'progress':
      return row.progress;
    case 'status':
      return row.statusRank;
    case 'updatedAt':
      return row.updatedAt.toISOString();
  }
}

function parseSortValue(value: unknown, field: IssueSortField): Date | number {
  if (field === 'createdAt' || field === 'updatedAt') {
    if (typeof value !== 'string') return invalidCursor();
    const date = new Date(value);
    if (Number.isNaN(date.getTime()) || date.toISOString() !== value) return invalidCursor();
    return date;
  }

  if (typeof value !== 'number' || !Number.isInteger(value)) return invalidCursor();
  if (field === 'progress' && (value < 0 || value > 100)) return invalidCursor();
  return value;
}

function normalizedFilterPayload(filters: IssueListFilters): Record<string, unknown> {
  return {
    createdFrom: filters.createdFrom?.toISOString() ?? null,
    createdTo: filters.createdTo?.toISOString() ?? null,
    creatorIds: [...filters.creatorIds].sort(),
    labelIds: [...filters.labelIds].sort(),
    priorities: [...filters.priorities].sort(),
    projectIds: [...filters.projectIds].sort(),
    query: filters.query ?? null,
    statuses: [...filters.statuses].sort(),
    updatedFrom: filters.updatedFrom?.toISOString() ?? null,
    updatedTo: filters.updatedTo?.toISOString() ?? null,
    workspaceId: filters.workspaceId,
  };
}

export function issueListFilterFingerprint(filters: IssueListFilters): string {
  return createHash('sha256')
    .update(JSON.stringify(normalizedFilterPayload(filters)))
    .digest('base64url');
}

export function encodeIssueListCursor(
  row: IssueListOrderRow,
  sorts: readonly IssueSortClause[],
  filterFingerprint: string,
): string {
  return Buffer.from(
    JSON.stringify({
      f: filterFingerprint,
      i: row.id,
      k: sorts.map(({ field }) => sortValue(row, field)),
      s: serializeIssueSorts(sorts),
      v: ISSUE_CURSOR_VERSION,
    }),
  ).toString('base64url');
}

export function parseIssueListCursor(
  value: string | undefined,
  sorts: readonly IssueSortClause[],
  filterFingerprint: string,
): IssueListCursor | undefined {
  if (value === undefined) return undefined;

  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) return invalidCursor();
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) return invalidCursor();

    const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed) ||
      !('v' in parsed) ||
      parsed.v !== ISSUE_CURSOR_VERSION ||
      !('s' in parsed) ||
      parsed.s !== serializeIssueSorts(sorts) ||
      !('f' in parsed) ||
      parsed.f !== filterFingerprint ||
      !('i' in parsed) ||
      typeof parsed.i !== 'string' ||
      !isUUID(parsed.i, '4') ||
      !('k' in parsed) ||
      !Array.isArray(parsed.k) ||
      parsed.k.length !== sorts.length
    ) {
      return invalidCursor('현재 작업공간·필터·정렬 조건에 맞는 커서를 사용해 주세요.');
    }

    return {
      id: parsed.i,
      values: parsed.k.map((item, index) => parseSortValue(item, sorts[index]!.field)),
    };
  } catch {
    return invalidCursor();
  }
}
