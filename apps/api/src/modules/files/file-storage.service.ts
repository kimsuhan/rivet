import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import { HttpStatus, Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { apiConfig } from '../../config/api.config';
import { fileError, isMissingFileError } from './file.errors';

@Injectable()
export class FileStorageService implements OnModuleInit {
  private readonly objectsRoot: string;
  private readonly storageRoot: string;
  private readonly temporaryRoot: string;

  constructor(@Inject(apiConfig.KEY) config: ConfigType<typeof apiConfig>) {
    this.storageRoot = resolve(config.fileStorageRoot);
    this.objectsRoot = resolve(this.storageRoot, 'objects');
    this.temporaryRoot = resolve(this.storageRoot, 'tmp');
  }

  async onModuleInit(): Promise<void> {
    await Promise.all([
      mkdir(this.objectsRoot, { mode: 0o700, recursive: true }),
      mkdir(this.temporaryRoot, { mode: 0o700, recursive: true }),
    ]);
  }

  resolveTemporaryPath(path: string): string {
    const temporaryPath = resolve(path);
    const pathRelativeToTemporaryRoot = relative(this.temporaryRoot, temporaryPath);
    if (
      pathRelativeToTemporaryRoot.length === 0 ||
      pathRelativeToTemporaryRoot.startsWith('..') ||
      isAbsolute(pathRelativeToTemporaryRoot)
    ) {
      throw new Error('FILE_TEMPORARY_PATH_INVALID');
    }
    return temporaryPath;
  }

  async readSignature(path: string): Promise<Buffer> {
    const handle = await open(path, 'r');
    const signature = Buffer.alloc(12);
    try {
      await handle.read(signature, 0, signature.length, 0);
    } finally {
      await handle.close();
    }
    return signature;
  }

  async persistTemporary(path: string, storageKey: string): Promise<void> {
    const finalPath = this.resolveStorageKey(storageKey);
    try {
      await rename(path, finalPath);
    } catch {
      await Promise.all([this.discardTemporary(path), unlink(finalPath).catch(() => undefined)]);
      fileError(
        'FILE_UNAVAILABLE',
        '파일 저장소를 일시적으로 사용할 수 없습니다.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  async discardTemporary(path: string): Promise<void> {
    await unlink(path).catch(() => undefined);
  }

  async delete(storageKey: string): Promise<void> {
    await unlink(this.resolveStorageKey(storageKey)).catch((error: unknown) => {
      if (!isMissingFileError(error)) throw error;
    });
  }

  async assertAvailable(storageKey: string): Promise<string> {
    let path: string;
    try {
      path = this.resolveStorageKey(storageKey);
      const metadata = await lstat(path);
      if (!metadata.isFile()) throw new Error('FILE_STORAGE_NOT_REGULAR');
    } catch {
      fileError(
        'FILE_UNAVAILABLE',
        '파일을 일시적으로 사용할 수 없습니다.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return path;
  }

  private resolveStorageKey(storageKey: string): string {
    if (
      isAbsolute(storageKey) ||
      !/^objects\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        storageKey,
      )
    ) {
      throw new Error('FILE_STORAGE_KEY_INVALID');
    }
    const path = resolve(this.storageRoot, storageKey);
    const pathRelativeToRoot = relative(this.storageRoot, path);
    if (
      pathRelativeToRoot.length === 0 ||
      pathRelativeToRoot.startsWith('..') ||
      isAbsolute(pathRelativeToRoot)
    ) {
      throw new Error('FILE_STORAGE_KEY_INVALID');
    }
    return path;
  }
}
