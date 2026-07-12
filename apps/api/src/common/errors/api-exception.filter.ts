import { randomUUID } from 'node:crypto';

import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { ObservabilityService } from '../observability/observability.service';
import { ApiError } from './api-error';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function defaultError(status: number): { code: string; message: string } {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return { code: 'INVALID_REQUEST', message: '요청 형식을 확인해 주세요.' };
    case HttpStatus.UNAUTHORIZED:
      return { code: 'SESSION_REQUIRED', message: '로그인이 필요합니다.' };
    case HttpStatus.FORBIDDEN:
      return { code: 'FORBIDDEN', message: '이 작업을 수행할 권한이 없습니다.' };
    case HttpStatus.NOT_FOUND:
      return { code: 'RESOURCE_NOT_FOUND', message: '요청한 리소스를 찾을 수 없습니다.' };
    case HttpStatus.CONFLICT:
      return { code: 'CONFLICT', message: '현재 상태에서는 요청을 완료할 수 없습니다.' };
    case HttpStatus.GONE:
      return { code: 'RESOURCE_EXPIRED', message: '더 이상 사용할 수 없는 리소스입니다.' };
    case HttpStatus.PAYLOAD_TOO_LARGE:
    case HttpStatus.UNSUPPORTED_MEDIA_TYPE:
      return { code: 'INVALID_REQUEST', message: '요청 형식을 확인해 주세요.' };
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return { code: 'VALIDATION_ERROR', message: '입력값을 확인해 주세요.' };
    case HttpStatus.TOO_MANY_REQUESTS:
      return { code: 'RATE_LIMITED', message: '요청이 너무 많습니다.' };
    case HttpStatus.SERVICE_UNAVAILABLE:
      return { code: 'SERVICE_UNAVAILABLE', message: '서비스를 일시적으로 사용할 수 없습니다.' };
    default:
      return {
        code: 'INTERNAL_SERVER_ERROR',
        message: '요청을 처리하지 못했습니다. 다시 시도해 주세요.',
      };
  }
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  constructor(private readonly observability: ObservabilityService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request & { id?: string }>();
    const response = context.getResponse<Response>();
    const requestId = request.id ?? `req_${randomUUID()}`;
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse = exception instanceof HttpException ? exception.getResponse() : null;
    const fallback =
      status === HttpStatus.PAYLOAD_TOO_LARGE &&
      request.method === 'POST' &&
      request.path === '/api/v1/files'
        ? { code: 'FILE_TOO_LARGE', message: '파일은 25MB 이하여야 합니다.' }
        : defaultError(status);
    const payload = isRecord(exceptionResponse) ? exceptionResponse : {};
    const hasApiCode = typeof payload.code === 'string';
    const code = hasApiCode ? payload.code : fallback.code;
    const message =
      hasApiCode && typeof payload.message === 'string' ? payload.message : fallback.message;
    const fieldErrors = hasApiCode && isRecord(payload.fieldErrors) ? payload.fieldErrors : {};
    const body: Record<string, unknown> = { code, fieldErrors, message, requestId };

    if (Number.isInteger(payload.currentVersion)) {
      body.currentVersion = payload.currentVersion;
    }

    if (isRecord(payload.details)) {
      body.details = payload.details;
    }

    if (exception instanceof ApiError && exception.retryAfterSeconds !== undefined) {
      response.setHeader('Retry-After', String(exception.retryAfterSeconds));
    }

    if (!(exception instanceof HttpException)) {
      this.observability.captureException(exception, requestId);
      this.logger.error(
        {
          errorCode: 'INTERNAL_SERVER_ERROR',
          method: request.method,
          path: request.path,
          requestId,
        },
        '예상하지 못한 요청 오류',
      );
    }

    response.setHeader('X-Request-ID', requestId);
    response.status(status).json(body);
  }
}
