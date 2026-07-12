import { Module } from '@nestjs/common';

import { FilesModule } from '../files/files.module';
import {
  CommentsController,
  IssueBlockRelationsController,
  IssueCollaborationController,
} from './issue-collaboration.controller';
import { IssueCollaborationService } from './issue-collaboration.service';

@Module({
  controllers: [CommentsController, IssueBlockRelationsController, IssueCollaborationController],
  exports: [IssueCollaborationService],
  imports: [FilesModule],
  providers: [IssueCollaborationService],
})
export class IssueCollaborationModule {}
