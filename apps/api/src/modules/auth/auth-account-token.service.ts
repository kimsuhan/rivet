import { randomUUID, timingSafeEqual } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { Prisma, TokenPurpose } from '@rivet/database';
import {
  ACCOUNT_EMAIL_SCHEMA_VERSION,
  type AccountEmailEventType,
  type AccountEmailOutboxPayload,
  AUTH_EMAIL_VERIFICATION_REQUESTED,
  AUTH_PASSWORD_RESET_REQUESTED,
} from '@rivet/event-contracts';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import { apiConfig } from '../../config/api.config';
import { throwAuthInputError } from './auth.errors';
import { maskEmail, normalizeEmail, validatePassword } from './auth-input.policy';
import { AUTH_RATE_LIMITS, AuthRateLimitService } from './auth-rate-limit.service';
import {
  createOneTimeToken,
  getOneTimeTokenRateLimitKey,
  verifyOneTimeToken,
} from './auth-token.crypto';
import type {
  AcceptedAuthRequestDto,
  ResetPasswordDto,
  VerifiedEmailDto,
} from './dto/auth-response.dto';
import type { EmailDto } from './dto/email.dto';
import type { ConfirmPasswordResetDto, TokenDto } from './dto/token.dto';
import { hashPassword } from './password.crypto';

type TokenUseOutcome = 'EXPIRED' | 'INVALID' | 'SUCCESS' | 'USED';

type LockedPasswordResetToken = {
  isExpired: boolean;
  normalizedEmail: string;
  purpose: TokenPurpose;
  revokedAt: Date | null;
  tokenHash: Uint8Array;
  usedAt: Date | null;
  userId: string;
};

@Injectable()
export class AuthAccountTokenService {
  constructor(
    private readonly database: DatabaseService,
    private readonly rateLimits: AuthRateLimitService,
    @Inject(apiConfig.KEY) private readonly config: ConfigType<typeof apiConfig>,
  ) {}

  issueEmailVerification(transaction: Prisma.TransactionClient, userId: string): Promise<void> {
    return this.issueAccountEmail(
      transaction,
      userId,
      TokenPurpose.EMAIL_VERIFICATION,
      AUTH_EMAIL_VERIFICATION_REQUESTED,
      24 * 60 * 60,
    );
  }

  async verifyEmail(dto: TokenDto, clientIp: string): Promise<VerifiedEmailDto> {
    await this.assertTokenLimits(dto.token, clientIp);
    const parsed = verifyOneTimeToken(
      dto.token,
      'EMAIL_VERIFICATION',
      this.config.security.oneTimeTokenHmacKey,
    );

    if (!parsed) {
      return this.rejectToken('INVALID', dto.token, clientIp);
    }

    const outcome = await this.database.client.$transaction(async (transaction) => {
      const [token] = await transaction.$queryRaw<
        Array<{
          isExpired: boolean;
          purpose: TokenPurpose;
          revokedAt: Date | null;
          tokenHash: Uint8Array;
          usedAt: Date | null;
          userId: string;
        }>
      >`
        SELECT token."token_hash" AS "tokenHash",
               token."purpose",
               token."user_id" AS "userId",
               token."used_at" AS "usedAt",
               token."revoked_at" AS "revokedAt",
               token."expires_at" <= NOW() AS "isExpired"
        FROM "one_time_tokens" AS token
        INNER JOIN "users" AS account ON account."id" = token."user_id"
        WHERE token."id" = ${parsed.tokenId}::uuid
        FOR UPDATE OF token, account
      `;

      const status = this.tokenStatus(token, parsed.tokenHash, TokenPurpose.EMAIL_VERIFICATION);
      if (status !== 'SUCCESS' || !token) {
        return status;
      }

      await transaction.$executeRaw`
        UPDATE "one_time_tokens"
        SET "used_at" = NOW()
        WHERE "id" = ${parsed.tokenId}::uuid
      `;
      await transaction.$executeRaw`
        UPDATE "users"
        SET "email_verified_at" = COALESCE("email_verified_at", NOW()),
            "updated_at" = NOW()
        WHERE "id" = ${token.userId}::uuid
      `;
      await this.revokeOtherTokensAndOutbox(
        transaction,
        token.userId,
        parsed.tokenId,
        TokenPurpose.EMAIL_VERIFICATION,
        AUTH_EMAIL_VERIFICATION_REQUESTED,
      );
      return 'SUCCESS' as const;
    });

    if (outcome !== 'SUCCESS') {
      return this.rejectToken(outcome, dto.token, clientIp);
    }

    return { verified: true };
  }

