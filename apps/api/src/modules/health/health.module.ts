import { Module } from '@nestjs/common';

import { EventsModule } from '../events/events.module';
import { FileStorageReadinessService } from './file-storage-readiness.service';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  controllers: [HealthController],
  imports: [EventsModule],
  providers: [FileStorageReadinessService, HealthService],
})
export class HealthModule {}
