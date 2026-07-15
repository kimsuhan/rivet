import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Injectable } from '@nestjs/common';

import {
  ImportRunStatus,
  IssuePriority,
  IssueStatus,
  MembershipStatus,
  Prisma,
  type PrismaClient,
  ProjectRole,
  ProjectStatus,
  StateCategory,
} from '@rivet/database';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import { parseOptionalMarkdown } from '../../common/validation/markdown';
import {
  CSV_IMPORT_MAX_DISTINCT_VALUES,
  CsvImportParseError,
  type CsvImportUpload,
  isFormulaCell,
  parseCsvImportFile,
  type ParsedCsvImport,
  splitLabelValues,
} from './csv-import-parser';
import type { CsvImportRunListQueryDto } from './dto/csv-import-request.dto';
import type {
  CsvImportInspectionResponseDto,
  CsvImportMappingOptionsResponseDto,
  CsvImportPreviewErrorDto,
  CsvImportRunListResponseDto,
  CsvImportRunResponseDto,
  CsvImportValidationResponseDto,
} from './dto/csv-import-response.dto';

type ImportContext = { membershipId: string; workspaceId: string };
type DatabaseClient = Prisma.TransactionClient | PrismaClient;
type ErrorPreview = CsvImportPreviewErrorDto;
type MappingMode = 'CREATE' | 'EXCLUDE' | 'IGNORE' | 'MAP' | 'NONE';

type MappingEntry = {
  mode: MappingMode;
  source: string;
  targetId?: string;
  targetValue?: IssuePriority;
  teamSource?: string;
};

type CsvImportMapping = {
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
  labels: MappingEntry[];
  members: MappingEntry[];
  priorities: MappingEntry[];
  projects: MappingEntry[];
  states: MappingEntry[];
  targetFingerprint: string;
  teams: MappingEntry[];
};

type TargetSnapshot = {
  fingerprint: string;
  labels: Array<{
    color: string;
    id: string;
    name: string;
    normalizedName: string;
    version: number;
  }>;
  members: Array<{
    displayName: string;
    email: string;
    id: string;
    role: 'ADMIN' | 'MEMBER';
    teamIds: string[];
  }>;
  projects: Array<{
    id: string;
    name: string;
    roleTeams: Array<{ role: ProjectRole; teamId: string }>;
    version: number;
  }>;
  states: Array<{
    category: StateCategory;
    id: string;
    name: string;
    teamId: string;
    version: number;
  }>;
  teams: Array<{ id: string; key: string; name: string; version: number }>;
};

type PreparedRow = {
  assigneeMembershipId: string | null;
  descriptionMarkdown: string | null;
  labelSources: string[];
  priority: IssuePriority;
  projectRole: ProjectRole;
  projectSource: string;
  sourceKeyHash: string;
  sourceReference: string;
  stateCategory: StateCategory;
  teamId: string;
  title: string;
  workflowStateId: string;
};

type Analysis = {
  errors: ErrorPreview[];
  excludedRowCount: number;
  preparedRows: PreparedRow[];
  projectTeams: Map<string, string>;
  summary: {
    connectionCreateCount: number;
    errorCount: number;
    excludedRowCount: number;
    issueCreateCount: number;
    projectCreateCount: number;
    warningCount: number;
  };
  warnings: ErrorPreview[];
};

const RUN_SELECT = {
  completedAt: true,
  connectionCreatedCount: true,
  createdAt: true,
  errorCount: true,
  errorDetails: true,
  executionId: true,
  excludedRowCount: true,
  failedAt: true,
  id: true,
  inputRowCount: true,
  issueCreatedCount: true,
  lastErrorCode: true,
  projectCreatedCount: true,
  sourceRows: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      issue: { select: { id: true, identifier: true } },
      project: { select: { id: true, name: true } },
      projectCreated: true,
    },
    take: 20,
  },
  status: true,
} satisfies Prisma.ImportRunSelect;

type ImportRunRow = Prisma.ImportRunGetPayload<{ select: typeof RUN_SELECT }>;

const UNSUPPORTED_COLUMN_PATTERN =
  /comment|댓글|activity|활동|notification|알림|handoff|전달|attachment|첨부|automation|자동화/iu;
const CSV_IMPORT_BATCH_SIZE = 500;
const CSV_IMPORT_TRANSACTION_MAX_WAIT_MS = 30_000;
const CSV_IMPORT_TRANSACTION_TIMEOUT_MS = 180_000;

