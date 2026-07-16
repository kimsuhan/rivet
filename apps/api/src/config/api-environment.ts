import { isAbsolute } from 'node:path';

import { plainToInstance, Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  validateSync,
} from 'class-validator';

function toNumber(value: unknown, fallback: number): number {
  return value === undefined || value === '' ? fallback : Number(value);
}

class ApiEnvironment {
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

  @IsString()
  @IsNotEmpty()
  ONE_TIME_TOKEN_HMAC_KEY!: string;

  @IsString()
  @IsNotEmpty()
  CSRF_HMAC_KEY!: string;

  @IsString()
  @IsNotEmpty()
  RATE_LIMIT_HMAC_KEY!: string;

  @IsOptional()
  @IsString()
  POSTHOG_API_KEY?: string;

  @IsOptional()
  @IsString()
  SLACK_ALERT_WEBHOOK_URL?: string;

  @IsOptional()
  @IsString()
  WEB_PUSH_VAPID_PUBLIC_KEY?: string;

  @Transform(({ value }) => toNumber(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  DATABASE_POOL_MAX = 10;

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

  @Transform(({ value }) => toNumber(value, 4_000))
  @IsInt()
  @Min(1)
  @Max(65_535)
  API_PORT = 4_000;
}

export function validateApiEnvironment(values: Record<string, unknown>): ApiEnvironment {
  const environment = plainToInstance(ApiEnvironment, values, {
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

      if (
        webOrigin.origin !== environment.WEB_ORIGIN ||
        (environment.NODE_ENV === 'production' && webOrigin.protocol !== 'https:') ||
        (webOrigin.protocol === 'http:' &&
          !['127.0.0.1', '[::1]', 'localhost'].includes(webOrigin.hostname))
      ) {
        invalidKeys.add('WEB_ORIGIN');
      }
    } catch {
      invalidKeys.add('WEB_ORIGIN');
    }
  }

  const webPushPublicKey = environment.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() ?? '';
  const decodedWebPushPublicKey = Buffer.from(webPushPublicKey, 'base64url');
  if (
    (webPushPublicKey.length > 0 &&
      (!/^[A-Za-z0-9_-]+$/.test(webPushPublicKey) ||
        decodedWebPushPublicKey.byteLength !== 65 ||
        decodedWebPushPublicKey[0] !== 4 ||
        decodedWebPushPublicKey.toString('base64url') !== webPushPublicKey)) ||
    (environment.NODE_ENV === 'production' && webPushPublicKey.length === 0)
  ) {
    invalidKeys.add('WEB_PUSH_VAPID_PUBLIC_KEY');
  }

  const hmacKeys = [
    ['CSRF_HMAC_KEY', environment.CSRF_HMAC_KEY],
    ['ONE_TIME_TOKEN_HMAC_KEY', environment.ONE_TIME_TOKEN_HMAC_KEY],
    ['RATE_LIMIT_HMAC_KEY', environment.RATE_LIMIT_HMAC_KEY],
  ] as const;

  for (const [key, value] of hmacKeys) {
    if (
      typeof value === 'string' &&
      (value.trim().length === 0 || Buffer.byteLength(value, 'utf8') < 32)
    ) {
      invalidKeys.add(key);
    }
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

  for (const [key, value] of hmacKeys) {
    if (hmacKeys.filter(([, candidate]) => candidate === value).length > 1) {
      invalidKeys.add(key);
    }
  }

  if (invalidKeys.size > 0) {
    throw new Error(`API 환경 변수 검증 실패: ${[...invalidKeys].sort().join(', ')}`);
  }

  return environment;
}
