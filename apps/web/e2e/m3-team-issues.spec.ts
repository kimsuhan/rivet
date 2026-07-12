import { randomUUID } from 'node:crypto';

import { expect, type Locator, type Page, test } from '@playwright/test';

import type {
  AuthenticatedSessionDto,
  CreateIssueResponseDto,
  IssueDetailResponseDto,
  LabelResponseDto,
  TeamListResponseDto,
  WorkflowStateListResponseDto,
} from '@rivet/api-client';

import {
  cleanupM2Users,
  clearM1RateLimits,
  getLatestM1Token,
} from '../../../scripts/e2e/m1-auth-fixture';

async function checkLayout(page: Page, projectName: string, stage: string): Promise<void> {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);

  const screenshotPrefix = process.env.RIVET_VISUAL_QA_PREFIX;
  if (screenshotPrefix) {
    await page.screenshot({
      fullPage: true,
      path: `${screenshotPrefix}-${projectName}-m3-${stage}.png`,
    });
  }
}

async function apiRequest<T>(
  page: Page,
  path: string,
  options: { body?: unknown; method?: 'GET' | 'PATCH' | 'POST' } = {},
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
  await page.getByLabel('표시 이름').fill('M3 브라우저 사용자');
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
  await page.getByLabel('워크스페이스 이름').fill('M3 브라우저 워크스페이스');
  await page.getByLabel('슬러그').fill(input.slug);
  await page.getByRole('button', { name: '워크스페이스 만들기' }).click();
  await expect(page).toHaveURL(/\/onboarding\/team$/);
  await page.getByLabel('팀 이름').fill('웹');
  await page.getByLabel('팀 키').fill('WEB');
  await page.getByRole('button', { name: '팀 만들기' }).click();
  await expect(page).toHaveURL(/\/onboarding\/invite$/);
  await page.getByRole('button', { name: '건너뛰기' }).click();
  await expect(page).toHaveURL(/\/my-issues$/);
  await expect(page.getByRole('heading', { name: '내 이슈' })).toBeVisible();
}

async function selectOption(
  page: Page,
  triggerName: string,
  optionName: string,
  triggerRoot: Locator | Page = page,
): Promise<void> {
  await triggerRoot.getByRole('combobox', { name: triggerName, exact: true }).click();
  await page.getByRole('listbox').getByRole('option', { name: optionName, exact: true }).click();
}

