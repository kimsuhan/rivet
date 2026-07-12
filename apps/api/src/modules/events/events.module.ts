import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Client } from 'pg';

import { apiConfig } from '../../config/api.config';
import { EventsController } from './events.controller';
import {
  EventsService,
  POSTGRES_LISTENER_CLIENT_FACTORY,
  type PostgresListenerClientFactory,
} from './events.service';

@Module({
  controllers: [EventsController],
  exports: [EventsService],
  providers: [
    EventsService,
    {
      inject: [apiConfig.KEY],
      provide: POSTGRES_LISTENER_CLIENT_FACTORY,
      useFactory:
        (config: ConfigType<typeof apiConfig>): PostgresListenerClientFactory =>
        () =>
          new Client({
            connectionString: config.database.url,
            connectionTimeoutMillis: config.database.connectionTimeoutMs,
            keepAlive: true,
          }),
    },
  ],
})
export class EventsModule {}
