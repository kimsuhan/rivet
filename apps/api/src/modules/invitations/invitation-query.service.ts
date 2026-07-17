import { Injectable } from '@nestjs/common';

import type {
  InvitationListQueryDto,
  InvitationListResponseDto,
} from './dto/invitation.dto';
import { InvitationRepository } from './invitation.repository';
import {
  encodeInvitationCursor,
  parseInvitationCursor,
  parseInvitationStatuses,
  validateInvitationLimit,
} from './invitation-list.cursor';
import { toInvitationResponse } from './invitation-response.mapper';

@Injectable()
export class InvitationQueryService {
  constructor(private readonly invitations: InvitationRepository) {}

  async list(
    workspaceId: string,
    dto: InvitationListQueryDto,
  ): Promise<InvitationListResponseDto> {
    const cursor = parseInvitationCursor(dto.cursor);
    const statuses = parseInvitationStatuses(dto.status);
    const limit = dto.limit ?? 50;
    validateInvitationLimit(limit);

    const invitations = await this.invitations.findPage({ cursor, limit, statuses, workspaceId });
    const page = invitations.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(toInvitationResponse),
      nextCursor:
        invitations.length > limit && last
          ? encodeInvitationCursor({ createdAt: last.createdAt, id: last.id })
          : null,
    };
  }
}
