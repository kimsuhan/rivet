import { HttpStatus } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { ApiError } from '../../common/errors/api-error';
import type { InvitationResponseDto } from './dto/invitation.dto';

export type InvitationCursor = { createdAt: Date; id: string };

function invalidQuery(message: string): never {
  throw new ApiError({ code: 'INVALID_QUERY', message, status: HttpStatus.BAD_REQUEST });
}

export function parseInvitationCursor(value: string | undefined): InvitationCursor | null {
  if (value === undefined) return null;

  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) {
      return invalidQuery('커서를 확인해 주세요.');
    }
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) {
      return invalidQuery('커서를 확인해 주세요.');
    }
    const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== 'string' ||
      typeof parsed[1] !== 'string' ||
      !isUUID(parsed[1], '4')
    ) {
      return invalidQuery('커서를 확인해 주세요.');
    }
    const createdAt = new Date(parsed[0]);
    if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== parsed[0]) {
      return invalidQuery('커서를 확인해 주세요.');
    }
    return { createdAt, id: parsed[1] };
  } catch {
    return invalidQuery('커서를 확인해 주세요.');
  }
}

export function encodeInvitationCursor(row: InvitationCursor): string {
  return Buffer.from(JSON.stringify([row.createdAt.toISOString(), row.id])).toString('base64url');
}

export function parseInvitationStatuses(
  value: string | undefined,
): Set<InvitationResponseDto['status']> | null {
  if (value === undefined) return null;

  const statuses = new Set<InvitationResponseDto['status']>();
  for (const candidate of value.split(',')) {
    const status = candidate.trim();
    if (
      status !== 'PENDING' &&
      status !== 'ACCEPTED' &&
      status !== 'CANCELED' &&
      status !== 'EXPIRED'
    ) {
      return invalidQuery('초대 상태를 확인해 주세요.');
    }
    statuses.add(status);
  }
  return statuses;
}

export function validateInvitationLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    invalidQuery('조회 개수를 확인해 주세요.');
  }
}
