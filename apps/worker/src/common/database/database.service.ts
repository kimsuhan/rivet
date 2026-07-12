import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { createPrismaClient, type PrismaClient } from '@rivet/database';

import { workerConfig } from '../../config/worker.config';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(@Inject(workerConfig.KEY) config: ConfigType<typeof workerConfig>) {
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
}
