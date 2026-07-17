import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { findApiStructureViolations } from './check-api-structure.mjs';

async function withModules(files, operation) {
  const root = await mkdtemp(join(tmpdir(), 'rivet-api-structure-'));
  try {
    for (const file of files) {
      const path = join(root, file);
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, 'export {};\n');
    }
    return await operation(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

test('역할 접미사, dto, domain과 colocated spec을 허용한다', async () => {
  await withModules(
    [
      'projects/projects.controller.ts',
      'projects/projects.module.ts',
      'projects/projects.service.ts',
      'projects/project.repository.ts',
      'projects/project-response.mapper.ts',
      'projects/projects.service.spec.ts',
      'projects/dto/project-response.dto.ts',
      'projects/domain/project-role.ts',
    ],
    async (root) => {
      assert.deepEqual(await findApiStructureViolations(root), []);
    },
  );
});

test('범용 폴더, __test__와 역할 없는 모듈 루트 파일을 거부한다', async () => {
  await withModules(
    [
      'auth/password.ts',
      'auth/helpers/password.ts',
      'auth/__test__/password.spec.ts',
      'auth/dto/password.ts',
    ],
    async (root) => {
      assert.deepEqual(await findApiStructureViolations(root), [
        {
          path: 'auth/__test__',
          reason: "범용 또는 분리 테스트 폴더 '__test__'는 사용할 수 없습니다.",
        },
        {
          path: 'auth/dto/password.ts',
          reason: 'dto 폴더의 파일은 .dto.ts 접미사를 사용해야 합니다.',
        },
        {
          path: 'auth/helpers',
          reason: "범용 또는 분리 테스트 폴더 'helpers'는 사용할 수 없습니다.",
        },
        {
          path: 'auth/password.ts',
          reason: '모듈 루트 파일은 <대상>.<역할>.ts 형식이어야 합니다.',
        },
      ]);
    },
  );
});

test('현재 API 모듈이 구조 계약을 만족한다', async () => {
  assert.deepEqual(await findApiStructureViolations(), []);
});
