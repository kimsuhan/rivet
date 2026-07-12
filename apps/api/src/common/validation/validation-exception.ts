import { UnprocessableEntityException, type ValidationError } from '@nestjs/common';

function collectFieldErrors(
  errors: ValidationError[],
  fieldErrors: Record<string, string[]>,
  parentPath = '',
): void {
  for (const error of errors) {
    const fieldPath = parentPath ? `${parentPath}.${error.property}` : error.property;
    const messages = Object.values(error.constraints ?? {});

    if (messages.length > 0) {
      fieldErrors[fieldPath] = messages;
    }

    collectFieldErrors(error.children ?? [], fieldErrors, fieldPath);
  }
}

export function createValidationException(errors: ValidationError[]): UnprocessableEntityException {
  const fieldErrors: Record<string, string[]> = {};
  collectFieldErrors(errors, fieldErrors);

  return new UnprocessableEntityException({
    code: 'VALIDATION_ERROR',
    fieldErrors,
    message: '입력값을 확인해 주세요.',
  });
}