  async resendEmailVerification(dto: EmailDto, clientIp: string): Promise<AcceptedAuthRequestDto> {
    const email = dto.email.trim();
    const normalizedEmail = this.normalizeEmail(dto.email);

    await Promise.all([
      this.rateLimits.consume(AUTH_RATE_LIMITS.emailVerificationIp, clientIp),
      this.rateLimits.consume(AUTH_RATE_LIMITS.emailVerificationEmail, normalizedEmail),
    ]);
    await this.database.client.$transaction(async (transaction) => {
      const [user] = await transaction.$queryRaw<
        Array<{ emailVerifiedAt: Date | null; id: string }>
      >`
        SELECT "id", "email_verified_at" AS "emailVerifiedAt"
        FROM "users"
        WHERE "normalized_email" = ${normalizedEmail}
        FOR UPDATE
      `;

      if (user && !user.emailVerifiedAt) {
        await this.issueAccountEmail(
          transaction,
          user.id,
          TokenPurpose.EMAIL_VERIFICATION,
          AUTH_EMAIL_VERIFICATION_REQUESTED,
          24 * 60 * 60,
        );
      }
    });

    return {
      accepted: true,
      emailMasked: maskEmail(email),
      nextStep: 'VERIFY_EMAIL',
    };
  }

  async requestPasswordReset(dto: EmailDto, clientIp: string): Promise<void> {
    const email = this.normalizeEmail(dto.email);

    await Promise.all([
      this.rateLimits.consume(AUTH_RATE_LIMITS.passwordResetIp, clientIp),
      this.rateLimits.consume(AUTH_RATE_LIMITS.passwordResetEmail, email),
    ]);
    await this.database.client.$transaction(async (transaction) => {
      const [user] = await transaction.$queryRaw<
        Array<{ emailVerifiedAt: Date | null; id: string }>
      >`
        SELECT "id", "email_verified_at" AS "emailVerifiedAt"
        FROM "users"
        WHERE "normalized_email" = ${email}
        FOR UPDATE
      `;

      if (user?.emailVerifiedAt) {
        await this.issueAccountEmail(
          transaction,
          user.id,
          TokenPurpose.PASSWORD_RESET,
          AUTH_PASSWORD_RESET_REQUESTED,
          30 * 60,
        );
      }
    });
  }

