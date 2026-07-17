import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FileStorageService } from './file-storage.service';

describe('FileStorageService', () => {
  const fileId = '953685f0-4921-41cd-8422-d8a1ccc3f547';
  let root: string;
  let storage: FileStorageService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'rivet-file-storage-'));
    storage = new FileStorageService({ fileStorageRoot: root } as never);
    await storage.onModuleInit();
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it('moves a contained temporary file into object storage and reads it back', async () => {
    const temporaryPath = join(root, 'tmp', 'upload');
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await writeFile(temporaryPath, bytes);

    const containedPath = storage.resolveTemporaryPath(temporaryPath);
    await expect(storage.readSignature(containedPath)).resolves.toEqual(
      Buffer.concat([bytes, Buffer.alloc(8)]),
    );
    await storage.persistTemporary(containedPath, `objects/${fileId}`);

    const storedPath = await storage.assertAvailable(`objects/${fileId}`);
    await expect(stat(storedPath)).resolves.toMatchObject({ size: bytes.length });
    await storage.delete(`objects/${fileId}`);
    await expect(stat(storedPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects temporary paths and storage keys outside their roots', () => {
    expect(() => storage.resolveTemporaryPath(join(root, 'outside'))).toThrow(
      'FILE_TEMPORARY_PATH_INVALID',
    );
    expect(() => storage.assertAvailable('../outside')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'FILE_UNAVAILABLE' }),
    });
  });
});
