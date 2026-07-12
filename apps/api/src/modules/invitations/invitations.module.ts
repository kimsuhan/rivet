import { Module } from '@nestjs/common';

import { AdminGuard } from '../../common/guards/admin.guard';
import { AuthModule } from '../auth/auth.module';
import { InvitationAuthController, InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';

@Module({
  controllers: [InvitationAuthController, InvitationsController],
  imports: [AuthModule],
  providers: [AdminGuard, InvitationsService],
})
export class InvitationsModule {}
