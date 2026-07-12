import { Global, Module } from '@nestjs/common';

import { ObservabilityService } from './observability.service';

@Global()
@Module({
  exports: [ObservabilityService],
  providers: [ObservabilityService],
})
export class ObservabilityModule {}
