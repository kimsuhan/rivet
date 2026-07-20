import { Module } from '@nestjs/common';

import { AdminGuard } from '../../common/guards/admin.guard';
import { TeamRepository } from './team.repository';
import { TeamManagementPolicy } from './team-management.policy';
import { TeamQueryService } from './team-query.service';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';
import { WorkflowStatesService } from './workflow-states.service';

@Module({
  controllers: [TeamsController],
  exports: [TeamManagementPolicy],
  providers: [
    AdminGuard,
    TeamManagementPolicy,
    TeamQueryService,
    TeamRepository,
    TeamsService,
    WorkflowStatesService,
  ],
})
export class TeamsModule {}
