import { HttpStatus } from '@nestjs/common';

import { ApiError } from '../../common/errors/api-error';

export function invalidProjectQuery(message: string): never {
  throw new ApiError({ code: 'INVALID_QUERY', message, status: HttpStatus.BAD_REQUEST });
}

export function projectNotFound(message = '프로젝트를 찾을 수 없습니다.'): never {
  throw new ApiError({ code: 'RESOURCE_NOT_FOUND', message, status: HttpStatus.NOT_FOUND });
}

export function projectVersionConflict(currentVersion: number): never {
  throw new ApiError({
    code: 'VERSION_CONFLICT',
    currentVersion,
    message: '프로젝트가 다른 요청에서 변경되었습니다.',
    status: HttpStatus.CONFLICT,
  });
}

export function projectValidationError(field: string, message: string): never {
  throw new ApiError({
    code: 'VALIDATION_ERROR',
    fieldErrors: { [field]: [message] },
    message: '프로젝트 정보를 확인해 주세요.',
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  });
}
