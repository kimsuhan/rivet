import { randomUUID } from 'node:crypto';

import { expect, type Locator, type Page, test } from '@playwright/test';

import type {
  AuthenticatedSessionDto,
  ClaimIssueResponseDto,
  CreateIssueResponseDto,
  IssueDetailResponseDto,
  ProjectResponseDto,
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
  await page.getByLabel('표시 이름').fill('M8 브라우저 사용자');
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
  await page.getByLabel('워크스페이스 이름').fill('M8 브라우저 워크스페이스');
  await page.getByLabel('슬러그').fill(input.slug);
  await page.getByRole('button', { name: '워크스페이스 만들기' }).click();
  await expect(page).toHaveURL(/\/onboarding\/team$/);
  await page.getByLabel('팀 이름').fill('웹');
  await page.getByLabel('팀 키').fill('WEB');
  await page.getByRole('button', { name: '팀 만들기' }).click();
  await expect(page).toHaveURL(/\/onboarding\/invite$/);
  await page.getByRole('button', { name: '건너뛰기' }).click();
  await expect(page).toHaveURL(/\/my-issues$/);
  await expect(page.getByRole('heading', { name: '내 작업' })).toBeVisible();
}

async function selectOption(
  page: Page,
  triggerName: RegExp | string,
  optionName: string,
  triggerRoot: Locator | Page = page,
): Promise<void> {
  const trigger =
    typeof triggerName === 'string'
      ? triggerRoot.getByRole('combobox', { name: triggerName, exact: true })
      : triggerRoot.getByRole('combobox', { name: triggerName });
  await trigger.click();
  const listbox = await controlledListbox(page, trigger);
  await expect(listbox).toBeVisible();
  await listbox.getByRole('option', { name: optionName, exact: true }).click();
  await expect(listbox).toBeHidden();
}

async function controlledListbox(page: Page, trigger: Locator): Promise<Locator> {
  await expect(trigger).toHaveAttribute('aria-controls', /.+/u);
  const listboxId = await trigger.getAttribute('aria-controls');
  if (!listboxId) throw new Error('선택기와 연결된 listbox를 찾지 못했습니다.');
  return page.locator(`#${listboxId}`);
}

async function chooseQuickFilter(page: Page, isMobile: boolean, name: string): Promise<void> {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const optionName = new RegExp(`^${escapedName}\\s+\\d+(?:개)?$`, 'u');
  if (isMobile) {
    const trigger = page.getByRole('combobox', { name: /^빠른 필터/u });
    await trigger.click();
    const listbox = await controlledListbox(page, trigger);
    await expect(listbox).toBeVisible();
    await listbox.getByRole('option', { name: optionName }).click();
    await expect(listbox).toBeHidden();
    return;
  }
  const tab = page.getByRole('tab', { name: optionName });
  await tab.click();
}

async function tabTo(page: Page, target: Locator, name: string): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`${name}에 Tab 키만으로 도달하지 못했습니다.`);
}

function featureRow(page: Page, title: string): Locator {
  return page.getByRole('link', { name: title, exact: true }).locator('xpath=ancestor::li[1]');
}

async function expectMobileFullScreen(page: Page, dialog: Locator): Promise<void> {
  const [box, viewport] = await Promise.all([
    dialog.boundingBox(),
    page.evaluate(() => ({
      height: window.visualViewport?.height ?? window.innerHeight,
      width: window.visualViewport?.width ?? window.innerWidth,
    })),
  ]);
  expect(box).not.toBeNull();
  if (!box) throw new Error('M8 모바일 패널 크기를 확인하지 못했습니다.');
  expect(box.x).toBeLessThanOrEqual(viewport.width * 0.03);
  expect(box.y).toBeLessThanOrEqual(viewport.height * 0.03);
  expect(Math.round((box.width / viewport.width) * 1_000) / 1_000).toBeGreaterThanOrEqual(0.95);
  expect(box.height / viewport.height).toBeGreaterThanOrEqual(0.9);
}

async function captureIssueUi(page: Page, projectName: string, name: string): Promise<void> {
  const prefix = process.env.RIVET_VISUAL_QA_PREFIX;
  if (!prefix) return;
  await page.evaluate(async () => {
    await Promise.race([
      document.fonts.ready.then(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }),
      ),
      new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
    ]);
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    `${name} 가로 overflow`,
  ).toBe(true);
  await page.screenshot({
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
    path: `${prefix}-${projectName}-${name}.png`,
  });
}

async function createFeature(
  page: Page,
  input: { projectId: string; title: string },
): Promise<CreateIssueResponseDto> {
  return apiRequest<CreateIssueResponseDto>(page, '/issues', {
    body: {
      initialRoles: [],
      projectId: input.projectId,
      title: input.title,
      type: 'FEATURE',
    },
    method: 'POST',
  });
}

