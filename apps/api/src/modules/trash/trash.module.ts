import { Module } from '@nestjs/common';

import { AdminGuard } from '../../common/guards/admin.guard';
import { TrashController } from './trash.controller';
import { TrashService } from './trash.service';

@Module({ controllers: [TrashController], providers: [AdminGuard, TrashService] })
export class TrashModule {}
