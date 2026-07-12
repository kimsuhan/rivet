import { Module } from '@nestjs/common';

import { AdminGuard } from '../../common/guards/admin.guard';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';

@Module({ controllers: [MembersController], providers: [AdminGuard, MembersService] })
export class MembersModule {}