async function expectFeatureListGridAlignment(page: Page, targetRows?: Locator[]): Promise<void> {
  const header = page.locator('[aria-hidden="true"][data-layout="feature-issue-list-grid"]');
  const allRows = page
    .getByTestId('feature-issue-row')
    .locator('[data-layout="feature-issue-list-grid"]');
  const rows =
    targetRows?.map((row) => row.locator('[data-layout="feature-issue-list-grid"]')) ??
    Array.from({ length: 2 }, (_, index) => allRows.nth(index));

  await expect(header).toBeVisible();
  if (!targetRows)
    expect(await allRows.count(), '전역 이슈 목록 그리드 행 수').toBeGreaterThanOrEqual(2);

  const gridMetrics = await Promise.all(
    [header, ...rows].map((grid) =>
      grid.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          columns: getComputedStyle(element).gridTemplateColumns,
          starts: Object.fromEntries(
            Array.from(element.children).map((child) => [
              child.getAttribute('data-column'),
              Math.round((child.getBoundingClientRect().left - rect.left) * 100) / 100,
            ]),
          ),
        };
      }),
    ),
  );
  const [headerMetrics, ...rowMetrics] = gridMetrics;
  if (!headerMetrics) throw new Error('전역 이슈 목록 헤더 그리드를 측정하지 못했습니다.');

  const columnOrder = [
    'priority',
    'issue',
    'status',
    'current-work',
    'progress',
    'updated-at',
    'next-action',
  ] as const;
  expect(headerMetrics.columns, '전역 이슈 목록 헤더 열 정의').not.toBe('none');
  expect(Object.keys(headerMetrics.starts), '전역 이슈 목록 헤더 열').toHaveLength(7);
  expect(rowMetrics, '전역 이슈 목록 비교 행 수').toHaveLength(2);
  for (const [index, column] of columnOrder.entries()) {
    const previousColumn = columnOrder[index - 1];
    if (previousColumn) {
      expect(headerMetrics.starts[previousColumn]!).toBeLessThan(headerMetrics.starts[column]!);
    }
  }

  for (const metrics of rowMetrics) {
    expect(metrics.columns, '이슈 행과 헤더의 열 정의').toBe(headerMetrics.columns);
    expect(Object.keys(metrics.starts), '이슈 행 열 수').toHaveLength(columnOrder.length);
    for (const column of columnOrder) {
      expect(
        Math.abs(metrics.starts[column]! - headerMetrics.starts[column]!),
        `헤더와 이슈 행 ${column} 열 시작점`,
      ).toBeLessThanOrEqual(1);
    }
  }
}

