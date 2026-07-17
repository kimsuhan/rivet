import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { Prisma, TokenPurpose } from '@rivet/database';
import { AUTH_EMAIL_VERIFICATION_REQUESTED } from '@rivet/event-contracts';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import { apiConfig } from '../../config/api.config';
import { throwAuthInputError } from './auth.errors';
import { AuthAccountTokenService } from './auth-account-token.service';
import {
  maskEmail,
  normalizeDisplayName,
  normalizeEmail,
  normalizePasswordForVerification,
  validatePassword,
} from './auth-input.policy';
import { AUTH_RATE_LIMITS, AuthRateLimitService } from './auth-rate-limit.service';
import { type AuthSessionContext, AuthSessionService } from './auth-session.service';
import { createCsrfToken, hashOpaqueToken } from './auth-token.crypto';
import type {
  AcceptedAuthRequestDto,
  AuthenticatedSessionDto,
  UnauthenticatedSessionDto,
} from './dto/auth-response.dto';
import type { LoginDto } from './dto/login.dto';
import type { SignUpDto } from './dto/sign-up.dto';
import { hashPassword, passwordHashNeedsRehash, verifyPassword } from './password.crypto';

const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$u5oksZN2qlFVAyszxdWrug$xmy/xfzl6zj7sfdlIBgb2F6zHrOnBcsxDzJEO7QyG0A';

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
    private readonly accountTokens: AuthAccountTokenService,
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
              await this.accountTokens.issueEmailVerification(transaction, existingUser.id);
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
            await this.accountTokens.issueEmailVerification(transaction, user.id);
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

    return { accepted: true, emailMasked: maskEmail(email), nextStep };
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
      user: {
        avatarFileId: session.user.avatarFileId,
        displayName: session.user.displayName,
        email: session.user.email,
        id: session.user.id,
      },
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
      return throwAuthInputError(error);
    }
  }

  private normalizePassword(password: string): string {
    try {
      return normalizePasswordForVerification(password);
    } catch (error) {
      return throwAuthInputError(error);
    }
  }

  private normalizeEmail(email: string): string {
    try {
      return normalizeEmail(email);
    } catch (error) {
      return throwAuthInputError(error);
    }
  }
}
