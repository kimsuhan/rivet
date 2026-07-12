import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { createPrismaClient, type PrismaClient } from '@rivet/database';

import { apiConfig } from '../../config/api.config';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(@Inject(apiConfig.KEY) config: ConfigType<typeof apiConfig>) {
    this.client = createPrismaClient({
      connectionTimeoutMs: config.database.connectionTimeoutMs,
      databaseUrl: config.database.url,
      idleTimeoutMs: config.database.idleTimeoutMs,
      poolMax: config.database.poolMax,
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.$connect();
    } catch {
      throw new Error('데이터베이스 연결에 실패했습니다.');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }

  async isReady(timeoutMs = 1_000): Promise<boolean> {
    let timeout: NodeJS.Timeout | undefined;

    try {
      await Promise.race([
        this.client.$queryRaw`SELECT 1`,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error('DATABASE_READINESS_TIMEOUT')), timeoutMs);
        }),
      ]);
      return true;
    } catch {
      return false;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}
