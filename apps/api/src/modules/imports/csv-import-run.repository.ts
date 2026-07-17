import { HttpStatus, Injectable } from '@nestjs/common';

import { ImportRunStatus, Prisma } from '@rivet/database';

import { DatabaseService } from '../../common/database/database.service';
import type { CsvImportContext } from './csv-import.context';
import { csvImportError } from './csv-import.errors';

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

export type CsvImportRunRow = Prisma.ImportRunGetPayload<{ select: typeof RUN_SELECT }>;
export type CsvImportRunSaveData = {
  connectionCreatedCount?: number;
  errorCount: number;
  errorDetails: Array<{ code: string; field?: string; rowNumber: number; severity?: string }>;
  excludedRowCount?: number;
  inputRowCount: number;
  issueCreatedCount?: number;
  lastErrorCode: string | null;
  projectCreatedCount?: number;
  status: ImportRunStatus;
  validatedTargetFingerprint?: string | null;
  validationSignature?: string | null;
};

@Injectable()
export class CsvImportRunRepository {
  constructor(private readonly database: DatabaseService) {}

  get(workspaceId: string, executionId: string): Promise<CsvImportRunRow | null> {
    return this.database.client.importRun.findFirst({
      select: RUN_SELECT,
      where: { executionId, workspaceId },
    });
  }

  getCursor(workspaceId: string, id: string): Promise<{ createdAt: Date; id: string } | null> {
    return this.database.client.importRun.findFirst({
      select: { createdAt: true, id: true },
      where: { id, workspaceId },
    });
  }

  list(
    workspaceId: string,
    limit: number,
    cursor: { createdAt: Date; id: string } | null,
  ): Promise<CsvImportRunRow[]> {
    return this.database.client.importRun.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: RUN_SELECT,
      take: limit + 1,
      where: {
        workspaceId,
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
  }

  async save(
    context: CsvImportContext,
    executionId: string,
    sourceFingerprint: string,
    data: CsvImportRunSaveData,
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
      return csvImportError(
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
