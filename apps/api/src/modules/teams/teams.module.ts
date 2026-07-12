import { Module } from '@nestjs/common';

import { AdminGuard } from '../../common/guards/admin.guard';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';

@Module({
  controllers: [TeamsController],
  providers: [AdminGuard, TeamsService],
})
export class TeamsModule {}
