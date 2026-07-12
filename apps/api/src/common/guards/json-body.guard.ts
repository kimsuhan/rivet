import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { ApiError } from '../errors/api-error';

export const ALLOW_MULTIPART = 'rivet:allow-multipart';

@Injectable()
export class JsonBodyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      return true;
    }

    const mediaType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
    const hasBody =
      request.headers['transfer-encoding'] !== undefined ||
      (request.headers['content-length'] !== undefined &&
        request.headers['content-length'] !== '0');
    const allowsMultipart = this.reflector.getAllAndOverride<boolean>(ALLOW_MULTIPART, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (
      !hasBody ||
      mediaType === 'application/json' ||
      (allowsMultipart && mediaType === 'multipart/form-data')
    ) {
      return true;
    }

    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'JSON 요청 형식을 사용해 주세요.',
      status: HttpStatus.BAD_REQUEST,
    });
  }
}
