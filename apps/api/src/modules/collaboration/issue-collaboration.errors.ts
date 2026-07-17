import { HttpStatus } from '@nestjs/common';

import { ApiError } from '../../common/errors/api-error';

export function collaborationResourceNotFound(message = '리소스를 찾을 수 없습니다.'): never {
  throw new ApiError({ code: 'RESOURCE_NOT_FOUND', message, status: HttpStatus.NOT_FOUND });
}

export function collaborationConflict(
  code: string,
  message: string,
  options: { currentVersion?: number; details?: Record<string, unknown> } = {},
): never {
  throw new ApiError({ code, message, status: HttpStatus.CONFLICT, ...options });
}

export function collaborationUnprocessable(code: string, message: string): never {
  throw new ApiError({ code, message, status: HttpStatus.UNPROCESSABLE_ENTITY });
}

export function collaborationInvalidQuery(message: string): never {
  throw new ApiError({ code: 'INVALID_QUERY', message, status: HttpStatus.BAD_REQUEST });
}
