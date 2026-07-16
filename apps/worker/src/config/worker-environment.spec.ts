import { validateWorkerEnvironment } from './worker-environment';

const webPushEnvironment = {
  WEB_PUSH_VAPID_PRIVATE_KEY: Buffer.alloc(32, 1).toString('base64url'),
  WEB_PUSH_VAPID_PUBLIC_KEY: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 2)]).toString(
    'base64url',
  ),
  WEB_PUSH_VAPID_SUBJECT: 'mailto:push@example.test',
};

const validValues = {
  DATABASE_URL: 'postgresql://user:password@localhost:5432/rivet?schema=public',
  FILE_STORAGE_ROOT: '/tmp/rivet-files',
  NODE_ENV: 'development',
  ONE_TIME_TOKEN_HMAC_KEY: 'test-one-time-token-hmac-key-32-bytes',
  POSTHOG_API_KEY: '',
  RATE_LIMIT_HMAC_KEY: 'test-rate-limit-hmac-key-32-bytes!',
  RELEASE_ID: 'test-release',
  RESEND_ALLOWED_RECIPIENTS: 'allowed@example.test',
  RESEND_API_KEY: 're_test_worker_dummy',
  RESEND_FROM: 'rivet-worker@example.test',
  SLACK_ALERT_WEBHOOK_URL: '',
  WEB_ORIGIN: 'http://localhost:3000',
};

