import type { PinoLogger } from 'nestjs-pino';

import type { ObservabilityService } from '../../common/observability/observability.service';
import type { OutboxService } from './outbox.service';
import { OutboxPollerService } from './outbox-poller.service';
import type { OutboxProcessorService } from './outbox-processor.service';

describe('OutboxPollerService metrics', () => {
  it('logs the minimum metrics and alerts only on a delayed queue', async () => {
    const metrics = jest.fn().mockResolvedValue({
      failedCount: 2,
      oldestPendingSeconds: 301.8,
      pendingCount: 4,
    });
    const alert = jest.fn();
    const info = jest.fn();
    const service = new OutboxPollerService(
      { metrics } as unknown as OutboxService,
      {} as OutboxProcessorService,
      { alert } as unknown as ObservabilityService,
      { info, setContext: jest.fn() } as unknown as PinoLogger,
    );
    const internal = service as unknown as { logMetricsIfDue: () => Promise<void> };

    await internal.logMetricsIfDue();

    expect(info).toHaveBeenCalledWith(
      {
        outbox_failed_count: 2,
        outbox_oldest_pending_seconds: 301,
        outbox_pending_count: 4,
      },
      'Outbox 지표',
    );
    expect(alert).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: 'OUTBOX_OLDEST_PENDING_EXCEEDED',
        type: 'OUTBOX_BACKLOG_DELAYED',
      }),
    );
    expect(alert).toHaveBeenCalledTimes(1);
  });
});
