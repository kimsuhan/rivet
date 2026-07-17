import { HttpStatus } from '@nestjs/common';

import { ApiError } from '../../common/errors/api-error';

export function fileResourceNotFound(message = '파일을 찾을 수 없습니다.'): never {
  throw new ApiError({ code: 'RESOURCE_NOT_FOUND', message, status: HttpStatus.NOT_FOUND });
}

export function fileError(code: string, message: string, status: number): never {
  throw new ApiError({ code, message, status });
}

export function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}
