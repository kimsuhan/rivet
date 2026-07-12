import { PinoLogger } from 'nestjs-pino';

import { DatabaseService } from '../../common/database/database.service';
import { ObservabilityService } from '../../common/observability/observability.service';
import { RetentionService } from './retention.service';

describe('RetentionService', () => {
  const queryRaw = jest.fn();
  const warn = jest.fn();
  const database = { client: { $queryRaw: queryRaw } } as unknown as DatabaseService;
  const logger = { warn } as unknown as PinoLogger;
  const observability = { alert: jest.fn() } as unknown as ObservabilityService;
  const service = new RetentionService(database, observability, logger);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deletes every retention family in bounded batches and continues after one step fails', async () => {
    let sessionCalls = 0;
    const tables: string[] = [];
    queryRaw.mockImplementation((template: TemplateStringsArray) => {
      const sql = template.join('');
      tables.push(sql);

      if (sql.includes('"one_time_tokens"')) {
        return Promise.reject(new Error('TOKEN_DELETE_FAILED'));
      }
      if (sql.includes('"sessions"')) {
        sessionCalls += 1;
        return Promise.resolve(
          Array.from({ length: sessionCalls === 1 ? 100 : 1 }, (_, index) => ({
            id: `session-${sessionCalls}-${index}`,
          })),
        );
      }
      return Promise.resolve([]);
    });

    await expect(service.cleanup('maintenance-test')).resolves.toEqual({
      deletedEmailDeliveries: 0,
      deletedExportAudits: 0,
      deletedOutboxEvents: 0,
      deletedRateLimitBuckets: 0,
      deletedSessions: 101,
      deletedTokens: 0,
      failedSteps: 1,
    });

    expect(sessionCalls).toBe(2);
    for (const table of [
      '"email_deliveries"',
      '"one_time_tokens"',
      '"sessions"',
      '"auth_rate_limit_buckets"',
      '"export_audits"',
      '"outbox_events"',
    ]) {
      expect(tables.some((sql) => sql.includes(table))).toBe(true);
    }
    expect(warn).toHaveBeenCalledWith(
      {
        errorCode: 'RETENTION_CLEANUP_STEP_FAILED',
        jobId: 'maintenance-test',
        step: 'one_time_token',
      },
      '보존 데이터 정리 단계 실패',
    );
    expect(observability.alert).toHaveBeenCalledWith({
      errorCode: 'RETENTION_CLEANUP_STEP_FAILED',
      jobId: 'maintenance-test',
      type: 'MAINTENANCE_STEP_FAILED',
    });
  });

  it('does not delete failed outbox events or unfinished audit and delivery rows by contract', async () => {
    queryRaw.mockResolvedValue([]);

    await service.cleanup('maintenance-contract');

    const sql = queryRaw.mock.calls.map(([template]) =>
      (template as TemplateStringsArray).join(''),
    );
    expect(sql.find((value) => value.includes('"outbox_events"'))).toContain(
      '"processed_at" IS NOT NULL OR event."canceled_at" IS NOT NULL',
    );
    expect(sql.find((value) => value.includes('"export_audits"'))).toContain(
      '"completed_at" IS NOT NULL OR "failed_at" IS NOT NULL',
    );
    expect(sql.find((value) => value.includes('"email_deliveries"'))).toContain(
      '"sent_at" IS NOT NULL OR "failed_at" IS NOT NULL',
    );
  });
});
