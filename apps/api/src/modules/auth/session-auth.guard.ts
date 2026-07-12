import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Reflector } from '@nestjs/core';

import { readSessionCookie } from '../../common/auth/session-cookie';
import { ApiError } from '../../common/errors/api-error';
import { apiConfig } from '../../config/api.config';
import { AuthSessionService } from './auth-session.service';
import type { RequestWithAuthentication } from './authenticated-request';
import { IS_PUBLIC_ENDPOINT } from './public.decorator';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: AuthSessionService,
    @Inject(apiConfig.KEY) private readonly config: ConfigType<typeof apiConfig>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ENDPOINT, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithAuthentication>();
    const sessionToken = readSessionCookie(request, this.config);

    if (!sessionToken) {
      this.throwSessionRequired();
    }

    const session = await this.sessions.resolve(sessionToken);

    if (!session) {
      this.throwSessionRequired();
    }

    if (!session.user.emailVerifiedAt) {
      throw new ApiError({
        code: 'EMAIL_NOT_VERIFIED',
        message: '이메일 인증이 필요합니다.',
        status: HttpStatus.FORBIDDEN,
      });
    }

    if (session.membership?.status === 'INACTIVE') {
      throw new ApiError({
        code: 'MEMBERSHIP_INACTIVE',
        message: '비활성화된 멤버십입니다. 워크스페이스 관리자에게 문의해 주세요.',
        status: HttpStatus.FORBIDDEN,
      });
    }

    request.authentication = { session, sessionToken };
    return true;
  }

  private throwSessionRequired(): never {
    throw new ApiError({
      code: 'SESSION_REQUIRED',
      message: '로그인이 필요합니다.',
      status: HttpStatus.UNAUTHORIZED,
    });
  }
}
