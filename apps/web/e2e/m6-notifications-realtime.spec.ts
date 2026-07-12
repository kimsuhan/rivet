import { randomUUID } from 'node:crypto';

import { type BrowserContext, expect, type Page, type Route, test } from '@playwright/test';

import type {
  AuthenticatedSessionDto,
  CommentResourceResponseDto,
  CreateIssueResponseDto,
  IssueDetailResponseDto,
  NotificationReadAllResponseDto,
  NotificationUnreadCountResponseDto,
  TeamListResponseDto,
  TeamResponseDto,
  WorkflowStateListResponseDto,
} from '@rivet/api-client';

import {
  cleanupM2Users,
  clearM1RateLimits,
  getLatestM1Token,
  getLatestWorkspaceInvitationToken,
} from '../../../scripts/e2e/m1-auth-fixture';

async function apiRequest<T>(
  page: Page,
  path: string,
  options: { body?: unknown; method?: 'GET' | 'PATCH' | 'POST' | 'PUT' } = {},
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

async function signUpVerifyAndLogin(
  page: Page,
  input: { displayName: string; email: string; password: string },
): Promise<void> {
  await page.goto('/signup');
  await page.getByLabel('표시 이름').fill(input.displayName);
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
  await expect(page.getByLabel('워크스페이스 이름')).toBeVisible();
}

async function completeAdminOnboarding(
  page: Page,
  input: { email: string; password: string; slug: string },
): Promise<void> {
  await signUpVerifyAndLogin(page, {
    displayName: 'M6 알림 관리자',
    email: input.email,
    password: input.password,
  });
  await page.getByLabel('워크스페이스 이름').fill('M6 알림 워크스페이스');
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

async function unreadCount(page: Page): Promise<number> {
  return (await apiRequest<NotificationUnreadCountResponseDto>(page, '/notifications/unread-count'))
    .count;
}

test('E06 알림 앵커와 E08 다중 브라우저 SSE 수렴을 검증한다', async ({
  browser,
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-chromium',
    '핵심 다중 브라우저 흐름은 데스크톱에서 검증합니다.',
  );
  test.setTimeout(240_000);
  page.setDefaultTimeout(15_000);

  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const adminEmail = `m6.notifications.admin.${runId}@example.com`;
  const recipientEmail = `m6.notifications.recipient.${runId}@example.com`;
  const password = `M6 알림 브라우저 검증 비밀번호! ${runId}`;
  const initialTitle = `M6 다중 브라우저 ${runId}`;
  let recipientContext: BrowserContext | undefined;

  await clearM1RateLimits();

  try {
    await completeAdminOnboarding(page, {
      email: adminEmail,
      password,
      slug: `m6-notifications-${runId}`,
    });

    await apiRequest(page, '/invitations', {
      body: { emails: [recipientEmail] },
      method: 'POST',
    });
    const invitationToken = await getLatestWorkspaceInvitationToken(recipientEmail);

    recipientContext = await browser.newContext({
      baseURL: 'http://127.0.0.1:3000',
      viewport: { height: 800, width: 1280 },
    });
    const recipientPage = await recipientContext.newPage();
    await signUpVerifyAndLogin(recipientPage, {
      displayName: 'M6 알림 수신자',
      email: recipientEmail,
      password,
    });
    await apiRequest(recipientPage, '/auth/invitations/accept', {
      body: { token: invitationToken },
      method: 'POST',
    });
    await recipientPage.goto('/my-issues');
    await expect(recipientPage.getByRole('heading', { name: '내 이슈' })).toBeVisible();

    const [adminSession, recipientSession, teams] = await Promise.all([
      apiRequest<AuthenticatedSessionDto>(page, '/auth/session'),
      apiRequest<AuthenticatedSessionDto>(recipientPage, '/auth/session'),
      apiRequest<TeamListResponseDto>(page, '/teams?includeArchived=false'),
    ]);
    const team = teams.items.find((item) => item.key === 'WEB');
    if (!adminSession.membership || !recipientSession.membership || !team) {
      throw new Error('M6 E2E 관리자, 수신자와 팀을 준비하지 못했습니다.');
    }

    await apiRequest<TeamResponseDto>(
      page,
      `/teams/${encodeURIComponent(team.id)}/members/${encodeURIComponent(recipientSession.membership.id)}`,
      { method: 'PUT' },
    );
    const states = await apiRequest<WorkflowStateListResponseDto>(
      page,
      `/teams/${encodeURIComponent(team.id)}/workflow-states`,
    );
    const defaultState = states.items.find((state) => state.isDefault);
    if (!defaultState) throw new Error('M6 E2E 기본 상태를 찾지 못했습니다.');

    const issue = (
      await apiRequest<CreateIssueResponseDto>(page, '/issues', {
        body: {
          assigneeMembershipId: recipientSession.membership.id,
          priority: 'HIGH',
          teamId: team.id,
          title: initialTitle,
          type: 'TEAM_TASK',
          workflowStateId: defaultState.id,
        },
        method: 'POST',
      })
    ).issue;

    await expect(recipientPage.getByRole('link', { exact: true, name: initialTitle })).toBeVisible({
      timeout: 20_000,
    });
    await expect.poll(() => unreadCount(recipientPage), { timeout: 20_000 }).toBe(1);
    await expect(
      recipientPage.getByRole('link', { name: '알림함, 읽지 않은 알림 1개' }),
    ).toBeVisible();

    await apiRequest<NotificationReadAllResponseDto>(recipientPage, '/notifications/read-all', {
      method: 'POST',
    });
    await expect.poll(() => unreadCount(recipientPage), { timeout: 10_000 }).toBe(0);

    const comment = await apiRequest<CommentResourceResponseDto>(
      page,
      `/issues/${encodeURIComponent(issue.id)}/comments`,
      {
        body: {
          bodyMarkdown: `@[M6 알림 수신자](rivet-member:${recipientSession.membership.id}) 확인을 부탁합니다.`,
        },
        method: 'POST',
      },
    );

    await expect.poll(() => unreadCount(recipientPage), { timeout: 20_000 }).toBe(1);
    await recipientPage.getByRole('link', { name: '알림함, 읽지 않은 알림 1개' }).click();
    await expect(recipientPage.getByRole('heading', { name: '알림함' })).toBeVisible();
    const mentionNotification = recipientPage.getByRole('button', {
      name: `${issue.identifier} ${initialTitle} 알림 열기`,
    });
    await expect(mentionNotification).toContainText('멘션');
    await mentionNotification.click();
    await expect(recipientPage).toHaveURL(
      new RegExp(`/issues/${issue.identifier}\\?tab=work#comment-${comment.id}$`),
    );
    await expect(recipientPage.getByRole('tab', { name: '업무' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(recipientPage.locator(`#comment-${comment.id}`)).toBeVisible();
    await expect.poll(() => unreadCount(recipientPage), { timeout: 10_000 }).toBe(0);

    const eventsPattern = '**/api/v1/events';
    const abortEvents = (route: Route) => route.abort('failed');
    await recipientPage.route(eventsPattern, abortEvents);
    await recipientPage.goto('/my-issues');
    const disconnected = recipientPage
      .getByRole('status')
      .filter({ hasText: '실시간 연결이 끊겼습니다' });
    await expect(disconnected).toBeVisible();
    await expect(
      recipientPage.getByRole('link', { exact: true, name: initialTitle }),
    ).toBeVisible();

    const currentIssue = await apiRequest<IssueDetailResponseDto>(page, `/issues/${issue.id}`);
    const convergedTitle = `M6 REST 수렴 ${runId}`;
    await apiRequest<IssueDetailResponseDto>(page, `/issues/${issue.id}`, {
      body: { title: convergedTitle, version: currentIssue.version },
      method: 'PATCH',
    });
    await expect(
      recipientPage.getByRole('link', { exact: true, name: convergedTitle }),
    ).toHaveCount(0);

    await recipientPage.unroute(eventsPattern, abortEvents);
    await expect(disconnected).toBeHidden({ timeout: 20_000 });
    await expect(
      recipientPage.getByRole('link', { exact: true, name: convergedTitle }),
    ).toBeVisible({
      timeout: 20_000,
    });
  } finally {
    await recipientContext?.close();
    await cleanupM2Users([adminEmail, recipientEmail]);
    await clearM1RateLimits();
  }
});
