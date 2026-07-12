import { Module } from '@nestjs/common';

import { AdminGuard } from '../../common/guards/admin.guard';
import { LabelsController } from './labels.controller';
import { LabelsService } from './labels.service';

@Module({ controllers: [LabelsController], providers: [AdminGuard, LabelsService] })
export class LabelsModule {}
