import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, open, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { apiConfig } from '../../config/api.config';

@Injectable()
export class FileStorageReadinessService implements OnModuleInit {
  constructor(@Inject(apiConfig.KEY) private readonly config: ConfigType<typeof apiConfig>) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.verify();
    } catch {
      throw new Error('파일 저장소를 읽고 쓸 수 없습니다.');
    }
  }

  async isReady(): Promise<boolean> {
    try {
      await this.verify();
      return true;
    } catch {
      return false;
    }
  }

  private async verify(): Promise<void> {
    const root = this.config.fileStorageRoot;
    const metadata = await stat(root);

    if (!metadata.isDirectory()) {
      throw new Error('FILE_STORAGE_ROOT_NOT_DIRECTORY');
    }

    await access(root, constants.R_OK | constants.W_OK);

    const probePath = join(root, `.rivet-write-probe-${process.pid}-${randomUUID()}`);
    const probe = await open(probePath, 'wx', 0o600);

    try {
      await probe.writeFile('ok');
    } finally {
      await probe.close();
      await unlink(probePath).catch(() => undefined);
    }
  }
}
