import { unlink } from 'node:fs/promises';

import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { catchError, from, mergeMap, type Observable, of, throwError } from 'rxjs';

import type { UploadedTemporaryFile } from './files.service';

@Injectable()
export class UploadedFileCleanupInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request & { file?: UploadedTemporaryFile }>();

    return next.handle().pipe(
      catchError((error: unknown) =>
        request.file
          ? from(unlink(request.file.path)).pipe(
              catchError(() => of(undefined)),
              mergeMap(() => throwError(() => error)),
            )
          : throwError(() => error),
      ),
    );
  }
}
