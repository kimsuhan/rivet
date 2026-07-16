import { createHmac } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import { apiConfig } from '../../config/api.config';

export type AuthRateLimitRule = {
  limit: number;
  scope: string;
  windowSeconds: number;
};

export const AUTH_RATE_LIMITS = {
  emailVerificationEmail: { limit: 3, scope: 'EMAIL_VERIFICATION_EMAIL', windowSeconds: 3_600 },
  emailVerificationIp: { limit: 10, scope: 'EMAIL_VERIFICATION_IP', windowSeconds: 3_600 },
  loginEmail: { limit: 5, scope: 'LOGIN_EMAIL', windowSeconds: 900 },
  loginIp: { limit: 60, scope: 'LOGIN_IP', windowSeconds: 900 },
  passwordResetEmail: { limit: 3, scope: 'PASSWORD_RESET_EMAIL', windowSeconds: 3_600 },
  passwordResetIp: { limit: 10, scope: 'PASSWORD_RESET_IP', windowSeconds: 3_600 },
  signUpEmail: { limit: 3, scope: 'SIGN_UP_EMAIL', windowSeconds: 86_400 },
  signUpIp: { limit: 10, scope: 'SIGN_UP_IP', windowSeconds: 3_600 },
  tokenIp: { limit: 30, scope: 'TOKEN_IP', windowSeconds: 900 },
  tokenValue: { limit: 5, scope: 'TOKEN_VALUE', windowSeconds: 900 },
  webPushTestMembership: { limit: 10, scope: 'WEB_PUSH_TEST_MEMBERSHIP', windowSeconds: 600 },
  webPushTestSubscription: { limit: 3, scope: 'WEB_PUSH_TEST_SUBSCRIPTION', windowSeconds: 300 },
  workspaceInvitationEmail: {
    limit: 100,
    scope: 'WORKSPACE_INVITATION_EMAIL',
    windowSeconds: 86_400,
  },
} as const satisfies Record<string, AuthRateLimitRule>;

@Injectable()
export class AuthRateLimitService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(apiConfig.KEY) private readonly config: ConfigType<typeof apiConfig>,
  ) {}

  async assertNotBlocked(rule: AuthRateLimitRule, key: string): Promise<void> {
    const keyHash = this.hashKey(rule.scope, key);
    const rows = await this.database.client.$queryRaw<Array<{ retryAfterSeconds: number }>>`
      SELECT GREATEST(
               1,
               CEIL(EXTRACT(EPOCH FROM ("blocked_until" - NOW())))::integer
             ) AS "retryAfterSeconds"
      FROM "auth_rate_limit_buckets"
      WHERE "scope" = ${rule.scope}
        AND "key_hash" = ${keyHash}
        AND "blocked_until" > NOW()
      ORDER BY "blocked_until" DESC
      LIMIT 1
    `;

    if (rows[0]) {
      this.throwRateLimited(rows[0].retryAfterSeconds);
    }
  }

  async consume(rule: AuthRateLimitRule, key: string, amount = 1): Promise<void> {
    if (!Number.isSafeInteger(amount) || amount < 1) {
      throw new RangeError('속도 제한 소비량은 1 이상의 정수여야 합니다.');
    }

    const keyHash = this.hashKey(rule.scope, key);
    const rows = await this.database.client.$queryRaw<
      Array<{ attemptCount: number; retryAfterSeconds: number | null }>
    >`
      WITH clock AS (
        SELECT NOW() AS "now"
      ), bucket_window AS (
        SELECT "now",
               date_bin(
                 ${rule.windowSeconds} * INTERVAL '1 second',
                 "now",
                 TIMESTAMPTZ '2000-01-01 00:00:00+00'
               ) AS "window_started_at"
        FROM clock
      ), consumed AS (
        INSERT INTO "auth_rate_limit_buckets" AS bucket (
          "id",
          "scope",
          "key_hash",
          "window_started_at",
          "attempt_count",
          "blocked_until",
          "expires_at",
          "updated_at"
        )
        SELECT gen_random_uuid(),
               ${rule.scope},
               ${keyHash},
               "window_started_at",
               ${amount},
               NULL,
               "window_started_at" + ${rule.windowSeconds * 2} * INTERVAL '1 second',
               "now"
        FROM bucket_window
        WHERE TRUE
        ON CONFLICT ("scope", "key_hash", "window_started_at")
        DO UPDATE SET
          "attempt_count" = bucket."attempt_count" + ${amount},
          "blocked_until" = CASE
            WHEN bucket."attempt_count" + ${amount} > ${rule.limit}
              THEN bucket."window_started_at" + ${rule.windowSeconds} * INTERVAL '1 second'
            ELSE bucket."blocked_until"
          END,
          "expires_at" = bucket."window_started_at" +
                         ${rule.windowSeconds * 2} * INTERVAL '1 second',
          "updated_at" = (SELECT "now" FROM clock)
        RETURNING "attempt_count", "blocked_until"
      )
      SELECT "attempt_count" AS "attemptCount",
             CASE
               WHEN "blocked_until" IS NULL THEN NULL
               ELSE GREATEST(
                 1,
                 CEIL(EXTRACT(EPOCH FROM ("blocked_until" - (SELECT "now" FROM clock))))::integer
               )
             END AS "retryAfterSeconds"
      FROM consumed
    `;
    const result = rows[0];

    if (!result) {
      throw new Error('인증 속도 제한 결과를 확인할 수 없습니다.');
    }

    if (result.attemptCount > rule.limit && result.retryAfterSeconds !== null) {
      this.throwRateLimited(result.retryAfterSeconds);
    }
  }

  async clear(rule: AuthRateLimitRule, key: string): Promise<void> {
    const keyHash = this.hashKey(rule.scope, key);

    await this.database.client.$executeRaw`
      DELETE FROM "auth_rate_limit_buckets"
      WHERE "scope" = ${rule.scope}
        AND "key_hash" = ${keyHash}
    `;
  }

  private hashKey(scope: string, key: string): Buffer {
    return createHmac('sha256', this.config.security.rateLimitHmacKey)
      .update(`${scope}:${key}`)
      .digest();
  }

  private throwRateLimited(retryAfterSeconds: number): never {
    throw new ApiError({
      code: 'RATE_LIMITED',
      message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
      retryAfterSeconds,
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
  }
}
