import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';

import type { RequestWithAuthentication } from '../../modules/auth/authenticated-request';
import { ApiError } from '../errors/api-error';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { membership, workspace } = context.switchToHttp().getRequest<RequestWithAuthentication>()
      .authentication?.session ?? {
      membership: null,
      workspace: null,
    };

    if (
      membership?.role === 'ADMIN' &&
      membership.status === 'ACTIVE' &&
      workspace &&
      membership.workspaceId === workspace.id
    ) {
      return true;
    }

    throw new ApiError({
      code: 'FORBIDDEN',
      message: '이 작업을 수행할 권한이 없습니다.',
      status: HttpStatus.FORBIDDEN,
    });
  }
}
