import { createHash } from 'node:crypto';

import { HttpStatus, Injectable } from '@nestjs/common';

import { ImportRunStatus, IssuePriority } from '@rivet/database';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import type { CsvImportContext as ImportContext } from './csv-import.context';
import { csvImportError as importError } from './csv-import.errors';
import {
  CSV_IMPORT_MAX_DISTINCT_VALUES,
  CsvImportParseError,
  type CsvImportUpload,
  parseCsvImportFile,
  type ParsedCsvImport,
} from './csv-import.parser';
import { CsvImportAnalysisService } from './csv-import-analysis.service';
import {
  CSV_IMPORT_UNSUPPORTED_COLUMN_PATTERN as UNSUPPORTED_COLUMN_PATTERN,
  csvImportPreview as preview,
  hashCsvImportValue as sha256,
  normalizeCsvImportValue as normalized,
  parseCsvImportMapping as parseMapping,
} from './csv-import-mapping.policy';
import { CsvImportPersistenceService } from './csv-import-persistence.service';
import { CsvImportQueryService } from './csv-import-query.service';
import { CsvImportRunRepository } from './csv-import-run.repository';
import { CsvImportTargetRepository } from './csv-import-target.repository';
import type {
  CsvImportInspectionResponseDto,
  CsvImportMappingOptionsResponseDto,
  CsvImportRunResponseDto,
  CsvImportValidationResponseDto,
} from './dto/csv-import-response.dto';

const CSV_IMPORT_TRANSACTION_MAX_WAIT_MS = 30_000;
const CSV_IMPORT_TRANSACTION_TIMEOUT_MS = 180_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

@Injectable()
export class CsvImportService {
  constructor(
    private readonly analysis: CsvImportAnalysisService,
    private readonly database: DatabaseService,
    private readonly persistence: CsvImportPersistenceService,
    private readonly queries: CsvImportQueryService,
    private readonly runs: CsvImportRunRepository,
    private readonly targets: CsvImportTargetRepository,
  ) {}

  async inspect(
    context: ImportContext,
    executionId: string,
    file: CsvImportUpload | undefined,
  ): Promise<CsvImportInspectionResponseDto> {
    try {
      const parsed = parseCsvImportFile(file);
      await this.runs.save(context, executionId, parsed.fingerprint, {
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
        await this.runs.save(context, executionId, fingerprint, {
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
    const snapshot = await this.targets.load(this.database.client, context.workspaceId);
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
    const targets = await this.targets.load(this.database.client, context.workspaceId);
    const duplicateCompletedRun = await this.database.client.importRun.findFirst({
      select: { id: true },
      where: {
        executionId: { not: executionId },
        sourceFingerprint: parsed.fingerprint,
        status: ImportRunStatus.SUCCEEDED,
        workspaceId: context.workspaceId,
      },
    });
    const analysis = await this.analysis.analyze(
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
    await this.runs.save(context, executionId, parsed.fingerprint, {
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
          const targets = await this.targets.load(transaction, context.workspaceId);
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
          const analysis = await this.analysis.analyze(
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
          await this.persistence.persist(transaction, context, executionId, mapping, analysis);
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
    return this.queries.getRun(context, executionId);
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
}
