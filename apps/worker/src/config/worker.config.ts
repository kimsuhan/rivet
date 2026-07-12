import { registerAs } from '@nestjs/config';

function parseAllowedRecipients(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export const workerConfig = registerAs('worker', () => ({
  database: {
    connectionTimeoutMs: Number(process.env.DATABASE_CONNECTION_TIMEOUT_MS ?? 5_000),
    idleTimeoutMs: Number(process.env.DATABASE_IDLE_TIMEOUT_MS ?? 10_000),
    poolMax: Number(process.env.DATABASE_POOL_MAX ?? 5),
    url: process.env.DATABASE_URL as string,
  },
  email: {
    allowedRecipients: parseAllowedRecipients(process.env.RESEND_ALLOWED_RECIPIENTS),
    apiKey: process.env.RESEND_API_KEY as string,
    from: process.env.RESEND_FROM as string,
    oneTimeTokenHmacKey: process.env.ONE_TIME_TOKEN_HMAC_KEY as string,
  },
  environment: process.env.NODE_ENV as 'development' | 'test' | 'production',
  fileStorageRoot: process.env.FILE_STORAGE_ROOT as string,
  observability: {
    posthogApiKey: process.env.POSTHOG_API_KEY?.trim() || null,
    slackAlertWebhookUrl: process.env.SLACK_ALERT_WEBHOOK_URL?.trim() || null,
  },
  rateLimitHmacKey: process.env.RATE_LIMIT_HMAC_KEY as string,
  releaseId: process.env.RELEASE_ID as string,
  webOrigin: process.env.WEB_ORIGIN as string,
}));
