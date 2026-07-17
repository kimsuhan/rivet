import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import {
  cleanupM2Users,
  clearM1RateLimits,
  getLatestM1Token,
} from '../../../scripts/e2e/m1-auth-fixture';

test('A2 개인 저장된 보기를 저장하고 기본 보기로 복원한다', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-chromium',
    '저장된 보기 전체 흐름은 데스크톱 프로젝트에서 한 번 검증합니다.',
  );
  test.setTimeout(180_000);
  page.setDefaultTimeout(20_000);

  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const email = `a2.saved-view.${runId}@example.com`;
  const password = `A2 저장된 보기 브라우저 검증 전용 비밀번호! ${runId}`;
  const viewName = `긴급 작업 ${runId}`;
  const updatedQuery = '긴급 수정';

  await clearM1RateLimits();
  try {
    await page.goto('/signup');
    await page.getByLabel('표시 이름').fill('A2 브라우저 사용자');
    await page.getByLabel('이메일').fill(email);
    await page.getByLabel('비밀번호', { exact: true }).fill(password);
    await page.getByLabel('비밀번호 확인').fill(password);
    await page.getByRole('button', { name: '가입하기' }).click();
    await expect(page.getByRole('heading', { name: '이메일을 확인해 주세요' })).toBeVisible();

    const token = await getLatestM1Token(email, 'EMAIL_VERIFICATION');
    await page.goto(`/verify-email#token=${encodeURIComponent(token)}`);
    await page.getByRole('link', { name: '로그인' }).click();
    await page.getByLabel('이메일').fill(email);
    await page.getByLabel('비밀번호', { exact: true }).fill(password);
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await expect(page).toHaveURL(/\/onboarding\/workspace$/u);
    await page.getByLabel('워크스페이스 이름').fill('A2 저장된 보기 워크스페이스');
    await page.getByLabel('슬러그').fill(`a2-view-${runId}`);
    await page.getByRole('button', { name: '워크스페이스 만들기' }).click();
    await page.getByLabel('팀 이름').fill('제품');
    await page.getByLabel('팀 키').fill('PROD');
    await page.getByRole('button', { name: '팀 만들기' }).click();
    await page.getByRole('button', { name: '건너뛰기' }).click();
    await expect(page).toHaveURL(/\/my-issues$/u);

    const search = page.getByRole('textbox', { name: '내 작업 검색' });
    await search.fill('긴급');
    await search.press('Enter');
    await expect(page).toHaveURL(/query=%EA%B8%B4%EA%B8%89/u);
    await page.getByRole('button', { name: '보기 저장', exact: true }).click();
    const createDialog = page.getByRole('dialog', { name: '새 보기 만들기' });
    await createDialog.getByLabel('저장된 보기 이름').fill(viewName);
    await createDialog.getByRole('button', { name: '보기 저장', exact: true }).click();
    await expect(createDialog).toBeHidden();
    await expect(page).toHaveURL(/view=/u);

    await search.fill(updatedQuery);
    await search.press('Enter');
    await expect(page).toHaveURL(/view=/u);
    await page.getByRole('button', { name: '변경 저장' }).click();
    await expect(page.getByRole('button', { name: '변경 저장' })).toBeHidden();

    await page.getByRole('button', { name: `${viewName} 보기 관리` }).click();
    await page.getByRole('button', { name: '기본 보기로 지정' }).click();
    await page.getByRole('button', { name: `${viewName} 보기 관리` }).click();
    await expect(page.getByRole('button', { name: '기본 보기' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.getByRole('link', { name: '이슈', exact: true }).click();
    await expect(page).toHaveURL(/\/issues$/u);
    await page.getByRole('link', { name: '내 작업', exact: true }).click();
    await expect(search).toHaveValue(updatedQuery);
    await expect(page).toHaveURL(/view=/u);

    await page.getByRole('button', { name: `${viewName} 보기 관리` }).click();
    await page.getByRole('button', { name: '이름 변경' }).click();
    const renameDialog = page.getByRole('dialog', { name: '저장된 보기 이름 변경' });
    await renameDialog.getByLabel('새 저장된 보기 이름').fill(`${viewName} 수정`);
    await renameDialog.getByRole('button', { name: '변경', exact: true }).click();
    await expect(renameDialog).toBeHidden();
  } finally {
    await cleanupM2Users([email]);
    await clearM1RateLimits();
  }
});
