import type { ConfigType } from '@nestjs/config';
import type { Params } from 'nestjs-pino';

import type { workerConfig } from '../../config/worker.config';

export function createWorkerLoggerOptions(config: ConfigType<typeof workerConfig>): Params {
  return {
    pinoHttp: {
      base: {
        environment: config.environment,
        releaseId: config.releaseId,
      },
      level: config.environment === 'production' ? 'info' : 'debug',
      redact: {
        censor: '[REDACTED]',
        paths: ['email', 'password', 'payload', 'token'],
      },
    },
  };
}
