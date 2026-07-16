import { setTimeout as delay } from 'node:timers/promises';

import { PinoLogger } from 'nestjs-pino';

import { DatabaseService } from '../../common/database/database.service';
import { ObservabilityService } from '../../common/observability/observability.service';
import { workerConfig } from '../../config/worker.config';
import {
  type FileCleanupResult,
  FileCleanupService,
  millisecondsUntilNextMaintenance,
} from './file-cleanup.service';
import type { RetentionCleanupResult } from './retention.service';
import { RetentionService } from './retention.service';

jest.mock('node:timers/promises', () => ({ setTimeout: jest.fn() }));

const emptyResult: FileCleanupResult = {
  deactivatedPushSubscriptions: 0,
  deletedEmailDeliveries: 0,
  deletedExportAudits: 0,
  deletedBinaries: 0,
  deletedMetadata: 0,
  deletedOrphans: 0,
  deletedOutboxEvents: 0,
  deletedRateLimitBuckets: 0,
  deletedSessions: 0,
  deletedTemporaryFiles: 0,
  deletedTokens: 0,
  failedSteps: 0,
  invalidStorageKeys: 0,
  missingBinaries: 0,
  skippedByLock: false,
};

describe('FileCleanupService', () => {
  const error = jest.fn();
  const logger = {
    error,
    setContext: jest.fn(),
  } as unknown as PinoLogger;
  const mockedDelay = jest.mocked(delay);
  let finishDelay: (() => void) | undefined;
  let retention: jest.Mocked<Pick<RetentionService, 'cleanup'>>;
  let service: FileCleanupService;
  const observability = { alert: jest.fn() } as unknown as ObservabilityService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedDelay.mockImplementation(
      (_milliseconds, _value, options) =>
        new Promise((resolve, reject) => {
          finishDelay = () => resolve(undefined);
          options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
    );
    retention = {
      cleanup: jest.fn().mockResolvedValue({
        deactivatedPushSubscriptions: 0,
        deletedEmailDeliveries: 0,
        deletedExportAudits: 0,
        deletedOutboxEvents: 0,
        deletedRateLimitBuckets: 0,
        deletedSessions: 0,
        deletedTokens: 0,
        failedSteps: 0,
      } satisfies RetentionCleanupResult),
    };
    service = new FileCleanupService(
      {} as DatabaseService,
      { fileStorageRoot: '/tmp/rivet-worker-test' } as ReturnType<typeof workerConfig>,
      retention as unknown as RetentionService,
      observability,
      logger,
    );
  });

  it.each([
    ['2026-07-11T17:30:00.000Z', 30 * 60 * 1_000],
    ['2026-07-11T18:00:00.000Z', 24 * 60 * 60 * 1_000],
    ['2026-07-11T18:30:00.000Z', 23.5 * 60 * 60 * 1_000],
  ])('aligns the next run after %s to 18:00 UTC', (now, expected) => {
    expect(millisecondsUntilNextMaintenance(new Date(now))).toBe(expected);
  });

  it('runs immediately, repeats after 24 hours, and stops without waiting for the timer', async () => {
    const cleanup = jest.spyOn(service, 'cleanupOnce').mockResolvedValue(emptyResult);

    service.onApplicationBootstrap();
    await Promise.resolve();
    expect(cleanup).toHaveBeenCalledTimes(1);
    const scheduledDelay = mockedDelay.mock.calls[0]?.[0];
    expect(scheduledDelay).toBeGreaterThan(0);
    expect(scheduledDelay).toBeLessThanOrEqual(86_400_000);
    expect(mockedDelay).toHaveBeenCalledWith(scheduledDelay, undefined, {
      signal: expect.any(AbortSignal),
    });

    finishDelay?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(cleanup).toHaveBeenCalledTimes(2);

    await service.onApplicationShutdown();
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it('keeps the daily loop alive after one cleanup failure', async () => {
    const cleanup = jest
      .spyOn(service, 'cleanupOnce')
      .mockRejectedValueOnce(new Error('cleanup failed'))
      .mockResolvedValue(emptyResult);

    service.onApplicationBootstrap();
    await Promise.resolve();
    await Promise.resolve();
    finishDelay?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'FILE_CLEANUP_FAILED', jobId: expect.any(String) }),
      '파일 정리 실패',
    );
    await service.onApplicationShutdown();
  });
});
