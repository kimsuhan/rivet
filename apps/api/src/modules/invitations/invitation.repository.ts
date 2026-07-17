import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../../common/database/database.service';
import type { InvitationResponseDto } from './dto/invitation.dto';
import type { InvitationCursor } from './invitation-list.cursor';
import type { InvitationRow } from './invitation-response.mapper';

@Injectable()
export class InvitationRepository {
  constructor(private readonly database: DatabaseService) {}

  findPage(criteria: {
    cursor: InvitationCursor | null;
    limit: number;
    statuses: Set<InvitationResponseDto['status']> | null;
    workspaceId: string;
  }): Promise<InvitationRow[]> {
    return this.database.client.$queryRaw<InvitationRow[]>`
      SELECT invitation."id",
             invitation."email",
             invitation."expires_at" AS "expiresAt",
             invitation."accepted_at" AS "acceptedAt",
             invitation."canceled_at" AS "canceledAt",
             invitation."invited_by_membership_id" AS "invitedByMembershipId",
             inviter_user."display_name" AS "invitedByDisplayName",
             invitation."created_at" AS "createdAt"
      FROM "workspace_invitations" AS invitation
      INNER JOIN "workspace_memberships" AS inviter
        ON inviter."workspace_id" = invitation."workspace_id"
       AND inviter."id" = invitation."invited_by_membership_id"
      INNER JOIN "users" AS inviter_user ON inviter_user."id" = inviter."user_id"
      WHERE invitation."workspace_id" = ${criteria.workspaceId}::uuid
        AND (
          ${criteria.statuses === null}::boolean
          OR CASE
            WHEN invitation."accepted_at" IS NOT NULL
              THEN ${criteria.statuses?.has('ACCEPTED') ?? false}::boolean
            WHEN invitation."canceled_at" IS NOT NULL
              THEN ${criteria.statuses?.has('CANCELED') ?? false}::boolean
            WHEN invitation."expires_at" <= NOW()
              THEN ${criteria.statuses?.has('EXPIRED') ?? false}::boolean
            ELSE ${criteria.statuses?.has('PENDING') ?? false}::boolean
          END
        )
        AND (
          ${criteria.cursor?.createdAt ?? null}::timestamptz IS NULL
          OR invitation."created_at" < ${criteria.cursor?.createdAt ?? null}::timestamptz
          OR (
            invitation."created_at" = ${criteria.cursor?.createdAt ?? null}::timestamptz
            AND invitation."id" < ${criteria.cursor?.id ?? null}::uuid
          )
        )
      ORDER BY invitation."created_at" DESC, invitation."id" DESC
      LIMIT ${criteria.limit + 1}
    `;
  }
}
