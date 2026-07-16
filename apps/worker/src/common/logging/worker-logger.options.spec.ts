import type { ConfigType } from '@nestjs/config';

import { workerConfig } from '../../config/worker.config';
import { createWorkerLoggerOptions } from './worker-logger.options';

function loggerOptions(): { redact?: unknown } {
  const options = createWorkerLoggerOptions({
    environment: 'test',
    releaseId: 'worker-logger-test',
  } as ConfigType<typeof workerConfig>).pinoHttp;

  if (!options || Array.isArray(options) || 'write' in options) {
    throw new Error('Pino HTTP 옵션을 준비하지 못했습니다.');
  }
  return options;
}

describe('createWorkerLoggerOptions', () => {
  it('redacts Push subscription and VAPID material at the job boundary', () => {
    const options = loggerOptions();

    expect(options.redact).toEqual(
      expect.objectContaining({
        paths: expect.arrayContaining([
          'auth',
          '*.auth',
          'endpoint',
          '*.endpoint',
          'p256dh',
          '*.p256dh',
          'privateKey',
          '*.privateKey',
          'payload',
        ]),
      }),
    );
  });
});
