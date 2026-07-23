import { Module } from '@nestjs/common';

import { IssueCollaborationModule } from '../collaboration/issue-collaboration.module';
import { FilesModule } from '../files/files.module';
import { IssueTemplatesModule } from '../issue-templates/issue-templates.module';
import { DeploymentsController } from './deployments.controller';
import { DeploymentsService } from './deployments.service';
import { IssueRepository } from './issue.repository';
import { IssueAssignmentService } from './issue-assignment.service';
import { IssueListRepository } from './issue-list.repository';
import { IssueQueryService } from './issue-query.service';
import { IssueStatusService } from './issue-status.service';
import { IssuesController } from './issues.controller';
import { IssuesService } from './issues.service';
import { TeamWorkQueryService } from './team-work-query.service';
import { TeamWorksController } from './team-works.controller';
import { TeamWorksService } from './team-works.service';

@Module({
  controllers: [DeploymentsController, IssuesController, TeamWorksController],
  imports: [FilesModule, IssueCollaborationModule, IssueTemplatesModule],
  providers: [
    DeploymentsService,
    IssueAssignmentService,
    IssueListRepository,
    IssueQueryService,
    IssueRepository,
    IssueStatusService,
    IssuesService,
    TeamWorkQueryService,
    TeamWorksService,
  ],
  exports: [IssueQueryService],
})
export class IssuesModule {}
