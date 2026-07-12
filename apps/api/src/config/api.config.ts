import { registerAs } from '@nestjs/config';

export const apiConfig = registerAs('api', () => ({
  database: {
    connectionTimeoutMs: Number(process.env.DATABASE_CONNECTION_TIMEOUT_MS ?? 5_000),
    idleTimeoutMs: Number(process.env.DATABASE_IDLE_TIMEOUT_MS ?? 10_000),
    poolMax: Number(process.env.DATABASE_POOL_MAX ?? 10),
    url: process.env.DATABASE_URL as string,
  },
  environment: process.env.NODE_ENV as 'development' | 'test' | 'production',
  fileStorageRoot: process.env.FILE_STORAGE_ROOT as string,
  observability: {
    posthogApiKey: process.env.POSTHOG_API_KEY?.trim() || null,
    slackAlertWebhookUrl: process.env.SLACK_ALERT_WEBHOOK_URL?.trim() || null,
  },
  port: Number(process.env.API_PORT ?? 4_000),
  releaseId: process.env.RELEASE_ID as string,
  security: {
    csrfHmacKey: process.env.CSRF_HMAC_KEY as string,
    oneTimeTokenHmacKey: process.env.ONE_TIME_TOKEN_HMAC_KEY as string,
    rateLimitHmacKey: process.env.RATE_LIMIT_HMAC_KEY as string,
  },
  webOrigin: process.env.WEB_ORIGIN as string,
}));
