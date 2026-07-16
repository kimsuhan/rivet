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
import {
  AuthInputValidationError,
  normalizeDisplayName,
  normalizeEmail,
  normalizePasswordForVerification,
  validatePassword,
} from './auth-input';
import { AUTH_RATE_LIMITS, AuthRateLimitService } from './auth-rate-limit.service';
import { type AuthSessionContext, AuthSessionService } from './auth-session.service';
import {
  createCsrfToken,
  createOneTimeToken,
  getOneTimeTokenRateLimitKey,
  hashOpaqueToken,
  verifyOneTimeToken,
} from './auth-token';
import type {
  AcceptedAuthRequestDto,
  AuthenticatedSessionDto,
  ResetPasswordDto,
  SessionUserDto,
  UnauthenticatedSessionDto,
  VerifiedEmailDto,
} from './dto/auth-response.dto';
import type { EmailDto } from './dto/email.dto';
import type { LoginDto } from './dto/login.dto';
import type { SignUpDto } from './dto/sign-up.dto';
import type { ConfirmPasswordResetDto, TokenDto } from './dto/token.dto';
import { hashPassword, passwordHashNeedsRehash, verifyPassword } from './password';

const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$u5oksZN2qlFVAyszxdWrug$xmy/xfzl6zj7sfdlIBgb2F6zHrOnBcsxDzJEO7QyG0A';

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

