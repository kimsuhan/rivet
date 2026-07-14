import { Module } from '@nestjs/common';

import { IssueCollaborationModule } from '../collaboration/issue-collaboration.module';
import { FilesModule } from '../files/files.module';
import { IssuesController } from './issues.controller';
import { IssuesService } from './issues.service';
import { TeamWorksController } from './team-works.controller';
import { TeamWorksService } from './team-works.service';

@Module({
  controllers: [IssuesController, TeamWorksController],
  imports: [FilesModule, IssueCollaborationModule],
  providers: [IssuesService, TeamWorksService],
  exports: [IssuesService],
})
export class IssuesModule {}
