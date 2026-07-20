import { Module } from '@nestjs/common';

import { AdminGuard } from '../../common/guards/admin.guard';
import { AuthModule } from '../auth/auth.module';
import { TeamsModule } from '../teams/teams.module';
import { InvitationRepository } from './invitation.repository';
import { InvitationContinuationService } from './invitation-continuation.service';
import { InvitationQueryService } from './invitation-query.service';
import {
  InvitationAuthController,
  InvitationsController,
  TeamInvitationsController,
} from './invitations.controller';
import { InvitationsService } from './invitations.service';

@Module({
  controllers: [InvitationAuthController, InvitationsController, TeamInvitationsController],
  imports: [AuthModule, TeamsModule],
  providers: [
    AdminGuard,
    InvitationContinuationService,
    InvitationQueryService,
    InvitationRepository,
    InvitationsService,
  ],
})
export class InvitationsModule {}
