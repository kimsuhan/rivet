import { Module } from '@nestjs/common';

import { AdminGuard } from '../../common/guards/admin.guard';
import { IssueTemplatesController } from './issue-templates.controller';
import { IssueTemplatesService } from './issue-templates.service';

@Module({
  controllers: [IssueTemplatesController],
  exports: [IssueTemplatesService],
  providers: [AdminGuard, IssueTemplatesService],
})
export class IssueTemplatesModule {}
