import { isAbsolute } from 'node:path';

import { plainToInstance, Transform } from 'class-transformer';
import {
  IsEmail,
  isEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  validateSync,
} from 'class-validator';

function toNumber(value: unknown, fallback: number): number {
  return value === undefined || value === '' ? fallback : Number(value);
}

class WorkerEnvironment {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV!: 'development' | 'test' | 'production';

  @IsString()
  @IsNotEmpty()
  RELEASE_ID!: string;

  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  WEB_ORIGIN!: string;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @Transform(({ value }) => toNumber(value, 5))
  @IsInt()
  @Min(1)
  @Max(100)
  DATABASE_POOL_MAX = 5;

  @Transform(({ value }) => toNumber(value, 5_000))
  @IsInt()
  @Min(100)
  DATABASE_CONNECTION_TIMEOUT_MS = 5_000;

  @Transform(({ value }) => toNumber(value, 10_000))
  @IsInt()
  @Min(100)
  DATABASE_IDLE_TIMEOUT_MS = 10_000;

  @IsString()
  @IsNotEmpty()
  FILE_STORAGE_ROOT!: string;

  @IsString()
  @IsNotEmpty()
  RESEND_API_KEY!: string;

  @IsEmail()
  @MaxLength(254)
  RESEND_FROM!: string;

  @IsOptional()
  @IsString()
  RESEND_ALLOWED_RECIPIENTS?: string;

  @IsString()
  @IsNotEmpty()
  ONE_TIME_TOKEN_HMAC_KEY!: string;

  @IsString()
  @IsNotEmpty()
  RATE_LIMIT_HMAC_KEY!: string;

  @IsOptional()
  @IsString()
  POSTHOG_API_KEY?: string;

  @IsOptional()
  @IsString()
  SLACK_ALERT_WEBHOOK_URL?: string;
}

export function validateWorkerEnvironment(values: Record<string, unknown>): WorkerEnvironment {
  const environment = plainToInstance(WorkerEnvironment, values, {
    enableImplicitConversion: false,
  });
  const invalidKeys = new Set(
    validateSync(environment, { forbidUnknownValues: true }).map((error) => error.property),
  );

  if (environment.FILE_STORAGE_ROOT && !isAbsolute(environment.FILE_STORAGE_ROOT)) {
    invalidKeys.add('FILE_STORAGE_ROOT');
  }

  if (environment.WEB_ORIGIN) {
    try {
      const webOrigin = new URL(environment.WEB_ORIGIN);
      const localHttpHosts = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);

      if (
        webOrigin.origin !== environment.WEB_ORIGIN ||
        (webOrigin.protocol === 'http:' && !localHttpHosts.has(webOrigin.hostname)) ||
        (environment.NODE_ENV === 'production' && webOrigin.protocol !== 'https:')
      ) {
        invalidKeys.add('WEB_ORIGIN');
      }
    } catch {
      invalidKeys.add('WEB_ORIGIN');
    }
  }

  for (const key of ['ONE_TIME_TOKEN_HMAC_KEY', 'RATE_LIMIT_HMAC_KEY'] as const) {
    const value = environment[key];

    if (!value || value.trim().length === 0 || Buffer.byteLength(value, 'utf8') < 32) {
      invalidKeys.add(key);
    }
  }

  if (
    environment.ONE_TIME_TOKEN_HMAC_KEY &&
    environment.ONE_TIME_TOKEN_HMAC_KEY === environment.RATE_LIMIT_HMAC_KEY
  ) {
    invalidKeys.add('ONE_TIME_TOKEN_HMAC_KEY');
    invalidKeys.add('RATE_LIMIT_HMAC_KEY');
  }

  if (!environment.RESEND_API_KEY?.trim()) {
    invalidKeys.add('RESEND_API_KEY');
  }

  const posthogApiKey = environment.POSTHOG_API_KEY?.trim() ?? '';
  if (
    (posthogApiKey.length > 0 && !/^phc_[A-Za-z0-9_-]{8,}$/.test(posthogApiKey)) ||
    (environment.NODE_ENV === 'production' && posthogApiKey.length === 0)
  ) {
    invalidKeys.add('POSTHOG_API_KEY');
  }

  const slackWebhookUrl = environment.SLACK_ALERT_WEBHOOK_URL?.trim() ?? '';
  if (slackWebhookUrl.length > 0) {
    try {
      const url = new URL(slackWebhookUrl);
      if (
        url.protocol !== 'https:' ||
        url.hostname !== 'hooks.slack.com' ||
        !/^\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(url.pathname) ||
        url.search.length > 0 ||
        url.hash.length > 0
      ) {
        invalidKeys.add('SLACK_ALERT_WEBHOOK_URL');
      }
    } catch {
      invalidKeys.add('SLACK_ALERT_WEBHOOK_URL');
    }
  } else if (environment.NODE_ENV === 'production') {
    invalidKeys.add('SLACK_ALERT_WEBHOOK_URL');
  }

  const allowedRecipients = environment.RESEND_ALLOWED_RECIPIENTS?.split(',').map((email) =>
    email.trim(),
  );

  if (
    (environment.NODE_ENV !== 'production' && !allowedRecipients?.length) ||
    allowedRecipients?.some((email) => email.length > 254 || !isEmail(email))
  ) {
    invalidKeys.add('RESEND_ALLOWED_RECIPIENTS');
  }

  if (invalidKeys.size > 0) {
    throw new Error(`워커 환경 변수 검증 실패: ${[...invalidKeys].sort().join(', ')}`);
  }

  return environment;
}
