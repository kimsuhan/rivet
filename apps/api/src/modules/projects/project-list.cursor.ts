import { isUUID } from 'class-validator';

import { invalidProjectQuery } from './project.errors';

export type ProjectSortField = 'targetDate' | 'updatedAt';
export type ProjectSortDirection = 'asc' | 'desc';

export type ProjectCursor = {
  id: string;
  value: Date | null;
};

export function parseProjectCsvFilter(
  value: string | undefined,
  isValid: (item: string) => boolean,
  message: string,
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const items = value.split(',').map((item) => item.trim());
  if (items.length === 0 || items.some((item) => item.length === 0 || !isValid(item))) {
    return invalidProjectQuery(message);
  }
  return [...new Set(items)];
}

export function parseProjectCursor(
  value: string | undefined,
  sort: ProjectSortField,
  direction: ProjectSortDirection,
): ProjectCursor | undefined {
  if (value === undefined) {
    return undefined;
  }

  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) {
      return invalidProjectQuery('커서를 확인해 주세요.');
    }
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) {
      return invalidProjectQuery('커서를 확인해 주세요.');
    }

    const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 4 ||
      parsed[0] !== sort ||
      parsed[1] !== direction ||
      typeof parsed[3] !== 'string' ||
      !isUUID(parsed[3], '4')
    ) {
      return invalidProjectQuery('현재 정렬 조건에 맞는 커서를 사용해 주세요.');
    }

    if (sort === 'targetDate' && parsed[2] === null) {
      return { id: parsed[3], value: null };
    }
    if (typeof parsed[2] !== 'string') {
      return invalidProjectQuery('커서를 확인해 주세요.');
    }

    const date =
      sort === 'updatedAt' ? new Date(parsed[2]) : new Date(`${parsed[2]}T00:00:00.000Z`);
    if (
      Number.isNaN(date.getTime()) ||
      (sort === 'updatedAt'
        ? date.toISOString() !== parsed[2]
        : date.toISOString().slice(0, 10) !== parsed[2])
    ) {
      return invalidProjectQuery('커서를 확인해 주세요.');
    }
    return { id: parsed[3], value: date };
  } catch {
    return invalidProjectQuery('커서를 확인해 주세요.');
  }
}

export function encodeProjectCursor(
  row: { id: string; targetDate: Date | null; updatedAt: Date },
  sort: ProjectSortField,
  direction: ProjectSortDirection,
): string {
  const value =
    sort === 'updatedAt' ? row.updatedAt.toISOString() : projectDateValue(row.targetDate);
  return Buffer.from(JSON.stringify([sort, direction, value, row.id])).toString('base64url');
}

export function projectDateValue(value: Date | null): string | null {
  return value?.toISOString().slice(0, 10) ?? null;
}
