import { Controller, Get, HttpStatus, Logger, Res, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { ApiError } from '../../common/errors/api-error';
import { ApiErrorResponseDto } from '../../common/errors/api-error-response.dto';
import { AdminGuard } from '../../common/guards/admin.guard';
import { ObservabilityService } from '../../common/observability/observability.service';
import type { AuthenticatedRequestContext } from '../auth/authentication.context';
import { CurrentAuthentication } from '../auth/current-authentication.decorator';
import {
  type CsvExportRun,
  type ExportContext,
  type ExportFailureCode,
  ExportsService,
} from './exports.service';

type ResponseOutcome = 'CLOSED' | 'ERRORED' | 'FINISHED';

function adminContext(authentication: AuthenticatedRequestContext): ExportContext {
  const { membership, workspace } = authentication.session;
  if (
    !membership ||
    !workspace ||
    membership.role !== 'ADMIN' ||
    membership.status !== 'ACTIVE' ||
    membership.workspaceId !== workspace.id
  ) {
    throw new ApiError({
      code: 'FORBIDDEN',
      message: '관리자만 데이터를 내보낼 수 있습니다.',
      status: HttpStatus.FORBIDDEN,
    });
  }
  return { membershipId: membership.id, workspaceId: workspace.id };
}

function observeResponse(response: Response): {
  current: () => ResponseOutcome | null;
  dispose: () => void;
  promise: Promise<ResponseOutcome>;
} {
  let current: ResponseOutcome | null = null;
  let resolveOutcome: (outcome: ResponseOutcome) => void = () => undefined;

  const promise = new Promise<ResponseOutcome>((resolve) => {
    resolveOutcome = resolve;
  });
  const cleanup = (): void => {
    response.off('close', onClose);
    response.off('error', onError);
    response.off('finish', onFinish);
  };
  const settle = (outcome: ResponseOutcome): void => {
    if (current !== null) return;
    current = outcome;
    cleanup();
    resolveOutcome(outcome);
  };
  const onClose = (): void => settle('CLOSED');
  const onError = (): void => settle('ERRORED');
  const onFinish = (): void => settle('FINISHED');

  response.once('close', onClose);
  response.once('error', onError);
  response.once('finish', onFinish);
  if (response.destroyed) settle('CLOSED');

  return { current: () => current, dispose: cleanup, promise };
}

function responseFailure(outcome: ResponseOutcome | null, error: unknown): ExportFailureCode {
  if (outcome === 'CLOSED') return 'EXPORT_RESPONSE_CLOSED';
  if (outcome === 'ERRORED') return 'EXPORT_RESPONSE_ERROR';
  if (error instanceof Error && error.message === 'EXPORT_RESPONSE_CLOSED') {
    return 'EXPORT_RESPONSE_CLOSED';
  }
  if (error instanceof Error && error.message === 'EXPORT_RESPONSE_ERROR') {
    return 'EXPORT_RESPONSE_ERROR';
  }
  if (error instanceof Error && error.message === 'EXPORT_GENERATION_FAILED') {
    return 'EXPORT_GENERATION_FAILED';
  }
  return 'EXPORT_STREAM_FAILED';
}

function writeChunk(response: Response, chunk: string): Promise<void> {
  if (response.destroyed || response.writableEnded) {
    return Promise.reject(new Error('EXPORT_RESPONSE_CLOSED'));
  }
  if (response.write(chunk)) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      response.off('close', onClose);
      response.off('drain', onDrain);
      response.off('error', onError);
    };
    const onClose = (): void => {
      cleanup();
      reject(new Error('EXPORT_RESPONSE_CLOSED'));
    };
    const onDrain = (): void => {
      cleanup();
      resolve();
    };
    const onError = (): void => {
      cleanup();
      reject(new Error('EXPORT_RESPONSE_ERROR'));
    };

    response.once('close', onClose);
    response.once('drain', onDrain);
    response.once('error', onError);
  });
}

function fileDate(): string {
  return new Date().toISOString().slice(0, 10).replaceAll('-', '');
}

@ApiTags('exports')
@ApiCookieAuth('sessionCookie')
@UseGuards(AdminGuard)
@Controller('exports')
export class ExportsController {
  private readonly logger = new Logger(ExportsController.name);

  constructor(
    private readonly exportsService: ExportsService,
    private readonly observability: ObservabilityService,
  ) {}

