import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { AuthSessionService } from './auth-session.service';
import { CsrfGuard } from './csrf.guard';
import { SessionAuthGuard } from './session-auth.guard';

@Module({
  controllers: [AuthController],
  exports: [AuthRateLimitService, AuthSessionService],
  providers: [
    AuthService,
    AuthRateLimitService,
    AuthSessionService,
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
})
export class AuthModule {}
