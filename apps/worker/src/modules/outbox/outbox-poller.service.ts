import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { ObservabilityService } from '../../common/observability/observability.service';
import { OutboxService } from './outbox.service';
import { OutboxProcessorService } from './outbox-processor.service';

const EMPTY_QUEUE_POLL_INTERVAL_MS = 1_000;
const METRICS_LOG_INTERVAL_MS = 60_000;

@Injectable()
export class OutboxPollerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly workerId = `worker_${process.pid}_${randomUUID()}`;
  private isStopping = false;
  private lastMetricsLoggedAt = 0;
  private polling: Promise<void> | undefined;

  constructor(
    private readonly outbox: OutboxService,
    private readonly processor: OutboxProcessorService,
    private readonly observability: ObservabilityService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutboxPollerService.name);
  }

  onApplicationBootstrap(): void {
    this.polling = this.poll();
  }

  async onApplicationShutdown(): Promise<void> {
    this.isStopping = true;
    await this.polling;
  }

  private async poll(): Promise<void> {
    this.logger.info({ workerId: this.workerId }, 'Outbox polling 시작');

    while (!this.isStopping) {
      try {
        await this.logMetricsIfDue();
        const events = await this.outbox.claimBatch(this.workerId);

        if (events.length === 0) {
          await delay(EMPTY_QUEUE_POLL_INTERVAL_MS);
          continue;
        }

        await this.processor.processBatch(events, this.workerId);
      } catch {
        this.logger.error(
          { errorCode: 'OUTBOX_POLL_FAILED', workerId: this.workerId },
          'Outbox polling 실패',
        );
        await delay(EMPTY_QUEUE_POLL_INTERVAL_MS);
      }
    }

    this.logger.info({ workerId: this.workerId }, 'Outbox polling 종료');
  }

  private async logMetricsIfDue(): Promise<void> {
    const now = Date.now();
    if (now - this.lastMetricsLoggedAt < METRICS_LOG_INTERVAL_MS) return;

    const metrics = await this.outbox.metrics();
    this.lastMetricsLoggedAt = now;
    this.logger.info(
      {
        outbox_failed_count: metrics.failedCount,
        outbox_oldest_pending_seconds: Math.max(0, Math.floor(metrics.oldestPendingSeconds)),
        outbox_pending_count: metrics.pendingCount,
      },
      'Outbox 지표',
    );
    if (metrics.oldestPendingSeconds > 300) {
      this.observability.alert({
        errorCode: 'OUTBOX_OLDEST_PENDING_EXCEEDED',
        jobId: this.workerId,
        type: 'OUTBOX_BACKLOG_DELAYED',
      });
    }
  }
}
