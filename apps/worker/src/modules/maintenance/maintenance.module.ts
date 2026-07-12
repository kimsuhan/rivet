import { Module } from '@nestjs/common';

import { ObservabilityModule } from '../../common/observability/observability.module';
import { FileCleanupService } from './file-cleanup.service';
import { RetentionService } from './retention.service';

@Module({
  imports: [ObservabilityModule],
  providers: [FileCleanupService, RetentionService],
})
export class MaintenanceModule {}
