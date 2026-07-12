import { join } from 'node:path';

import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';

import { apiConfig } from '../../config/api.config';
import { AvatarController, FilesController, IssueAttachmentsController } from './files.controller';
import { FilesService } from './files.service';
import { UploadedFileCleanupInterceptor } from './uploaded-file-cleanup.interceptor';

@Module({
  controllers: [AvatarController, FilesController, IssueAttachmentsController],
  exports: [FilesService],
  imports: [
    MulterModule.registerAsync({
      inject: [apiConfig.KEY],
      useFactory: (config: ConfigType<typeof apiConfig>) => ({
        dest: join(config.fileStorageRoot, 'tmp'),
        limits: { fields: 1, files: 1, fileSize: 26_214_401, parts: 3 },
      }),
    }),
  ],
  providers: [FilesService, UploadedFileCleanupInterceptor],
})
export class FilesModule {}
