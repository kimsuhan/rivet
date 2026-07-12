import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { EmailTemplateType, MembershipRole, MembershipStatus, TokenPurpose } from '@rivet/database';
import type { WorkspaceInvitationEmailOutboxPayload } from '@rivet/event-contracts';

import { DatabaseService } from '../../../common/database/database.service';
import { workerConfig } from '../../../config/worker.config';
import { createWorkspaceInvitationTemplate } from '../../email/account-email-templates';
import { EmailDeliveryService } from '../../email/email-delivery.service';
import { createWorkspaceInvitationLink } from '../../email/one-time-token-link';
import type { ClaimedOutboxEvent } from '../outbox.types';
import { CanceledOutboxError, PermanentOutboxError } from '../outbox-errors';

type WorkspaceInvitationEmailState = {
  acceptedAt: Date | null;
  canceledAt: Date | null;
  email: string;
  invitedByMembershipId: string;
  inviterDisplayName: string;
  inviterEmailVerifiedAt: Date | null;
  inviterRole: MembershipRole;
  inviterStatus: MembershipStatus;
  isInvitationExpired: boolean;
  isTokenActive: boolean;
  tokenPurpose: TokenPurpose;
  workspaceId: string;
  workspaceName: string;
};

@Injectable()
export class WorkspaceInvitationEmailHandler {
  constructor(
    private readonly database: DatabaseService,
    private readonly emailDelivery: EmailDeliveryService,
    @Inject(workerConfig.KEY) private readonly config: ConfigType<typeof workerConfig>,
  ) {}

  async handle(
    event: ClaimedOutboxEvent,
    payload: WorkspaceInvitationEmailOutboxPayload,
  ): Promise<void> {
    const state = await this.loadState(payload);

    if (!state) {
      throw new CanceledOutboxError('EMAIL_TOKEN_INACTIVE');
    }

    if (
      state.workspaceId !== event.workspaceId ||
      state.invitedByMembershipId !== event.actorMembershipId
    ) {
      throw new PermanentOutboxError('OUTBOX_EVENT_CONTRACT_INVALID');
    }

    if (!this.isEligible(state)) {
      throw new CanceledOutboxError('EMAIL_TOKEN_INACTIVE');
    }

    const link = createWorkspaceInvitationLink({
      hmacKey: this.config.email.oneTimeTokenHmacKey,
      tokenId: payload.tokenId,
      webOrigin: this.config.webOrigin,
    });
    const template = createWorkspaceInvitationTemplate({
      inviterDisplayName: state.inviterDisplayName,
      link,
      workspaceName: state.workspaceName,
    });

    await this.emailDelivery.deliver({
      ...template,
      outboxEventId: event.id,
      recipient: state.email,
      templateType: EmailTemplateType.WORKSPACE_INVITATION,
    });
  }

  private async loadState(
    payload: WorkspaceInvitationEmailOutboxPayload,
  ): Promise<WorkspaceInvitationEmailState | null> {
    const [state] = await this.database.client.$queryRaw<WorkspaceInvitationEmailState[]>`
      SELECT invitation."accepted_at" AS "acceptedAt",
             invitation."canceled_at" AS "canceledAt",
             invitation."email",
             invitation."invited_by_membership_id" AS "invitedByMembershipId",
             inviter_user."display_name" AS "inviterDisplayName",
             inviter_user."email_verified_at" AS "inviterEmailVerifiedAt",
             inviter."role" AS "inviterRole",
             inviter."status" AS "inviterStatus",
             invitation."expires_at" <= NOW() AS "isInvitationExpired",
             (token."used_at" IS NULL AND token."revoked_at" IS NULL AND token."expires_at" > NOW()) AS "isTokenActive",
             token."purpose" AS "tokenPurpose",
             workspace."id" AS "workspaceId",
             workspace."name" AS "workspaceName"
      FROM "one_time_tokens" AS token
      INNER JOIN "workspace_invitations" AS invitation
        ON invitation."id" = token."invitation_id"
      INNER JOIN "workspaces" AS workspace
        ON workspace."id" = invitation."workspace_id"
      INNER JOIN "workspace_memberships" AS inviter
        ON inviter."workspace_id" = invitation."workspace_id"
       AND inviter."id" = invitation."invited_by_membership_id"
      INNER JOIN "users" AS inviter_user
        ON inviter_user."id" = inviter."user_id"
      WHERE token."id" = ${payload.tokenId}::uuid
        AND invitation."id" = ${payload.invitationId}::uuid
      LIMIT 1
    `;

    return state ?? null;
  }

  private isEligible(state: WorkspaceInvitationEmailState): boolean {
    return (
      state.acceptedAt === null &&
      state.canceledAt === null &&
      !state.isInvitationExpired &&
      state.isTokenActive &&
      state.tokenPurpose === TokenPurpose.WORKSPACE_INVITATION &&
      state.inviterEmailVerifiedAt !== null &&
      state.inviterRole === MembershipRole.ADMIN &&
      state.inviterStatus === MembershipStatus.ACTIVE
    );
  }
}