describe('validateWorkerEnvironment', () => {
  it('applies the worker connection pool default', () => {
    expect(validateWorkerEnvironment(validValues).DATABASE_POOL_MAX).toBe(5);
  });

  it('rejects a relative file storage path', () => {
    expect(() =>
      validateWorkerEnvironment({ ...validValues, FILE_STORAGE_ROOT: './files' }),
    ).toThrow('FILE_STORAGE_ROOT');
  });

  it('requires an HTTPS web origin in production', () => {
    expect(() => validateWorkerEnvironment({ ...validValues, NODE_ENV: 'production' })).toThrow(
      'WEB_ORIGIN',
    );
  });

  it.each(['http://example.com', 'http://192.168.0.10:3000'])(
    'rejects a remote HTTP web origin: %s',
    (webOrigin) => {
      expect(() => validateWorkerEnvironment({ ...validValues, WEB_ORIGIN: webOrigin })).toThrow(
        'WEB_ORIGIN',
      );
    },
  );

  it.each(['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000'])(
    'allows a loopback HTTP web origin outside production: %s',
    (webOrigin) => {
      expect(validateWorkerEnvironment({ ...validValues, WEB_ORIGIN: webOrigin }).WEB_ORIGIN).toBe(
        webOrigin,
      );
    },
  );

  it.each([
    'http://user:password@localhost:3000',
    'http://localhost:3000/',
    'http://localhost:3000/path',
    'http://localhost:3000?source=test',
    'http://localhost:3000#fragment',
  ])('rejects a web URL that is not a pure origin: %s', (webOrigin) => {
    expect(() => validateWorkerEnvironment({ ...validValues, WEB_ORIGIN: webOrigin })).toThrow(
      'WEB_ORIGIN',
    );
  });

  it.each([
    'ONE_TIME_TOKEN_HMAC_KEY',
    'RATE_LIMIT_HMAC_KEY',
    'RESEND_API_KEY',
    'RESEND_FROM',
  ] as const)('requires %s at startup', (key) => {
    expect(() => validateWorkerEnvironment({ ...validValues, [key]: undefined })).toThrow(key);
  });

  it('requires HMAC keys to be different and at least 32 bytes', () => {
    expect(() =>
      validateWorkerEnvironment({ ...validValues, ONE_TIME_TOKEN_HMAC_KEY: 'x'.repeat(31) }),
    ).toThrow('ONE_TIME_TOKEN_HMAC_KEY');
    expect(() =>
      validateWorkerEnvironment({
        ...validValues,
        RATE_LIMIT_HMAC_KEY: validValues.ONE_TIME_TOKEN_HMAC_KEY,
      }),
    ).toThrow('RATE_LIMIT_HMAC_KEY');
  });

  it('requires a valid sender email', () => {
    expect(() =>
      validateWorkerEnvironment({ ...validValues, RESEND_FROM: 'Rivet sender' }),
    ).toThrow('RESEND_FROM');
  });

  it('requires a valid development recipient allowlist', () => {
    expect(() =>
      validateWorkerEnvironment({ ...validValues, RESEND_ALLOWED_RECIPIENTS: undefined }),
    ).toThrow('RESEND_ALLOWED_RECIPIENTS');
    expect(() =>
      validateWorkerEnvironment({ ...validValues, RESEND_ALLOWED_RECIPIENTS: 'not-an-email' }),
    ).toThrow('RESEND_ALLOWED_RECIPIENTS');
  });

  it('requires a valid test recipient allowlist', () => {
    expect(() =>
      validateWorkerEnvironment({
        ...validValues,
        NODE_ENV: 'test',
        RESEND_ALLOWED_RECIPIENTS: undefined,
      }),
    ).toThrow('RESEND_ALLOWED_RECIPIENTS');
  });

  it('does not require the development recipient allowlist in production', () => {
    expect(
      validateWorkerEnvironment({
        ...validValues,
        NODE_ENV: 'production',
        POSTHOG_API_KEY: 'phc_12345678',
        RESEND_ALLOWED_RECIPIENTS: undefined,
        SLACK_ALERT_WEBHOOK_URL: 'https://hooks.slack.com/services/team/channel/secret',
        WEB_ORIGIN: 'https://rivet.example.com',
        ...webPushEnvironment,
      }).RESEND_ALLOWED_RECIPIENTS,
    ).toBeUndefined();
  });

  it('allows explicit disabled observability outside production', () => {
    expect(() => validateWorkerEnvironment(validValues)).not.toThrow();
  });

  it('requires valid PostHog and Slack settings in production', () => {
    const production = {
      ...validValues,
      NODE_ENV: 'production',
      POSTHOG_API_KEY: 'phc_12345678',
      RESEND_ALLOWED_RECIPIENTS: undefined,
      SLACK_ALERT_WEBHOOK_URL: 'https://hooks.slack.com/services/team/channel/secret',
      WEB_ORIGIN: 'https://rivet.example.com',
      ...webPushEnvironment,
    };

    expect(() => validateWorkerEnvironment(production)).not.toThrow();
    expect(() => validateWorkerEnvironment({ ...production, POSTHOG_API_KEY: '' })).toThrow(
      'POSTHOG_API_KEY',
    );
    expect(() =>
      validateWorkerEnvironment({
        ...production,
        SLACK_ALERT_WEBHOOK_URL: 'http://hooks.slack.com/services/team/channel/secret',
      }),
    ).toThrow('SLACK_ALERT_WEBHOOK_URL');
  });

  it('requires the complete VAPID environment group in production', () => {
    expect(() =>
      validateWorkerEnvironment({
        ...validValues,
        NODE_ENV: 'production',
        POSTHOG_API_KEY: 'phc_12345678',
        RESEND_ALLOWED_RECIPIENTS: undefined,
        SLACK_ALERT_WEBHOOK_URL: 'https://hooks.slack.com/services/team/channel/secret',
        WEB_ORIGIN: 'https://rivet.example.com',
        WEB_PUSH_VAPID_PUBLIC_KEY: webPushEnvironment.WEB_PUSH_VAPID_PUBLIC_KEY,
      }),
    ).toThrow('WEB_PUSH_VAPID_PRIVATE_KEY');
    expect(() =>
      validateWorkerEnvironment({
        ...validValues,
        ...webPushEnvironment,
        WEB_PUSH_VAPID_PUBLIC_KEY: Buffer.alloc(65, 2).toString('base64url'),
      }),
    ).toThrow('WEB_PUSH_VAPID_PUBLIC_KEY');
  });
});