test('UF-03과 UF-07 팀 이슈 기본 루프를 완료한다', async ({ page, isMobile }, testInfo) => {
  test.setTimeout(150_000);

  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const email = `m3.browser.${runId}@example.com`;
  const password = `M3 브라우저 검증 전용 비밀번호! ${runId}`;
  const title = `M3 핵심 흐름 ${runId}`;
  const updatedTitle = `${title} 수정`;

  await clearM1RateLimits();

  try {
    await completeOnboarding(page, { email, password, slug: `m3-${runId}` });

    const [session, teams] = await Promise.all([
      apiRequest<AuthenticatedSessionDto>(page, '/auth/session'),
      apiRequest<TeamListResponseDto>(page, '/teams?includeArchived=false'),
    ]);
    const team = teams.items.find((item) => item.key === 'WEB');
    expect(team).toBeDefined();
    expect(session.membership).not.toBeNull();
    if (!team || !session.membership) throw new Error('M3 E2E 팀과 멤버십을 준비하지 못했습니다.');

    const [states, label] = await Promise.all([
      apiRequest<WorkflowStateListResponseDto>(
        page,
        `/teams/${encodeURIComponent(team.id)}/workflow-states`,
      ),
      apiRequest<LabelResponseDto>(page, '/labels', {
        body: { color: '#2AA198', name: 'M3 핵심' },
        method: 'POST',
      }),
    ]);
    const defaultState = states.items.find((state) => state.isDefault);
    expect(defaultState?.name).toBe('미분류');
    if (!defaultState) throw new Error('M3 E2E 기본 상태를 찾지 못했습니다.');

    let issue: IssueDetailResponseDto;

    if (isMobile) {
      issue = (
        await apiRequest<CreateIssueResponseDto>(page, '/issues', {
          body: {
            assigneeMembershipId: session.membership.id,
            labelIds: [label.id],
            priority: 'HIGH',
            teamId: team.id,
            title,
            type: 'TEAM_TASK',
            workflowStateId: defaultState.id,
          },
          method: 'POST',
        })
      ).issue;

      await page.goto('/my-issues');
      await expect(page.getByRole('link', { name: title })).toBeVisible();
      await checkLayout(page, testInfo.project.name, 'my-issues-mobile');

      await page.getByRole('link', { name: title }).click();
      await expect(page).toHaveURL(new RegExp(`/issues/${issue.identifier}$`));
      await expect(page.getByLabel('이슈 제목')).toHaveValue(title);
      await expect(page.getByLabel('라벨')).toContainText('M3 핵심');
      await checkLayout(page, testInfo.project.name, 'detail-mobile');

      await page.goto('/my-issues?create=1');
      await expect(
        page.getByRole('heading', {
          name: '이슈 만들기는 데스크톱에서 사용할 수 있습니다',
        }),
      ).toBeVisible();
      await checkLayout(page, testInfo.project.name, 'create-guidance-mobile');
      await page.getByRole('button', { name: '이슈 만들기 닫기' }).click();

      await page.goto('/teams/WEB/board?sort=priority&direction=asc');
      await expect(
        page.getByRole('heading', { name: '팀 보드는 데스크톱에서 사용할 수 있습니다' }),
      ).toBeVisible();
      await expect(page.getByRole('link', { name: '목록으로 보기' })).toHaveAttribute(
        'href',
        /\/teams\/WEB\/issues\?sort=priority&direction=asc/,
      );
      await checkLayout(page, testInfo.project.name, 'board-guidance-mobile');
    } else {
      await page.goto('/teams/WEB/issues');
      await expect(page.getByRole('heading', { name: '웹 이슈' })).toBeVisible();
      await page.getByRole('link', { name: '팀 작업 만들기' }).first().click();

      const createDialog = page.getByRole('dialog', { name: '팀 작업 만들기' });
      await expect(createDialog).toBeVisible();
      await expect(createDialog.getByLabel('팀')).toContainText('웹');
      await expect(createDialog.getByLabel('상태')).toContainText('미분류');
      await createDialog.getByRole('textbox', { name: '제목', exact: true }).fill(title);
      await selectOption(page, '담당자', 'M3 브라우저 사용자', createDialog);
      await selectOption(page, '우선순위', '높음', createDialog);
      const labelCheckbox = createDialog.getByRole('checkbox', { name: 'M3 핵심' });
      await labelCheckbox.click();
      await expect(labelCheckbox).toBeChecked();
      await createDialog.getByRole('button', { name: '팀 작업 만들기', exact: true }).click();

      await expect(page).toHaveURL(/\/issues\/WEB-1$/);
      await expect(createDialog).toBeHidden();
      issue = await apiRequest<IssueDetailResponseDto>(page, '/issues/WEB-1');
      const properties = page.getByRole('complementary', { name: '속성' });
      await expect(page.getByLabel('이슈 제목')).toHaveValue(title);
      await expect(properties.getByText('웹 (WEB)', { exact: true })).toBeVisible();
      await expect(properties.getByLabel('우선순위')).toContainText('높음');
      await expect(properties.getByLabel('라벨')).toContainText('M3 핵심');
      await checkLayout(page, testInfo.project.name, 'detail-created');

      await page.getByLabel('이슈 제목').fill(updatedTitle);
      const titleSaved = page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          response.url().endsWith(`/api/v1/issues/${issue.id}`) &&
          response.ok(),
      );
      await page.getByRole('button', { name: '제목 저장' }).click();
      await titleSaved;
      await expect(page.getByLabel('이슈 제목')).toHaveValue(updatedTitle);
      await expect(page.getByRole('button', { name: '제목 저장' })).toBeDisabled();

      issue = await apiRequest<IssueDetailResponseDto>(page, `/issues/${issue.identifier}`);
      const concurrentUpdate = await apiRequest<IssueDetailResponseDto>(
        page,
        `/issues/${issue.id}`,
        {
          body: { priority: 'MEDIUM', version: issue.version },
          method: 'PATCH',
        },
      );
      expect(concurrentUpdate.priority).toBe('MEDIUM');

      const issueUpdatePattern = /\/api\/v1\/issues\/[^/?]+$/;
      let injectedStaleVersion = false;
      await page.route(issueUpdatePattern, async (route) => {
        if (route.request().method() !== 'PATCH' || injectedStaleVersion) {
          await route.continue();
          return;
        }

        injectedStaleVersion = true;
        const body = route.request().postDataJSON() as Record<string, unknown>;
        await route.continue({
          postData: JSON.stringify({ ...body, version: issue.version }),
        });
      });

      await selectOption(page, '우선순위', '긴급', properties);
      const conflictAlert = page
        .getByRole('alert')
        .filter({ hasText: '다른 변경이 먼저 저장되었습니다' });
      await expect(conflictAlert.getByText('다른 변경이 먼저 저장되었습니다')).toBeVisible();
      expect(injectedStaleVersion).toBe(true);
      await expect(conflictAlert.getByText('보통', { exact: true })).toBeVisible();
      await expect(conflictAlert.getByText('긴급', { exact: true })).toBeVisible();
      await page.unroute(issueUpdatePattern);
      await conflictAlert.getByRole('button', { name: '내 변경 다시 적용' }).click();
      await expect(properties.getByLabel('우선순위')).toContainText('긴급');
      await expect(conflictAlert).toBeHidden();

      await page.goto('/my-issues');
      await expect(page.getByRole('link', { name: updatedTitle })).toBeVisible();
      await checkLayout(page, testInfo.project.name, 'my-issues');

      const priorityFilter = page
        .locator('details')
        .filter({ hasText: /^우선순위/ })
        .first();
      await priorityFilter.locator('summary').click();
      await priorityFilter.getByText('긴급', { exact: true }).click();
      await expect(page).toHaveURL(/priority=URGENT/);
      await expect(page.getByRole('link', { name: updatedTitle })).toBeVisible();

      await selectOption(page, '정렬 기준', '상태');
      await expect(page).toHaveURL(/sort=status/);
      await selectOption(page, '정렬 방향', '오름차순');
      await expect(page).toHaveURL(/direction=asc/);
      await page.getByRole('button', { name: '필터 초기화' }).click();

      await selectOption(page, 'WEB-1 상태', '진행 중');
      await expect(page.getByRole('combobox', { name: 'WEB-1 상태' })).toContainText('진행 중');
      await selectOption(page, 'WEB-1 우선순위', '높음');
      await expect(page.getByRole('combobox', { name: 'WEB-1 우선순위' })).toContainText('높음');

      await page.goto('/teams/WEB/issues');
      await expect(page.getByRole('link', { name: updatedTitle })).toBeVisible();
      await page.getByRole('tab', { name: '진행 중' }).click();
      await expect(page).toHaveURL(/tab=progress/);
      await expect(page.getByRole('link', { name: updatedTitle })).toBeVisible();
      await checkLayout(page, testInfo.project.name, 'team-issues');

      await page.getByRole('link', { name: '보드로 보기' }).click();
      await expect(page).toHaveURL(/\/teams\/WEB\/board\?tab=progress/);
      await expect(page.getByLabel('워크플로 상태 보드')).toBeVisible();
      await expect(page.getByRole('link', { name: updatedTitle })).toBeVisible();
      await checkLayout(page, testInfo.project.name, 'team-board');
      await page.getByRole('tab', { name: '전체' }).click();
      await expect(page).toHaveURL(/\/teams\/WEB\/board$/);

      await selectOption(page, 'WEB-1 상태', '검토');
      const boardState = page.getByRole('combobox', { name: 'WEB-1 상태' });
      await expect(boardState).toContainText('검토');
      await expect(boardState).toBeEnabled();

      const boardCard = page
        .getByRole('listitem')
        .filter({ has: page.getByRole('link', { name: updatedTitle }) });
      await selectOption(page, 'WEB-1 담당자', '담당자 없음', boardCard);
      const boardAssignee = boardCard.getByRole('combobox', { name: 'WEB-1 담당자' });
      await expect(boardAssignee).toContainText('담당자 없음');
      await expect(boardAssignee).toBeEnabled();

      const boardLabels = boardCard.getByLabel('WEB-1 라벨', { exact: true });
      await boardLabels.click();
      const boardLabelCheckbox = boardCard.getByRole('checkbox', { name: 'M3 핵심' });
      await boardLabelCheckbox.click();
      await expect(boardLabelCheckbox).not.toBeChecked();
      await expect(boardLabelCheckbox).toBeEnabled();
      await boardLabelCheckbox.click();
      await expect(boardLabelCheckbox).toBeChecked();
      await expect(boardLabelCheckbox).toBeEnabled();
      await boardLabels.click();

      const beforeBoardConflict = await apiRequest<IssueDetailResponseDto>(
        page,
        `/issues/${issue.identifier}`,
      );
      await apiRequest<IssueDetailResponseDto>(page, `/issues/${issue.id}`, {
        body: { priority: 'MEDIUM', version: beforeBoardConflict.version },
        method: 'PATCH',
      });

      let injectedBoardStaleVersion = false;
      await page.route(issueUpdatePattern, async (route) => {
        if (route.request().method() !== 'PATCH' || injectedBoardStaleVersion) {
          await route.continue();
          return;
        }

        injectedBoardStaleVersion = true;
        const body = route.request().postDataJSON() as Record<string, unknown>;
        await route.continue({
          postData: JSON.stringify({ ...body, version: beforeBoardConflict.version }),
        });
      });

      await selectOption(page, 'WEB-1 우선순위', '긴급', boardCard);
      const boardPriority = boardCard.getByRole('combobox', { name: 'WEB-1 우선순위' });
      const boardConflict = boardCard
        .getByRole('alert')
        .filter({ hasText: '다른 변경이 먼저 저장되었습니다' });
      await expect(boardConflict).toBeVisible();
      await expect(boardConflict.getByText('최신 값: 보통', { exact: true })).toBeVisible();
      await expect(boardConflict.getByText('내 변경: 긴급', { exact: true })).toBeVisible();
      await expect(boardPriority).toContainText('보통');
      expect(injectedBoardStaleVersion).toBe(true);
      await page.unroute(issueUpdatePattern);
      await boardConflict.getByRole('button', { name: '내 변경 다시 적용' }).click();
      await expect(boardPriority).toContainText('긴급');
      await expect(boardPriority).toBeEnabled();
      await expect(boardConflict).toBeHidden();

      let failedBoardPatch = false;
      await page.route(issueUpdatePattern, async (route) => {
        if (route.request().method() !== 'PATCH' || failedBoardPatch) {
          await route.continue();
          return;
        }

        failedBoardPatch = true;
        await route.fulfill({
          body: JSON.stringify({
            code: 'INTERNAL_SERVER_ERROR',
            fieldErrors: {},
            message: 'M3 E2E 의도된 보드 저장 실패',
          }),
          contentType: 'application/json',
          status: 500,
        });
      });

      await selectOption(page, 'WEB-1 우선순위', '낮음', boardCard);
      const boardSaveError = page
        .getByRole('alert')
        .filter({ hasText: '속성을 변경하지 못했습니다' });
      await expect(boardSaveError).toBeVisible();
      expect(failedBoardPatch).toBe(true);
      await expect(boardPriority).toContainText('긴급');
      await page.unroute(issueUpdatePattern);
      await boardSaveError.getByRole('button', { name: '다시 시도' }).click();
      await expect(boardPriority).toContainText('낮음');
      await expect(boardPriority).toBeEnabled();
      await expect(boardSaveError).toBeHidden();

      const savedBoardIssue = await apiRequest<IssueDetailResponseDto>(
        page,
        `/issues/${issue.identifier}`,
      );
      expect(savedBoardIssue.assignee).toBeNull();
      expect(savedBoardIssue.labels).toEqual([
        expect.objectContaining({ id: label.id, name: 'M3 핵심' }),
      ]);
      expect(savedBoardIssue.priority).toBe('LOW');
      expect(savedBoardIssue.status.workflowState?.name).toBe('검토');
    }
  } finally {
    await cleanupM2Users([email]);
    await clearM1RateLimits();
  }
});
