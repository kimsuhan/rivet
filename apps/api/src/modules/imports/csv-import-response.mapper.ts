import { Prisma } from '@rivet/database';

import type { CsvImportRunRow } from './csv-import-run.repository';
import type {
  CsvImportPreviewErrorDto,
  CsvImportRunResponseDto,
} from './dto/csv-import-response.dto';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeErrors(value: Prisma.JsonValue | null): CsvImportPreviewErrorDto[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.code !== 'string' || typeof item.rowNumber !== 'number') {
      return [];
    }
    return [
      {
        code: item.code,
        rowNumber: item.rowNumber,
        ...(typeof item.field === 'string' ? { field: item.field } : {}),
        severity: item.severity === 'WARNING' ? 'WARNING' : 'ERROR',
      } satisfies CsvImportPreviewErrorDto,
    ];
  });
}

export function toCsvImportRunResponse(row: CsvImportRunRow): CsvImportRunResponseDto {
  const projects = new Map<string, string>();
  const issues = new Map<string, string>();
  for (const sourceRow of row.sourceRows) {
    if (sourceRow.projectCreated) projects.set(sourceRow.project.id, sourceRow.project.name);
    issues.set(sourceRow.issue.id, sourceRow.issue.identifier);
  }
  return {
    completedAt: row.completedAt?.toISOString() ?? null,
    connectionCreatedCount: row.connectionCreatedCount,
    createdAt: row.createdAt.toISOString(),
    createdIssues: [...issues].map(([id, label]) => ({ id, label })),
    createdProjects: [...projects].map(([id, label]) => ({ id, label })),
    errorCount: row.errorCount,
    errors: safeErrors(row.errorDetails),
    executionId: row.executionId,
    excludedRowCount: row.excludedRowCount,
    failedAt: row.failedAt?.toISOString() ?? null,
    id: row.id,
    inputRowCount: row.inputRowCount,
    issueCreatedCount: row.issueCreatedCount,
    lastErrorCode: row.lastErrorCode,
    projectCreatedCount: row.projectCreatedCount,
    status: row.status,
  };
}
