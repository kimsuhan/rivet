import { type INestApplication, ValidationPipe } from '@nestjs/common';

import { ApiExceptionFilter } from './common/errors/api-exception.filter';
import { createValidationException } from './common/validation/validation-exception';

export const API_GLOBAL_PREFIX = 'api/v1';

export function configureApplication(app: INestApplication): void {
  app.setGlobalPrefix(API_GLOBAL_PREFIX);
  app.useGlobalFilters(app.get(ApiExceptionFilter));
  app.useGlobalPipes(
    new ValidationPipe({
      exceptionFactory: createValidationException,
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  app.enableShutdownHooks();
}
