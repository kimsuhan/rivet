import { HttpStatus } from '@nestjs/common';

import { ApiError } from '../../common/errors/api-error';

export function teamResourceNotFound(message: string): ApiError {
  return new ApiError({ code: 'RESOURCE_NOT_FOUND', message, status: HttpStatus.NOT_FOUND });
}

export function teamVersionConflict(currentVersion: number): ApiError {
  return new ApiError({
    code: 'VERSION_CONFLICT',
    currentVersion,
    message: '리소스가 다른 요청에서 변경되었습니다.',
    status: HttpStatus.CONFLICT,
  });
}

export function teamOpenIssueConflict(
  code: 'TEAM_HAS_OPEN_ISSUES' | 'TEAM_MEMBER_HAS_OPEN_ASSIGNMENTS',
  message: string,
  issues: Array<{ id: string; identifier: string; title: string }>,
): ApiError {
  return new ApiError({ code, details: { issues }, message, status: HttpStatus.CONFLICT });
}
