import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthAccountTokenService } from './auth-account-token.service';
import { AuthProfileService } from './auth-profile.service';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { AuthSessionService } from './auth-session.service';
import { CsrfGuard } from './csrf.guard';
import { SessionAuthGuard } from './session-auth.guard';

@Module({
  controllers: [AuthController],
  exports: [AuthRateLimitService, AuthSessionService],
  providers: [
    AuthAccountTokenService,
    AuthService,
    AuthProfileService,
    AuthRateLimitService,
    AuthSessionService,
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
})
export class AuthModule {}
