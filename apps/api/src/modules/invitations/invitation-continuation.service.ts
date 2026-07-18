import { randomUUID, timingSafeEqual } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import { ObservabilityService } from '../../common/observability/observability.service';
import { productEvent } from '../../common/observability/product-event';
import { notifyResourceChanged } from '../../common/realtime/notify-resource-changed';
import { apiConfig } from '../../config/api.config';
import { AUTH_RATE_LIMITS, AuthRateLimitService } from '../auth/auth-rate-limit.service';
import {
  createOpaqueToken,
  getOneTimeTokenRateLimitKey,
  hashOpaqueToken,
  verifyOneTimeToken,
} from '../auth/auth-token.crypto';
import type {
  AcceptInvitationResponseDto,
  InvitationContinuationResponseDto,
  InvitationPreviewResponseDto,
} from './dto/invitation.dto';

type InvitationRow = {
  acceptedAt: Date | null;
  canceledAt: Date | null;
  createdAt: Date;
  email: string;
  expiresAt: Date;
  id: string;
  invitedByDisplayName: string;
  invitedByMembershipId: string;
};

type LockedInvitationRow = InvitationRow & {
  normalizedEmail: string;
  workspaceId: string;
};

type InvitationTokenRow = LockedInvitationRow & {
  invitationId: string;
  isTokenExpired: boolean;
  oneTimeTokenId: string;
  purpose: string;
  revokedAt: Date | null;
  tokenHash: Uint8Array;
  usedAt: Date | null;
  workspaceName: string;
  workspaceSlug: string;
};

type InvitationContinuationRow = InvitationTokenRow & {
  continuationConsumedAt: Date | null;
  continuationId: string;
  continuationRevokedAt: Date | null;
  continuationTokenHash: Uint8Array;
  continuationUserId: string | null;
};

type TokenOutcome = 'EXPIRED' | 'INVALID' | 'SUCCESS' | 'USED';

