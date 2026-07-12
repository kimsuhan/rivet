import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const options = new DocumentBuilder()
    .setTitle('Rivet API')
    .setDescription('Rivet 비공개 MVP 베타 REST API')
    .setVersion('1.0')
    .addCookieAuth('__Host-rivet_session', undefined, 'sessionCookie')
    .build();

  return SwaggerModule.createDocument(app, options);
}

export function setupSwagger(app: INestApplication, document: OpenAPIObject): void {
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/openapi.json',
  });
}
