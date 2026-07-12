import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Request } from 'express';

import { apiConfig } from '../../config/api.config';
import { ApiError } from '../errors/api-error';

@Injectable()
export class OriginGuard implements CanActivate {
  constructor(
    @Inject(apiConfig.KEY)
    private readonly config: Pick<ConfigType<typeof apiConfig>, 'webOrigin'>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      return true;
    }

    const origin = request.get('origin');

    if (origin === this.config.webOrigin) {
      return true;
    }

    if (!origin) {
      const referer = request.get('referer');

      try {
        if (referer && new URL(referer).origin === this.config.webOrigin) {
          return true;
        }
      } catch {
        // 잘못된 Referer도 출처 검증 실패로 동일하게 처리한다.
      }
    }

    throw new ApiError({
      code: 'CSRF_INVALID',
      message: '요청 출처를 확인할 수 없습니다.',
      status: HttpStatus.FORBIDDEN,
    });
  }
}
