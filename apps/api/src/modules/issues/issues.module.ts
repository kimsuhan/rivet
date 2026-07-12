import { Module } from '@nestjs/common';

import { IssueCollaborationModule } from '../collaboration/issue-collaboration.module';
import { FilesModule } from '../files/files.module';
import { IssuesController } from './issues.controller';
import { IssuesService } from './issues.service';

@Module({
  controllers: [IssuesController],
  imports: [FilesModule, IssueCollaborationModule],
  providers: [IssuesService],
})
export class IssuesModule {}
