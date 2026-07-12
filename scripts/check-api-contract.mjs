import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contractPaths = [
  resolve(rootDirectory, 'apps/api/openapi/openapi.json'),
  resolve(rootDirectory, 'packages/api-client/src/generated'),
];

async function collectFiles(path) {
  const metadata = await stat(path, { throwIfNoEntry: false });

  if (!metadata) {
    return [];
  }

  if (metadata.isFile()) {
    return [path];
  }

  const entries = await readdir(path, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map((entry) => collectFiles(resolve(path, entry.name))),
  );
  return nestedFiles.flat();
}

async function snapshot() {
  const files = (await Promise.all(contractPaths.map(collectFiles))).flat().sort();
  const entries = await Promise.all(
    files.map(async (file) => [
      relative(rootDirectory, file),
      createHash('sha256')
        .update(await readFile(file))
        .digest('hex'),
    ]),
  );
  return JSON.stringify(entries);
}

const before = await snapshot();
const packageManager = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const generation = spawnSync(packageManager, ['api:contract:generate'], {
  cwd: rootDirectory,
  env: process.env,
  stdio: 'inherit',
});

if (generation.status !== 0) {
  process.exit(generation.status ?? 1);
}

const after = await snapshot();

if (before !== after) {
  console.error('OpenAPI 또는 생성 API 클라이언트가 최신 상태가 아닙니다.');
  process.exit(1);
}
