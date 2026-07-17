import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Reflector } from '@nestjs/core';

import { ApiError } from '../../common/errors/api-error';
import { apiConfig } from '../../config/api.config';
import { verifyCsrfToken } from './auth-token.crypto';
import type { RequestWithAuthentication } from './authentication.context';
import { IS_PUBLIC_ENDPOINT } from './public.decorator';

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(apiConfig.KEY) private readonly config: ConfigType<typeof apiConfig>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithAuthentication>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ENDPOINT, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic || ['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      return true;
    }

    const csrfToken = request.get('x-csrf-token');
    const authentication = request.authentication;

    if (
      authentication &&
      csrfToken &&
      verifyCsrfToken(authentication.sessionToken, csrfToken, this.config.security.csrfHmacKey)
    ) {
      return true;
    }

    throw new ApiError({
      code: 'CSRF_INVALID',
      message: '보안 토큰을 확인할 수 없습니다.',
      status: HttpStatus.FORBIDDEN,
    });
  }
}
