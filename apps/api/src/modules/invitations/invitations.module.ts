import { Module } from '@nestjs/common';

import { AdminGuard } from '../../common/guards/admin.guard';
import { AuthModule } from '../auth/auth.module';
import { InvitationRepository } from './invitation.repository';
import { InvitationContinuationService } from './invitation-continuation.service';
import { InvitationQueryService } from './invitation-query.service';
import { InvitationAuthController, InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';

@Module({
  controllers: [InvitationAuthController, InvitationsController],
  imports: [AuthModule],
  providers: [
    AdminGuard,
    InvitationContinuationService,
    InvitationQueryService,
    InvitationRepository,
    InvitationsService,
  ],
})
export class InvitationsModule {}
