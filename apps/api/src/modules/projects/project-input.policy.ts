import { HttpStatus } from '@nestjs/common';

import { ApiError } from '../../common/errors/api-error';
import { projectValidationError } from './project.errors';

export function normalizeProjectName(value: string): string {
  const name = value.normalize('NFC').trim();
  if ([...name].length < 1 || [...name].length > 200) {
    return projectValidationError('name', '프로젝트 이름은 1~200자로 입력해 주세요.');
  }
  return name;
}

export function normalizeProjectDescription(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }

  const description = value.normalize('NFC').trim();
  if ([...description].length < 1 || [...description].length > 5000) {
    return projectValidationError('description', '프로젝트 설명은 1~5,000자로 입력해 주세요.');
  }
  return description;
}

export function parseProjectDate(
  value: string | null | undefined,
  field: 'startDate' | 'targetDate',
): Date | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return projectValidationError(field, '날짜는 YYYY-MM-DD 형식이어야 합니다.');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return projectValidationError(field, '유효한 날짜를 입력해 주세요.');
  }
  return date;
}

export function validateProjectDateOrder(startDate: Date | null, targetDate: Date | null): void {
  if (startDate && targetDate && targetDate < startDate) {
    throw new ApiError({
      code: 'PROJECT_DATE_INVALID',
      fieldErrors: { targetDate: ['목표일은 시작일보다 빠를 수 없습니다.'] },
      message: '프로젝트 일정을 확인해 주세요.',
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });
  }
}
