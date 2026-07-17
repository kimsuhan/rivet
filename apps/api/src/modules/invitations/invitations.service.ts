import { randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { Prisma } from '@rivet/database';
import {
  WORKSPACE_INVITATION_EMAIL_SCHEMA_VERSION,
  WORKSPACE_INVITATION_REQUESTED,
  type WorkspaceInvitationEmailOutboxPayload,
} from '@rivet/event-contracts';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import { apiConfig } from '../../config/api.config';
import { normalizeEmail } from '../auth/auth-input.policy';
import { AUTH_RATE_LIMITS, AuthRateLimitService } from '../auth/auth-rate-limit.service';
import { createOneTimeToken } from '../auth/auth-token.crypto';
import type {
  CreateInvitationsResponseDto,
  InvitationResponseDto,
} from './dto/invitation.dto';
import {
  type InvitationRow,
  toInvitationResponse,
} from './invitation-response.mapper';


type LockedInvitationRow = InvitationRow & {
  normalizedEmail: string;
  workspaceId: string;
};


@Injectable()
export class InvitationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly rateLimits: AuthRateLimitService,
    @Inject(apiConfig.KEY) private readonly config: ConfigType<typeof apiConfig>,
  ) {}


  async create(
    context: { membershipId: string; workspaceId: string },
    emails: string[],
  ): Promise<CreateInvitationsResponseDto> {
    const emailByNormalized = new Map<string, string>();
    for (const email of emails) {
      const trimmedEmail = email.trim();
      const normalizedEmail = normalizeEmail(trimmedEmail);
      if (!emailByNormalized.has(normalizedEmail)) {
        emailByNormalized.set(normalizedEmail, trimmedEmail);
      }
    }
    const normalizedEmails = [...emailByNormalized.keys()];
    const [existingMembers, pendingInvitations] = await Promise.all([
      this.database.client.workspaceMembership.findMany({
        select: { user: { select: { normalizedEmail: true } } },
        where: {
          user: { normalizedEmail: { in: normalizedEmails } },
          workspaceId: context.workspaceId,
        },
      }),
      this.database.client.workspaceInvitation.findMany({
        select: { normalizedEmail: true },
        where: {
          acceptedAt: null,
          canceledAt: null,
          expiresAt: { gt: new Date() },
          normalizedEmail: { in: normalizedEmails },
          workspaceId: context.workspaceId,
        },
      }),
    ]);
    const recipientsWithoutNewEmail = new Set([
      ...existingMembers.map(({ user }) => user.normalizedEmail),
      ...pendingInvitations.map(({ normalizedEmail }) => normalizedEmail),
    ]);
    const newEmailCount = normalizedEmails.filter(
      (email) => !recipientsWithoutNewEmail.has(email),
    ).length;
    if (newEmailCount > 0) {
      await this.rateLimits.consume(
        AUTH_RATE_LIMITS.workspaceInvitationEmail,
        context.workspaceId,
        newEmailCount,
      );
    }
    const currentMemberCount = await this.database.client.workspaceMembership.count({
      where: { status: 'ACTIVE', workspaceId: context.workspaceId },
    });
    const items: CreateInvitationsResponseDto['items'] = [];

    for (const [normalizedEmail, email] of emailByNormalized) {
      try {
        const result = await this.database.client.$transaction(async (transaction) => {
          // 수락 트랜잭션과 직렬화한 뒤 멤버십을 다시 확인해 새 pending 초대 생성을 막는다.
          const [pending] = await transaction.$queryRaw<Array<{ expiresAt: Date; id: string }>>`
            SELECT "id", "expires_at" AS "expiresAt"
            FROM "workspace_invitations"
            WHERE "workspace_id" = ${context.workspaceId}::uuid
              AND "normalized_email" = ${normalizedEmail}
              AND "accepted_at" IS NULL
              AND "canceled_at" IS NULL
            LIMIT 1
            FOR UPDATE
          `;

          const [member] = await transaction.$queryRaw<Array<{ id: string }>>`
            SELECT membership."id"
            FROM "users" AS account
            INNER JOIN "workspace_memberships" AS membership
              ON membership."user_id" = account."id"
             AND membership."workspace_id" = ${context.workspaceId}::uuid
            WHERE account."normalized_email" = ${normalizedEmail}
            LIMIT 1
          `;

          if (member) {
            return { email, invitationId: null, result: 'ALREADY_MEMBER' as const };
          }

          if (pending) {
            if (pending.expiresAt > new Date()) {
              return { email, invitationId: pending.id, result: 'ALREADY_INVITED' as const };
            }

            await transaction.$executeRaw`
              UPDATE "workspace_invitations"
              SET "email" = ${email},
                  "invited_by_membership_id" = ${context.membershipId}::uuid,
                  "expires_at" = NOW() + INTERVAL '7 days',
                  "updated_at" = NOW()
              WHERE "id" = ${pending.id}::uuid
            `;
            await this.issueEmail(transaction, {
              ...context,
              currentMemberCount,
              invitationId: pending.id,
            });
            return { email, invitationId: pending.id, result: 'INVITED' as const };
          }

          const invitationId = randomUUID();
          await transaction.$executeRaw`
            INSERT INTO "workspace_invitations" (
              "id",
              "workspace_id",
              "email",
              "normalized_email",
              "invited_by_membership_id",
              "expires_at",
              "updated_at"
            ) VALUES (
              ${invitationId}::uuid,
              ${context.workspaceId}::uuid,
              ${email},
              ${normalizedEmail},
              ${context.membershipId}::uuid,
              NOW() + INTERVAL '7 days',
              NOW()
            )
          `;
          await this.issueEmail(transaction, {
            ...context,
            currentMemberCount,
            invitationId,
          });

          return { email, invitationId, result: 'INVITED' as const };
        });
        items.push(result);
      } catch {
        const pending = await this.findPending(context.workspaceId, normalizedEmail);
        items.push(
          pending
            ? { email, invitationId: pending.id, result: 'ALREADY_INVITED' }
            : { email, invitationId: null, result: 'FAILED' },
        );
      }
    }

    return { items };
  }

  async resend(
    context: { membershipId: string; workspaceId: string },
    invitationId: string,
  ): Promise<InvitationResponseDto> {
    const invitationExists = await this.database.client.workspaceInvitation.findFirst({
      select: { acceptedAt: true, canceledAt: true, id: true, normalizedEmail: true },
      where: {
        id: invitationId,
        workspaceId: context.workspaceId,
      },
    });
    if (!invitationExists) {
      this.throwNotFound();
    }
    if (invitationExists.acceptedAt || invitationExists.canceledAt) {
      const pending = await this.findUnterminated(
        context.workspaceId,
        invitationExists.normalizedEmail,
      );
      if (pending && pending.id !== invitationId) {
        this.throwAlreadyPending();
      }
    }
    await this.rateLimits.consume(AUTH_RATE_LIMITS.workspaceInvitationEmail, context.workspaceId);
    const currentMemberCount = await this.database.client.workspaceMembership.count({
      where: { status: 'ACTIVE', workspaceId: context.workspaceId },
    });

    let effectiveInvitationId: string;
    try {
      effectiveInvitationId = await this.database.client.$transaction(async (transaction) => {
        const invitation = await this.lockInvitation(
          transaction,
          context.workspaceId,
          invitationId,
        );
        if (!invitation) {
          this.throwNotFound();
        }

        let targetInvitationId = invitation.id;
        if (invitation.acceptedAt || invitation.canceledAt) {
          const [pending] = await transaction.$queryRaw<Array<{ id: string }>>`
            SELECT "id"
            FROM "workspace_invitations"
            WHERE "workspace_id" = ${context.workspaceId}::uuid
              AND "normalized_email" = ${invitation.normalizedEmail}
              AND "id" <> ${invitation.id}::uuid
              AND "accepted_at" IS NULL
              AND "canceled_at" IS NULL
            LIMIT 1
            FOR UPDATE
          `;
          if (pending) {
            this.throwAlreadyPending();
          }

          targetInvitationId = randomUUID();
          await transaction.$executeRaw`
            INSERT INTO "workspace_invitations" (
              "id",
              "workspace_id",
              "email",
              "normalized_email",
              "invited_by_membership_id",
              "expires_at",
              "updated_at"
            ) VALUES (
              ${targetInvitationId}::uuid,
              ${context.workspaceId}::uuid,
              ${invitation.email},
              ${invitation.normalizedEmail},
              ${context.membershipId}::uuid,
              NOW() + INTERVAL '7 days',
              NOW()
            )
          `;
        } else {
          await transaction.$executeRaw`
            UPDATE "workspace_invitations"
            SET "invited_by_membership_id" = ${context.membershipId}::uuid,
                "expires_at" = NOW() + INTERVAL '7 days',
                "updated_at" = NOW()
            WHERE "id" = ${invitation.id}::uuid
          `;
        }

        await this.issueEmail(transaction, {
          ...context,
          currentMemberCount,
          invitationId: targetInvitationId,
        });
        return targetInvitationId;
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const pending = await this.findUnterminated(
        context.workspaceId,
        invitationExists.normalizedEmail,
      );
      if (pending && pending.id !== invitationId) {
        this.throwAlreadyPending();
      }
      throw error;
    }

    return this.getResponse(context.workspaceId, effectiveInvitationId);
  }

  async cancel(workspaceId: string, invitationId: string): Promise<InvitationResponseDto> {
    await this.database.client.$transaction(async (transaction) => {
      const invitation = await this.lockPendingInvitation(transaction, workspaceId, invitationId);
      if (!invitation) {
        this.throwNotFound();
      }

      await transaction.$executeRaw`
        UPDATE "workspace_invitations"
        SET "canceled_at" = NOW(),
            "updated_at" = NOW()
        WHERE "id" = ${invitationId}::uuid
      `;
      await this.revokeInvitationDelivery(transaction, invitationId);
    });

    return this.getResponse(workspaceId, invitationId);
  }

  private async issueEmail(
    transaction: Prisma.TransactionClient,
    input: {
      currentMemberCount: number;
      invitationId: string;
      membershipId: string;
      workspaceId: string;
    },
  ): Promise<void> {
    const token = createOneTimeToken(
      'WORKSPACE_INVITATION',
      this.config.security.oneTimeTokenHmacKey,
    );
    const eventId = randomUUID();
    const payload = {
      currentMemberCount: input.currentMemberCount,
      invitationId: input.invitationId,
      schemaVersion: WORKSPACE_INVITATION_EMAIL_SCHEMA_VERSION,
      tokenId: token.tokenId,
    } satisfies WorkspaceInvitationEmailOutboxPayload;

    await this.revokeInvitationDelivery(transaction, input.invitationId);
    await transaction.$executeRaw`
      INSERT INTO "one_time_tokens" (
        "id", "purpose", "invitation_id", "token_hash", "expires_at"
      ) VALUES (
        ${token.tokenId}::uuid,
        'WORKSPACE_INVITATION'::"TokenPurpose",
        ${input.invitationId}::uuid,
        ${token.tokenHash},
        NOW() + INTERVAL '7 days'
      )
    `;
    await transaction.$executeRaw`
      INSERT INTO "outbox_events" (
        "id",
        "workspace_id",
        "event_type",
        "aggregate_type",
        "aggregate_id",
        "actor_membership_id",
        "payload"
      ) VALUES (
        ${eventId}::uuid,
        ${input.workspaceId}::uuid,
        ${WORKSPACE_INVITATION_REQUESTED},
        'WORKSPACE_INVITATION',
        ${input.invitationId}::uuid,
        ${input.membershipId}::uuid,
        ${JSON.stringify(payload)}::jsonb
      )
    `;
  }

  private async revokeInvitationDelivery(
    transaction: Prisma.TransactionClient,
    invitationId: string,
  ): Promise<void> {
    await transaction.$executeRaw`
      UPDATE "one_time_tokens"
      SET "revoked_at" = NOW()
      WHERE "invitation_id" = ${invitationId}::uuid
        AND "purpose" = 'WORKSPACE_INVITATION'::"TokenPurpose"
        AND "used_at" IS NULL
        AND "revoked_at" IS NULL
    `;
    await transaction.$executeRaw`
      UPDATE "outbox_events"
      SET "canceled_at" = NOW()
      WHERE "aggregate_type" = 'WORKSPACE_INVITATION'
        AND "aggregate_id" = ${invitationId}::uuid
        AND "event_type" = ${WORKSPACE_INVITATION_REQUESTED}
        AND "processed_at" IS NULL
        AND "canceled_at" IS NULL
    `;
  }

  private async lockPendingInvitation(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    invitationId: string,
  ): Promise<LockedInvitationRow | undefined> {
    const [invitation] = await transaction.$queryRaw<LockedInvitationRow[]>`
      SELECT "id",
             "workspace_id" AS "workspaceId",
             "email",
             "normalized_email" AS "normalizedEmail",
             "expires_at" AS "expiresAt",
             "accepted_at" AS "acceptedAt",
             "canceled_at" AS "canceledAt",
             "invited_by_membership_id" AS "invitedByMembershipId",
             '' AS "invitedByDisplayName",
             "created_at" AS "createdAt"
      FROM "workspace_invitations"
      WHERE "workspace_id" = ${workspaceId}::uuid
        AND "id" = ${invitationId}::uuid
        AND "accepted_at" IS NULL
        AND "canceled_at" IS NULL
        AND "expires_at" > NOW()
      FOR UPDATE
    `;

    return invitation;
  }

  private async lockInvitation(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    invitationId: string,
  ): Promise<LockedInvitationRow | undefined> {
    const [invitation] = await transaction.$queryRaw<LockedInvitationRow[]>`
      SELECT "id",
             "workspace_id" AS "workspaceId",
             "email",
             "normalized_email" AS "normalizedEmail",
             "expires_at" AS "expiresAt",
             "accepted_at" AS "acceptedAt",
             "canceled_at" AS "canceledAt",
             "invited_by_membership_id" AS "invitedByMembershipId",
             '' AS "invitedByDisplayName",
             "created_at" AS "createdAt"
      FROM "workspace_invitations"
      WHERE "workspace_id" = ${workspaceId}::uuid
        AND "id" = ${invitationId}::uuid
      FOR UPDATE
    `;

    return invitation;
  }

  private async findPending(
    workspaceId: string,
    normalizedEmail: string,
  ): Promise<{ id: string } | undefined> {
    const [invitation] = await this.database.client.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "workspace_invitations"
      WHERE "workspace_id" = ${workspaceId}::uuid
        AND "normalized_email" = ${normalizedEmail}
        AND "accepted_at" IS NULL
        AND "canceled_at" IS NULL
        AND "expires_at" > NOW()
      LIMIT 1
    `;
    return invitation;
  }

  private async findUnterminated(
    workspaceId: string,
    normalizedEmail: string,
  ): Promise<{ id: string } | undefined> {
    const [invitation] = await this.database.client.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "workspace_invitations"
      WHERE "workspace_id" = ${workspaceId}::uuid
        AND "normalized_email" = ${normalizedEmail}
        AND "accepted_at" IS NULL
        AND "canceled_at" IS NULL
      LIMIT 1
    `;
    return invitation;
  }

  private async getResponse(
    workspaceId: string,
    invitationId: string,
  ): Promise<InvitationResponseDto> {
    const [invitation] = await this.database.client.$queryRaw<InvitationRow[]>`
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
      WHERE invitation."workspace_id" = ${workspaceId}::uuid
        AND invitation."id" = ${invitationId}::uuid
      LIMIT 1
    `;
    if (!invitation) {
      this.throwNotFound();
    }
    return toInvitationResponse(invitation);
  }


  private throwNotFound(): never {
    throw new ApiError({
      code: 'RESOURCE_NOT_FOUND',
      message: '초대를 찾을 수 없습니다.',
      status: HttpStatus.NOT_FOUND,
    });
  }

  private throwAlreadyPending(): never {
    throw new ApiError({
      code: 'INVITATION_ALREADY_PENDING',
      message: '같은 이메일의 처리 중인 초대가 이미 있습니다.',
      status: HttpStatus.CONFLICT,
    });
  }
}