  async confirmPasswordReset(
    dto: ConfirmPasswordResetDto,
    clientIp: string,
  ): Promise<ResetPasswordDto> {
    await this.assertTokenLimits(dto.token, clientIp);
    const parsed = verifyOneTimeToken(
      dto.token,
      'PASSWORD_RESET',
      this.config.security.oneTimeTokenHmacKey,
    );

    if (!parsed) {
      return this.rejectToken('INVALID', dto.token, clientIp);
    }

    const preflight = await this.database.client.$transaction((transaction) =>
      this.lockPasswordResetToken(transaction, parsed.tokenId, parsed.tokenHash),
    );
    if (preflight.status !== 'SUCCESS') {
      return this.rejectToken(preflight.status, dto.token, clientIp);
    }
    if (!preflight.token) {
      return this.rejectToken('INVALID', dto.token, clientIp);
    }

    const password = this.validatePassword(dto.password, preflight.token.normalizedEmail);
    const passwordHash = await hashPassword(password);
    const outcome = await this.database.client.$transaction(async (transaction) => {
      const { status, token: lockedToken } = await this.lockPasswordResetToken(
        transaction,
        parsed.tokenId,
        parsed.tokenHash,
      );

      if (status !== 'SUCCESS' || !lockedToken) {
        return status;
      }

      await transaction.$executeRaw`
        UPDATE "users"
        SET "password_hash" = ${passwordHash},
            "updated_at" = NOW()
        WHERE "id" = ${lockedToken.userId}::uuid
      `;
      await transaction.$executeRaw`
        UPDATE "one_time_tokens"
        SET "used_at" = NOW()
        WHERE "id" = ${parsed.tokenId}::uuid
      `;
      await transaction.$executeRaw`
        UPDATE "sessions"
        SET "revoked_at" = NOW()
        WHERE "user_id" = ${lockedToken.userId}::uuid
          AND "revoked_at" IS NULL
      `;
      await this.revokeOtherTokensAndOutbox(
        transaction,
        lockedToken.userId,
        parsed.tokenId,
        TokenPurpose.PASSWORD_RESET,
        AUTH_PASSWORD_RESET_REQUESTED,
      );
      return 'SUCCESS' as const;
    });

    if (outcome !== 'SUCCESS') {
      return this.rejectToken(outcome, dto.token, clientIp);
    }

    return { reset: true };
  }

  private async lockPasswordResetToken(
    transaction: Prisma.TransactionClient,
    tokenId: string,
    tokenHash: Uint8Array,
  ): Promise<{ status: TokenUseOutcome; token: LockedPasswordResetToken | undefined }> {
    const [token] = await transaction.$queryRaw<Array<LockedPasswordResetToken>>`
      SELECT token."token_hash" AS "tokenHash",
             token."purpose",
             token."user_id" AS "userId",
             token."used_at" AS "usedAt",
             token."revoked_at" AS "revokedAt",
             token."expires_at" <= NOW() AS "isExpired",
             account."normalized_email" AS "normalizedEmail"
      FROM "one_time_tokens" AS token
      INNER JOIN "users" AS account ON account."id" = token."user_id"
      WHERE token."id" = ${tokenId}::uuid
      FOR UPDATE OF token, account
    `;

    return {
      status: this.tokenStatus(token, tokenHash, TokenPurpose.PASSWORD_RESET),
      token,
    };
  }

  private async issueAccountEmail(
    transaction: Prisma.TransactionClient,
    userId: string,
    purpose: TokenPurpose,
    eventType: AccountEmailEventType,
    lifetimeSeconds: number,
  ): Promise<void> {
    const token = createOneTimeToken(purpose, this.config.security.oneTimeTokenHmacKey);
    const outboxEventId = randomUUID();
    const payload = {
      schemaVersion: ACCOUNT_EMAIL_SCHEMA_VERSION,
      tokenId: token.tokenId,
      userId,
    } satisfies AccountEmailOutboxPayload;

    await transaction.$executeRaw`
      UPDATE "one_time_tokens"
      SET "revoked_at" = NOW()
      WHERE "user_id" = ${userId}::uuid
        AND "purpose" = ${purpose}::"TokenPurpose"
        AND "used_at" IS NULL
        AND "revoked_at" IS NULL
    `;
    await transaction.$executeRaw`
      UPDATE "outbox_events"
      SET "canceled_at" = NOW()
      WHERE "aggregate_type" = 'USER'
        AND "aggregate_id" = ${userId}::uuid
        AND "event_type" = ${eventType}
        AND "processed_at" IS NULL
        AND "canceled_at" IS NULL
    `;
    await transaction.$executeRaw`
      INSERT INTO "one_time_tokens" (
        "id", "purpose", "user_id", "token_hash", "expires_at"
      ) VALUES (
        ${token.tokenId}::uuid,
        ${purpose}::"TokenPurpose",
        ${userId}::uuid,
        ${token.tokenHash},
        NOW() + ${lifetimeSeconds} * INTERVAL '1 second'
      )
    `;
    await transaction.$executeRaw`
      INSERT INTO "outbox_events" (
        "id", "event_type", "aggregate_type", "aggregate_id", "payload"
      ) VALUES (
        ${outboxEventId}::uuid,
        ${eventType},
        'USER',
        ${userId}::uuid,
        ${JSON.stringify(payload)}::jsonb
      )
    `;
  }

