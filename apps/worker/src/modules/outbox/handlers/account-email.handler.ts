import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { EmailTemplateType, MembershipStatus, TokenPurpose } from '@rivet/database';
import {
  type AccountEmailEventType,
  type AccountEmailOutboxPayload,
  AUTH_EMAIL_VERIFICATION_REQUESTED,
} from '@rivet/event-contracts';

import { DatabaseService } from '../../../common/database/database.service';
import { workerConfig } from '../../../config/worker.config';
import {
  createEmailVerificationTemplate,
  createPasswordResetTemplate,
} from '../../email/account-email-templates';
import { EmailDeliveryService } from '../../email/email-delivery.service';
import {
  createEmailVerificationLink,
  createPasswordResetLink,
} from '../../email/one-time-token-link';
import type { ClaimedOutboxEvent } from '../outbox.types';
import { CanceledOutboxError } from '../outbox-errors';

type AccountEmailState = {
  email: string;
  emailVerifiedAt: Date | null;
  isTokenActive: boolean;
  membershipStatus: MembershipStatus | null;
  tokenPurpose: TokenPurpose;
};

@Injectable()
export class AccountEmailHandler {
  constructor(
    private readonly database: DatabaseService,
    private readonly emailDelivery: EmailDeliveryService,
    @Inject(workerConfig.KEY) private readonly config: ConfigType<typeof workerConfig>,
  ) {}

  async handle(
    event: ClaimedOutboxEvent,
    eventType: AccountEmailEventType,
    payload: AccountEmailOutboxPayload,
  ): Promise<void> {
    const state = await this.loadState(payload);

    if (!state || !this.isEligible(state, eventType)) {
      throw new CanceledOutboxError('EMAIL_TOKEN_INACTIVE');
    }

    const isVerification = eventType === AUTH_EMAIL_VERIFICATION_REQUESTED;
    const templateType = isVerification
      ? EmailTemplateType.EMAIL_VERIFICATION
      : EmailTemplateType.PASSWORD_RESET;
    const linkInput = {
      hmacKey: this.config.email.oneTimeTokenHmacKey,
      tokenId: payload.tokenId,
      webOrigin: this.config.webOrigin,
    };
    const template = isVerification
      ? createEmailVerificationTemplate(createEmailVerificationLink(linkInput))
      : createPasswordResetTemplate(createPasswordResetLink(linkInput));

    await this.emailDelivery.deliver({
      ...template,
      outboxEventId: event.id,
      recipient: state.email,
      templateType,
    });
  }

  private async loadState(payload: AccountEmailOutboxPayload): Promise<AccountEmailState | null> {
    const [state] = await this.database.client.$queryRaw<AccountEmailState[]>`
      SELECT "user"."email",
             "user"."email_verified_at" AS "emailVerifiedAt",
             (token."used_at" IS NULL AND token."revoked_at" IS NULL AND token."expires_at" > NOW()) AS "isTokenActive",
             membership."status" AS "membershipStatus",
             token."purpose" AS "tokenPurpose"
      FROM "one_time_tokens" AS token
      INNER JOIN "users" AS "user" ON "user"."id" = token."user_id"
      LEFT JOIN "workspace_memberships" AS membership ON membership."user_id" = "user"."id"
      WHERE token."id" = ${payload.tokenId}::uuid
        AND token."user_id" = ${payload.userId}::uuid
      LIMIT 1
    `;

    return state ?? null;
  }

  private isEligible(state: AccountEmailState, eventType: AccountEmailEventType): boolean {
    if (!state.isTokenActive || state.membershipStatus === MembershipStatus.INACTIVE) {
      return false;
    }

    if (eventType === AUTH_EMAIL_VERIFICATION_REQUESTED) {
      return (
        state.tokenPurpose === TokenPurpose.EMAIL_VERIFICATION && state.emailVerifiedAt === null
      );
    }

    return state.tokenPurpose === TokenPurpose.PASSWORD_RESET && state.emailVerifiedAt !== null;
  }
}
