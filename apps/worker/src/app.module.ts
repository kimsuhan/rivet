import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';

import { DatabaseModule } from './common/database/database.module';
import { FileStorageModule } from './common/file-storage/file-storage.module';
import { createWorkerLoggerOptions } from './common/logging/worker-logger.options';
import { ObservabilityModule } from './common/observability/observability.module';
import { workerConfig } from './config/worker.config';
import { validateWorkerEnvironment } from './config/worker-environment';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { OutboxModule } from './modules/outbox/outbox.module';

const environmentFiles =
  process.env.NODE_ENV === 'test' ? ['../../.env.test.local'] : ['../../.env.local', '../../.env'];

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      envFilePath: environmentFiles,
      isGlobal: true,
      load: [workerConfig],
      validate: validateWorkerEnvironment,
    }),
    LoggerModule.forRootAsync({
      inject: [workerConfig.KEY],
      useFactory: createWorkerLoggerOptions,
    }),
    ObservabilityModule,
    DatabaseModule,
    FileStorageModule,
    MaintenanceModule,
    OutboxModule,
  ],
})
export class AppModule {}
