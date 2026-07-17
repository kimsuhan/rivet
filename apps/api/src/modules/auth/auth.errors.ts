import { HttpStatus } from '@nestjs/common';

import { ApiError } from '../../common/errors/api-error';
import { AuthInputValidationError } from './auth-input.policy';

export function throwAuthInputError(error: unknown): never {
  if (!(error instanceof AuthInputValidationError)) {
    throw error;
  }

  const messages = {
    DISPLAY_NAME_INVALID: '표시 이름을 확인해 주세요.',
    EMAIL_INVALID: '올바른 이메일 주소를 입력해 주세요.',
    PASSWORD_INVALID: '사용할 수 없는 문자가 비밀번호에 포함되어 있습니다.',
    PASSWORD_TOO_COMMON: '더 길고 예측하기 어려운 비밀번호를 사용해 주세요.',
    PASSWORD_TOO_LONG: '비밀번호는 128자 이하여야 합니다.',
    PASSWORD_TOO_SHORT: '비밀번호는 12자 이상이어야 합니다.',
  } as const;

  throw new ApiError({
    code: 'VALIDATION_ERROR',
    fieldErrors: { [error.field]: [messages[error.code]] },
    message: '입력값을 확인해 주세요.',
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  });
}
