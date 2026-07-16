import { validateApiEnvironment } from './api-environment';

const webPushPublicKey = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString(
  'base64url',
);

const validValues = {
  API_PORT: '4000',
  CSRF_HMAC_KEY: 'test-csrf-hmac-key-with-at-least-32-bytes',
  DATABASE_CONNECTION_TIMEOUT_MS: '5000',
  DATABASE_IDLE_TIMEOUT_MS: '10000',
  DATABASE_POOL_MAX: '10',
  DATABASE_URL: 'postgresql://user:password@localhost:5432/rivet?schema=public',
  FILE_STORAGE_ROOT: '/tmp/rivet-files',
  NODE_ENV: 'development',
  ONE_TIME_TOKEN_HMAC_KEY: 'test-token-hmac-key-with-at-least-32-bytes',
  POSTHOG_API_KEY: '',
  RATE_LIMIT_HMAC_KEY: 'test-rate-hmac-key-with-at-least-32-bytes',
  RELEASE_ID: 'test-release',
  SLACK_ALERT_WEBHOOK_URL: '',
  WEB_ORIGIN: 'http://localhost:3000',
};

describe('validateApiEnvironment', () => {
  it('converts numeric settings after validation', () => {
    const environment = validateApiEnvironment(validValues);

    expect(environment.API_PORT).toBe(4_000);
    expect(environment.DATABASE_POOL_MAX).toBe(10);
  });

  it('rejects a relative file storage path', () => {
    expect(() => validateApiEnvironment({ ...validValues, FILE_STORAGE_ROOT: './files' })).toThrow(
      'FILE_STORAGE_ROOT',
    );
  });

  it('requires an HTTPS web origin in production', () => {
    expect(() => validateApiEnvironment({ ...validValues, NODE_ENV: 'production' })).toThrow(
      'WEB_ORIGIN',
    );
  });

  it('allows insecure HTTP only on a loopback host', () => {
    expect(() =>
      validateApiEnvironment({ ...validValues, WEB_ORIGIN: 'http://example.com' }),
    ).toThrow('WEB_ORIGIN');
    expect(() =>
      validateApiEnvironment({ ...validValues, WEB_ORIGIN: 'http://127.0.0.1:3000' }),
    ).not.toThrow();
  });

  it.each([
    'http://user:password@localhost:3000',
    'http://localhost:3000/',
    'http://localhost:3000/path',
    'http://localhost:3000?source=test',
    'http://localhost:3000#fragment',
  ])('rejects a web URL that is not a pure origin: %s', (webOrigin) => {
    expect(() => validateApiEnvironment({ ...validValues, WEB_ORIGIN: webOrigin })).toThrow(
      'WEB_ORIGIN',
    );
  });

  it('requires separate HMAC keys with at least 32 bytes', () => {
    expect(() => validateApiEnvironment({ ...validValues, CSRF_HMAC_KEY: 'short' })).toThrow(
      'CSRF_HMAC_KEY',
    );
    expect(() => validateApiEnvironment({ ...validValues, CSRF_HMAC_KEY: ' '.repeat(32) })).toThrow(
      'CSRF_HMAC_KEY',
    );
    expect(() =>
      validateApiEnvironment({
        ...validValues,
        CSRF_HMAC_KEY: validValues.RATE_LIMIT_HMAC_KEY,
      }),
    ).toThrow('CSRF_HMAC_KEY');
  });

  it('allows explicit disabled observability outside production', () => {
    expect(() => validateApiEnvironment(validValues)).not.toThrow();
  });

  it('requires valid PostHog and Slack settings in production', () => {
    const production = {
      ...validValues,
      NODE_ENV: 'production',
      POSTHOG_API_KEY: 'phc_12345678',
      SLACK_ALERT_WEBHOOK_URL: 'https://hooks.slack.com/services/team/channel/secret',
      WEB_ORIGIN: 'https://rivet.example.com',
      WEB_PUSH_VAPID_PUBLIC_KEY: webPushPublicKey,
    };

    expect(() => validateApiEnvironment(production)).not.toThrow();
    expect(() => validateApiEnvironment({ ...production, POSTHOG_API_KEY: '' })).toThrow(
      'POSTHOG_API_KEY',
    );
    expect(() =>
      validateApiEnvironment({
        ...production,
        SLACK_ALERT_WEBHOOK_URL: 'https://example.com/services/team/channel/secret',
      }),
    ).toThrow('SLACK_ALERT_WEBHOOK_URL');
  });

  it('requires a valid VAPID public key in production without exposing its value', () => {
    expect(() =>
      validateApiEnvironment({
        ...validValues,
        NODE_ENV: 'production',
        POSTHOG_API_KEY: 'phc_12345678',
        SLACK_ALERT_WEBHOOK_URL: 'https://hooks.slack.com/services/team/channel/secret',
        WEB_ORIGIN: 'https://rivet.example.com',
        WEB_PUSH_VAPID_PUBLIC_KEY: 'not-a-key',
      }),
    ).toThrow('WEB_PUSH_VAPID_PUBLIC_KEY');
    expect(() =>
      validateApiEnvironment({
        ...validValues,
        NODE_ENV: 'production',
        POSTHOG_API_KEY: 'phc_12345678',
        SLACK_ALERT_WEBHOOK_URL: 'https://hooks.slack.com/services/team/channel/secret',
        WEB_ORIGIN: 'https://rivet.example.com',
        WEB_PUSH_VAPID_PUBLIC_KEY: Buffer.alloc(65, 1).toString('base64url'),
      }),
    ).toThrow('WEB_PUSH_VAPID_PUBLIC_KEY');
  });
});
