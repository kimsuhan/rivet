import { Module } from '@nestjs/common';

import { FilesModule } from '../files/files.module';
import { CommentsController, IssueCollaborationController } from './issue-collaboration.controller';
import { IssueCollaborationLockService } from './issue-collaboration-lock.service';
import { IssueCommentService } from './issue-comment.service';
import { IssueHandoffService } from './issue-handoff.service';
import { IssueTimelineQueryService } from './issue-timeline-query.service';

@Module({
  controllers: [CommentsController, IssueCollaborationController],
  exports: [IssueHandoffService],
  imports: [FilesModule],
  providers: [
    IssueCollaborationLockService,
    IssueCommentService,
    IssueHandoffService,
    IssueTimelineQueryService,
  ],
})
export class IssueCollaborationModule {}
