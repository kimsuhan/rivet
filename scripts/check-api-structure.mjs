import { readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API_MODULES_ROOT = join(REPOSITORY_ROOT, 'apps/api/src/modules');
const FORBIDDEN_DIRECTORY_NAMES = new Set([
  '__test__',
  '__tests__',
  'helper',
  'helpers',
  'interface',
  'interfaces',
  'type',
  'types',
  'util',
  'utils',
]);
const MODULE_FILE_ROLE_SUFFIXES = [
  '.context.ts',
  '.controller.ts',
  '.crypto.ts',
  '.cursor.ts',
  '.decorator.ts',
  '.errors.ts',
  '.guard.ts',
  '.interceptor.ts',
  '.mapper.ts',
  '.module.ts',
  '.parser.ts',
  '.policy.ts',
  '.repository.ts',
  '.service.ts',
  '.signal.ts',
];

async function walk(directory, visit) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    visit(path, entry);
    if (entry.isDirectory()) {
      await walk(path, visit);
    }
  }
}

export async function findApiStructureViolations(rootDirectory = API_MODULES_ROOT) {
  const violations = [];

  await walk(rootDirectory, (path, entry) => {
    const pathFromRoot = relative(rootDirectory, path);
    const segments = pathFromRoot.split(sep);

    if (entry.isDirectory() && FORBIDDEN_DIRECTORY_NAMES.has(entry.name)) {
      violations.push({
        path: pathFromRoot,
        reason: `범용 또는 분리 테스트 폴더 '${entry.name}'는 사용할 수 없습니다.`,
      });
      return;
    }

    if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) {
      return;
    }

    if (
      segments.length === 2 &&
      !MODULE_FILE_ROLE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))
    ) {
      violations.push({
        path: pathFromRoot,
        reason: '모듈 루트 파일은 <대상>.<역할>.ts 형식이어야 합니다.',
      });
    }

    if (segments.length === 3 && segments[1] === 'dto' && !entry.name.endsWith('.dto.ts')) {
      violations.push({
        path: pathFromRoot,
        reason: 'dto 폴더의 파일은 .dto.ts 접미사를 사용해야 합니다.',
      });
    }
  });

  return violations.sort((left, right) => left.path.localeCompare(right.path));
}

export async function runApiStructureCheck({ error = console.error, log = console.log } = {}) {
  const violations = await findApiStructureViolations();
  if (violations.length === 0) {
    log('API 구조 검사 통과');
    return 0;
  }

  error(
    ['API 구조 검사 실패', ...violations.map(({ path, reason }) => `- ${path}: ${reason}`)].join(
      '\n',
    ),
  );
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await runApiStructureCheck();
}