function isNormalizedEmailConflict(error: Prisma.PrismaClientKnownRequestError): boolean {
  const target = error.meta?.target;
  const targets = typeof target === 'string' ? [target] : Array.isArray(target) ? target : [];

  return targets.some(
    (value) =>
      typeof value === 'string' &&
      (value === 'normalized_email' ||
        value === 'normalizedEmail' ||
        value.includes('users_normalized_email_key')),
  );
}

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly rateLimits: AuthRateLimitService,
    private readonly sessions: AuthSessionService,
    @Inject(apiConfig.KEY) private readonly config: ConfigType<typeof apiConfig>,
  ) {}

  async signUp(
    dto: SignUpDto,
    clientIp: string,
    invitationContinuationToken: string | null = null,
  ): Promise<AcceptedAuthRequestDto> {
    const { displayName, email, normalizedEmail, password } = this.normalizeSignUp(dto);

    await Promise.all([
      this.rateLimits.consume(AUTH_RATE_LIMITS.signUpIp, clientIp),
      this.rateLimits.consume(AUTH_RATE_LIMITS.signUpEmail, normalizedEmail),
    ]);

    // 기존 계정 경로도 신규 계정과 같은 고비용 연산을 거쳐 존재 여부의 시간 차이를 줄인다.
    const passwordHash = await hashPassword(password);

    let nextStep: AcceptedAuthRequestDto['nextStep'];

    try {
      const invitationVerifiedEmail = await this.database.client.$transaction(
        async (transaction) => {
          const [existingUser] = await transaction.$queryRaw<
            Array<{ emailVerifiedAt: Date | null; id: string }>
          >`
            SELECT "id", "email_verified_at" AS "emailVerifiedAt"
            FROM "users"
            WHERE "normalized_email" = ${normalizedEmail}
            FOR UPDATE
          `;

          if (existingUser) {
            const hasInvitationProof = await this.bindInvitationContinuation(
              transaction,
              existingUser.id,
              normalizedEmail,
              invitationContinuationToken,
              true,
            );
            if (hasInvitationProof && !existingUser.emailVerifiedAt) {
              await this.verifyEmailFromInvitation(transaction, existingUser.id);
            } else if (!existingUser.emailVerifiedAt) {
              await this.issueAccountEmail(
                transaction,
                existingUser.id,
                TokenPurpose.EMAIL_VERIFICATION,
                AUTH_EMAIL_VERIFICATION_REQUESTED,
                24 * 60 * 60,
              );
            }
            return hasInvitationProof;
          }

          const user = await transaction.user.create({
            data: {
              displayName,
              email,
              normalizedEmail,
              passwordHash,
            },
            select: { id: true },
          });
          const hasInvitationProof = await this.bindInvitationContinuation(
            transaction,
            user.id,
            normalizedEmail,
            invitationContinuationToken,
            true,
          );
          if (hasInvitationProof) {
            await this.verifyEmailFromInvitation(transaction, user.id);
          } else {
            await this.issueAccountEmail(
              transaction,
              user.id,
              TokenPurpose.EMAIL_VERIFICATION,
              AUTH_EMAIL_VERIFICATION_REQUESTED,
              24 * 60 * 60,
            );
          }
          return hasInvitationProof;
        },
      );
      nextStep = invitationVerifiedEmail ? 'LOGIN' : 'VERIFY_EMAIL';
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002' ||
        !isNormalizedEmailConflict(error)
      ) {
        throw error;
      }

      const user = await this.database.client.user.findUnique({
        select: { id: true },
        where: { normalizedEmail },
      });
      if (!user) {
        throw error;
      }
      const invitationVerifiedEmail = await this.database.client.$transaction(
        async (transaction) => {
          const hasInvitationProof = await this.bindInvitationContinuation(
            transaction,
            user.id,
            normalizedEmail,
            invitationContinuationToken,
            true,
          );
          if (hasInvitationProof) {
            await this.verifyEmailFromInvitation(transaction, user.id);
          }
          return hasInvitationProof;
        },
      );
      nextStep = invitationVerifiedEmail ? 'LOGIN' : 'VERIFY_EMAIL';
    }

    return { accepted: true, emailMasked: this.maskEmail(email), nextStep };
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
      emailMasked: this.maskEmail(email),
      nextStep: 'VERIFY_EMAIL',
    };
  }

  async login(
    dto: LoginDto,
    clientIp: string,
    invitationContinuationToken: string | null = null,
  ): Promise<{
    absoluteExpiresAt: Date;
    response: AuthenticatedSessionDto;
    token: string;
  }> {
    const email = this.normalizeEmail(dto.email);
    const password = this.normalizePassword(dto.password);

    await Promise.all([
      this.rateLimits.assertNotBlocked(AUTH_RATE_LIMITS.loginIp, clientIp),
      this.rateLimits.assertNotBlocked(AUTH_RATE_LIMITS.loginEmail, email),
    ]);

    const user = await this.database.client.user.findUnique({
      select: {
        emailVerifiedAt: true,
        id: true,
        membership: { select: { status: true } },
        passwordHash: true,
      },
      where: { normalizedEmail: email },
    });
    const isValid = await verifyPassword(user?.passwordHash ?? DUMMY_PASSWORD_HASH, password);

    if (!user || !isValid) {
      await Promise.all([
        this.rateLimits.consume(AUTH_RATE_LIMITS.loginIp, clientIp),
        this.rateLimits.consume(AUTH_RATE_LIMITS.loginEmail, email),
      ]);
      throw new ApiError({
        code: 'INVALID_CREDENTIALS',
        message: '이메일 또는 비밀번호가 올바르지 않습니다.',
        status: HttpStatus.UNAUTHORIZED,
      });
    }

    if (!user.emailVerifiedAt) {
      throw new ApiError({
        code: 'EMAIL_NOT_VERIFIED',
        message: '이메일 인증이 필요합니다.',
        status: HttpStatus.FORBIDDEN,
      });
    }

    if (user.membership?.status === 'INACTIVE') {
      throw new ApiError({
        code: 'MEMBERSHIP_INACTIVE',
        message: '비활성화된 멤버십입니다. 워크스페이스 관리자에게 문의해 주세요.',
        status: HttpStatus.FORBIDDEN,
      });
    }

    if (invitationContinuationToken) {
      await this.database.client.$transaction(async (transaction) => {
        await transaction.$queryRaw`
          SELECT "id"
          FROM "users"
          WHERE "id" = ${user.id}::uuid
          FOR UPDATE
        `;
        await this.bindInvitationContinuation(
          transaction,
          user.id,
          email,
          invitationContinuationToken,
          false,
        );
      });
    }

    if (passwordHashNeedsRehash(user.passwordHash)) {
      const passwordHash = await hashPassword(password);
      await this.database.client.user.updateMany({
        data: { passwordHash },
        where: { id: user.id, passwordHash: user.passwordHash },
      });
    }

    await this.rateLimits.clear(AUTH_RATE_LIMITS.loginEmail, email);
    const session = await this.sessions.create(user.id);

    return {
      absoluteExpiresAt: session.absoluteExpiresAt,
      response: await this.toAuthenticatedSession(
        session.context,
        session.token,
        invitationContinuationToken,
      ),
      token: session.token,
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId);
  }

  async getSession(
    sessionToken: string | null,
    invitationContinuationToken: string | null = null,
  ): Promise<AuthenticatedSessionDto | UnauthenticatedSessionDto> {
    if (!sessionToken) {
      return { authenticated: false };
    }

    const session = await this.sessions.resolve(sessionToken);
    if (!session || !session.user.emailVerifiedAt || session.membership?.status === 'INACTIVE') {
      return { authenticated: false };
    }

    return this.toAuthenticatedSession(session, sessionToken, invitationContinuationToken);
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

  getMe(session: AuthSessionContext): SessionUserDto {
    return {
      avatarFileId: session.user.avatarFileId,
      displayName: session.user.displayName,
      email: session.user.email,
      id: session.user.id,
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

  private async verifyEmailFromInvitation(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    await transaction.$executeRaw`
      UPDATE "users"
      SET "email_verified_at" = COALESCE("email_verified_at", NOW()),
          "updated_at" = NOW()
      WHERE "id" = ${userId}::uuid
    `;
    await transaction.$executeRaw`
      UPDATE "one_time_tokens"
      SET "revoked_at" = NOW()
      WHERE "user_id" = ${userId}::uuid
        AND "purpose" = ${TokenPurpose.EMAIL_VERIFICATION}::"TokenPurpose"
        AND "used_at" IS NULL
        AND "revoked_at" IS NULL
    `;
    await transaction.$executeRaw`
      UPDATE "outbox_events"
      SET "canceled_at" = NOW()
      WHERE "aggregate_type" = 'USER'
        AND "aggregate_id" = ${userId}::uuid
        AND "event_type" = ${AUTH_EMAIL_VERIFICATION_REQUESTED}
        AND "processed_at" IS NULL
        AND "canceled_at" IS NULL
    `;
  }

  private async toAuthenticatedSession(
    session: AuthSessionContext,
    sessionToken: string,
    invitationContinuationToken: string | null = null,
  ): Promise<AuthenticatedSessionDto> {
    const hasInvitation = await this.hasInvitationContinuation(
      session.user.id,
      invitationContinuationToken,
    );
    const hasTeam =
      !hasInvitation && session.workspace
        ? Boolean(
            await this.database.client.team.findFirst({
              select: { id: true },
              where: { archivedAt: null, workspaceId: session.workspace.id },
            }),
          )
        : false;

    return {
      authenticated: true,
      csrfToken: createCsrfToken(sessionToken, this.config.security.csrfHmacKey),
      membership: session.membership
        ? {
            id: session.membership.id,
            role: session.membership.role,
            status: 'ACTIVE',
          }
        : null,
      onboardingStep: hasInvitation
        ? 'ACCEPT_INVITATION'
        : !session.workspace
          ? 'CREATE_WORKSPACE'
          : hasTeam
            ? 'COMPLETE'
            : 'CREATE_TEAM',
      user: this.getMe(session),
      workspace: session.workspace,
    };
  }

  private async bindInvitationContinuation(
    transaction: Prisma.TransactionClient,
    userId: string,
    normalizedEmail: string,
    continuationToken: string | null,
    rejectEmailMismatch: boolean,
  ): Promise<boolean> {
    if (!continuationToken) {
      return false;
    }

    const [continuation] = await transaction.$queryRaw<
      Array<{ id: string; invitationEmail: string; userId: string | null }>
    >`
      SELECT continuation."id",
             continuation."user_id" AS "userId",
             invitation."normalized_email" AS "invitationEmail"
      FROM "workspace_invitation_continuations" AS continuation
      INNER JOIN "one_time_tokens" AS token
        ON token."id" = continuation."one_time_token_id"
      INNER JOIN "workspace_invitations" AS invitation
        ON invitation."id" = token."invitation_id"
      WHERE continuation."token_hash" = ${hashOpaqueToken(continuationToken)}
        AND continuation."consumed_at" IS NULL
        AND continuation."revoked_at" IS NULL
        AND token."purpose" = 'WORKSPACE_INVITATION'::"TokenPurpose"
        AND token."used_at" IS NULL
        AND token."revoked_at" IS NULL
        AND token."expires_at" > NOW()
        AND invitation."accepted_at" IS NULL
        AND invitation."canceled_at" IS NULL
        AND invitation."expires_at" > NOW()
      LIMIT 1
      FOR UPDATE OF continuation, token, invitation
    `;
    if (!continuation) {
      return false;
    }
    if (continuation.invitationEmail !== normalizedEmail || continuation.userId !== null) {
      if (continuation.userId === userId && continuation.invitationEmail === normalizedEmail) {
        return true;
      }
      if (rejectEmailMismatch) {
        throw new ApiError({
          code: 'INVITATION_EMAIL_MISMATCH',
          fieldErrors: { email: ['초대받은 이메일 주소로 가입해 주세요.'] },
          message: '초대받은 이메일 주소로 가입해 주세요.',
          status: HttpStatus.CONFLICT,
        });
      }
      return false;
    }

    await transaction.$executeRaw`
      UPDATE "workspace_invitation_continuations"
      SET "revoked_at" = NOW(),
          "updated_at" = NOW()
      WHERE "user_id" = ${userId}::uuid
        AND "id" <> ${continuation.id}::uuid
        AND "consumed_at" IS NULL
        AND "revoked_at" IS NULL
    `;
    await transaction.$executeRaw`
      UPDATE "workspace_invitation_continuations"
      SET "user_id" = ${userId}::uuid,
          "updated_at" = NOW()
      WHERE "id" = ${continuation.id}::uuid
        AND "user_id" IS NULL
        AND "consumed_at" IS NULL
        AND "revoked_at" IS NULL
    `;
    return true;
  }

  private async hasInvitationContinuation(
    userId: string,
    continuationToken: string | null,
  ): Promise<boolean> {
    const [continuation] = await this.database.client.$queryRaw<Array<{ id: string }>>`
      SELECT continuation."id"
      FROM "workspace_invitation_continuations" AS continuation
      INNER JOIN "one_time_tokens" AS token
        ON token."id" = continuation."one_time_token_id"
      INNER JOIN "workspace_invitations" AS invitation
        ON invitation."id" = token."invitation_id"
      WHERE (
          continuation."user_id" = ${userId}::uuid
          OR (
            ${continuationToken !== null}::boolean
            AND continuation."token_hash" = ${continuationToken ? hashOpaqueToken(continuationToken) : Buffer.alloc(0)}
            AND continuation."user_id" IS NULL
          )
        )
        AND continuation."consumed_at" IS NULL
        AND continuation."revoked_at" IS NULL
        AND token."purpose" = 'WORKSPACE_INVITATION'::"TokenPurpose"
        AND token."used_at" IS NULL
        AND token."revoked_at" IS NULL
        AND token."expires_at" > NOW()
        AND invitation."accepted_at" IS NULL
        AND invitation."canceled_at" IS NULL
        AND invitation."expires_at" > NOW()
      LIMIT 1
    `;

    return Boolean(continuation);
  }

  private normalizeSignUp(dto: SignUpDto): {
    displayName: string;
    email: string;
    normalizedEmail: string;
    password: string;
  } {
    try {
      const email = dto.email.trim();
      const normalizedEmail = normalizeEmail(dto.email);
      return {
        displayName: normalizeDisplayName(dto.displayName),
        email,
        normalizedEmail,
        password: validatePassword(dto.password, normalizedEmail),
      };
    } catch (error) {
      return this.throwInputError(error);
    }
  }

  private normalizeEmail(email: string): string {
    try {
      return normalizeEmail(email);
    } catch (error) {
      return this.throwInputError(error);
    }
  }

  private normalizePassword(password: string): string {
    try {
      return normalizePasswordForVerification(password);
    } catch (error) {
      return this.throwInputError(error);
    }
  }

  private validatePassword(password: string, email: string): string {
    try {
      return validatePassword(password, email);
    } catch (error) {
      return this.throwInputError(error);
    }
  }

  private throwInputError(error: unknown): never {
    if (!(error instanceof AuthInputValidationError)) {
      throw error;
    }

    const messages = {
      DISPLAY_NAME_INVALID: '표시 이름을 확인해 주세요.',
      EMAIL_INVALID: '올바른 이메일 주소를 입력해 주세요.',
      PASSWORD_INVALID: '사용할 수 없는 문자가 비밀번호에 포함되어 있습니다.',
      PASSWORD_TOO_COMMON: '더 길고 예측하기 어려운 비밀번호를 사용해 주세요.',
      PASSWORD_TOO_LONG: '비밀번호는 128자 이하여야 합니다.',
      PASSWORD_TOO_SHORT: '비밀번호는 12자 이상이어야 합니다.',
    } as const;

    throw new ApiError({
      code: 'VALIDATION_ERROR',
      fieldErrors: { [error.field]: [messages[error.code]] },
      message: '입력값을 확인해 주세요.',
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });
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

  private maskEmail(email: string): string {
    const separator = email.lastIndexOf('@');
    const localPart = email.slice(0, separator);
    return `${localPart.slice(0, Math.min(2, localPart.length))}***${email.slice(separator)}`;
  }
}
