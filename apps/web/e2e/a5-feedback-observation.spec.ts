import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import {
  cleanupM2Users,
  clearM1RateLimits,
  getLatestM1Token,
} from '../../../scripts/e2e/m1-auth-fixture';

test('A5 피드백 실패 복구·중복 방지·관리자 상태 흐름을 검증한다', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-chromium',
    'A5 관리자 흐름은 데스크톱 Chromium에서 한 번 검증합니다.',
  );
  test.setTimeout(180_000);
  page.setDefaultTimeout(20_000);

  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const email = `a5.feedback.${runId}@example.com`;
  const password = `A5 피드백 브라우저 검증 전용 비밀번호! ${runId}`;
  const body = `A5 ${runId} 검색 결과에서 작업 맥락을 파악하기 어려웠습니다.`;

  await clearM1RateLimits();
  try {
    await page.goto('/signup');
    await page.getByLabel('표시 이름').fill('A5 브라우저 사용자');
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
    await page.getByRole('button', { name: '새 워크스페이스 만들기' }).click();
    await page.getByLabel('워크스페이스 이름').fill('A5 피드백 워크스페이스');
    await page.getByLabel('슬러그').fill(`a5-feedback-${runId}`);
    await page.getByRole('button', { name: '워크스페이스 만들기' }).click();
    await page.getByLabel('팀 이름').fill('제품');
    await page.getByLabel('팀 키').fill('PROD');
    await page.getByRole('button', { name: '팀 만들기' }).click();
    await page.getByRole('button', { name: '건너뛰기' }).click();
    await expect(page).toHaveURL(/\/my-issues$/u);
    await page.goto('/my-issues?query=user%40example.com&token=secret&fileName=private.csv');

    await page.getByRole('button', { name: '피드백 보내기' }).first().click();
    const dialog = page.getByRole('dialog', { name: '제품 피드백 보내기' });
    await dialog.getByLabel('내용').fill(body);
    let failedSubmissionId: string | null = null;
    await page.route(
      '**/api/v1/feedback',
      async (route) => {
        failedSubmissionId = (route.request().postDataJSON() as { submissionId: string })
          .submissionId;
        await route.fulfill({
          body: JSON.stringify({ code: 'TEMPORARY_FAILURE' }),
          contentType: 'application/json',
          status: 503,
        });
      },
      { times: 1 },
    );
    await dialog.getByRole('button', { name: '피드백 보내기' }).click();
    await expect(dialog.getByLabel('내용')).toHaveValue(body);
    await expect(dialog.getByText('입력은 그대로 유지했습니다', { exact: false })).toBeVisible();

    const successfulRequest = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === '/api/v1/feedback' && request.method() === 'POST',
    );
    await dialog.getByRole('button', { name: '피드백 보내기' }).click();
    const submitted = (await successfulRequest).postDataJSON() as {
      currentPath: string;
      submissionId: string;
    };
    expect(submitted.submissionId).toBe(failedSubmissionId);
    expect(submitted.currentPath).toMatch(/^\/[^?#]*$/u);
    expect(submitted.currentPath).not.toContain('user@example.com');
    expect(submitted.currentPath).not.toContain('secret');
    expect(submitted.currentPath).not.toContain('private.csv');
    await expect(dialog.getByText('피드백을 접수했습니다')).toBeVisible();
    await dialog.getByRole('button', { name: '닫기', exact: true }).click();

    await page.goto('/settings/feedback');
    await expect(page.getByRole('heading', { name: '제품 피드백', exact: true })).toBeVisible();
    await expect(page.getByText(body)).toBeVisible();
    await expect(page.getByText('playwright-e2e')).toBeVisible();
    const statusSelect = page.getByLabel(/피드백 상태 필터/u).last();
    await page.route(
      '**/api/v1/feedback/*/status',
      (route) =>
        route.fulfill({
          body: JSON.stringify({ code: 'FEEDBACK_VERSION_CONFLICT', currentVersion: 2 }),
          contentType: 'application/json',
          status: 409,
        }),
      { times: 1 },
    );
    const refreshed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/feedback' &&
        response.request().method() === 'GET' &&
        response.status() === 200,
    );
    await statusSelect.click();
    await page.getByRole('option', { name: '검토 중', exact: true }).click();
    await refreshed;
    await expect(page.getByText('목록을 새로 불러온 뒤', { exact: false })).toBeVisible();
    await expect(statusSelect).toContainText('접수');

    await statusSelect.click();
    await page.getByRole('option', { name: '검토 중', exact: true }).click();
    await expect(statusSelect).toContainText('검토 중');
    await page.reload();
    await expect(page.getByText(body)).toHaveCount(1);
    await expect(page.getByLabel(/피드백 상태 필터/u).last()).toContainText('검토 중');
  } finally {
    await cleanupM2Users([email]);
    await clearM1RateLimits();
  }
});
