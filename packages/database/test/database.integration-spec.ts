import { randomUUID } from 'node:crypto';

import { createPrismaClient } from '../src';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL 환경 변수가 필요합니다.');
}

const prisma = createPrismaClient({
  connectionTimeoutMs: 5_000,
  databaseUrl,
  idleTimeoutMs: 10_000,
  poolMax: 2,
});

describe('database integration', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('connects only to the rivet_test public test schema', async () => {
    const rows = await prisma.$queryRaw<
      Array<{ databaseName: string; schemaName: string; timezone: string }>
    >`SELECT current_database() AS "databaseName",
             current_schema() AS "schemaName",
             current_setting('TimeZone') AS timezone`;

    expect(rows).toEqual([{ databaseName: 'rivet_test', schemaName: 'public', timezone: 'UTC' }]);
  });

  it('stores the minimum outbox event contract', async () => {
    const eventId = randomUUID();

    try {
      const event = await prisma.outboxEvent.create({
        data: {
          aggregateId: randomUUID(),
          aggregateType: 'ACCOUNT',
          eventType: 'ACCOUNT_EMAIL_REQUESTED',
          id: eventId,
          payload: { schemaVersion: 1, tokenId: randomUUID() },
        },
      });

      expect(event).toMatchObject({
        attemptCount: 0,
        eventType: 'ACCOUNT_EMAIL_REQUESTED',
        nextAttemptAt: null,
        payload: { schemaVersion: 1 },
      });
      expect(Math.abs(Date.now() - event.createdAt.getTime())).toBeLessThan(5_000);
    } finally {
      await prisma.outboxEvent.deleteMany({ where: { id: eventId } });
    }
  });

  it('requires an integer schemaVersion in every outbox payload', async () => {
    const missingVersionEventId = randomUUID();
    const fractionalVersionEventId = randomUUID();

    try {
      await expect(
        prisma.outboxEvent.create({
          data: {
            aggregateId: randomUUID(),
            aggregateType: 'ACCOUNT',
            eventType: 'ACCOUNT_EMAIL_REQUESTED',
            id: missingVersionEventId,
            payload: { tokenId: randomUUID() },
          },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.outboxEvent.create({
          data: {
            aggregateId: randomUUID(),
            aggregateType: 'ACCOUNT',
            eventType: 'ACCOUNT_EMAIL_REQUESTED',
            id: fractionalVersionEventId,
            payload: { schemaVersion: 1.5, tokenId: randomUUID() },
          },
        }),
      ).rejects.toThrow();
    } finally {
      await prisma.outboxEvent.deleteMany({
        where: { id: { in: [missingVersionEventId, fractionalVersionEventId] } },
      });
    }
  });
});
