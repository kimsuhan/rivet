import { Module } from '@nestjs/common';

import { AdminGuard } from '../../common/guards/admin.guard';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';

@Module({ controllers: [FeedbackController], providers: [AdminGuard, FeedbackService] })
export class FeedbackModule {}
