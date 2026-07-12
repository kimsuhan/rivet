import { randomUUID } from 'node:crypto';

import { type Download, expect, type Page, test } from '@playwright/test';

import type {
  AuthenticatedSessionDto,
  IssueDetailResponseDto,
  TeamListResponseDto,
  WorkflowStateListResponseDto,
} from '@rivet/api-client';

import {
  cleanupM2Users,
  clearM1RateLimits,
  getLatestM1Token,
} from '../../../scripts/e2e/m1-auth-fixture';

async function apiRequest<T>(
  page: Page,
  path: string,
  options: { body?: unknown; method?: 'GET' | 'POST' } = {},
): Promise<T> {
  const result = await page.evaluate(
    async ({ body, method, path }): Promise<{ body: unknown; status: number }> => {
      const headers = new Headers({ Accept: 'application/json' });
      if (body !== null) headers.set('Content-Type', 'application/json');

      const csrfToken = window.sessionStorage.getItem('rivet.csrf-token');
      if (method !== 'GET' && csrfToken) headers.set('X-CSRF-Token', csrfToken);

      const response = await fetch(`/api/v1${path}`, {
        ...(body === null ? {} : { body: JSON.stringify(body) }),
        credentials: 'include',
        headers,
        method,
      });
      const responseBody: unknown = await response.json();
      return { body: responseBody, status: response.status };
    },
    {
      body: options.body ?? null,
      method: options.method ?? 'GET',
      path,
    },
  );

  expect(result.status, JSON.stringify(result.body)).toBeGreaterThanOrEqual(200);
  expect(result.status, JSON.stringify(result.body)).toBeLessThan(300);
  return result.body as T;
}

async function completeOnboarding(
  page: Page,
  input: { email: string; password: string; slug: string },
): Promise<void> {
  await page.goto('/signup');
  await page.getByLabel('표시 이름').fill('M7 브라우저 사용자');
  await page.getByLabel('이메일').fill(input.email);
  await page.getByLabel('비밀번호', { exact: true }).fill(input.password);
  await page.getByLabel('비밀번호 확인').fill(input.password);
  await page.getByRole('button', { name: '가입하기' }).click();
  await expect(page.getByRole('heading', { name: '요청을 접수했습니다' })).toBeVisible();

  const verificationToken = await getLatestM1Token(input.email, 'EMAIL_VERIFICATION');
  await page.goto(`/verify-email#token=${encodeURIComponent(verificationToken)}`);
  await expect(page.getByRole('heading', { name: '이메일 인증을 마쳤습니다' })).toBeVisible();
  await page.getByRole('link', { name: '로그인' }).click();
  await page.getByLabel('이메일').fill(input.email);
  await page.getByLabel('비밀번호', { exact: true }).fill(input.password);
  await page.getByRole('button', { name: '로그인', exact: true }).click();

  await expect(page).toHaveURL(/\/onboarding\/workspace$/);
  await page.getByLabel('워크스페이스 이름').fill('M7 브라우저 워크스페이스');
  await page.getByLabel('슬러그').fill(input.slug);
  await page.getByRole('button', { name: '워크스페이스 만들기' }).click();
  await expect(page).toHaveURL(/\/onboarding\/team$/);
  await page.getByLabel('팀 이름').fill('웹');
  await page.getByLabel('팀 키').fill('WEB');
  await page.getByRole('button', { name: '팀 만들기' }).click();
  await expect(page).toHaveURL(/\/onboarding\/invite$/);
  await page.getByRole('button', { name: '건너뛰기' }).click();
  await expect(page).toHaveURL(/\/my-issues$/);
}

async function downloadText(download: Download): Promise<string> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('utf8');
}

