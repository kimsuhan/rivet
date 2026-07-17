import { createHash } from 'node:crypto';

import { IssuePriority, IssueStatus, StateCategory } from '@rivet/database';

import { csvImportError } from './csv-import.errors';
import { isFormulaCell } from './csv-import.parser';
import type { CsvImportPreviewErrorDto } from './dto/csv-import-response.dto';

type MappingMode = 'CREATE' | 'EXCLUDE' | 'IGNORE' | 'MAP' | 'NONE';

export type CsvImportMappingEntry = {
  mode: MappingMode;
  source: string;
  targetId?: string;
  targetValue?: IssuePriority;
  teamSource?: string;
};

export type CsvImportMapping = {
  columns: {
    assignee?: string;
    description?: string;
    labels?: string;
    priority?: string;
    project: string;
    sourceKey: string;
    status: string;
    team: string;
    title: string;
  };
  labels: CsvImportMappingEntry[];
  members: CsvImportMappingEntry[];
  priorities: CsvImportMappingEntry[];
  projects: CsvImportMappingEntry[];
  states: CsvImportMappingEntry[];
  targetFingerprint: string;
  teams: CsvImportMappingEntry[];
};

export const CSV_IMPORT_UNSUPPORTED_COLUMN_PATTERN =
  /comment|댓글|activity|활동|notification|알림|handoff|전달|attachment|첨부|automation|자동화/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeCsvImportValue(value: string): string {
  return value.normalize('NFC').trim();
}

export function hashCsvImportValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashCsvImportSource(value: string): string {
  return hashCsvImportValue(normalizeCsvImportValue(value).toLocaleLowerCase('en-US'));
}

export function csvImportIssueStatus(category: StateCategory): IssueStatus {
  switch (category) {
    case StateCategory.BACKLOG:
      return IssueStatus.UNSORTED;
    case StateCategory.UNSTARTED:
      return IssueStatus.TODO;
    case StateCategory.STARTED:
      return IssueStatus.IN_PROGRESS;
    case StateCategory.COMPLETED:
      return IssueStatus.REVIEW;
    case StateCategory.CANCELED:
      return IssueStatus.CANCELED;
  }
}

export function csvImportPreview(
  code: string,
  rowNumber: number,
  field?: string,
  severity?: 'ERROR' | 'WARNING',
): CsvImportPreviewErrorDto {
  return { code, rowNumber, ...(field ? { field } : {}), ...(severity ? { severity } : {}) };
}

function parseEntry(value: unknown, kind: keyof CsvImportMapping): CsvImportMappingEntry {
  if (!isRecord(value) || typeof value.source !== 'string' || typeof value.mode !== 'string') {
    return csvImportError('IMPORT_MAPPING_INVALID', `${kind} 매핑을 확인해 주세요.`);
  }
  const source = normalizeCsvImportValue(value.source);
  if (source.length < 1 || [...source].length > 255 || isFormulaCell(source)) {
    return csvImportError('IMPORT_MAPPING_INVALID', `${kind} 원본 값을 확인해 주세요.`);
  }
  const allowedModes: Record<string, MappingMode[]> = {
    labels: ['MAP', 'CREATE', 'IGNORE'],
    members: ['MAP', 'NONE'],
    priorities: ['MAP'],
    projects: ['MAP', 'CREATE', 'EXCLUDE'],
    states: ['MAP', 'EXCLUDE'],
    teams: ['MAP', 'EXCLUDE'],
  };
  if (!allowedModes[kind]?.includes(value.mode as MappingMode)) {
    return csvImportError('IMPORT_MAPPING_INVALID', `${kind} 매핑 방식을 확인해 주세요.`);
  }
  const entry: CsvImportMappingEntry = { mode: value.mode as MappingMode, source };
  if (typeof value.teamSource === 'string') {
    entry.teamSource = normalizeCsvImportValue(value.teamSource);
  }
  if (typeof value.targetId === 'string') entry.targetId = value.targetId.toLowerCase();
  if (typeof value.targetValue === 'string') {
    if (!Object.values(IssuePriority).includes(value.targetValue as IssuePriority)) {
      return csvImportError('IMPORT_MAPPING_INVALID', '우선순위 매핑을 확인해 주세요.');
    }
    entry.targetValue = value.targetValue as IssuePriority;
  }
  if (entry.mode === 'MAP' && kind !== 'priorities' && !entry.targetId) {
    return csvImportError('IMPORT_MAPPING_INVALID', `${kind} 대상 식별자를 확인해 주세요.`);
  }
  if (kind === 'priorities' && !entry.targetValue) {
    return csvImportError('IMPORT_MAPPING_INVALID', '우선순위 대상 값을 확인해 주세요.');
  }
  if ((kind === 'states' || kind === 'members') && !entry.teamSource) {
    return csvImportError('IMPORT_MAPPING_INVALID', `${kind} 팀 원본 값을 확인해 주세요.`);
  }
  return entry;
}

