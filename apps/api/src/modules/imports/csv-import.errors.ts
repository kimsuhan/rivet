import { HttpStatus } from '@nestjs/common';

import { ApiError } from '../../common/errors/api-error';

export function csvImportError(
  code: string,
  message: string,
  status = HttpStatus.UNPROCESSABLE_ENTITY,
): never {
  throw new ApiError({ code, message, status });
}
