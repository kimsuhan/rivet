import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type {
  AuthenticatedRequestContext,
  RequestWithAuthentication,
} from './authentication.context';

export const CurrentAuthentication = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedRequestContext => {
    const authentication = context
      .switchToHttp()
      .getRequest<RequestWithAuthentication>().authentication;

    if (!authentication) {
      throw new Error('인증 요청 컨텍스트가 없습니다.');
    }

    return authentication;
  },
);
