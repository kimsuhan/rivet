import { Module } from '@nestjs/common';

import { FileStorageStartupService } from './file-storage-startup.service';

@Module({
  providers: [FileStorageStartupService],
})
export class FileStorageModule {}