function importError(
  code: string,
  message: string,
  status = HttpStatus.UNPROCESSABLE_ENTITY,
): never {
  throw new ApiError({ code, message, status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalized(value: string): string {
  return value.normalize('NFC').trim();
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sourceHash(value: string): string {
  return sha256(normalized(value).toLocaleLowerCase('en-US'));
}

function issueStatus(category: StateCategory): IssueStatus {
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

function preview(
  code: string,
  rowNumber: number,
  field?: string,
  severity?: 'ERROR' | 'WARNING',
): ErrorPreview {
  return { code, rowNumber, ...(field ? { field } : {}), ...(severity ? { severity } : {}) };
}

function parseEntry(value: unknown, kind: keyof CsvImportMapping): MappingEntry {
  if (!isRecord(value) || typeof value.source !== 'string' || typeof value.mode !== 'string') {
    return importError('IMPORT_MAPPING_INVALID', `${kind} 매핑을 확인해 주세요.`);
  }
  const source = normalized(value.source);
  if (source.length < 1 || [...source].length > 255 || isFormulaCell(source)) {
    return importError('IMPORT_MAPPING_INVALID', `${kind} 원본 값을 확인해 주세요.`);
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
    return importError('IMPORT_MAPPING_INVALID', `${kind} 매핑 방식을 확인해 주세요.`);
  }
  const entry: MappingEntry = { mode: value.mode as MappingMode, source };
  if (typeof value.teamSource === 'string') entry.teamSource = normalized(value.teamSource);
  if (typeof value.targetId === 'string') entry.targetId = value.targetId.toLowerCase();
  if (typeof value.targetValue === 'string') {
    if (!Object.values(IssuePriority).includes(value.targetValue as IssuePriority)) {
      return importError('IMPORT_MAPPING_INVALID', '우선순위 매핑을 확인해 주세요.');
    }
    entry.targetValue = value.targetValue as IssuePriority;
  }
  if (entry.mode === 'MAP' && kind !== 'priorities' && !entry.targetId) {
    return importError('IMPORT_MAPPING_INVALID', `${kind} 대상 식별자를 확인해 주세요.`);
  }
  if (kind === 'priorities' && !entry.targetValue) {
    return importError('IMPORT_MAPPING_INVALID', '우선순위 대상 값을 확인해 주세요.');
  }
  if ((kind === 'states' || kind === 'members') && !entry.teamSource) {
    return importError('IMPORT_MAPPING_INVALID', `${kind} 팀 원본 값을 확인해 주세요.`);
  }
  return entry;
}

function parseMapping(raw: string, columns: string[]): CsvImportMapping {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return importError('IMPORT_MAPPING_INVALID', '가져오기 매핑 JSON을 확인해 주세요.');
  }
  if (
    !isRecord(value) ||
    !isRecord(value.columns) ||
    typeof value.targetFingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(value.targetFingerprint)
  ) {
    return importError('IMPORT_MAPPING_INVALID', '가져오기 매핑을 확인해 주세요.');
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
      UNSUPPORTED_COLUMN_PATTERN.test(column)
    ) {
      return importError('IMPORT_COLUMN_MAPPING_INVALID', `${field} 컬럼 매핑을 확인해 주세요.`);
    }
    mappedColumns[field] = column;
  }
  if (new Set(Object.values(mappedColumns)).size !== Object.values(mappedColumns).length) {
    return importError(
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
      return importError('IMPORT_MAPPING_INVALID', `${kind} 매핑 목록을 확인해 주세요.`);
    }
    result[kind] = entries
      .map((entry) => parseEntry(entry, kind))
      .sort((left, right) =>
        `${left.teamSource ?? ''}\u0000${left.source}`.localeCompare(
          `${right.teamSource ?? ''}\u0000${right.source}`,
        ),
      );
    const keys = result[kind].map((entry) => mappingKey(entry.source, entry.teamSource));
    if (new Set(keys).size !== keys.length) {
      return importError('IMPORT_MAPPING_INVALID', `${kind} 원본 값이 중복되었습니다.`);
    }
  }
  return result;
}

function mappingKey(source: string, teamSource?: string): string {
  return `${teamSource ?? ''}\u0000${normalized(source)}`;
}

function entryMap(entries: MappingEntry[]): Map<string, MappingEntry> {
  return new Map(entries.map((entry) => [mappingKey(entry.source, entry.teamSource), entry]));
}

function safeErrors(value: Prisma.JsonValue | null): ErrorPreview[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.code !== 'string' || typeof item.rowNumber !== 'number') {
      return [];
    }
    return [
      preview(
        item.code,
        item.rowNumber,
        typeof item.field === 'string' ? item.field : undefined,
        item.severity === 'WARNING' ? 'WARNING' : 'ERROR',
      ),
    ];
  });
}

