import 'reflect-metadata';

import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { config as loadEnv } from 'dotenv';

async function generateOpenApi(): Promise<void> {
  loadEnv({
    path: resolve(process.cwd(), '../../.env.test.local'),
    override: true,
    quiet: true,
  });

  process.env.API_PORT = '4000';
  process.env.CSRF_HMAC_KEY = 'openapi-csrf-hmac-key-with-at-least-32-bytes';
  process.env.FILE_STORAGE_ROOT = tmpdir();
  process.env.NODE_ENV = 'test';
  process.env.ONE_TIME_TOKEN_HMAC_KEY = 'openapi-token-hmac-key-with-at-least-32-bytes';
  process.env.RATE_LIMIT_HMAC_KEY = 'openapi-rate-hmac-key-with-at-least-32-bytes';
  process.env.RELEASE_ID = 'openapi';
  process.env.WEB_ORIGIN = 'http://localhost:3000';

  const [{ NestFactory }, { AppModule }, { configureApplication }, { createOpenApiDocument }] =
    await Promise.all([
      import('@nestjs/core'),
      import('./app.module.js'),
      import('./bootstrap.js'),
      import('./openapi.js'),
    ]);
  const app = await NestFactory.create(AppModule, { logger: false });
  configureApplication(app);
  const document = createOpenApiDocument(app);
  const outputDirectory = resolve(process.cwd(), 'openapi');

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    resolve(outputDirectory, 'openapi.json'),
    `${JSON.stringify(document, null, 2)}\n`,
  );
  await app.close();
}

void generateOpenApi();