test('전역 이슈 접수부터 작업 배정과 완료까지 M8 흐름을 복원한다', async ({
  page,
  isMobile,
}, testInfo) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(15_000);

  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const email = `m8.browser.${runId}@example.com`;
  const password = `M8 브라우저 검증 전용 비밀번호! ${runId}`;
  const projectName = `M8 전역 이슈 프로젝트 ${runId}`;
  const featureTitle = `M8 결제 수단 오류 재현 및 다중 팀 작업 배정 검수 ${runId}`;
  const claimTitle = `M8 직접 맡기 이슈 ${runId}`;
  const labelName = `M8 검수 ${runId}`;

  await clearM1RateLimits();

  try {
    await completeOnboarding(page, { email, password, slug: `m8-${runId}` });

    const [session, teams] = await Promise.all([
      apiRequest<AuthenticatedSessionDto>(page, '/auth/session'),
      apiRequest<TeamListResponseDto>(page, '/teams?includeArchived=false'),
    ]);
    const membership = session.membership;
    const team = teams.items.find((item) => item.key === 'WEB');
    if (!membership || !team) throw new Error('M8 E2E 팀과 멤버십을 준비하지 못했습니다.');

    const [states, project] = await Promise.all([
      apiRequest<WorkflowStateListResponseDto>(
        page,
        `/teams/${encodeURIComponent(team.id)}/workflow-states`,
      ),
      apiRequest<ProjectResponseDto>(page, '/projects', {
        body: {
          leadMembershipId: membership.id,
          name: projectName,
          roleTeams: [
            { role: 'WEB_FRONTEND', teamId: team.id },
            { role: 'APP_FRONTEND', teamId: team.id },
          ],
          status: 'IN_PROGRESS',
        },
        method: 'POST',
      }),
    ]);
    const completedState = states.items.find((state) => state.category === 'COMPLETED');
    if (!completedState) throw new Error('M8 E2E 완료 상태를 찾지 못했습니다.');
    await apiRequest(page, '/labels', {
      body: { color: '#2AA198', name: labelName },
      method: 'POST',
    });

    let created: CreateIssueResponseDto;
    if (isMobile) {
      created = await createFeature(page, { projectId: project.id, title: featureTitle });
    } else {
      await page.goto('/issues');
      await page.getByRole('link', { name: '이슈 만들기' }).first().click();
      const createDialog = page.getByRole('dialog', { name: '이슈 만들기' });
      await createDialog.getByRole('textbox', { name: '제목', exact: true }).fill(featureTitle);
      await selectOption(page, '프로젝트', projectName, createDialog);
      const createResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().endsWith('/api/v1/issues') &&
          response.status() === 201,
      );
      await createDialog.getByRole('button', { name: '이슈 만들기', exact: true }).click();
      created = (await (await createResponse).json()) as CreateIssueResponseDto;
      await expect(page).toHaveURL(new RegExp(`/issues/${created.issue.identifier}$`));
    }
    expect(created.createdTeamTasks).toHaveLength(0);

    const densityTitles =
      testInfo.project.name === 'desktop-chromium'
        ? Array.from({ length: 20 }, (_, index) => `M8 밀도 검수 ${index + 1} ${runId}`)
        : [];
    for (const title of densityTitles) {
      await createFeature(page, { projectId: project.id, title });
    }

    if (densityTitles.length > 0) {
      const desktopViewports = [
        { height: 800, width: 1280 },
        { height: 900, width: 1440 },
        { height: 1200, width: 2048 },
      ];
      for (const viewport of desktopViewports) {
        await page.setViewportSize(viewport);
        await page.goto('/issues');
        await expect(page.getByTestId('feature-issue-row')).toHaveCount(21);
        await expectFeatureListGridAlignment(page);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
          `${viewport.width}px 전역 이슈 목록 가로 overflow`,
        ).toBe(true);
        if (process.env.RIVET_VISUAL_QA_PREFIX) {
          await page.screenshot({
            animations: 'disabled',
            caret: 'hide',
            fullPage: true,
            path: `${process.env.RIVET_VISUAL_QA_PREFIX}-desktop-${viewport.width}-m8-grid.png`,
          });
        }
      }

      await page.setViewportSize({ width: 2048, height: 1200 });
      await page.goto('/issues');
      const content = page.getByTestId('feature-issue-list-content');
      const main = page.locator('#workspace-main-content');
      await expect(page.getByTestId('feature-issue-row')).toHaveCount(21);
      await expect(page.getByRole('tab', { name: /^전체 21개$/u })).toBeVisible();

      const [contentBox, mainBox, searchBox, rowHeights] = await Promise.all([
        content.boundingBox(),
        main.boundingBox(),
        page.getByRole('search').boundingBox(),
        page
          .getByTestId('feature-issue-row')
          .evaluateAll((rows) => rows.slice(0, 5).map((row) => row.getBoundingClientRect().height)),
      ]);
      expect(contentBox).not.toBeNull();
      expect(mainBox).not.toBeNull();
      expect(searchBox).not.toBeNull();
      if (!contentBox || !mainBox || !searchBox) {
        throw new Error('M8 초광폭 목록의 레이아웃을 측정하지 못했습니다.');
      }
      expect(contentBox.width).toBeGreaterThanOrEqual(1_440);
      expect(contentBox.width).toBeLessThanOrEqual(1_600);
      expect(
        Math.abs(
          contentBox.x -
            mainBox.x -
            (mainBox.width - contentBox.width - (contentBox.x - mainBox.x)),
        ),
      ).toBeLessThanOrEqual(4);
      expect(searchBox.width).toBeGreaterThanOrEqual(320);
      expect(searchBox.width).toBeLessThanOrEqual(420);
      expect(Math.min(...rowHeights)).toBeGreaterThanOrEqual(72);
      expect(Math.max(...rowHeights)).toBeLessThanOrEqual(84);

      const densityRow = featureRow(page, featureTitle);
      const statusPresentation = densityRow.locator(
        `span[aria-label="${created.issue.identifier} 상태: 접수됨"]`,
      );
      const priorityTrigger = densityRow.getByRole('combobox', {
        name: new RegExp(`^${created.issue.identifier} 우선순위:`, 'u'),
      });
      await expect(
        densityRow.getByRole('combobox', {
          name: new RegExp(`^${created.issue.identifier} 상태:`, 'u'),
        }),
      ).toHaveCount(0);
      const [statusBox, priorityBox, statusAttributes, priorityStyle] = await Promise.all([
        statusPresentation.boundingBox(),
        priorityTrigger.boundingBox(),
        statusPresentation.evaluate((element) => ({
          ariaHasPopup: element.getAttribute('aria-haspopup'),
          role: element.getAttribute('role'),
          tagName: element.tagName,
        })),
        priorityTrigger.evaluate((element) => {
          const style = getComputedStyle(element);
          return { backgroundColor: style.backgroundColor, borderColor: style.borderColor };
        }),
      ]);
      expect(statusBox).not.toBeNull();
      expect(priorityBox).not.toBeNull();
      if (!statusBox || !priorityBox)
        throw new Error('M8 상태·우선순위 위치를 측정하지 못했습니다.');
      expect(
        Math.abs(statusBox.y + statusBox.height / 2 - (priorityBox.y + priorityBox.height / 2)),
      ).toBeLessThanOrEqual(1);
      expect(priorityBox.height).toBeGreaterThanOrEqual(40);
      expect(statusAttributes.tagName).toBe('SPAN');
      expect(statusAttributes.role).toBeNull();
      expect(statusAttributes.ariaHasPopup).toBeNull();
      expect(priorityStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)');
      expect(priorityStyle.borderColor).toBe('rgba(0, 0, 0, 0)');

      const labelTrigger = densityRow.getByRole('button', {
        name: new RegExp(`^${created.issue.identifier} 라벨:`, 'u'),
      });
      await expect(labelTrigger).toHaveCSS('opacity', '0');
      await expect(labelTrigger).toHaveCSS('pointer-events', 'none');
      await densityRow.hover();
      await expect(labelTrigger).toHaveCSS('opacity', '1');
      await expect(labelTrigger).toHaveCSS('pointer-events', 'auto');
      const labelTriggerBox = await labelTrigger.boundingBox();
      expect(labelTriggerBox).not.toBeNull();
      if (!labelTriggerBox) throw new Error('M8 라벨 편집 조작 영역을 측정하지 못했습니다.');
      expect(labelTriggerBox.height).toBeGreaterThanOrEqual(40);
      expect(labelTriggerBox.width).toBeGreaterThanOrEqual(40);
      await labelTrigger.click();
      const labelPopup = page.getByTestId('issue-filter-menu-popup');
      await expect(labelPopup).toBeVisible();
      expect(
        await labelPopup.evaluate(
          (popup) => popup.closest('[data-testid="feature-issue-row"]') === null,
        ),
      ).toBe(true);
      expect(
        await labelPopup.evaluate((popup) => {
          const color = getComputedStyle(popup).backgroundColor;
          if (color.startsWith('rgb(')) return true;
          const alpha = color.match(/^rgba\(.+,\s*([\d.]+)\)$/u)?.[1];
          return alpha !== undefined && Number(alpha) === 1;
        }),
      ).toBe(true);
      expect(
        await labelPopup.evaluate((popup) => {
          const rect = popup.getBoundingClientRect();
          const topElement = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          );
          return topElement ? popup.contains(topElement) : false;
        }),
      ).toBe(true);
      if (process.env.RIVET_VISUAL_QA_PREFIX) {
        await page.screenshot({
          animations: 'disabled',
          caret: 'hide',
          fullPage: false,
          path: `${process.env.RIVET_VISUAL_QA_PREFIX}-desktop-wide-m8-label-popover.png`,
        });
      }
      await page.keyboard.press('Escape');
      await expect(labelPopup).toBeHidden();
      await expect(labelTrigger).toBeFocused();

      await labelTrigger.click();
      const labelResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          response.url().endsWith(`/api/v1/issues/${created.issue.id}`) &&
          response.status() === 200,
      );
      await page.getByRole('checkbox', { name: labelName }).click();
      await labelResponse;
      await expect(densityRow.getByText(labelName, { exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(labelPopup).toBeHidden();

      const header = page.getByRole('heading', { name: '이슈' }).locator('xpath=ancestor::header');
      const [titleBox, countBox, createBox] = await Promise.all([
        page.getByRole('heading', { name: '이슈' }).boundingBox(),
        header.getByText('21개', { exact: true }).boundingBox(),
        header.getByRole('link', { name: '이슈 만들기' }).boundingBox(),
      ]);
      expect(titleBox).not.toBeNull();
      expect(countBox).not.toBeNull();
      expect(createBox).not.toBeNull();
      if (titleBox && countBox && createBox) {
        expect(Math.abs(titleBox.y - countBox.y)).toBeLessThanOrEqual(8);
        expect(Math.abs(titleBox.y - createBox.y)).toBeLessThanOrEqual(8);
      }
      if (process.env.RIVET_VISUAL_QA_PREFIX) {
        await page.screenshot({
          animations: 'disabled',
          caret: 'hide',
          fullPage: false,
          path: `${process.env.RIVET_VISUAL_QA_PREFIX}-desktop-wide-m8-density.png`,
        });
      }

      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto('/issues');
      const searchInput = page.getByRole('textbox', { name: '이슈 검색' });
      await searchInput.fill('M8');
      await searchInput.press('Enter');
      await expect.poll(() => new URL(page.url()).searchParams.get('query')).toBe('M8');

      await page.getByRole('button', { name: '세부 필터' }).click();
      const detailFilterDialog = page.getByRole('dialog', { name: '세부 필터' });
      const detailFilterClose = detailFilterDialog.getByRole('button', {
        name: '세부 필터 닫기',
      });
      await expect
        .poll(async () => (await detailFilterClose.boundingBox())?.height ?? 0)
        .toBeGreaterThanOrEqual(40);
      await detailFilterDialog.getByRole('button', { name: '프로젝트', exact: true }).click();
      await page.getByRole('checkbox', { name: projectName, exact: true }).click();
      await expect.poll(() => new URL(page.url()).searchParams.get('projectId')).toBe(project.id);

      await detailFilterDialog.getByRole('button', { name: '우선순위', exact: true }).click();
      await page.getByRole('checkbox', { name: '없음', exact: true }).click();
      await expect.poll(() => new URL(page.url()).searchParams.get('priority')).toBe('NONE');
      await detailFilterDialog.getByRole('button', { name: '세부 필터 닫기' }).click();
      await expect(detailFilterDialog).toBeHidden();

      await expect(page.getByText('21개', { exact: true })).toBeVisible();
      await expect(page.getByLabel('활성 필터')).toBeVisible();
      await page.getByRole('button', { name: `프로젝트: ${projectName} 필터 제거` }).click();
      await expect(page).not.toHaveURL(/projectId=/u);
      await page.getByRole('button', { name: '세부 필터 전체 초기화' }).click();
      await expect.poll(() => new URL(page.url()).searchParams.toString()).toBe('query=M8');

      await page.setViewportSize({ width: 1024, height: 800 });
      await page.goto(`/issues?query=${encodeURIComponent(featureTitle)}`);
      const mediumRow = featureRow(page, featureTitle);
      await expect(mediumRow).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      ).toBe(true);
      const mediumPriority = mediumRow.getByRole('combobox', {
        name: `${created.issue.identifier} 우선순위: 없음`,
      });
      await expect(mediumPriority).toBeVisible();
      await expect(mediumPriority).toHaveAttribute('title', '없음');
      await expect(mediumPriority.locator('[data-slot="inline-select-label"]')).toHaveText('없음');
      await expect(mediumPriority.locator('[data-slot="inline-select-label"]')).toBeVisible();
      if (process.env.RIVET_VISUAL_QA_PREFIX) {
        await page.screenshot({
          fullPage: true,
          path: `${process.env.RIVET_VISUAL_QA_PREFIX}-desktop-medium-m8-density.png`,
        });
      }

      await page.setViewportSize({ width: 640, height: 800 });
      await page.goto(`/issues?query=${encodeURIComponent(featureTitle)}`);
      const narrowRow = featureRow(page, featureTitle);
      await expect(narrowRow).toBeVisible();
      await expect(narrowRow.getByRole('button', { name: '작업 시작', exact: true })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      ).toBe(true);
      expect(
        await narrowRow
          .getByText(featureTitle, { exact: true })
          .evaluate((element) => getComputedStyle(element).whiteSpace),
      ).toBe('normal');
      if (process.env.RIVET_VISUAL_QA_PREFIX) {
        await page.screenshot({
          fullPage: true,
          path: `${process.env.RIVET_VISUAL_QA_PREFIX}-desktop-narrow-640-m8-density.png`,
        });
      }
      await page.setViewportSize({ width: 1280, height: 800 });
    }

    if (testInfo.project.name === 'desktop-chromium') {
      const keyboardPage = await page.context().newPage();
      const keyboardListUrl = `/issues?query=${encodeURIComponent(featureTitle)}`;
      try {
        await keyboardPage.goto(keyboardListUrl);
        let keyboardRow = featureRow(keyboardPage, featureTitle);
        await tabTo(
          keyboardPage,
          keyboardRow.getByRole('link', { name: featureTitle, exact: true }),
          '이슈 행 상세 링크',
        );
        await keyboardPage.keyboard.press('Enter');
        await expect(keyboardPage).toHaveURL(new RegExp(`/issues/${created.issue.identifier}$`));

        await keyboardPage.goto(keyboardListUrl);
        await tabTo(keyboardPage, keyboardPage.getByRole('textbox', { name: '이슈 검색' }), '검색');
        await tabTo(
          keyboardPage,
          keyboardPage.getByRole('tab', { selected: true }),
          '선택된 빠른 필터',
        );
        const keyboardReviewTab = keyboardPage.getByRole('tab', {
          name: /^검토 필요\s+\d+(?:개)?$/u,
        });
        await keyboardPage.keyboard.press('ArrowRight');
        await expect(keyboardReviewTab).toBeFocused();
        await keyboardPage.keyboard.press('Enter');
        await expect(keyboardPage).toHaveURL(/workQueue=REVIEW_REQUIRED/, { timeout: 15_000 });

        keyboardRow = featureRow(keyboardPage, featureTitle);
        const keyboardRowLink = keyboardRow.getByRole('link', {
          name: featureTitle,
          exact: true,
        });
        const keyboardLabelEditor = keyboardRow.getByLabel(
          new RegExp(`^${created.issue.identifier} 라벨:`, 'u'),
        );
        const keyboardPriorityEditor = keyboardRow.getByRole('combobox', {
          name: new RegExp(`^${created.issue.identifier} 우선순위:`, 'u'),
        });
        const keyboardStartButton = keyboardRow.getByRole('button', {
          name: '작업 시작',
          exact: true,
        });
        await tabTo(keyboardPage, keyboardRowLink, '이슈 행 상세 링크');
        await expect(keyboardLabelEditor).toBeVisible();
        await keyboardPage.keyboard.press('Tab');
        await expect(keyboardLabelEditor).toBeFocused();
        await keyboardPage.keyboard.press('Enter');
        await expect(keyboardPage.getByTestId('issue-filter-menu-popup')).toBeVisible();
        await keyboardPage.keyboard.press('Escape');
        await expect(keyboardLabelEditor).toBeFocused();
        await keyboardPage.keyboard.press('Tab');
        await expect(keyboardPriorityEditor).toBeFocused();
        if (process.env.RIVET_VISUAL_QA_PREFIX) {
          await keyboardPage.screenshot({
            fullPage: true,
            path: `${process.env.RIVET_VISUAL_QA_PREFIX}-desktop-keyboard-focus-m8.png`,
          });
        }
        await keyboardPage.keyboard.press('Space');
        const keyboardPriorityListbox = await controlledListbox(
          keyboardPage,
          keyboardPriorityEditor,
        );
        await expect(keyboardPriorityListbox).toBeVisible();
        await keyboardPage.keyboard.press('Escape');
        await expect(keyboardPriorityListbox).toBeHidden();
        await expect(keyboardPriorityEditor).toBeFocused();
        await keyboardPage.keyboard.press('Tab');
        await expect(keyboardStartButton).toBeFocused();
        await keyboardPage.keyboard.press('Enter');
        const keyboardStartDialog = keyboardPage.getByRole('dialog', { name: '작업 시작' });
        await expect(keyboardStartDialog).toBeVisible();
        await keyboardPage.keyboard.press('Escape');
        await expect(keyboardStartDialog).toBeHidden();
      } finally {
        await keyboardPage.close();
      }
    }

    await page.goto('/issues');
    const searchControl = page.getByRole('textbox', { name: '이슈 검색' });
    await searchControl.fill('M8');
    await searchControl.press('Enter');
    await expect.poll(() => new URL(page.url()).searchParams.get('query')).toBe('M8');
    const searchClear = page.getByRole('button', { name: '검색 초기화' });
    const searchClearBox = await searchClear.boundingBox();
    expect(searchClearBox, '검색 초기화 조작 영역').not.toBeNull();
    if (!searchClearBox) throw new Error('검색 초기화 조작 영역을 측정하지 못했습니다.');
    expect(searchClearBox.height, '검색 초기화 조작 영역 높이').toBeGreaterThanOrEqual(
      isMobile ? 44 : 40,
    );
    await searchClear.click();
    await expect.poll(() => new URL(page.url()).searchParams.get('query')).toBeNull();
    await chooseQuickFilter(page, isMobile, '검토 필요');
    await expect(page).toHaveURL(/workQueue=REVIEW_REQUIRED/, { timeout: 15_000 });
    await expect(page.getByRole('link', { name: featureTitle, exact: true })).toBeVisible();
    await expect(page.getByText(`${densityTitles.length + 1}개`, { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
    let reviewRow = featureRow(page, featureTitle);
    await expect(
      reviewRow.getByLabel(new RegExp(`^${created.issue.identifier} 라벨:`, 'u')),
    ).toHaveCSS('opacity', '0');

    const minimumHitTargetHeight = isMobile ? 44 : 40;
    const quickFilterControl = isMobile
      ? page.getByRole('combobox', { name: /^빠른 필터/u })
      : page.getByRole('tab', { selected: true });
    const hitTargets: Array<[string, Locator]> = [
      ['이슈 만들기', page.getByRole('link', { name: '이슈 만들기', exact: true })],
      ['빠른 필터', quickFilterControl],
      ['세부 필터', page.getByRole('button', { name: '세부 필터' })],
      ['정렬 기준', page.getByRole('combobox', { name: '정렬 기준' })],
      ['정렬 방향', page.getByRole('combobox', { name: /^정렬 방향:/u })],
      [
        '우선순위',
        reviewRow.getByRole('combobox', {
          name: new RegExp(`^${created.issue.identifier} 우선순위:`, 'u'),
        }),
      ],
      ['작업 시작', reviewRow.getByRole('button', { name: '작업 시작', exact: true })],
      [
        '더보기',
        reviewRow.getByRole('combobox', {
          name: `${created.issue.identifier} 이슈 작업 더보기`,
        }),
      ],
    ];
    for (const [name, control] of hitTargets) {
      const box = await control.boundingBox();
      expect(box, `${name} 조작 영역`).not.toBeNull();
      if (!box) throw new Error('M8 목록 조작 영역을 측정하지 못했습니다.');
      expect(box.height, `${name} 조작 영역 높이`).toBeGreaterThanOrEqual(minimumHitTargetHeight);
    }

    if (isMobile) {
      await expect(
        page.locator('[aria-hidden="true"][data-layout="feature-issue-list-grid"]'),
      ).toBeHidden();
      await expect(reviewRow).toBeVisible();
      await page.getByRole('button', { name: '세부 필터' }).click();
      const filterDialog = page.getByRole('dialog', { name: '세부 필터' });
      await expectMobileFullScreen(page, filterDialog);
      const filterClose = filterDialog.getByRole('button', { name: '세부 필터 닫기' });
      await expect
        .poll(async () => (await filterClose.boundingBox())?.height ?? 0)
        .toBeGreaterThanOrEqual(44);
      await filterClose.click();
      await expect(filterDialog).toBeHidden();
    }

    if (process.env.RIVET_VISUAL_QA_PREFIX) {
      await page.screenshot({
        fullPage: true,
        path: `${process.env.RIVET_VISUAL_QA_PREFIX}-${testInfo.project.name}-m8-review.png`,
      });
    }
    const listUrl = page.url();

    const priorityResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        response.url().endsWith(`/api/v1/issues/${created.issue.id}`) &&
        response.status() === 200,
    );
    await selectOption(
      page,
      new RegExp(`^${created.issue.identifier} 우선순위:`, 'u'),
      '낮음',
      reviewRow,
    );
    await priorityResponse;
    await expect(page).toHaveURL(listUrl);

    if (testInfo.project.name === 'desktop-chromium') {
      await reviewRow
        .getByRole('link', { name: featureTitle, exact: true })
        .click({ position: { x: 120, y: 20 } });
      await expect(page).toHaveURL(new RegExp(`/issues/${created.issue.identifier}$`));
      await page.goBack();
      await expect(page).toHaveURL(/workQueue=REVIEW_REQUIRED/);
      reviewRow = featureRow(page, featureTitle);
      await reviewRow.getByRole('button', { name: '작업 시작', exact: true }).click();
    } else {
      await reviewRow.getByRole('button', { name: '작업 시작', exact: true }).click();
    }
    const startDialog = page.getByRole('dialog', { name: '작업 시작' });
    await startDialog.getByRole('checkbox', { name: '웹 프론트 · 웹', exact: true }).check();
    await startDialog.getByRole('checkbox', { name: '앱 프론트 · 웹', exact: true }).check();
    await selectOption(page, '웹 프론트 담당자', 'M8 브라우저 사용자', startDialog);
    for (const [name, control] of [
      ['작업 창 닫기', startDialog.getByRole('button', { name: '작업 창 닫기' })],
      ['웹 프론트 담당자', startDialog.getByRole('combobox', { name: '웹 프론트 담당자' })],
      ['작업 취소', startDialog.getByRole('button', { name: '취소' })],
      ['작업 저장', startDialog.getByRole('button', { name: '작업 시작', exact: true })],
    ] satisfies Array<[string, Locator]>) {
      const box = await control.boundingBox();
      expect(box, `${name} 조작 영역`).not.toBeNull();
      if (!box) throw new Error('M8 작업 다이얼로그 조작 영역을 측정하지 못했습니다.');
      expect(box.height, `${name} 조작 영역 높이`).toBeGreaterThanOrEqual(minimumHitTargetHeight);
    }
    if (isMobile) {
      await expectMobileFullScreen(page, startDialog);
    }
    const startResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/api/v1/issues/${created.issue.id}/start`) &&
        response.status() === 200,
    );
    await startDialog.getByRole('button', { name: '작업 시작', exact: true }).click();
    const started = (await (await startResponse).json()) as CreateIssueResponseDto;
    await expect(startDialog).toBeHidden();
    expect(started.createdTeamTasks).toHaveLength(2);
    const webTask = started.createdTeamTasks.find((task) => task.projectRole === 'WEB_FRONTEND');
    const appTask = started.createdTeamTasks.find((task) => task.projectRole === 'APP_FRONTEND');
    if (!webTask || !appTask) throw new Error('M8 E2E 역할별 팀 작업을 찾지 못했습니다.');

    await chooseQuickFilter(page, isMobile, '담당 필요');
    await expect(page).toHaveURL(/workQueue=ASSIGNMENT_REQUIRED/, { timeout: 15_000 });
    const assignmentRow = featureRow(page, featureTitle);
    await expect(assignmentRow).toBeVisible();
    await assignmentRow.getByRole('button', { name: '담당자 지정', exact: true }).click();
    const assignmentDialog = page.getByRole('dialog', { name: '담당자 지정' });
    await selectOption(
      page,
      `${appTask.identifier} 담당자`,
      'M8 브라우저 사용자',
      assignmentDialog,
    );
    const assignmentResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/api/v1/issues/${created.issue.id}/assign-team-tasks`) &&
        response.status() === 200,
    );
    await assignmentDialog.getByRole('button', { name: '담당자 지정', exact: true }).click();
    await assignmentResponse;
    await expect(assignmentDialog).toBeHidden();
    await expect(page.getByRole('link', { name: featureTitle, exact: true })).toHaveCount(0);
    await expect(page.getByText('담당자가 필요한 작업이 없습니다')).toBeVisible();

    await page.goto('/my-issues');
    await expect(page.getByRole('heading', { name: '내 작업' })).toBeVisible();
    await expect(page.getByRole('link', { name: featureTitle, exact: true })).toHaveCount(2);
    await page.goto('/teams/WEB/issues');
    await expect(page.getByRole('heading', { name: '웹 이슈' })).toBeVisible();
    await expect(page.getByRole('link', { name: featureTitle, exact: true })).toHaveCount(2);

    if (process.env.RIVET_VISUAL_QA_PREFIX) {
      const projectNameForCapture = testInfo.project.name;
      if (projectNameForCapture === 'desktop-chromium') {
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto(`/issues?query=${encodeURIComponent(featureTitle)}`);
        await expect(featureRow(page, featureTitle)).toBeVisible();
        await captureIssueUi(page, projectNameForCapture, 'global-list');

        await page.goto('/my-issues');
        await expect(page.getByRole('link', { name: featureTitle, exact: true })).toHaveCount(2);
        await captureIssueUi(page, projectNameForCapture, 'my-work');

        await page.goto('/teams/WEB/issues');
        await expect(page.getByRole('link', { name: featureTitle, exact: true })).toHaveCount(2);
        await captureIssueUi(page, projectNameForCapture, 'team-list');

        await page.goto('/teams/WEB/board');
        await expect(page.getByLabel('워크플로 상태 보드')).toBeVisible();
        await captureIssueUi(page, projectNameForCapture, 'team-board');

        await page.goto(`/projects/${project.id}`);
        await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
        await captureIssueUi(page, projectNameForCapture, 'project-team-tasks');

        await page.goto(`/issues/${created.issue.identifier}`);
        await expect(page.getByRole('heading', { name: '속성' })).toBeVisible();
        await captureIssueUi(page, projectNameForCapture, 'feature-detail');

        await page.goto(`/issues/${webTask.identifier}`);
        await expect(page.getByRole('heading', { name: '속성' })).toBeVisible();
        await captureIssueUi(page, projectNameForCapture, 'team-task-detail');

        await page.setViewportSize({ width: 1024, height: 800 });
        await page.goto(`/issues?query=${encodeURIComponent(featureTitle)}`);
        await expect(featureRow(page, featureTitle)).toBeVisible();
        await captureIssueUi(page, projectNameForCapture, 'medium-global-list');
        await page.goto(`/issues/${webTask.identifier}`);
        await expect(page.getByRole('heading', { name: '속성' })).toBeVisible();
        await captureIssueUi(page, projectNameForCapture, 'medium-team-task-detail');

        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto(`/issues?query=${encodeURIComponent(featureTitle)}`);
        await expect(featureRow(page, featureTitle)).toBeVisible();
        const normalGlobalList = await page.screenshot({
          animations: 'disabled',
          caret: 'hide',
          fullPage: true,
        });
        await page.goto(`/issues/${webTask.identifier}`);
        await expect(page.getByRole('complementary', { name: '속성' })).toBeVisible();
        const normalTeamTaskDetail = await page.screenshot({
          animations: 'disabled',
          caret: 'hide',
          fullPage: true,
        });
        const browser = page.context().browser();
        if (!browser) throw new Error('200% 확대 Chromium context를 만들 수 없습니다.');
        const zoomContext = await browser.newContext({
          baseURL: new URL(page.url()).origin,
          deviceScaleFactor: 2,
          storageState: await page.context().storageState(),
          viewport: { height: 400, width: 640 },
        });
        const zoomPage = await zoomContext.newPage();
        try {
          await zoomPage.goto(`/issues?query=${encodeURIComponent(featureTitle)}`);
          await expect(featureRow(zoomPage, featureTitle)).toBeVisible();
          await expect.poll(() => zoomPage.evaluate(() => window.innerWidth)).toBe(640);
          await expect.poll(() => zoomPage.evaluate(() => window.devicePixelRatio)).toBe(2);
          await expect
            .poll(() =>
              zoomPage.evaluate(
                () => document.documentElement.scrollWidth <= window.innerWidth + 1,
              ),
            )
            .toBe(true);
          const zoomedGlobalList = await zoomPage.screenshot({
            animations: 'disabled',
            caret: 'hide',
            fullPage: true,
            path: `${process.env.RIVET_VISUAL_QA_PREFIX}-${projectNameForCapture}-zoom-200-global-list.png`,
          });
          expect(zoomedGlobalList.equals(normalGlobalList), '전역 이슈 목록 200% 확대 캡처').toBe(
            false,
          );

          await zoomPage.goto(`/issues/${webTask.identifier}`);
          const zoomProperties = zoomPage.getByRole('complementary', { name: '속성' });
          await expect(zoomProperties).toBeVisible();
          await expect
            .poll(() =>
              zoomPage.evaluate(
                () => document.documentElement.scrollWidth <= window.innerWidth + 1,
              ),
            )
            .toBe(true);
          const propertyBox = await zoomProperties.boundingBox();
          expect(propertyBox).not.toBeNull();
          if (!propertyBox) throw new Error('200% 확대 속성 패널 경계를 확인하지 못했습니다.');
          expect(propertyBox.x).toBeGreaterThanOrEqual(0);
          expect(propertyBox.x + propertyBox.width).toBeLessThanOrEqual(641);
          const zoomedTeamTaskDetail = await zoomPage.screenshot({
            animations: 'disabled',
            caret: 'hide',
            fullPage: true,
            path: `${process.env.RIVET_VISUAL_QA_PREFIX}-${projectNameForCapture}-zoom-200-team-task-detail.png`,
          });
          expect(
            zoomedTeamTaskDetail.equals(normalTeamTaskDetail),
            '팀 작업 상세 200% 확대 캡처',
          ).toBe(false);
        } finally {
          await zoomContext.close();
        }
      } else if (projectNameForCapture === 'compact-chromium') {
        await page.goto(`/issues?query=${encodeURIComponent(featureTitle)}`);
        await expect(featureRow(page, featureTitle)).toBeVisible();
        await captureIssueUi(page, projectNameForCapture, 'global-list');
        await page.goto(`/issues/${webTask.identifier}`);
        await expect(page.getByRole('heading', { name: '속성' })).toBeVisible();
        await captureIssueUi(page, projectNameForCapture, 'team-task-detail');
      } else if (isMobile) {
        await page.goto(`/issues?query=${encodeURIComponent(featureTitle)}`);
        await expect(featureRow(page, featureTitle)).toBeVisible();
        await captureIssueUi(page, projectNameForCapture, 'mobile-global-list');
        await page.goto(`/issues/${webTask.identifier}`);
        await expect(page.getByRole('heading', { name: '속성' })).toBeVisible();
        await captureIssueUi(page, projectNameForCapture, 'mobile-team-task-detail');
      }
    }

    const claimable = await createFeature(page, { projectId: project.id, title: claimTitle });
    await page.goto(`/issues?query=${encodeURIComponent(claimTitle)}`);
    const claimRow = featureRow(page, claimTitle);
    await expect(claimRow).toBeVisible();
    await selectOption(
      page,
      `${claimable.issue.identifier} 이슈 작업 더보기`,
      '내가 맡기',
      claimRow,
    );
    const claimDialog = page.getByRole('dialog', { name: '내가 맡기' });
    await selectOption(page, '프로젝트 역할', '웹 프론트', claimDialog);
    const claimResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/api/v1/issues/${claimable.issue.id}/claim`) &&
        response.status() === 200,
    );
    await claimDialog.getByRole('button', { name: '내가 맡기', exact: true }).click();
    const claimed = (await (await claimResponse).json()) as ClaimIssueResponseDto;
    await expect(claimDialog).toBeHidden();
    expect(claimed.teamTask.assignee?.id).toBe(membership.id);
    await page.goto('/my-issues');
    await expect(page.getByRole('link', { name: claimTitle, exact: true })).toBeVisible();

    for (const task of [webTask, appTask]) {
      const latest = await apiRequest<IssueDetailResponseDto>(
        page,
        `/issues/${encodeURIComponent(task.id)}`,
      );
      const completed = await apiRequest<IssueDetailResponseDto>(
        page,
        `/issues/${encodeURIComponent(task.id)}`,
        {
          body: { version: latest.version, workflowStateId: completedState.id },
          method: 'PATCH',
        },
      );
      expect(completed.status.category).toBe('COMPLETED');
    }

    await page.goto('/issues');
    await chooseQuickFilter(page, isMobile, '완료 확인');
    await expect(page).toHaveURL(/workQueue=COMPLETION_REQUIRED/, { timeout: 15_000 });
    await expect(featureRow(page, featureTitle)).toBeVisible();

    if (testInfo.project.name === 'desktop-chromium') {
      await page.setViewportSize({ width: 2048, height: 1200 });
      await page.goto('/issues');
      const reviewRow = featureRow(page, featureTitle);
      const unsortedRow = featureRow(page, densityTitles[0]!);
      await expect(
        reviewRow.getByLabel(new RegExp(`^${created.issue.identifier} 상태: 완료 확인$`, 'u')),
      ).toBeVisible();
      await expect(unsortedRow.getByLabel(/상태: 접수됨$/u)).toBeVisible();
      await expectFeatureListGridAlignment(page, [reviewRow, unsortedRow]);
      if (process.env.RIVET_VISUAL_QA_PREFIX) {
        await page.screenshot({
          animations: 'disabled',
          caret: 'hide',
          fullPage: true,
          path: `${process.env.RIVET_VISUAL_QA_PREFIX}-desktop-2048-status-pair-m8-grid.png`,
        });
      }
      await page.goto('/issues');
      await chooseQuickFilter(page, isMobile, '완료 확인');
    }

    const completionRow = featureRow(page, featureTitle);
    await completionRow.getByRole('button', { name: '이슈 완료', exact: true }).click();
    const completionDialog = page.getByRole('dialog', { name: '이슈 완료' });
    await expect(completionDialog.getByText('완료된 팀 작업')).toBeVisible();
    await expect(completionDialog.getByText(webTask.identifier, { exact: false })).toBeVisible();
    await expect(completionDialog.getByText(appTask.identifier, { exact: false })).toBeVisible();
    const completeResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        response.url().endsWith(`/api/v1/issues/${created.issue.id}`) &&
        response.status() === 200,
    );
    await completionDialog.getByRole('button', { name: '이슈 완료', exact: true }).click();
    await completeResponse;
    await expect(completionDialog).toBeHidden();
    await expect(page.getByRole('link', { name: featureTitle, exact: true })).toHaveCount(0);

    await chooseQuickFilter(page, isMobile, '완료');
    await expect(page).toHaveURL(/workQueue=COMPLETED/, { timeout: 15_000 });
    await expect(page.getByRole('link', { name: featureTitle, exact: true })).toBeVisible();

    const directUrl = `/issues?workQueue=COMPLETED&sort=createdAt&sortDirection=asc&query=${encodeURIComponent(featureTitle)}`;
    await page.goto(directUrl);
    await expect(page.getByRole('link', { name: featureTitle, exact: true })).toBeVisible();
    if (isMobile) {
      await expect(page.getByRole('combobox', { name: /^빠른 필터/u })).toContainText('완료');
    } else {
      await expect(page.getByRole('tab', { name: /^완료 \d+개$/u })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    }
    await expect(page.getByRole('combobox', { name: '정렬 기준' })).toContainText('생성일');
    await expect(page.getByRole('combobox', { name: '정렬 방향: 오름차순' })).toContainText(
      '오름차순',
    );
    await page
      .getByRole('link', { name: featureTitle, exact: true })
      .click({ position: { x: 120, y: 20 } });
    await expect(page).toHaveURL(new RegExp(`/issues/${created.issue.identifier}$`));
    await page.goBack();
    await expect
      .poll(() => {
        const url = new URL(page.url());
        return {
          query: url.searchParams.get('query'),
          sort: url.searchParams.get('sort'),
          sortDirection: url.searchParams.get('sortDirection'),
          workQueue: url.searchParams.get('workQueue'),
        };
      })
      .toEqual({
        query: featureTitle,
        sort: 'createdAt',
        sortDirection: 'asc',
        workQueue: 'COMPLETED',
      });
    await expect(page.getByRole('link', { name: featureTitle, exact: true })).toBeVisible();

    const scrollBeforeSse = await page.evaluate(() => window.scrollY);
    const latestFeature = await apiRequest<IssueDetailResponseDto>(
      page,
      `/issues/${encodeURIComponent(created.issue.id)}`,
    );
    await apiRequest<IssueDetailResponseDto>(
      page,
      `/issues/${encodeURIComponent(created.issue.id)}`,
      {
        body: { featureStatusAction: 'REOPEN', version: latestFeature.version },
        method: 'PATCH',
      },
    );
    await expect(page.getByRole('link', { name: featureTitle, exact: true })).toHaveCount(0);
    await expect
      .poll(async () => {
        const url = new URL(page.url());
        return {
          query: url.searchParams.get('query'),
          scrollY: await page.evaluate(() => window.scrollY),
          sort: url.searchParams.get('sort'),
          sortDirection: url.searchParams.get('sortDirection'),
          workQueue: url.searchParams.get('workQueue'),
        };
      })
      .toEqual({
        query: featureTitle,
        scrollY: scrollBeforeSse,
        sort: 'createdAt',
        sortDirection: 'asc',
        workQueue: 'COMPLETED',
      });

    if (process.env.RIVET_VISUAL_QA_PREFIX) {
      await page.screenshot({
        fullPage: true,
        path: `${process.env.RIVET_VISUAL_QA_PREFIX}-${testInfo.project.name}-m8-completed.png`,
      });
    }
  } finally {
    await cleanupM2Users([email]);
    await clearM1RateLimits();
  }
});