@Injectable()
export class InvitationContinuationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly rateLimits: AuthRateLimitService,
    private readonly observability: ObservabilityService,
    @Inject(apiConfig.KEY) private readonly config: ConfigType<typeof apiConfig>,
  ) {}

  async startContinuation(
    token: string,
    currentContinuationToken: string | null,
    clientIp: string,
  ): Promise<{
    continuationToken: string;
    expiresAt: Date;
    response: InvitationPreviewResponseDto;
  }> {
    await this.assertTokenLimits(token, clientIp);
    const parsed = verifyOneTimeToken(
      token,
      'WORKSPACE_INVITATION',
      this.config.security.oneTimeTokenHmacKey,
    );
    if (!parsed) {
      return this.rejectToken('INVALID', token, clientIp);
    }

    const invitation = await this.loadToken(parsed.tokenId);
    const outcome = this.tokenOutcome(invitation, parsed.tokenHash);
    if (outcome !== 'SUCCESS' || !invitation) {
      return this.rejectToken(outcome, token, clientIp);
    }

    const continuation = createOpaqueToken();
    await this.database.client.$transaction(async (transaction) => {
      if (currentContinuationToken) {
        await transaction.$executeRaw`
          UPDATE "workspace_invitation_continuations"
          SET "revoked_at" = COALESCE("revoked_at", NOW()),
              "updated_at" = NOW()
          WHERE "token_hash" = ${hashOpaqueToken(currentContinuationToken)}
            AND "consumed_at" IS NULL
            AND "revoked_at" IS NULL
        `;
      }
      await transaction.$executeRaw`
        INSERT INTO "workspace_invitation_continuations" (
          "id", "one_time_token_id", "token_hash", "updated_at"
        ) VALUES (
          ${randomUUID()}::uuid,
          ${parsed.tokenId}::uuid,
          ${continuation.tokenHash},
          NOW()
        )
      `;
    });

    return {
      continuationToken: continuation.token,
      expiresAt: invitation.expiresAt,
      response: this.toPreviewResponse(invitation),
    };
  }

  async getContinuation(
    continuationToken: string | null,
    userId: string | null,
  ): Promise<InvitationContinuationResponseDto> {
    const continuation = await this.loadContinuation(continuationToken, userId);
    if (!continuation) {
      this.throwContinuationNotFound();
    }

    const outcome = this.continuationOutcome(continuation);
    if (outcome !== 'SUCCESS') {
      return this.throwTokenOutcome(outcome);
    }

    return { ...this.toPreviewResponse(continuation), email: continuation.email };
  }

  async dismissContinuation(
    continuationToken: string | null,
    userId: string | null,
  ): Promise<void> {
    const continuationId = await this.findContinuationId(continuationToken, userId);
    if (!continuationId) {
      return;
    }

    await this.database.client.$executeRaw`
      UPDATE "workspace_invitation_continuations"
      SET "revoked_at" = COALESCE("revoked_at", NOW()),
          "updated_at" = NOW()
      WHERE "id" = ${continuationId}::uuid
        AND "consumed_at" IS NULL
    `;
  }

  async accept(
    userId: string,
    continuationToken: string | null,
  ): Promise<AcceptInvitationResponseDto> {
    const continuationId = await this.findContinuationId(continuationToken, userId);
    if (!continuationId) {
      this.throwContinuationNotFound();
    }

    const result = await this.database.client.$transaction(async (transaction) => {
      const [invitation] = await transaction.$queryRaw<
        Array<InvitationContinuationRow & { accountNormalizedEmail: string }>
      >`
        SELECT continuation."id" AS "continuationId",
               continuation."token_hash" AS "continuationTokenHash",
               continuation."user_id" AS "continuationUserId",
               continuation."consumed_at" AS "continuationConsumedAt",
               continuation."revoked_at" AS "continuationRevokedAt",
               token."id" AS "oneTimeTokenId",
               token."invitation_id" AS "invitationId",
               token."purpose",
               token."token_hash" AS "tokenHash",
               token."used_at" AS "usedAt",
               token."revoked_at" AS "revokedAt",
               token."expires_at" <= NOW() AS "isTokenExpired",
               invitation."id",
               invitation."workspace_id" AS "workspaceId",
               invitation."email",
               invitation."normalized_email" AS "normalizedEmail",
               invitation."expires_at" AS "expiresAt",
               invitation."accepted_at" AS "acceptedAt",
               invitation."canceled_at" AS "canceledAt",
               invitation."invited_by_membership_id" AS "invitedByMembershipId",
               invitation."created_at" AS "createdAt",
               inviter_user."display_name" AS "invitedByDisplayName",
               workspace."name" AS "workspaceName",
               workspace."slug" AS "workspaceSlug",
               account."normalized_email" AS "accountNormalizedEmail"
        FROM "workspace_invitation_continuations" AS continuation
        INNER JOIN "one_time_tokens" AS token
          ON token."id" = continuation."one_time_token_id"
        INNER JOIN "workspace_invitations" AS invitation
          ON invitation."id" = token."invitation_id"
        INNER JOIN "workspaces" AS workspace ON workspace."id" = invitation."workspace_id"
        INNER JOIN "workspace_memberships" AS inviter
          ON inviter."workspace_id" = invitation."workspace_id"
         AND inviter."id" = invitation."invited_by_membership_id"
        INNER JOIN "users" AS inviter_user ON inviter_user."id" = inviter."user_id"
        INNER JOIN "users" AS account ON account."id" = ${userId}::uuid
        WHERE continuation."id" = ${continuationId}::uuid
        FOR UPDATE OF continuation, token, invitation, account
      `;
      const outcome = this.continuationOutcome(invitation);
      if (outcome !== 'SUCCESS' || !invitation) {
        return { outcome, success: false as const };
      }

      if (invitation.accountNormalizedEmail !== invitation.normalizedEmail) {
        throw new ApiError({
          code: 'INVITATION_EMAIL_MISMATCH',
          message: '초대받은 이메일 계정으로 로그인해 주세요.',
          status: HttpStatus.CONFLICT,
        });
      }

      const [existingMembership] = await transaction.$queryRaw<
        Array<{ id: string; role: string; status: string; workspaceId: string }>
      >`
        SELECT "id",
               "workspace_id" AS "workspaceId",
               "role",
               "status"
        FROM "workspace_memberships"
        WHERE "user_id" = ${userId}::uuid
        LIMIT 1
        FOR UPDATE
      `;
      if (
        existingMembership &&
        (existingMembership.workspaceId !== invitation.workspaceId ||
          existingMembership.status !== 'ACTIVE' ||
          existingMembership.role !== 'MEMBER')
      ) {
        throw new ApiError({
          code: 'WORKSPACE_LIMIT_REACHED',
          message: '이미 참여 중인 워크스페이스가 있습니다.',
          status: HttpStatus.CONFLICT,
        });
      }

      const membershipId = existingMembership?.id ?? randomUUID();
      if (!existingMembership) {
        await transaction.$executeRaw`
          INSERT INTO "workspace_memberships" (
            "id",
            "workspace_id",
            "user_id",
            "role",
            "status",
            "invited_by_membership_id",
            "updated_at"
          ) VALUES (
            ${membershipId}::uuid,
            ${invitation.workspaceId}::uuid,
            ${userId}::uuid,
            'MEMBER'::"MembershipRole",
            'ACTIVE'::"MembershipStatus",
            ${invitation.invitedByMembershipId}::uuid,
            NOW()
          )
        `;
      }
      await transaction.$executeRaw`
        UPDATE "workspace_invitations"
        SET "accepted_at" = NOW(),
            "accepted_by_user_id" = ${userId}::uuid,
            "updated_at" = NOW()
        WHERE "id" = ${invitation.id}::uuid
      `;
      await transaction.$executeRaw`
        UPDATE "one_time_tokens"
        SET "used_at" = NOW()
        WHERE "id" = ${invitation.oneTimeTokenId}::uuid
      `;
      await transaction.$executeRaw`
        UPDATE "workspace_invitation_continuations"
        SET "consumed_at" = NOW(),
            "updated_at" = NOW()
        WHERE "id" = ${continuationId}::uuid
      `;
      await transaction.$executeRaw`
        UPDATE "outbox_events"
        SET "canceled_at" = NOW()
        WHERE "aggregate_type" = 'WORKSPACE_INVITATION'
          AND "aggregate_id" = ${invitation.id}::uuid
          AND "processed_at" IS NULL
          AND "canceled_at" IS NULL
      `;
      if (!existingMembership) {
        await notifyResourceChanged(transaction, {
          changeType: 'CREATED',
          resourceId: membershipId,
          resourceType: 'MEMBER',
          version: null,
          workspaceId: invitation.workspaceId,
        });
      }

      return {
        invitationId: invitation.id,
        membershipId,
        success: true as const,
        workspaceId: invitation.workspaceId,
        workspaceName: invitation.workspaceName,
        workspaceSlug: invitation.workspaceSlug,
      };
    });

    if (!result.success) {
      return this.throwTokenOutcome(result.outcome);
    }

    this.observability.capture(
      productEvent(
        { membershipId: result.membershipId, workspaceId: result.workspaceId },
        'invitation_accepted',
        { invitationId: result.invitationId },
        { eventId: result.invitationId },
      ),
    );

    return {
      accepted: true,
      membership: { id: result.membershipId, role: 'MEMBER', status: 'ACTIVE' },
      workspace: {
        id: result.workspaceId,
        name: result.workspaceName,
        slug: result.workspaceSlug,
      },
    };
  }

  private async loadToken(tokenId: string): Promise<InvitationTokenRow | undefined> {
    const [invitation] = await this.database.client.$queryRaw<InvitationTokenRow[]>`
      SELECT token."id" AS "oneTimeTokenId",
             token."invitation_id" AS "invitationId",
             token."purpose",
             token."token_hash" AS "tokenHash",
             token."used_at" AS "usedAt",
             token."revoked_at" AS "revokedAt",
             token."expires_at" <= NOW() AS "isTokenExpired",
             invitation."id",
             invitation."workspace_id" AS "workspaceId",
             invitation."email",
             invitation."normalized_email" AS "normalizedEmail",
             invitation."expires_at" AS "expiresAt",
             invitation."accepted_at" AS "acceptedAt",
             invitation."canceled_at" AS "canceledAt",
             invitation."invited_by_membership_id" AS "invitedByMembershipId",
             invitation."created_at" AS "createdAt",
             inviter_user."display_name" AS "invitedByDisplayName",
             workspace."name" AS "workspaceName",
             workspace."slug" AS "workspaceSlug"
      FROM "one_time_tokens" AS token
      INNER JOIN "workspace_invitations" AS invitation
        ON invitation."id" = token."invitation_id"
      INNER JOIN "workspaces" AS workspace ON workspace."id" = invitation."workspace_id"
      INNER JOIN "workspace_memberships" AS inviter
        ON inviter."workspace_id" = invitation."workspace_id"
       AND inviter."id" = invitation."invited_by_membership_id"
      INNER JOIN "users" AS inviter_user ON inviter_user."id" = inviter."user_id"
      WHERE token."id" = ${tokenId}::uuid
      LIMIT 1
    `;
    return invitation;
  }

  private async findContinuationId(
    continuationToken: string | null,
    userId: string | null,
  ): Promise<string | null> {
    if (continuationToken) {
      const [continuation] = await this.database.client.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "workspace_invitation_continuations"
        WHERE "token_hash" = ${hashOpaqueToken(continuationToken)}
        LIMIT 1
      `;
      if (continuation) {
        return continuation.id;
      }
    }

    const [continuation] = userId
      ? await this.database.client.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "workspace_invitation_continuations"
          WHERE "user_id" = ${userId}::uuid
            AND "consumed_at" IS NULL
            AND "revoked_at" IS NULL
          ORDER BY "created_at" DESC
          LIMIT 1
        `
      : [];

    return continuation?.id ?? null;
  }

  private async loadContinuation(
    continuationToken: string | null,
    userId: string | null,
  ): Promise<InvitationContinuationRow | undefined> {
    const continuationId = await this.findContinuationId(continuationToken, userId);
    if (!continuationId) {
      return undefined;
    }

    const [continuation] = await this.database.client.$queryRaw<InvitationContinuationRow[]>`
      SELECT continuation."id" AS "continuationId",
             continuation."token_hash" AS "continuationTokenHash",
             continuation."user_id" AS "continuationUserId",
             continuation."consumed_at" AS "continuationConsumedAt",
             continuation."revoked_at" AS "continuationRevokedAt",
             token."id" AS "oneTimeTokenId",
             token."invitation_id" AS "invitationId",
             token."purpose",
             token."token_hash" AS "tokenHash",
             token."used_at" AS "usedAt",
             token."revoked_at" AS "revokedAt",
             token."expires_at" <= NOW() AS "isTokenExpired",
             invitation."id",
             invitation."workspace_id" AS "workspaceId",
             invitation."email",
             invitation."normalized_email" AS "normalizedEmail",
             invitation."expires_at" AS "expiresAt",
             invitation."accepted_at" AS "acceptedAt",
             invitation."canceled_at" AS "canceledAt",
             invitation."invited_by_membership_id" AS "invitedByMembershipId",
             invitation."created_at" AS "createdAt",
             inviter_user."display_name" AS "invitedByDisplayName",
             workspace."name" AS "workspaceName",
             workspace."slug" AS "workspaceSlug"
      FROM "workspace_invitation_continuations" AS continuation
      INNER JOIN "one_time_tokens" AS token
        ON token."id" = continuation."one_time_token_id"
      INNER JOIN "workspace_invitations" AS invitation
        ON invitation."id" = token."invitation_id"
      INNER JOIN "workspaces" AS workspace ON workspace."id" = invitation."workspace_id"
      INNER JOIN "workspace_memberships" AS inviter
        ON inviter."workspace_id" = invitation."workspace_id"
       AND inviter."id" = invitation."invited_by_membership_id"
      INNER JOIN "users" AS inviter_user ON inviter_user."id" = inviter."user_id"
      WHERE continuation."id" = ${continuationId}::uuid
      LIMIT 1
    `;

    return continuation;
  }

  private tokenOutcome(
    invitation: InvitationTokenRow | undefined,
    expectedHash: Uint8Array,
  ): TokenOutcome {
    if (
      !invitation ||
      invitation.purpose !== 'WORKSPACE_INVITATION' ||
      invitation.invitationId !== invitation.id ||
      invitation.tokenHash.length !== expectedHash.length ||
      !timingSafeEqual(invitation.tokenHash, expectedHash)
    ) {
      return 'INVALID';
    }
    if (invitation.usedAt || invitation.acceptedAt) {
      return 'USED';
    }
    if (invitation.revokedAt || invitation.canceledAt) {
      return 'INVALID';
    }
    return invitation.isTokenExpired || invitation.expiresAt <= new Date() ? 'EXPIRED' : 'SUCCESS';
  }

  private continuationOutcome(invitation: InvitationContinuationRow | undefined): TokenOutcome {
    if (!invitation || invitation.continuationRevokedAt) {
      return 'INVALID';
    }
    if (invitation.continuationConsumedAt) {
      return 'USED';
    }

    return this.tokenOutcome(invitation, invitation.tokenHash);
  }

  private async assertTokenLimits(token: string, clientIp: string): Promise<void> {
    const key = getOneTimeTokenRateLimitKey(token);
    await Promise.all([
      this.rateLimits.assertNotBlocked(AUTH_RATE_LIMITS.tokenIp, clientIp),
      this.rateLimits.assertNotBlocked(AUTH_RATE_LIMITS.tokenValue, key),
    ]);
  }

  private async rejectToken(
    outcome: TokenOutcome,
    token: string,
    clientIp: string,
  ): Promise<never> {
    const key = getOneTimeTokenRateLimitKey(token);
    await Promise.all([
      this.rateLimits.consume(AUTH_RATE_LIMITS.tokenIp, clientIp),
      this.rateLimits.consume(AUTH_RATE_LIMITS.tokenValue, key),
    ]);

    return this.throwTokenOutcome(outcome);
  }

  private throwTokenOutcome(outcome: TokenOutcome): never {
    if (outcome === 'USED') {
      throw new ApiError({
        code: 'TOKEN_ALREADY_USED',
        message: '이미 사용한 초대 링크입니다.',
        status: HttpStatus.CONFLICT,
      });
    }
    if (outcome === 'EXPIRED') {
      throw new ApiError({
        code: 'TOKEN_EXPIRED',
        message: '초대 링크가 만료되었습니다.',
        status: HttpStatus.GONE,
      });
    }
    throw new ApiError({
      code: 'TOKEN_INVALID',
      message: '초대 링크를 확인할 수 없습니다.',
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });
  }

  private toPreviewResponse(invitation: InvitationTokenRow): InvitationPreviewResponseDto {
    return {
      emailMasked: this.maskEmail(invitation.email),
      expiresAt: invitation.expiresAt.toISOString(),
      invitedByDisplayName: invitation.invitedByDisplayName,
      workspaceName: invitation.workspaceName,
    };
  }

  private maskEmail(email: string): string {
    const separator = email.lastIndexOf('@');
    const localPart = email.slice(0, separator);
    return `${localPart.slice(0, Math.min(2, localPart.length))}***${email.slice(separator)}`;
  }

  private throwContinuationNotFound(): never {
    throw new ApiError({
      code: 'INVITATION_CONTINUATION_NOT_FOUND',
      message: '진행 중인 초대를 찾을 수 없습니다.',
      status: HttpStatus.NOT_FOUND,
    });
  }
}
