import { HttpStatus } from '@nestjs/common';

import { ApiError } from '../../common/errors/api-error';

export function issueResourceNotFound(message = '이슈를 찾을 수 없습니다.'): never {
  throw new ApiError({ code: 'RESOURCE_NOT_FOUND', message, status: HttpStatus.NOT_FOUND });
}

export function issueConflict(code: string, message: string, currentVersion?: number): never {
  throw new ApiError({
    code,
    ...(currentVersion ? { currentVersion } : {}),
    message,
    status: HttpStatus.CONFLICT,
  });
}

export function issueUnprocessable(code: string, message: string): never {
  throw new ApiError({ code, message, status: HttpStatus.UNPROCESSABLE_ENTITY });
}
