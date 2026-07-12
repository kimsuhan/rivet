import { randomUUID } from 'node:crypto';

import { expect, type Page, type Route, test } from '@playwright/test';

import type {
  AuthenticatedSessionDto,
  CreateIssueResponseDto,
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
  await page.getByLabel('표시 이름').fill('M6 브라우저 사용자');
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
  await page.getByLabel('워크스페이스 이름').fill('M6 브라우저 워크스페이스');
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

function waitForSearch(page: Page, query: string) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.ok() &&
      url.pathname === '/api/v1/search/issues' &&
      url.searchParams.get('query') === query
    );
  });
}

test('SEARCH-01 전역 검색과 SSE 재연결 뒤 REST 수렴을 검증한다', async ({ page, isMobile }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);

  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const email = `m6.browser.${runId}@example.com`;
  const password = `M6 브라우저 검증 전용 비밀번호! ${runId}`;

  await clearM1RateLimits();

  try {
    await completeOnboarding(page, { email, password, slug: `m6-${runId}` });

    const [session, teams] = await Promise.all([
      apiRequest<AuthenticatedSessionDto>(page, '/auth/session'),
      apiRequest<TeamListResponseDto>(page, '/teams?includeArchived=false'),
    ]);
    const team = teams.items.find((item) => item.key === 'WEB');
    if (!session.membership || !team) throw new Error('M6 E2E 사용자와 팀을 준비하지 못했습니다.');

    const states = await apiRequest<WorkflowStateListResponseDto>(
      page,
      `/teams/${encodeURIComponent(team.id)}/workflow-states`,
    );
    const defaultState = states.items.find((state) => state.isDefault);
    if (!defaultState) throw new Error('M6 E2E 기본 상태를 찾지 못했습니다.');

    const exactIssue = (
      await apiRequest<CreateIssueResponseDto>(page, '/issues', {
        body: {
          assigneeMembershipId: session.membership.id,
          priority: 'MEDIUM',
          teamId: team.id,
          title: `M6 정확 ID 검색 ${runId}`,
          type: 'TEAM_TASK',
          workflowStateId: defaultState.id,
        },
        method: 'POST',
      })
    ).issue;
    const titleIssue = (
      await apiRequest<CreateIssueResponseDto>(page, '/issues', {
        body: {
          assigneeMembershipId: session.membership.id,
          priority: 'LOW',
          teamId: team.id,
          title: `${exactIssue.identifier} 후속 검색 ${runId}`,
          type: 'TEAM_TASK',
          workflowStateId: defaultState.id,
        },
        method: 'POST',
      })
    ).issue;
    expect(exactIssue.identifier).toBe('WEB-1');
    expect(titleIssue.identifier).toBe('WEB-2');

    await page.goto(`/issues/${exactIssue.identifier}`);
    const titleInput = page.getByLabel('이슈 제목');
    await titleInput.focus();
    await page.keyboard.press('Slash');
    await expect(page.getByRole('dialog', { name: '검색' })).toBeHidden();
    await page.goto('/my-issues');
    const searchTrigger = page.getByRole('button', { name: '검색 열기' });
    await expect(searchTrigger).toBeVisible();

    await page.keyboard.press('Slash');
    const searchDialog = page.getByRole('dialog', { name: '검색' });
    const searchInput = searchDialog.getByRole('combobox', { name: '검색어' });
    await expect(searchDialog).toBeVisible();
    await expect(searchInput).toBeFocused();
    await expect(searchInput).toHaveAttribute('aria-autocomplete', 'list');

    const viewport = page.viewportSize();
    const dialogBox = await searchDialog.boundingBox();
    if (!viewport || !dialogBox) throw new Error('M6 E2E 검색 레이아웃을 측정하지 못했습니다.');
    if (isMobile) {
      expect(dialogBox.x).toBeLessThanOrEqual(1);
      expect(dialogBox.y).toBeLessThanOrEqual(1);
      expect(dialogBox.width).toBeGreaterThanOrEqual(viewport.width - 1);
      expect(dialogBox.height).toBeGreaterThanOrEqual(viewport.height - 1);
    } else {
      expect(dialogBox.x).toBeGreaterThan(0);
      expect(dialogBox.y).toBeGreaterThan(0);
      expect(dialogBox.width).toBeLessThan(viewport.width);
      expect(dialogBox.height).toBeLessThan(viewport.height);
    }

    await searchInput.fill('W');
    await expect(searchDialog.getByText('두 글자 이상 입력하세요')).toBeVisible();

    const twoLetterSearch = waitForSearch(page, 'WE');
    await searchInput.fill('WE');
    await twoLetterSearch;
    await expect(searchDialog.getByRole('option')).toHaveCount(1);

    const exactSearch = waitForSearch(page, exactIssue.identifier);
    await searchInput.fill(exactIssue.identifier);
    await exactSearch;
    const options = searchDialog.getByRole('option');
    await expect(options).toHaveCount(2);
    await expect(options.nth(0)).toContainText(exactIssue.identifier);
    await expect(options.nth(0)).toContainText('ID 일치');
    await expect(options.nth(1)).toContainText(titleIssue.identifier);
    await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');

    await searchInput.press('ArrowDown');
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
    const secondOptionId = await options.nth(1).getAttribute('id');
    if (!secondOptionId) throw new Error('M6 E2E 두 번째 검색 결과 ID를 찾지 못했습니다.');
    await expect(searchInput).toHaveAttribute('aria-activedescendant', secondOptionId);
    await searchInput.press('ArrowUp');
    await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
    await searchInput.press('ArrowDown');
    await searchInput.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/issues/${titleIssue.identifier}$`));

    await expect(searchDialog).toBeHidden();
    await searchTrigger.click();
    await expect(searchDialog).toBeVisible();
    const reopenedInput = searchDialog.getByRole('combobox', {
      name: '검색어',
    });
    await expect(reopenedInput).toBeFocused();
    const missingQuery = `없는검색-${runId}`;
    const missingSearch = waitForSearch(page, missingQuery);
    await reopenedInput.fill(missingQuery);
    await missingSearch;
    await expect(
      searchDialog.getByText('조건에 맞는 이슈가 없습니다', { exact: true }),
    ).toBeVisible();
    await reopenedInput.press('Escape');

    const eventsPattern = '**/api/v1/events';
    const abortEvents = (route: Route) => route.abort('failed');
    await page.route(eventsPattern, abortEvents);
    await page.goto('/my-issues');

    const disconnected = page.getByRole('status').filter({ hasText: '실시간 연결이 끊겼습니다' });
    await expect(disconnected).toBeVisible();
    await expect(page.getByRole('link', { exact: true, name: exactIssue.title })).toBeVisible();

    const convergedTitle = `M6 재연결 수렴 ${runId}`;
    await apiRequest<CreateIssueResponseDto>(page, '/issues', {
      body: {
        assigneeMembershipId: session.membership.id,
        priority: 'HIGH',
        teamId: team.id,
        title: convergedTitle,
        type: 'TEAM_TASK',
        workflowStateId: defaultState.id,
      },
      method: 'POST',
    });
    await expect(page.getByRole('link', { exact: true, name: convergedTitle })).toHaveCount(0);

    await page.unroute(eventsPattern, abortEvents);
    await expect(disconnected).toBeHidden({ timeout: 20_000 });
    await expect(page.getByRole('link', { exact: true, name: convergedTitle })).toBeVisible({
      timeout: 20_000,
    });
  } finally {
    await cleanupM2Users([email]);
    await clearM1RateLimits();
  }
});
