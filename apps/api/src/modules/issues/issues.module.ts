import { Module } from '@nestjs/common';

import { IssueCollaborationModule } from '../collaboration/issue-collaboration.module';
import { FilesModule } from '../files/files.module';
import { IssueRepository } from './issue.repository';
import { IssueAssignmentService } from './issue-assignment.service';
import { IssueQueryService } from './issue-query.service';
import { IssueStatusService } from './issue-status.service';
import { IssuesController } from './issues.controller';
import { IssuesService } from './issues.service';
import { TeamWorkQueryService } from './team-work-query.service';
import { TeamWorksController } from './team-works.controller';
import { TeamWorksService } from './team-works.service';

@Module({
  controllers: [IssuesController, TeamWorksController],
  imports: [FilesModule, IssueCollaborationModule],
  providers: [
    IssueAssignmentService,
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