  private async revokeOtherTokensAndOutbox(
    transaction: Prisma.TransactionClient,
    userId: string,
    usedTokenId: string,
    purpose: TokenPurpose,
    eventType: AccountEmailEventType,
  ): Promise<void> {
    await transaction.$executeRaw`
      UPDATE "one_time_tokens"
      SET "revoked_at" = NOW()
      WHERE "user_id" = ${userId}::uuid
        AND "purpose" = ${purpose}::"TokenPurpose"
        AND "id" <> ${usedTokenId}::uuid
        AND "used_at" IS NULL
        AND "revoked_at" IS NULL
    `;
    await transaction.$executeRaw`
      UPDATE "outbox_events"
      SET "canceled_at" = NOW()
      WHERE "aggregate_type" = 'USER'
        AND "aggregate_id" = ${userId}::uuid
        AND "event_type" = ${eventType}
        AND "processed_at" IS NULL
        AND "canceled_at" IS NULL
    `;
  }

  private normalizeEmail(email: string): string {
    try {
      return normalizeEmail(email);
    } catch (error) {
      return throwAuthInputError(error);
    }
  }

  private validatePassword(password: string, email: string): string {
    try {
      return validatePassword(password, email);
    } catch (error) {
      return throwAuthInputError(error);
    }
  }

  private async assertTokenLimits(token: string, clientIp: string): Promise<void> {
    const tokenRateLimitKey = getOneTimeTokenRateLimitKey(token);

    await Promise.all([
      this.rateLimits.assertNotBlocked(AUTH_RATE_LIMITS.tokenIp, clientIp),
      this.rateLimits.assertNotBlocked(AUTH_RATE_LIMITS.tokenValue, tokenRateLimitKey),
    ]);
  }

  private async rejectToken(
    outcome: Exclude<TokenUseOutcome, 'SUCCESS'>,
    token: string,
    clientIp: string,
  ): Promise<never> {
    const tokenRateLimitKey = getOneTimeTokenRateLimitKey(token);

    await Promise.all([
      this.rateLimits.consume(AUTH_RATE_LIMITS.tokenIp, clientIp),
      this.rateLimits.consume(AUTH_RATE_LIMITS.tokenValue, tokenRateLimitKey),
    ]);

    if (outcome === 'EXPIRED') {
      throw new ApiError({
        code: 'TOKEN_EXPIRED',
        message: '인증 링크가 만료되었습니다.',
        status: HttpStatus.GONE,
      });
    }

    if (outcome === 'USED') {
      throw new ApiError({
        code: 'TOKEN_ALREADY_USED',
        message: '이미 사용한 인증 링크입니다.',
        status: HttpStatus.CONFLICT,
      });
    }

    throw new ApiError({
      code: 'TOKEN_INVALID',
      message: '인증 링크를 확인할 수 없습니다.',
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });
  }

  private tokenStatus(
    token:
      | {
          isExpired: boolean;
          purpose: TokenPurpose;
          revokedAt: Date | null;
          tokenHash: Uint8Array;
          usedAt: Date | null;
        }
      | undefined,
    expectedHash: Uint8Array,
    purpose: TokenPurpose,
  ): TokenUseOutcome {
    if (
      !token ||
      token.purpose !== purpose ||
      !this.tokenHashMatches(token.tokenHash, expectedHash)
    ) {
      return 'INVALID';
    }
    if (token.usedAt) {
      return 'USED';
    }
    if (token.revokedAt) {
      return 'INVALID';
    }
    return token.isExpired ? 'EXPIRED' : 'SUCCESS';
  }

  private tokenHashMatches(storedHash: Uint8Array, expectedHash: Uint8Array): boolean {
    return storedHash.length === expectedHash.length && timingSafeEqual(storedHash, expectedHash);
  }
}
