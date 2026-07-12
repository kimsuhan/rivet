import { afterEach, describe, expect, it, vi } from 'vitest';

describe('webEnvironment', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('exposes the release metadata used by Next and Nginx', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('RELEASE_ID', 'web-test-release');

    const { webEnvironment } = await import('./environment');

    expect(webEnvironment).toMatchObject({
      NODE_ENV: 'test',
      RELEASE_ID: 'web-test-release',
    });
  });

  it('rejects an empty production release ID', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RELEASE_ID', '');

    await expect(import('./environment')).rejects.toThrow('웹 환경 변수 구성이 올바르지 않습니다.');
  });
});