function runResponse(row: ImportRunRow): CsvImportRunResponseDto {
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

@Injectable()
export class CsvImportService {
  constructor(private readonly database: DatabaseService) {}

  async inspect(
    context: ImportContext,
    executionId: string,
    file: CsvImportUpload | undefined,
  ): Promise<CsvImportInspectionResponseDto> {
    try {
      const parsed = parseCsvImportFile(file);
      await this.saveRun(context, executionId, parsed.fingerprint, {
        errorCount: parsed.structureErrors.length,
        errorDetails: parsed.structureErrors,
        inputRowCount: parsed.rows.length,
        lastErrorCode: parsed.structureErrors[0]?.code ?? null,
        status:
          parsed.structureErrors.length > 0
            ? ImportRunStatus.VALIDATION_FAILED
            : ImportRunStatus.PREVIEWED,
      });
      return {
        columnValues: parsed.columns.map((column) => {
          const values = [
            ...new Set(parsed.rows.map((row) => normalized(row[column] ?? '')).filter(Boolean)),
          ];
          return {
            column,
            totalDistinctCount: values.length,
            truncated: values.length > CSV_IMPORT_MAX_DISTINCT_VALUES,
            values: values.slice(0, CSV_IMPORT_MAX_DISTINCT_VALUES),
          };
        }),
        columns: parsed.columns,
        errors: parsed.structureErrors.map((error) => ({ ...error, severity: 'ERROR' })),
        executionId,
        rowCount: parsed.rows.length,
        sourceFingerprint: parsed.fingerprint,
        unsupportedColumns: parsed.columns.filter((column) =>
          UNSUPPORTED_COLUMN_PATTERN.test(column),
        ),
      };
    } catch (error) {
      if (error instanceof CsvImportParseError) {
        const fingerprint = file?.buffer
          ? createHash('sha256').update(file.buffer).digest('hex')
          : sha256('');
        await this.saveRun(context, executionId, fingerprint, {
          errorCount: 1,
          errorDetails: [preview(error.code, 1, undefined, 'ERROR')],
          inputRowCount: 0,
          lastErrorCode: error.code,
          status: ImportRunStatus.VALIDATION_FAILED,
        });
        return importError(error.code, 'CSV 파일 형식과 제한을 확인해 주세요.');
      }
      throw error;
    }
  }

  async mappingOptions(context: ImportContext): Promise<CsvImportMappingOptionsResponseDto> {
    const snapshot = await this.loadTargets(this.database.client, context.workspaceId);
    return {
      labels: snapshot.labels.map(({ color, id, name, version }) => ({ color, id, name, version })),
      members: snapshot.members,
      priorities: Object.values(IssuePriority),
      projects: snapshot.projects,
      states: snapshot.states,
      targetFingerprint: snapshot.fingerprint,
      teams: snapshot.teams,
    };
  }

  async validate(
    context: ImportContext,
    executionId: string,
    file: CsvImportUpload | undefined,
    rawMapping: string,
    allowDuplicateFile: boolean,
  ): Promise<CsvImportValidationResponseDto> {
    const parsed = this.parseFile(file);
    const mapping = parseMapping(rawMapping, parsed.columns);
    const targets = await this.loadTargets(this.database.client, context.workspaceId);
    const duplicateCompletedRun = await this.database.client.importRun.findFirst({
      select: { id: true },
      where: {
        executionId: { not: executionId },
        sourceFingerprint: parsed.fingerprint,
        status: ImportRunStatus.SUCCEEDED,
        workspaceId: context.workspaceId,
      },
    });
    const analysis = await this.analyze(
      this.database.client,
      context.workspaceId,
      parsed,
      mapping,
      targets,
    );
    if (mapping.targetFingerprint !== targets.fingerprint) {
      analysis.errors.unshift(preview('IMPORT_TARGETS_CHANGED', 1, undefined, 'ERROR'));
    }
    if (duplicateCompletedRun && !allowDuplicateFile) {
      analysis.errors.unshift(preview('IMPORT_FILE_ALREADY_COMPLETED', 1, undefined, 'ERROR'));
    }
    analysis.summary.errorCount = analysis.errors.length;
    const canExecute = analysis.errors.length === 0;
    const validationSignature = sha256(
      `${parsed.fingerprint}:${targets.fingerprint}:${JSON.stringify(mapping)}`,
    );
    await this.saveRun(context, executionId, parsed.fingerprint, {
      connectionCreatedCount: analysis.summary.connectionCreateCount,
      errorCount: analysis.summary.errorCount,
      errorDetails: analysis.errors.slice(0, 200),
      excludedRowCount: analysis.summary.excludedRowCount,
      inputRowCount: parsed.rows.length,
      issueCreatedCount: analysis.summary.issueCreateCount,
      lastErrorCode: analysis.errors[0]?.code ?? null,
      projectCreatedCount: analysis.summary.projectCreateCount,
      status: canExecute ? ImportRunStatus.VALIDATED : ImportRunStatus.VALIDATION_FAILED,
      validatedTargetFingerprint: canExecute ? targets.fingerprint : null,
      validationSignature: canExecute ? validationSignature : null,
    });
    return {
      canExecute,
      duplicateCompletedRun: Boolean(duplicateCompletedRun),
      errors: analysis.errors.slice(0, 200),
      executionId,
      summary: analysis.summary,
      ...(canExecute ? { validationSignature } : {}),
      warnings: analysis.warnings.slice(0, 200),
    };
  }

  async execute(
    context: ImportContext,
    executionId: string,
    file: CsvImportUpload | undefined,
    rawMapping: string,
    allowDuplicateFile: boolean,
    validationSignature: string,
  ): Promise<CsvImportRunResponseDto> {
    const parsed = this.parseFile(file);
    const mapping = parseMapping(rawMapping, parsed.columns);
    try {
      await this.database.client.$transaction(
        async (transaction) => {
          await transaction.$queryRaw`
            SELECT "id" FROM "workspaces"
            WHERE "id" = ${context.workspaceId}::uuid
            FOR UPDATE
          `;
          const claimed = await transaction.importRun.updateMany({
            data: { startedAt: new Date(), status: ImportRunStatus.PROCESSING },
            where: {
              executionId,
              requestedByMembershipId: context.membershipId,
              sourceFingerprint: parsed.fingerprint,
              status: ImportRunStatus.VALIDATED,
              validationSignature,
              workspaceId: context.workspaceId,
            },
          });
          if (claimed.count !== 1) {
            return importError(
              'IMPORT_EXECUTION_CONFLICT',
              '이미 실행했거나 다시 검증해야 하는 가져오기입니다.',
              HttpStatus.CONFLICT,
            );
          }
          const targets = await this.loadTargets(transaction, context.workspaceId);
          const expectedSignature = sha256(
            `${parsed.fingerprint}:${targets.fingerprint}:${JSON.stringify(mapping)}`,
          );
          if (
            targets.fingerprint !== mapping.targetFingerprint ||
            expectedSignature !== validationSignature
          ) {
            return importError(
              'IMPORT_REVALIDATION_REQUIRED',
              '매핑 대상이 변경되었습니다. 다시 검증해 주세요.',
              HttpStatus.CONFLICT,
            );
          }
          if (!allowDuplicateFile) {
            const duplicate = await transaction.importRun.findFirst({
              select: { id: true },
              where: {
                executionId: { not: executionId },
                sourceFingerprint: parsed.fingerprint,
                status: ImportRunStatus.SUCCEEDED,
                workspaceId: context.workspaceId,
              },
            });
            if (duplicate) {
              return importError(
                'IMPORT_FILE_ALREADY_COMPLETED',
                '같은 파일의 완료 기록이 있습니다.',
                HttpStatus.CONFLICT,
              );
            }
          }
          const analysis = await this.analyze(
            transaction,
            context.workspaceId,
            parsed,
            mapping,
            targets,
          );
          if (analysis.errors.length > 0) {
            return importError(
              'IMPORT_REVALIDATION_REQUIRED',
              'CSV 또는 매핑 대상이 변경되었습니다. 다시 검증해 주세요.',
              HttpStatus.CONFLICT,
            );
          }
          await this.persist(transaction, context, executionId, mapping, analysis);
        },
        {
          maxWait: CSV_IMPORT_TRANSACTION_MAX_WAIT_MS,
          timeout: CSV_IMPORT_TRANSACTION_TIMEOUT_MS,
        },
      );
    } catch (error) {
      const code =
        error instanceof ApiError
          ? ((error.getResponse() as { code?: string }).code ?? 'IMPORT_FAILED')
          : isRecord(error) && error.code === 'P2002'
            ? 'IMPORT_DUPLICATE_CONFLICT'
            : 'IMPORT_FAILED';
      await this.database.client.importRun.updateMany({
        data: {
          failedAt: new Date(),
          lastErrorCode: code,
          status:
            code === 'IMPORT_REVALIDATION_REQUIRED'
              ? ImportRunStatus.VALIDATION_FAILED
              : ImportRunStatus.FAILED,
        },
        where: {
          executionId,
          requestedByMembershipId: context.membershipId,
          status: { in: [ImportRunStatus.PROCESSING, ImportRunStatus.VALIDATED] },
          workspaceId: context.workspaceId,
        },
      });
      if (error instanceof ApiError) throw error;
      if (code === 'IMPORT_DUPLICATE_CONFLICT') {
        return importError(
          code,
          '다른 가져오기가 같은 source key를 먼저 저장했습니다. 다시 검증해 주세요.',
          HttpStatus.CONFLICT,
        );
      }
      return importError(
        'IMPORT_FAILED',
        '가져오기에 실패해 전체 변경을 되돌렸습니다.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return this.getRun(context, executionId);
  }

  async getRun(context: ImportContext, executionId: string): Promise<CsvImportRunResponseDto> {
    const row = await this.database.client.importRun.findFirst({
      select: RUN_SELECT,
      where: { executionId, workspaceId: context.workspaceId },
    });
    if (!row) {
      return importError(
        'RESOURCE_NOT_FOUND',
        '가져오기 실행을 찾을 수 없습니다.',
        HttpStatus.NOT_FOUND,
      );
    }
    return runResponse(row);
  }

  async listRuns(
    context: ImportContext,
    query: CsvImportRunListQueryDto,
  ): Promise<CsvImportRunListResponseDto> {
    const cursor = query.cursor
      ? await this.database.client.importRun.findFirst({
          select: { createdAt: true, id: true },
          where: { id: query.cursor, workspaceId: context.workspaceId },
        })
      : null;
    if (query.cursor && !cursor) {
      return importError(
        'RESOURCE_NOT_FOUND',
        '가져오기 실행 커서를 찾을 수 없습니다.',
        HttpStatus.NOT_FOUND,
      );
    }

    const rows = await this.database.client.importRun.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: RUN_SELECT,
      take: query.limit + 1,
      where: {
        workspaceId: context.workspaceId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(runResponse),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  private parseFile(file: CsvImportUpload | undefined): ParsedCsvImport {
    try {
      return parseCsvImportFile(file);
    } catch (error) {
      if (error instanceof CsvImportParseError) {
        return importError(error.code, 'CSV 파일 형식과 제한을 확인해 주세요.');
      }
      throw error;
    }
  }

  private async loadTargets(client: DatabaseClient, workspaceId: string): Promise<TargetSnapshot> {
    const [teams, memberships, projects, labels] = await Promise.all([
      client.team.findMany({
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          key: true,
          name: true,
          version: true,
          workflowStates: {
            orderBy: [{ position: 'asc' }, { id: 'asc' }],
            select: { category: true, id: true, name: true, version: true },
          },
        },
        where: { archivedAt: null, workspaceId },
      }),
      client.workspaceMembership.findMany({
        orderBy: [{ user: { displayName: 'asc' } }, { id: 'asc' }],
        select: {
          id: true,
          role: true,
          teamMemberships: {
            select: { teamId: true },
            where: { removedAt: null, team: { archivedAt: null } },
          },
          user: { select: { displayName: true, email: true } },
        },
        where: { status: MembershipStatus.ACTIVE, workspaceId },
      }),
      client.project.findMany({
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          roleTeams: { orderBy: { role: 'asc' }, select: { role: true, teamId: true } },
          version: true,
        },
        where: { archivedAt: null, deletedAt: null, workspaceId },
      }),
      client.label.findMany({
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: { color: true, id: true, name: true, normalizedName: true, version: true },
        where: { archivedAt: null, workspaceId },
      }),
    ]);
    const snapshot = {
      labels,
      members: memberships.map(({ id, role, teamMemberships, user }) => ({
        displayName: user.displayName,
        email: user.email,
        id,
        role,
        teamIds: teamMemberships.map(({ teamId }) => teamId).sort(),
      })),
      projects,
      states: teams.flatMap((team) =>
        team.workflowStates.map((state) => ({ ...state, teamId: team.id })),
      ),
      teams: teams.map(({ id, key, name, version }) => ({ id, key, name, version })),
    };
    return { ...snapshot, fingerprint: sha256(JSON.stringify(snapshot)) };
  }

  private async analyze(
    client: DatabaseClient,
    workspaceId: string,
    parsed: ParsedCsvImport,
    mapping: CsvImportMapping,
    targets: TargetSnapshot,
  ): Promise<Analysis> {
    const errors: ErrorPreview[] = parsed.structureErrors.map((error) => ({
      ...error,
      severity: 'ERROR',
    }));
    const warnings: ErrorPreview[] = [];
    const teamMappings = entryMap(mapping.teams);
    const stateMappings = entryMap(mapping.states);
    const memberMappings = entryMap(mapping.members);
    const projectMappings = entryMap(mapping.projects);
    const priorityMappings = entryMap(mapping.priorities);
    const labelMappings = entryMap(mapping.labels);
    const teams = new Map(targets.teams.map((team) => [team.id, team]));
    const states = new Map(targets.states.map((state) => [state.id, state]));
    const members = new Map(targets.members.map((member) => [member.id, member]));
    const projects = new Map(targets.projects.map((project) => [project.id, project]));
    const labels = new Map(targets.labels.map((label) => [label.id, label]));
    const activeLabelNames = new Set(targets.labels.map((label) => label.normalizedName));
    const createdLabelNames = new Map<string, string>();
    const seenKeys = new Map<string, number>();
    const keyHashes = parsed.rows
      .map((row) => normalized(row[mapping.columns.sourceKey] ?? ''))
      .filter(Boolean)
      .map(sourceHash);
    const existingKeys = new Set(
      (
        await client.importSourceRow.findMany({
          select: { sourceKeyHash: true },
          where: { sourceKeyHash: { in: [...new Set(keyHashes)] }, workspaceId },
        })
      ).map(({ sourceKeyHash }) => sourceKeyHash),
    );
    const preparedRows: PreparedRow[] = [];
    const projectTeams = new Map<string, string>();
    let excludedRowCount = 0;

    for (const [index, row] of parsed.rows.entries()) {
      const rowNumber = index + 2;
      let invalid = parsed.structureErrors.some((error) => error.rowNumber === rowNumber);
      const addError = (code: string, field?: string): void => {
        errors.push(preview(code, rowNumber, field, 'ERROR'));
        invalid = true;
      };
      for (const [column, value] of Object.entries(row)) {
        if (value.length > 0 && isFormulaCell(value)) addError('IMPORT_FORMULA_VALUE', column);
      }

      const sourceReference = normalized(row[mapping.columns.sourceKey] ?? '');
      const title = normalized(row[mapping.columns.title] ?? '');
      const teamSource = normalized(row[mapping.columns.team] ?? '');
      const stateSource = normalized(row[mapping.columns.status] ?? '');
      const projectSource = normalized(row[mapping.columns.project] ?? '');
      const descriptionSource = mapping.columns.description
        ? normalized(row[mapping.columns.description] ?? '')
        : '';
      const memberSource = mapping.columns.assignee
        ? normalized(row[mapping.columns.assignee] ?? '')
        : '';
      const prioritySource = mapping.columns.priority
        ? normalized(row[mapping.columns.priority] ?? '')
        : '';
      const labelSources = mapping.columns.labels
        ? splitLabelValues(row[mapping.columns.labels] ?? '')
        : [];

      if (sourceReference.length < 1 || [...sourceReference].length > 255)
        addError('IMPORT_SOURCE_KEY_INVALID', 'sourceKey');
      if (title.length < 1 || [...title].length > 500) addError('IMPORT_TITLE_INVALID', 'title');
      if (!teamSource) addError('IMPORT_TEAM_REQUIRED', 'team');
      if (!stateSource) addError('IMPORT_STATE_REQUIRED', 'status');
      if (!projectSource) addError('IMPORT_PROJECT_REQUIRED', 'project');
      if ([...descriptionSource].length > 100_000)
        addError('IMPORT_DESCRIPTION_TOO_LONG', 'description');

      let descriptionMarkdown: string | null = null;
      if (descriptionSource && !invalid) {
        try {
          const parsedMarkdown = parseOptionalMarkdown(descriptionSource, 100_000);
          if (parsedMarkdown.fileIds.length || parsedMarkdown.mentionedMembershipIds.length) {
            addError('IMPORT_DESCRIPTION_REFERENCE_UNSUPPORTED', 'description');
          }
          descriptionMarkdown = parsedMarkdown.bodyMarkdown;
        } catch {
          addError('IMPORT_DESCRIPTION_INVALID', 'description');
        }
      }

      const sourceKeyHash = sourceReference ? sourceHash(sourceReference) : '';
      if (sourceKeyHash) {
        const previous = seenKeys.get(sourceKeyHash);
        if (previous !== undefined) {
          addError('IMPORT_SOURCE_KEY_DUPLICATE', 'sourceKey');
          errors.push(preview('IMPORT_SOURCE_KEY_DUPLICATE', previous, 'sourceKey', 'ERROR'));
        } else {
          seenKeys.set(sourceKeyHash, rowNumber);
        }
      }

      const teamMapping = teamMappings.get(mappingKey(teamSource));
      const stateMapping = stateMappings.get(mappingKey(stateSource, teamSource));
      const projectMapping = projectMappings.get(mappingKey(projectSource));
      if (!teamMapping) addError('IMPORT_TEAM_MAPPING_REQUIRED', 'team');
      if (!stateMapping) addError('IMPORT_STATE_MAPPING_REQUIRED', 'status');
      if (!projectMapping) addError('IMPORT_PROJECT_MAPPING_REQUIRED', 'project');
      if (
        teamMapping?.mode === 'EXCLUDE' ||
        stateMapping?.mode === 'EXCLUDE' ||
        projectMapping?.mode === 'EXCLUDE'
      ) {
        excludedRowCount += 1;
        continue;
      }

      const teamId = teamMapping?.targetId;
      const workflowStateId = stateMapping?.targetId;
      const team = teamId ? teams.get(teamId) : undefined;
      const state = workflowStateId ? states.get(workflowStateId) : undefined;
      if (!team) addError('IMPORT_TEAM_TARGET_INVALID', 'team');
      if (!state || state.teamId !== teamId) addError('IMPORT_STATE_TARGET_INVALID', 'status');

      let assigneeMembershipId: string | null = null;
      if (memberSource) {
        const memberMapping = memberMappings.get(mappingKey(memberSource, teamSource));
        if (!memberMapping) addError('IMPORT_MEMBER_MAPPING_REQUIRED', 'assignee');
        if (memberMapping?.mode === 'MAP') {
          const member = memberMapping.targetId ? members.get(memberMapping.targetId) : undefined;
          if (!member || !teamId || !member.teamIds.includes(teamId)) {
            addError('IMPORT_MEMBER_TARGET_INVALID', 'assignee');
          } else {
            assigneeMembershipId = member.id;
          }
        }
      }

      let priority: IssuePriority = IssuePriority.NONE;
      if (prioritySource) {
        const priorityMapping = priorityMappings.get(mappingKey(prioritySource));
        if (!priorityMapping?.targetValue) addError('IMPORT_PRIORITY_MAPPING_REQUIRED', 'priority');
        else priority = priorityMapping.targetValue;
      }

      for (const labelSource of labelSources) {
        const labelMapping = labelMappings.get(mappingKey(labelSource));
        if (!labelMapping) {
          addError('IMPORT_LABEL_MAPPING_REQUIRED', 'labels');
        } else if (
          labelMapping.mode === 'MAP' &&
          (!labelMapping.targetId || !labels.has(labelMapping.targetId))
        ) {
          addError('IMPORT_LABEL_TARGET_INVALID', 'labels');
        } else if (labelMapping.mode === 'CREATE' && [...labelSource].length > 50) {
          addError('IMPORT_LABEL_NAME_INVALID', 'labels');
        } else if (labelMapping.mode === 'CREATE') {
          const normalizedName = labelSource.toLowerCase();
          const previousSource = createdLabelNames.get(normalizedName);
          if (activeLabelNames.has(normalizedName)) {
            addError('IMPORT_LABEL_ALREADY_EXISTS', 'labels');
          } else if (previousSource && previousSource !== labelSource) {
            addError('IMPORT_LABEL_NAME_DUPLICATE', 'labels');
          } else {
            createdLabelNames.set(normalizedName, labelSource);
          }
        }
      }

      let projectRole: ProjectRole = ProjectRole.BACKEND;
      if (projectMapping?.mode === 'MAP') {
        const project = projectMapping.targetId ? projects.get(projectMapping.targetId) : undefined;
        if (!project) addError('IMPORT_PROJECT_TARGET_INVALID', 'project');
        else {
          const roles = project.roleTeams
            .filter((roleTeam) => roleTeam.teamId === teamId)
            .map(({ role }) => role)
            .sort((left, right) =>
              left === ProjectRole.BACKEND
                ? -1
                : right === ProjectRole.BACKEND
                  ? 1
                  : left.localeCompare(right),
            );
          if (!roles[0]) addError('IMPORT_PROJECT_TEAM_NOT_CONNECTED', 'project');
          else projectRole = roles[0];
        }
      } else if (projectMapping?.mode === 'CREATE' && teamId) {
        const previousTeamId = projectTeams.get(projectSource);
        if (previousTeamId && previousTeamId !== teamId) {
          addError('IMPORT_PROJECT_TEAM_AMBIGUOUS', 'project');
        } else {
          projectTeams.set(projectSource, teamId);
        }
        if ([...projectSource].length > 200) addError('IMPORT_PROJECT_NAME_INVALID', 'project');
      }

      if (sourceKeyHash && existingKeys.has(sourceKeyHash)) {
        excludedRowCount += 1;
        warnings.push(preview('IMPORT_SOURCE_ALREADY_IMPORTED', rowNumber, 'sourceKey', 'WARNING'));
        continue;
      }
      if (!invalid && teamId && workflowStateId && state) {
        preparedRows.push({
          assigneeMembershipId,
          descriptionMarkdown,
          labelSources,
          priority,
          projectRole,
          projectSource,
          sourceKeyHash,
          sourceReference,
          stateCategory: state.category,
          teamId,
          title,
          workflowStateId,
        });
      }
    }

    const createProjects = new Set(
      mapping.projects
        .filter(({ mode, source }) => mode === 'CREATE' && projectTeams.has(source))
        .map(({ source }) => source),
    );
    const connectionCreateCount = preparedRows.reduce(
      (count, row) =>
        count +
        1 +
        row.labelSources.filter(
          (source) => labelMappings.get(mappingKey(source))?.mode !== 'IGNORE',
        ).length,
      createProjects.size,
    );
    return {
      errors,
      excludedRowCount,
      preparedRows,
      projectTeams,
      summary: {
        connectionCreateCount,
        errorCount: errors.length,
        excludedRowCount,
        issueCreateCount: preparedRows.length,
        projectCreateCount: createProjects.size,
        warningCount: warnings.length,
      },
      warnings,
    };
  }

  private async persist(
    transaction: Prisma.TransactionClient,
    context: ImportContext,
    executionId: string,
    mapping: CsvImportMapping,
    analysis: Analysis,
  ): Promise<void> {
    const run = await transaction.importRun.findUniqueOrThrow({
      select: { id: true },
      where: { workspaceId_executionId: { executionId, workspaceId: context.workspaceId } },
    });
    const writeBatches = async <Row>(
      rows: Row[],
      write: (batch: Row[]) => Promise<unknown>,
    ): Promise<void> => {
      for (let offset = 0; offset < rows.length; offset += CSV_IMPORT_BATCH_SIZE) {
        await write(rows.slice(offset, offset + CSV_IMPORT_BATCH_SIZE));
      }
    };

    const labelIds = new Map<string, string>();
    const usedLabelSources = new Set(analysis.preparedRows.flatMap((row) => row.labelSources));
    const labelsToCreate: Prisma.LabelCreateManyInput[] = [];
    for (const entry of mapping.labels) {
      if (entry.mode === 'MAP' && entry.targetId) labelIds.set(entry.source, entry.targetId);
      if (entry.mode === 'CREATE' && usedLabelSources.has(entry.source)) {
        const id = randomUUID();
        labelsToCreate.push({
          color: '#5E6AD2',
          id,
          name: entry.source,
          normalizedName: entry.source.toLocaleLowerCase('ko-KR'),
          workspaceId: context.workspaceId,
        });
        labelIds.set(entry.source, id);
      }
    }
    await writeBatches(labelsToCreate, (data) => transaction.label.createMany({ data }));

    const projectIds = new Map<string, string>();
    const createdProjectSources = new Set<string>();
    const projectsToCreate: Prisma.ProjectCreateManyInput[] = [];
    const projectRoleTeamsToCreate: Prisma.ProjectRoleTeamCreateManyInput[] = [];
    const activityEventsToCreate: Prisma.ActivityEventCreateManyInput[] = [];
    for (const entry of mapping.projects) {
      if (entry.mode === 'MAP' && entry.targetId) projectIds.set(entry.source, entry.targetId);
      const teamId = analysis.projectTeams.get(entry.source);
      if (entry.mode === 'CREATE' && teamId) {
        const projectId = randomUUID();
        projectsToCreate.push({
          id: projectId,
          name: entry.source,
          status: ProjectStatus.PLANNED,
          workspaceId: context.workspaceId,
        });
        projectRoleTeamsToCreate.push({
          projectId,
          role: ProjectRole.BACKEND,
          teamId,
          workspaceId: context.workspaceId,
        });
        activityEventsToCreate.push({
          actorMembershipId: context.membershipId,
          afterData: { importRunId: run.id },
          eventType: 'PROJECT_IMPORTED',
          projectId,
          workspaceId: context.workspaceId,
        });
        projectIds.set(entry.source, projectId);
        createdProjectSources.add(entry.source);
      }
    }
    await writeBatches(projectsToCreate, (data) => transaction.project.createMany({ data }));
    await writeBatches(projectRoleTeamsToCreate, (data) =>
      transaction.projectRoleTeam.createMany({ data }),
    );

    const workspace = await transaction.workspace.findUniqueOrThrow({
      select: { nextIssueNumber: true },
      where: { id: context.workspaceId },
    });
    const teamCounts = new Map<string, number>();
    for (const row of analysis.preparedRows) {
      teamCounts.set(row.teamId, (teamCounts.get(row.teamId) ?? 0) + 1);
    }
    const teams =
      teamCounts.size === 0
        ? []
        : await transaction.$queryRaw<Array<{ id: string; key: string; nextIssueNumber: number }>>(
            Prisma.sql`
              SELECT "id", "key", "next_issue_number" AS "nextIssueNumber"
              FROM "teams"
              WHERE "workspace_id" = ${context.workspaceId}::uuid
                AND "id" IN (${Prisma.join(
                  [...teamCounts.keys()].map((id) => Prisma.sql`${id}::uuid`),
                )})
              ORDER BY "id"
              FOR UPDATE
            `,
          );
    const teamSequences = new Map(teams.map((team) => [team.id, team]));
    await transaction.workspace.update({
      data: { nextIssueNumber: { increment: analysis.preparedRows.length } },
      where: { id: context.workspaceId },
    });
    const teamCounterUpdates = [...teamCounts].map(([teamId, count]) => ({ count, teamId }));
    for (let offset = 0; offset < teamCounterUpdates.length; offset += CSV_IMPORT_BATCH_SIZE) {
      const batch = teamCounterUpdates.slice(offset, offset + CSV_IMPORT_BATCH_SIZE);
      await transaction.$executeRaw(
        Prisma.sql`
          UPDATE "teams" AS team
          SET "next_issue_number" = team."next_issue_number" + increments."count",
              "updated_at" = NOW()
          FROM (VALUES ${Prisma.join(
            batch.map(({ count, teamId }) => Prisma.sql`(${teamId}::uuid, ${count}::integer)`),
          )}) AS increments("id", "count")
          WHERE team."workspace_id" = ${context.workspaceId}::uuid
            AND team."id" = increments."id"
        `,
      );
    }

    const nextTeamOffset = new Map<string, number>();
    const ignoredLabelSources = new Set(
      mapping.labels.filter(({ mode }) => mode === 'IGNORE').map(({ source }) => source),
    );
    const issuesToCreate: Prisma.IssueCreateManyInput[] = [];
    const teamWorksToCreate: Prisma.TeamWorkCreateManyInput[] = [];
    const issueLabelsToCreate: Prisma.IssueLabelCreateManyInput[] = [];
    const sourceRowsToCreate: Prisma.ImportSourceRowCreateManyInput[] = [];
    for (const [index, row] of analysis.preparedRows.entries()) {
      const projectId = projectIds.get(row.projectSource);
      const team = teamSequences.get(row.teamId);
      if (!projectId || !team) throw new Error('IMPORT_RESOLVED_TARGET_MISSING');
      const issueNumber = workspace.nextIssueNumber + index;
      const teamOffset = nextTeamOffset.get(row.teamId) ?? 0;
      nextTeamOffset.set(row.teamId, teamOffset + 1);
      const teamWorkNumber = team.nextIssueNumber + teamOffset;
      const issueId = randomUUID();
      const teamWorkId = randomUUID();
      issuesToCreate.push({
        createdByMembershipId: context.membershipId,
        descriptionMarkdown: row.descriptionMarkdown,
        id: issueId,
        identifier: `F-${issueNumber}`,
        priority: row.priority,
        projectId,
        sequenceNumber: issueNumber,
        status: issueStatus(row.stateCategory),
        title: row.title,
        workspaceId: context.workspaceId,
      });
      teamWorksToCreate.push({
        assigneeMembershipId: row.assigneeMembershipId,
        createdByMembershipId: context.membershipId,
        id: teamWorkId,
        identifier: `${team.key}-${teamWorkNumber}`,
        issueId,
        projectRole: row.projectRole,
        sequenceNumber: teamWorkNumber,
        teamId: row.teamId,
        workflowStateId: row.workflowStateId,
        workspaceId: context.workspaceId,
      });
      const resolvedLabelIds = row.labelSources.flatMap((source) => {
        if (ignoredLabelSources.has(source)) return [];
        const labelId = labelIds.get(source);
        return labelId ? [labelId] : [];
      });
      issueLabelsToCreate.push(
        ...resolvedLabelIds.map((labelId) => ({
          issueId,
          labelId,
          workspaceId: context.workspaceId,
        })),
      );
      sourceRowsToCreate.push({
        importRunId: run.id,
        issueId,
        projectId,
        projectCreated: createdProjectSources.has(row.projectSource),
        sourceKeyHash: row.sourceKeyHash,
        sourceReference: row.sourceReference,
        workspaceId: context.workspaceId,
      });
      activityEventsToCreate.push({
        actorMembershipId: context.membershipId,
        afterData: { importRunId: run.id, sourceReference: row.sourceReference },
        eventType: 'ISSUE_IMPORTED',
        issueId,
        teamWorkId,
        workspaceId: context.workspaceId,
      });
    }

    await writeBatches(issuesToCreate, (data) => transaction.issue.createMany({ data }));
    await writeBatches(teamWorksToCreate, (data) => transaction.teamWork.createMany({ data }));
    await writeBatches(issueLabelsToCreate, (data) => transaction.issueLabel.createMany({ data }));
    await writeBatches(sourceRowsToCreate, (data) =>
      transaction.importSourceRow.createMany({ data }),
    );
    await writeBatches(activityEventsToCreate, (data) =>
      transaction.activityEvent.createMany({ data }),
    );

    await transaction.importRun.update({
      data: {
        completedAt: new Date(),
        connectionCreatedCount: analysis.summary.connectionCreateCount,
        errorCount: 0,
        errorDetails: Prisma.JsonNull,
        excludedRowCount: analysis.summary.excludedRowCount,
        failedAt: null,
        issueCreatedCount: analysis.summary.issueCreateCount,
        lastErrorCode: null,
        projectCreatedCount: analysis.summary.projectCreateCount,
        status: ImportRunStatus.SUCCEEDED,
      },
      where: { id: run.id },
    });
  }

  private async saveRun(
    context: ImportContext,
    executionId: string,
    sourceFingerprint: string,
    data: {
      connectionCreatedCount?: number;
      errorCount: number;
      errorDetails: ErrorPreview[] | { code: string; rowNumber: number }[];
      excludedRowCount?: number;
      inputRowCount: number;
      issueCreatedCount?: number;
      lastErrorCode: string | null;
      projectCreatedCount?: number;
      status: ImportRunStatus;
      validatedTargetFingerprint?: string | null;
      validationSignature?: string | null;
    },
  ): Promise<void> {
    const existing = await this.database.client.importRun.findUnique({
      select: { requestedByMembershipId: true, status: true },
      where: { workspaceId_executionId: { executionId, workspaceId: context.workspaceId } },
    });
    if (
      (existing && existing.requestedByMembershipId !== context.membershipId) ||
      existing?.status === ImportRunStatus.PROCESSING ||
      existing?.status === ImportRunStatus.SUCCEEDED
    ) {
      return importError(
        'IMPORT_EXECUTION_CONFLICT',
        '이미 처리 중이거나 완료된 실행 식별자입니다.',
        HttpStatus.CONFLICT,
      );
    }
    await this.database.client.importRun.upsert({
      create: {
        connectionCreatedCount: data.connectionCreatedCount ?? 0,
        errorCount: data.errorCount,
        errorDetails: data.errorDetails as Prisma.InputJsonValue,
        executionId,
        excludedRowCount: data.excludedRowCount ?? 0,
        inputRowCount: data.inputRowCount,
        issueCreatedCount: data.issueCreatedCount ?? 0,
        lastErrorCode: data.lastErrorCode,
        projectCreatedCount: data.projectCreatedCount ?? 0,
        requestedByMembershipId: context.membershipId,
        sourceFingerprint,
        status: data.status,
        validatedTargetFingerprint: data.validatedTargetFingerprint ?? null,
        validationSignature: data.validationSignature ?? null,
        workspaceId: context.workspaceId,
      },
      update: {
        completedAt: null,
        connectionCreatedCount: data.connectionCreatedCount ?? 0,
        errorCount: data.errorCount,
        errorDetails: data.errorDetails as Prisma.InputJsonValue,
        excludedRowCount: data.excludedRowCount ?? 0,
        failedAt: data.status === ImportRunStatus.VALIDATION_FAILED ? new Date() : null,
        inputRowCount: data.inputRowCount,
        issueCreatedCount: data.issueCreatedCount ?? 0,
        lastErrorCode: data.lastErrorCode,
        projectCreatedCount: data.projectCreatedCount ?? 0,
        requestedByMembershipId: context.membershipId,
        sourceFingerprint,
        startedAt: null,
        status: data.status,
        validatedTargetFingerprint: data.validatedTargetFingerprint ?? null,
        validationSignature: data.validationSignature ?? null,
      },
      where: { workspaceId_executionId: { executionId, workspaceId: context.workspaceId } },
    });
  }
}
