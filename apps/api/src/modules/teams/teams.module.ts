import { Module } from '@nestjs/common';

import { AdminGuard } from '../../common/guards/admin.guard';
import { TeamRepository } from './team.repository';
import { TeamQueryService } from './team-query.service';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';
import { WorkflowStatesService } from './workflow-states.service';

@Module({
  controllers: [TeamsController],
  providers: [
    AdminGuard,
    TeamQueryService,
    TeamRepository,
    TeamsService,
    WorkflowStatesService,
  ],
})
export class TeamsModule {}
