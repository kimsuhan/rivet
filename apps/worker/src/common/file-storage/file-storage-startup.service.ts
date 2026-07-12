import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, mkdir, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { workerConfig } from '../../config/worker.config';

@Injectable()
export class FileStorageStartupService implements OnModuleInit {
  constructor(@Inject(workerConfig.KEY) private readonly config: ConfigType<typeof workerConfig>) {}

  async onModuleInit(): Promise<void> {
    try {
      const root = this.config.fileStorageRoot;
      const metadata = await lstat(root);

      if (!metadata.isDirectory()) {
        throw new Error('FILE_STORAGE_ROOT_NOT_DIRECTORY');
      }

      await access(root, constants.R_OK | constants.W_OK);
      const storageDirectories = [join(root, 'objects'), join(root, 'tmp')];

      for (const directory of storageDirectories) {
        await mkdir(directory, { mode: 0o700, recursive: true });
        const directoryMetadata = await lstat(directory);

        if (!directoryMetadata.isDirectory()) {
          throw new Error('FILE_STORAGE_CHILD_NOT_DIRECTORY');
        }

        await access(directory, constants.R_OK | constants.W_OK);
      }

      const probePath = join(root, `.rivet-worker-write-probe-${process.pid}-${randomUUID()}`);
      const probe = await open(probePath, 'wx', 0o600);

      try {
        await probe.writeFile('ok');
      } finally {
        await probe.close();
        await unlink(probePath).catch(() => undefined);
      }
    } catch {
      throw new Error('파일 저장소를 읽고 쓸 수 없습니다.');
    }
  }
}
