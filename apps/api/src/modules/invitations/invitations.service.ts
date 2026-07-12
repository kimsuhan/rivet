import { randomUUID, timingSafeEqual } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { isUUID } from 'class-validator';

import { Prisma } from '@rivet/database';
import {
  WORKSPACE_INVITATION_EMAIL_SCHEMA_VERSION,
  WORKSPACE_INVITATION_REQUESTED,
  type WorkspaceInvitationEmailOutboxPayload,
} from '@rivet/event-contracts';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import { notifyResourceChanged } from '../../common/realtime/notify-resource-changed';
import { apiConfig } from '../../config/api.config';
import { normalizeEmail } from '../auth/auth-input';
import { AUTH_RATE_LIMITS, AuthRateLimitService } from '../auth/auth-rate-limit.service';
import {
  createOneTimeToken,
  getOneTimeTokenRateLimitKey,
  verifyOneTimeToken,
} from '../auth/auth-token';
import type {
  AcceptInvitationResponseDto,
  CreateInvitationsResponseDto,
  InvitationListQueryDto,
  InvitationListResponseDto,
  InvitationPreviewResponseDto,
  InvitationResponseDto,
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
  purpose: string;
  revokedAt: Date | null;
  tokenHash: Uint8Array;
  usedAt: Date | null;
  workspaceName: string;
  workspaceSlug: string;
};

type TokenOutcome = 'EXPIRED' | 'INVALID' | 'SUCCESS' | 'USED';

function invalidQuery(message: string): never {
  throw new ApiError({ code: 'INVALID_QUERY', message, status: HttpStatus.BAD_REQUEST });
}

function parseCursor(value: string | undefined): { createdAt: Date; id: string } | null {
  if (value === undefined) {
    return null;
  }

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

function encodeCursor(row: Pick<InvitationRow, 'createdAt' | 'id'>): string {
  return Buffer.from(JSON.stringify([row.createdAt.toISOString(), row.id])).toString('base64url');
}

function parseStatuses(value: string | undefined): Set<InvitationResponseDto['status']> | null {
  if (value === undefined) {
    return null;
  }

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

@Injectable()
export class InvitationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly rateLimits: AuthRateLimitService,
    @Inject(apiConfig.KEY) private readonly config: ConfigType<typeof apiConfig>,
  ) {}

  async list(workspaceId: string, dto: InvitationListQueryDto): Promise<InvitationListResponseDto> {
    const cursor = parseCursor(dto.cursor);
    const statuses = parseStatuses(dto.status);
    const limit = dto.limit ?? 50;

    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      invalidQuery('조회 개수를 확인해 주세요.');
    }

    const invitations = await this.database.client.$queryRaw<InvitationRow[]>`
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
        AND (
          ${statuses === null}::boolean
          OR CASE
            WHEN invitation."accepted_at" IS NOT NULL
              THEN ${statuses?.has('ACCEPTED') ?? false}::boolean
            WHEN invitation."canceled_at" IS NOT NULL
              THEN ${statuses?.has('CANCELED') ?? false}::boolean
            WHEN invitation."expires_at" <= NOW()
              THEN ${statuses?.has('EXPIRED') ?? false}::boolean
            ELSE ${statuses?.has('PENDING') ?? false}::boolean
          END
        )
        AND (
          ${cursor?.createdAt ?? null}::timestamptz IS NULL
          OR invitation."created_at" < ${cursor?.createdAt ?? null}::timestamptz
          OR (
            invitation."created_at" = ${cursor?.createdAt ?? null}::timestamptz
            AND invitation."id" < ${cursor?.id ?? null}::uuid
          )
        )
      ORDER BY invitation."created_at" DESC, invitation."id" DESC
      LIMIT ${limit + 1}
    `;
    const page = invitations.slice(0, limit);

    return {
      items: page.map((invitation) => this.toResponse(invitation)),
      nextCursor:
        invitations.length > limit && page.length > 0 ? encodeCursor(page[page.length - 1]!) : null,
    };
  }

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

  async preview(token: string, clientIp: string): Promise<InvitationPreviewResponseDto> {
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

    return {
      emailMasked: this.maskEmail(invitation.email),
      expiresAt: invitation.expiresAt.toISOString(),
      invitedByDisplayName: invitation.invitedByDisplayName,
      workspaceName: invitation.workspaceName,
    };
  }

  async accept(
    userId: string,
    token: string,
    clientIp: string,
  ): Promise<AcceptInvitationResponseDto> {
    await this.assertTokenLimits(token, clientIp);
    const parsed = verifyOneTimeToken(
      token,
      'WORKSPACE_INVITATION',
      this.config.security.oneTimeTokenHmacKey,
    );
    if (!parsed) {
      return this.rejectToken('INVALID', token, clientIp);
    }

    const result = await this.database.client.$transaction(async (transaction) => {
      const [invitation] = await transaction.$queryRaw<
        Array<InvitationTokenRow & { accountNormalizedEmail: string }>
      >`
        SELECT token."invitation_id" AS "invitationId",
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
        FROM "one_time_tokens" AS token
        INNER JOIN "workspace_invitations" AS invitation
          ON invitation."id" = token."invitation_id"
        INNER JOIN "workspaces" AS workspace ON workspace."id" = invitation."workspace_id"
        INNER JOIN "workspace_memberships" AS inviter
          ON inviter."workspace_id" = invitation."workspace_id"
         AND inviter."id" = invitation."invited_by_membership_id"
        INNER JOIN "users" AS inviter_user ON inviter_user."id" = inviter."user_id"
        INNER JOIN "users" AS account ON account."id" = ${userId}::uuid
        WHERE token."id" = ${parsed.tokenId}::uuid
        FOR UPDATE OF token, invitation, account
      `;
      const outcome = this.tokenOutcome(invitation, parsed.tokenHash);
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
        WHERE "id" = ${parsed.tokenId}::uuid
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
        membershipId,
        success: true as const,
        workspaceId: invitation.workspaceId,
        workspaceName: invitation.workspaceName,
        workspaceSlug: invitation.workspaceSlug,
      };
    });

    if (!result.success) {
      return this.rejectToken(result.outcome, token, clientIp);
    }

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
    return this.toResponse(invitation);
  }

  private async loadToken(tokenId: string): Promise<InvitationTokenRow | undefined> {
    const [invitation] = await this.database.client.$queryRaw<InvitationTokenRow[]>`
      SELECT token."invitation_id" AS "invitationId",
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

  private toResponse(invitation: InvitationRow): InvitationResponseDto {
    return {
      acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
      canceledAt: invitation.canceledAt?.toISOString() ?? null,
      createdAt: invitation.createdAt.toISOString(),
      email: invitation.email,
      expiresAt: invitation.expiresAt.toISOString(),
      id: invitation.id,
      invitedByDisplayName: invitation.invitedByDisplayName,
      invitedByMembershipId: invitation.invitedByMembershipId,
      status: invitation.acceptedAt
        ? 'ACCEPTED'
        : invitation.canceledAt
          ? 'CANCELED'
          : invitation.expiresAt <= new Date()
            ? 'EXPIRED'
            : 'PENDING',
    };
  }

  private maskEmail(email: string): string {
    const separator = email.lastIndexOf('@');
    const localPart = email.slice(0, separator);
    return `${localPart.slice(0, Math.min(2, localPart.length))}***${email.slice(separator)}`;
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
