import 'reflect-metadata';

import type { ConfigType } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { configureApplication } from './bootstrap';
import { apiConfig } from './config/api.config';
import { createOpenApiDocument, setupSwagger } from './openapi';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  configureApplication(app);

  const config = app.get<ConfigType<typeof apiConfig>>(apiConfig.KEY);

  if (config.environment === 'development') {
    setupSwagger(app, createOpenApiDocument(app));
  }

  await app.listen(config.port, '127.0.0.1');
  process.send?.('ready');
}

void bootstrap();