  @Get('issues.csv')
  @ApiOperation({ summary: '현재 워크스페이스 이슈 CSV 내보내기' })
  @ApiProduces('text/csv')
  @ApiOkResponse({
    content: { 'text/csv': { schema: { format: 'binary', type: 'string' } } },
    description: 'UTF-8 BOM 이슈 CSV 스트림',
  })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ description: 'FORBIDDEN', type: ApiErrorResponseDto })
  issues(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Res() response: Response,
  ): Promise<void> {
    const context = adminContext(authentication);
    return this.stream(
      response,
      context,
      'ISSUES',
      `rivet-issues-${fileDate()}.csv`,
      this.exportsService.beginIssues(context),
    );
  }

  @Get('projects.csv')
  @ApiOperation({ summary: '현재 워크스페이스 프로젝트 CSV 내보내기' })
  @ApiProduces('text/csv')
  @ApiOkResponse({
    content: { 'text/csv': { schema: { format: 'binary', type: 'string' } } },
    description: 'UTF-8 BOM 프로젝트 CSV 스트림',
  })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ description: 'FORBIDDEN', type: ApiErrorResponseDto })
  projects(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Res() response: Response,
  ): Promise<void> {
    const context = adminContext(authentication);
    return this.stream(
      response,
      context,
      'PROJECTS',
      `rivet-projects-${fileDate()}.csv`,
      this.exportsService.beginProjects(context),
    );
  }

  private async stream(
    response: Response,
    context: ExportContext,
    exportType: 'ISSUES' | 'PROJECTS',
    fileName: string,
    runPromise: Promise<CsvExportRun>,
  ): Promise<void> {
    const observation = observeResponse(response);
    let run: CsvExportRun;
    let itemCount = 0;

    try {
      run = await runPromise;
    } catch (error) {
      const disconnected = observation.current() !== null || response.destroyed;
      observation.dispose();
      if (!disconnected) throw error;

      this.logger.warn(
        { errorCode: 'EXPORT_INITIALIZATION_FAILED', workspaceId: context.workspaceId },
        'CSV 내보내기 시작 중 응답 연결 종료',
      );
      return;
    }

    if (observation.current() !== null) {
      await this.recordFailure(context, run.auditId, 'EXPORT_RESPONSE_CLOSED');
      observation.dispose();
      return;
    }

    try {
      response.status(HttpStatus.OK);
      response.setHeader('Content-Type', 'text/csv; charset=utf-8');
      response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      response.setHeader('Cache-Control', 'private, no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('X-Accel-Buffering', 'no');
      response.flushHeaders();

      await writeChunk(response, `\uFEFF${run.header}`);

      for await (const row of run.rows) {
        const outcome = observation.current();
        if (outcome !== null) throw new Error(`EXPORT_RESPONSE_${outcome}`);
        await writeChunk(response, row);
        itemCount += 1;
      }

      const outcomeBeforeCompletion = observation.current();
      if (outcomeBeforeCompletion !== null) {
        throw new Error(`EXPORT_RESPONSE_${outcomeBeforeCompletion}`);
      }

      await this.exportsService.markCompleted(context, run.auditId, itemCount);
      response.end();

      const outcome = await observation.promise;
      if (outcome === 'FINISHED') {
        try {
          await this.exportsService.markDownloaded(context, run.auditId);
          this.observability.capture({
            distinctId: context.membershipId,
            name: 'csv_exported',
            properties: { exportType, itemCount, workspaceId: context.workspaceId },
          });
        } catch {
          this.logger.error(
            {
              auditId: run.auditId,
              errorCode: 'EXPORT_AUDIT_UPDATE_FAILED',
              workspaceId: context.workspaceId,
            },
            'CSV 다운로드 완료 감사 갱신 실패',
          );
        }
        return;
      }

      await this.recordFailure(context, run.auditId, responseFailure(outcome, null));
    } catch (error) {
      const headersSent = response.headersSent;
      const failureCode = responseFailure(observation.current(), error);

      if (headersSent && !response.destroyed && !response.writableEnded) response.destroy();
      await this.recordFailure(
        context,
        run.auditId,
        failureCode,
        headersSent || response.destroyed,
      );
      observation.dispose();

      if (!headersSent && !response.destroyed) throw error;
    }
  }

  private async recordFailure(
    context: ExportContext,
    auditId: string,
    errorCode: ExportFailureCode,
    shouldLog = true,
  ): Promise<void> {
    try {
      await this.exportsService.markFailed(context, auditId, errorCode);
    } catch {
      this.logger.error(
        { auditId, errorCode: 'EXPORT_AUDIT_UPDATE_FAILED', workspaceId: context.workspaceId },
        'CSV 내보내기 감사 갱신 실패',
      );
      return;
    }

    if (!shouldLog) return;
    this.logger.warn(
      { auditId, errorCode, workspaceId: context.workspaceId },
      'CSV 내보내기 스트림 실패',
    );
  }
}