export function parseCsvImportMapping(raw: string, columns: string[]): CsvImportMapping {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return csvImportError('IMPORT_MAPPING_INVALID', '가져오기 매핑 JSON을 확인해 주세요.');
  }
  if (
    !isRecord(value) ||
    !isRecord(value.columns) ||
    typeof value.targetFingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(value.targetFingerprint)
  ) {
    return csvImportError('IMPORT_MAPPING_INVALID', '가져오기 매핑을 확인해 주세요.');
  }

  const requiredColumns = ['sourceKey', 'title', 'team', 'status', 'project'] as const;
  const optionalColumns = ['description', 'assignee', 'priority', 'labels'] as const;
  const mappedColumns: Record<string, string> = {};
  for (const field of [...requiredColumns, ...optionalColumns]) {
    const column = value.columns[field];
    if (
      column === undefined &&
      optionalColumns.includes(field as (typeof optionalColumns)[number])
    ) {
      continue;
    }
    if (
      typeof column !== 'string' ||
      !columns.includes(column) ||
      CSV_IMPORT_UNSUPPORTED_COLUMN_PATTERN.test(column)
    ) {
      return csvImportError('IMPORT_COLUMN_MAPPING_INVALID', `${field} 컬럼 매핑을 확인해 주세요.`);
    }
    mappedColumns[field] = column;
  }
  if (new Set(Object.values(mappedColumns)).size !== Object.values(mappedColumns).length) {
    return csvImportError(
      'IMPORT_COLUMN_MAPPING_INVALID',
      '같은 CSV 컬럼을 여러 필드에 매핑할 수 없습니다.',
    );
  }

  const result = {
    columns: mappedColumns,
    targetFingerprint: value.targetFingerprint,
  } as CsvImportMapping;
  for (const kind of ['teams', 'states', 'members', 'projects', 'priorities', 'labels'] as const) {
    const entries = value[kind];
    if (!Array.isArray(entries) || entries.length > 2_000) {
      return csvImportError('IMPORT_MAPPING_INVALID', `${kind} 매핑 목록을 확인해 주세요.`);
    }
    result[kind] = entries
      .map((entry) => parseEntry(entry, kind))
      .sort((left, right) =>
        `${left.teamSource ?? ''}\u0000${left.source}`.localeCompare(
          `${right.teamSource ?? ''}\u0000${right.source}`,
        ),
      );
    const keys = result[kind].map((entry) => csvImportMappingKey(entry.source, entry.teamSource));
    if (new Set(keys).size !== keys.length) {
      return csvImportError('IMPORT_MAPPING_INVALID', `${kind} 원본 값이 중복되었습니다.`);
    }
  }
  return result;
}

export function csvImportMappingKey(source: string, teamSource?: string): string {
  return `${teamSource ?? ''}\u0000${normalizeCsvImportValue(source)}`;
}

export function csvImportMappingEntryMap(
  entries: CsvImportMappingEntry[],
): Map<string, CsvImportMappingEntry> {
  return new Map(
    entries.map((entry) => [csvImportMappingKey(entry.source, entry.teamSource), entry]),
  );
}
