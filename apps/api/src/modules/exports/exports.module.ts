import { Module } from '@nestjs/common';

import { AdminGuard } from '../../common/guards/admin.guard';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';

@Module({ controllers: [ExportsController], providers: [AdminGuard, ExportsService] })
export class ExportsModule {}