test('M7 관리자 삭제·복구와 CSV 내보내기 안전 경계를 검증한다', async ({ page, isMobile }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);

  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const email = `m7.browser.${runId}@example.com`;
  const password = `M7 브라우저 검증 전용 비밀번호! ${runId}`;
  const title = `M7 삭제 복구 내보내기 ${runId}`;

  await clearM1RateLimits();

  try {
    await completeOnboarding(page, { email, password, slug: `m7-${runId}` });

    if (isMobile) {
      await page.goto('/settings/trash');
      await expect(
        page.getByRole('heading', { name: '설정은 데스크톱에서 사용할 수 있습니다' }),
      ).toBeVisible();
      await expect(page.getByRole('link', { name: '내 이슈로 돌아가기' })).toBeVisible();
      return;
    }

    const [session, teams] = await Promise.all([
      apiRequest<AuthenticatedSessionDto>(page, '/auth/session'),
      apiRequest<TeamListResponseDto>(page, '/teams?includeArchived=false'),
    ]);
    const team = teams.items.find((item) => item.key === 'WEB');
    if (!session.membership || !team) throw new Error('M7 E2E 사용자와 팀을 준비하지 못했습니다.');

    const states = await apiRequest<WorkflowStateListResponseDto>(
      page,
      `/teams/${encodeURIComponent(team.id)}/workflow-states`,
    );
    const defaultState = states.items.find((state) => state.isDefault);
    if (!defaultState) throw new Error('M7 E2E 기본 상태를 찾지 못했습니다.');

    const issue = await apiRequest<IssueDetailResponseDto>(page, '/issues', {
      body: {
        assigneeMembershipId: session.membership.id,
        descriptionMarkdown: `M7 데이터 안전 검증 ${runId}`,
        priority: 'MEDIUM',
        teamId: team.id,
        title,
        type: 'TEAM_TASK',
        workflowStateId: defaultState.id,
      },
      method: 'POST',
    });

    await page.goto(`/issues/${issue.identifier}`);
    await expect(page.getByLabel('이슈 제목')).toHaveValue(title);
    await page.getByRole('button', { name: '휴지통으로 이동', exact: true }).click();

    const trashDialog = page.getByRole('alertdialog', {
      name: '이슈를 휴지통으로 이동할까요?',
    });
    await expect(trashDialog).toContainText('30일 동안 관리자가 휴지통에서 복구할 수 있습니다');
    await trashDialog.getByRole('button', { name: '이슈를 휴지통으로 이동' }).click();
    await expect(page).toHaveURL(/\/my-issues$/);

    await page.goto('/settings/trash');
    await expect(page.getByRole('heading', { name: '휴지통' })).toBeVisible();
    const trashRow = page.locator('li').filter({ hasText: title });
    await expect(trashRow).toHaveCount(1);
    await trashRow.getByRole('button', { name: `${title} 복구` }).click();

    const restoreDialog = page.getByRole('alertdialog', { name: `${title}을 복구할까요?` });
    await restoreDialog.getByRole('button', { name: '항목 복구' }).click();
    await expect(page.getByText(`${title}을 복구했습니다`)).toBeVisible();

    const restoredIssue = await apiRequest<IssueDetailResponseDto>(
      page,
      `/issues/${encodeURIComponent(issue.identifier)}`,
    );
    expect(restoredIssue.title).toBe(title);

    await page.getByRole('link', { name: '데이터 내보내기' }).click();
    await expect(page).toHaveURL(/\/settings\/export$/);
    await expect(page.getByRole('heading', { name: '데이터 내보내기' })).toBeVisible();
    const issuesCard = page.locator('[data-slot="card"]').filter({
      has: page.locator('[data-slot="card-title"]', { hasText: '이슈 CSV' }),
    });
    const exportLink = issuesCard.locator('a[href="/api/v1/exports/issues.csv"]');
    await expect(exportLink).toHaveAccessibleName('내보내기');
    await expect(exportLink).not.toHaveAttribute('aria-disabled', 'true');
    const downloadPromise = page.waitForEvent('download');
    await exportLink.click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^rivet-issues-\d{8}\.csv$/);
    const csv = await downloadText(download);
    expect(csv.startsWith('\uFEFF"유형","상위 이슈","표시 ID"')).toBe(true);
    expect(csv).toContain(title);
  } finally {
    await cleanupM2Users([email]);
    await clearM1RateLimits();
  }
});
