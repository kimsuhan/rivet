import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/prisma/client';

export type DatabaseClientOptions = {
  connectionTimeoutMs: number;
  databaseUrl: string;
  idleTimeoutMs: number;
  poolMax: number;
};

export function createPrismaClient(options: DatabaseClientOptions): PrismaClient {
  // PrismaPg가 DateTime을 세션 시간대로 해석하므로 UTC 저장 계약을 연결 단계에서 고정한다.
  const adapter = new PrismaPg({
    connectionString: options.databaseUrl,
    connectionTimeoutMillis: options.connectionTimeoutMs,
    idleTimeoutMillis: options.idleTimeoutMs,
    max: options.poolMax,
    options: '-c timezone=UTC',
  });

  return new PrismaClient({ adapter });
}
