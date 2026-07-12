import { randomUUID } from 'node:crypto';

import { expect, type Locator, type Page, test } from '@playwright/test';

import type {
  AuthenticatedSessionDto,
  CreateIssueResponseDto,
  IssueDetailResponseDto,
  ProjectResponseDto,
  TeamListResponseDto,
  TeamResponseDto,
  UpdateIssueResponseDto,
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

  await page.screenshot({
    fullPage: true,
    path: `/private/tmp/rivet-m4-${projectName}-${stage}.png`,
  });
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
  await page.getByLabel('표시 이름').fill('M4 브라우저 사용자');
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
  await page.getByLabel('워크스페이스 이름').fill('M4 브라우저 워크스페이스');
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

async function selectOption(
  page: Page,
  triggerName: string,
  optionName: string,
  triggerRoot: Locator | Page = page,
): Promise<void> {
  await triggerRoot.getByRole('combobox', { name: triggerName, exact: true }).click();
  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();
  await listbox.getByRole('option', { name: optionName, exact: true }).click();
  await expect(listbox).toBeHidden();
}

async function seedProjectHierarchy(
  page: Page,
  input: {
    assigneeMembershipId: string;
    completedStateId: string;
    defaultStateId: string;
    projectId: string;
    runId: string;
    teamId: string;
  },
): Promise<{
  backend: IssueDetailResponseDto;
  feature: IssueDetailResponseDto;
  web: IssueDetailResponseDto;
}> {
  const created = await apiRequest<CreateIssueResponseDto>(page, '/issues', {
    body: {
      featureStatus: 'IN_PROGRESS',
      initialRoles: ['BACKEND'],
      projectId: input.projectId,
      title: `M4 결제 기능 ${input.runId}`,
      type: 'FEATURE',
    },
    method: 'POST',
  });
  const feature = created.issue;
  const backendSummary = created.createdTeamTasks.find((task) => task.projectRole === 'BACKEND');
  if (!backendSummary) throw new Error('M4 E2E 자동 생성 백엔드 작업을 찾지 못했습니다.');
  const backend = await apiRequest<IssueDetailResponseDto>(
    page,
    `/issues/${encodeURIComponent(backendSummary.id)}`,
  );
  const web = (
    await apiRequest<CreateIssueResponseDto>(page, '/issues', {
      body: {
        assigneeMembershipId: input.assigneeMembershipId,
        parentIssueId: feature.id,
        priority: 'MEDIUM',
        projectId: input.projectId,
        projectRole: 'WEB_FRONTEND',
        teamId: input.teamId,
        title: `M4 결제 화면 ${input.runId}`,
        type: 'TEAM_TASK',
        workflowStateId: input.completedStateId,
      },
      method: 'POST',
    })
  ).issue;

  return { backend, feature, web };
}

test('UF-04~05 프로젝트 생성, 계층, 충돌 복구와 보관을 완료한다', async ({
  page,
  isMobile,
}, testInfo) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(10_000);

  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const email = `m4.browser.${runId}@example.com`;
  const password = `M4 브라우저 검증 전용 비밀번호! ${runId}`;
  const apiProjectName = `M4 진행 프로젝트 ${runId}`;
  const uiProjectName = `M4 출시 프로젝트 ${runId}`;

  await clearM1RateLimits();

  try {
    await completeOnboarding(page, { email, password, slug: `m4-${runId}` });

    const [session, teams] = await Promise.all([
      apiRequest<AuthenticatedSessionDto>(page, '/auth/session'),
      apiRequest<TeamListResponseDto>(page, '/teams?includeArchived=false'),
    ]);
    const webTeam = teams.items.find((team) => team.key === 'WEB');
    expect(webTeam).toBeDefined();
    expect(session.membership).not.toBeNull();
    if (!webTeam || !session.membership) {
      throw new Error('M4 E2E 팀과 멤버십을 준비하지 못했습니다.');
    }

    const [apiTeam, states] = await Promise.all([
      apiRequest<TeamResponseDto>(page, '/teams', {
        body: { key: 'API', memberIds: [session.membership.id], name: 'API' },
        method: 'POST',
      }),
      apiRequest<WorkflowStateListResponseDto>(
        page,
        `/teams/${encodeURIComponent(webTeam.id)}/workflow-states`,
      ),
    ]);
    const defaultState = states.items.find((state) => state.isDefault);
    const completedState = states.items.find((state) => state.category === 'COMPLETED');
    expect(apiTeam.key).toBe('API');
    expect(defaultState).toBeDefined();
    expect(completedState).toBeDefined();
    if (!defaultState || !completedState) {
      throw new Error('M4 E2E 워크플로 상태를 준비하지 못했습니다.');
    }

    const apiProject = await apiRequest<ProjectResponseDto>(page, '/projects', {
      body: {
        description: '비기본 생성 상태와 모바일 조회를 검증합니다.',
        leadMembershipId: session.membership.id,
        name: apiProjectName,
        roleTeams: [
          { role: 'BACKEND', teamId: webTeam.id },
          { role: 'WEB_FRONTEND', teamId: webTeam.id },
        ],
        startDate: '2026-08-01',
        status: 'IN_PROGRESS',
        targetDate: '2026-08-31',
      },
      method: 'POST',
    });
    expect(apiProject.status).toBe('IN_PROGRESS');

    if (isMobile) {
      const hierarchy = await seedProjectHierarchy(page, {
        assigneeMembershipId: session.membership.id,
        completedStateId: completedState.id,
        defaultStateId: defaultState.id,
        projectId: apiProject.id,
        runId,
        teamId: webTeam.id,
      });

      await page.goto('/projects?status=IN_PROGRESS&sort=targetDate&direction=asc');
      await expect(page.getByRole('heading', { name: '프로젝트', exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: apiProjectName })).toBeVisible();
      await expect(page.getByRole('link', { name: '프로젝트 만들기' })).toHaveCount(0);
      await checkLayout(page, testInfo.project.name, 'list-mobile');

      await page.getByRole('link', { name: apiProjectName }).click();
      await expect(page).toHaveURL(new RegExp(`/projects/${apiProject.id}$`));
      await expect(page.getByRole('heading', { name: apiProjectName })).toBeVisible();
      await expect(page.getByRole('progressbar', { name: '완료 1 / 2 · 50%' })).toHaveAttribute(
        'value',
        '50',
      );
      await expect(
        page.getByRole('link', {
          name: new RegExp(`^${hierarchy.feature.identifier}.*${hierarchy.feature.title}$`),
        }),
      ).toBeVisible();
      await expect(
        page.getByRole('link', {
          name: new RegExp(`^${hierarchy.backend.identifier}.*${hierarchy.backend.title}$`),
        }),
      ).toBeVisible();
      await expect(
        page.getByRole('link', {
          name: new RegExp(`^${hierarchy.web.identifier}.*${hierarchy.web.title}$`),
        }),
      ).toBeVisible();
      await expect(page.getByRole('link', { name: '프로젝트 편집' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: '이슈 만들기' })).toHaveCount(0);
      await checkLayout(page, testInfo.project.name, 'detail-mobile');

      await page.goto(`/issues/${hierarchy.feature.identifier}`);
      const featureTabs = page.getByRole('tablist', { name: '상세 화면' });
      await expect(featureTabs.getByRole('tab')).toHaveCount(3);
      await expect(featureTabs.getByRole('tab', { name: '업무' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(page.getByRole('heading', { name: '속성' })).toBeVisible();
      await featureTabs.getByRole('tab', { name: '연결' }).click();
      await expect(page).toHaveURL(
        new RegExp(`/issues/${hierarchy.feature.identifier}\\?tab=relations$`),
      );
      await expect(page.getByRole('region', { name: '작업 흐름' })).toBeVisible();
      await expect(page.getByText(/0\/0 완료/)).toHaveCount(0);
      await checkLayout(page, testInfo.project.name, 'workflow-mobile');

      await page.goto(`/issues/${hierarchy.backend.identifier}`);
      const taskTabs = page.getByRole('tablist', { name: '상세 화면' });
      await expect(taskTabs.getByRole('tab')).toHaveCount(3);
      await expect(taskTabs.getByRole('tab', { name: '업무' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(
        page.getByText('작업 전달 작성과 전달을 포함한 완료는 데스크톱에서 사용할 수 있습니다.'),
      ).toBeVisible();
      await taskTabs.getByRole('tab', { name: '연결' }).click();
      await expect(page).toHaveURL(
        new RegExp(`/issues/${hierarchy.backend.identifier}\\?tab=relations$`),
      );
      await expect(page.getByRole('heading', { name: '작업 순서' })).toBeVisible();
      await expect(page.getByText('연결된 선행·후행 작업이 없습니다.')).toBeVisible();
      await expect(page.getByRole('heading', { name: '속성' })).toBeVisible();
      await checkLayout(page, testInfo.project.name, 'order-mobile');

      await page.goto('/projects/new');
      await expect(
        page.getByRole('heading', {
          name: '프로젝트 만들기는 데스크톱에서 지원합니다',
        }),
      ).toBeVisible();
      await checkLayout(page, testInfo.project.name, 'create-guidance-mobile');

      const latest = await apiRequest<ProjectResponseDto>(page, `/projects/${apiProject.id}`);
      await apiRequest<ProjectResponseDto>(page, `/projects/${apiProject.id}/archive`, {
        body: { version: latest.version },
        method: 'POST',
      });
      await page.goto(`/projects/${apiProject.id}`);
      await expect(page.getByText('보관된 프로젝트입니다')).toBeVisible();
      await checkLayout(page, testInfo.project.name, 'archived-mobile');
      return;
    }

    await page.goto('/projects/new');
    await expect(page.getByRole('heading', { name: '프로젝트 만들기' })).toBeVisible();
    await page.getByLabel('프로젝트 이름').fill(uiProjectName);
    await page.getByLabel('설명').fill('웹과 API의 출시 작업을 하나의 계층으로 관리합니다.');
    await selectOption(page, '리드', 'M4 브라우저 사용자');
    await page.getByLabel('시작일').fill('2026-08-10');
    await page.getByLabel('목표일').fill('2026-08-09');
    await page.getByRole('button', { name: '프로젝트 만들기' }).click();
    await expect(page.getByText('최소 한 역할에 담당 팀을 선택해 주세요.')).toBeVisible();
    await expect(page.getByText('목표일은 시작일과 같거나 이후여야 합니다.').first()).toBeVisible();

    await selectOption(page, '백엔드', '웹 (WEB)');
    await selectOption(page, '웹 프론트', '웹 (WEB)');
    await expect(page.getByRole('combobox', { name: '웹 프론트' })).toContainText('웹 (WEB)');
    await page.getByLabel('목표일').fill('2026-08-31');
    const createdResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith('/api/v1/projects') &&
        response.status() === 201,
    );
    await page.getByRole('button', { name: '프로젝트 만들기' }).click();
    const uiProject = (await (await createdResponse).json()) as ProjectResponseDto;
    await expect(page).toHaveURL(new RegExp(`/projects/${uiProject.id}$`));
    expect(uiProject.roleTeams).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'BACKEND',
          team: expect.objectContaining({ id: webTeam.id }),
        }),
        expect.objectContaining({
          role: 'WEB_FRONTEND',
          team: expect.objectContaining({ id: webTeam.id }),
        }),
      ]),
    );

    const hierarchy = await seedProjectHierarchy(page, {
      assigneeMembershipId: session.membership.id,
      completedStateId: completedState.id,
      defaultStateId: defaultState.id,
      projectId: uiProject.id,
      runId,
      teamId: webTeam.id,
    });
    await page.reload();
    await expect(page.getByRole('progressbar', { name: '완료 1 / 2 · 50%' })).toHaveAttribute(
      'value',
      '50',
    );
    const featureCard = page.locator('[data-slot="card"]').filter({
      has: page.getByRole('link', {
        name: new RegExp(`^${hierarchy.feature.identifier}.*${hierarchy.feature.title}$`),
      }),
    });
    await expect(featureCard.getByText('1/2 · 50%')).toBeVisible();
    await expect(
      featureCard.getByRole('link', {
        name: new RegExp(`^${hierarchy.backend.identifier}.*${hierarchy.backend.title}$`),
      }),
    ).toBeVisible();
    await expect(
      featureCard.getByRole('link', {
        name: new RegExp(`^${hierarchy.web.identifier}.*${hierarchy.web.title}$`),
      }),
    ).toBeVisible();

    await page.getByRole('link', { name: '이슈 만들기' }).click();
    const featureCreateDialog = page.getByRole('dialog', { name: '이슈 만들기' });
    await expect(featureCreateDialog.getByRole('combobox', { name: '이슈 유형' })).toHaveCount(0);
    await expect(featureCreateDialog.getByRole('combobox', { name: '프로젝트' })).toContainText(
      uiProjectName,
    );
    const backendStart = featureCreateDialog.getByRole('checkbox', { name: '백엔드' });
    await backendStart.focus();
    await page.keyboard.press('Space');
    await expect(backendStart).toBeChecked();
    await expect(featureCreateDialog.getByText('선택됨')).toHaveCount(1);
    const webStart = featureCreateDialog.getByRole('checkbox', { name: '웹 프론트' });
    await webStart.focus();
    await page.keyboard.press('Space');
    await expect(webStart).toBeChecked();
    await expect(featureCreateDialog.getByText('선택됨')).toHaveCount(2);
    await featureCreateDialog.getByRole('textbox', { name: '제목' }).fill(`M4 병렬 시작 ${runId}`);
    const parallelCreateResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith('/api/v1/issues') &&
        response.status() === 201,
    );
    await featureCreateDialog.getByRole('button', { exact: true, name: '이슈 만들기' }).click();
    const parallelCreated = (await (await parallelCreateResponse).json()) as CreateIssueResponseDto;
    expect(parallelCreated.createdTeamTasks.map((task) => task.projectRole).sort()).toEqual([
      'BACKEND',
      'WEB_FRONTEND',
    ]);
    await expect(page).toHaveURL(new RegExp(`/issues/${parallelCreated.issue.identifier}$`));
    const parallelTabs = page.getByRole('tablist', { name: '상세 화면' });
    await expect(parallelTabs.getByRole('tab', { name: '업무' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.goto(`/issues/${parallelCreated.issue.identifier}?tab=relations`);
    await expect(page.getByRole('tab', { name: '연결' })).toHaveAttribute('aria-selected', 'true');
    const parallelWorkflow = page.getByRole('region', { name: '작업 흐름' });
    await expect(parallelWorkflow.getByRole('heading', { name: '현재 작업' })).toBeVisible();
    await expect(parallelWorkflow.getByText('백엔드', { exact: true })).toBeVisible();
    await expect(parallelWorkflow.getByText('웹 프론트', { exact: true })).toBeVisible();
    await expect(parallelWorkflow.locator('li.border-l')).toHaveCount(0);

    const originalViewport = page.viewportSize();
    if (!originalViewport) throw new Error('M4 E2E viewport를 확인하지 못했습니다.');
    await page.setViewportSize({
      height: Math.max(360, Math.floor(originalViewport.height / 2)),
      width: Math.max(640, Math.floor(originalViewport.width / 2)),
    });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await page.evaluate(() => window.scrollTo(0, Math.min(320, document.body.scrollHeight)));
    const relationScrollY = await page.evaluate(() => window.scrollY);
    expect(relationScrollY).toBeGreaterThan(0);
    const parallelTaskLink = parallelWorkflow
      .getByRole('link', { name: new RegExp(parallelCreated.createdTeamTasks[0]!.identifier) })
      .first();
    await parallelTaskLink.evaluate((element: HTMLElement) => element.click());
    await expect(page).toHaveURL(/\/issues\/(API|WEB|APP)-\d+$/);
    await page.goBack();
    await expect(page).toHaveURL(
      new RegExp(`/issues/${parallelCreated.issue.identifier}\\?tab=relations$`),
    );
    await expect(page.getByRole('tab', { name: '연결' })).toHaveAttribute('aria-selected', 'true');
    await expect
      .poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - relationScrollY))
      .toBeLessThanOrEqual(8);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
    await expect
      .poll(() => page.evaluate(() => window.visualViewport?.scale ?? 1))
      .toBeGreaterThanOrEqual(2);
    await expect(page.getByRole('tablist', { name: '상세 화면' })).toBeVisible();
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
    await cdp.detach();
    await page.setViewportSize(originalViewport);

    await page.goto(`/projects/${uiProject.id}`);
    await page.getByRole('link', { name: '이슈 만들기' }).click();
    const analysisCreateDialog = page.getByRole('dialog', { name: '이슈 만들기' });
    await analysisCreateDialog
      .getByRole('textbox', { name: '제목' })
      .fill(`M4 분석 후 시작 ${runId}`);
    const analysisCreateResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith('/api/v1/issues') &&
        response.status() === 201,
    );
    await analysisCreateDialog.getByRole('button', { exact: true, name: '이슈 만들기' }).click();
    const analysisCreated = (await (await analysisCreateResponse).json()) as CreateIssueResponseDto;
    expect(analysisCreated.createdTeamTasks).toHaveLength(0);
    await expect(page).toHaveURL(new RegExp(`/issues/${analysisCreated.issue.identifier}$`));

    const analysisSummary = page
      .getByRole('heading', { name: '현재 작업 요약' })
      .locator('xpath=ancestor::section[1]');
    await expect(
      analysisSummary.getByRole('heading', { name: '아직 시작된 팀 작업이 없습니다' }),
    ).toBeVisible();
    await expect(
      analysisSummary.getByText('분석이 끝났다면 작업을 시작할 팀을 선택해 주세요.'),
    ).toBeVisible();
    await expect(analysisSummary.getByText(/0\/0 완료/)).toHaveCount(0);
    const openStart = analysisSummary.getByRole('button', { name: '작업 시작' });
    await expect(openStart).toBeEnabled();
    await openStart.click();

    const startDialog = page.getByRole('dialog', { name: '작업을 시작할 팀 선택' });
    const startBackend = startDialog.getByRole('checkbox', { name: '백엔드' });
    await startBackend.focus();
    await page.keyboard.press('Space');
    const startWeb = startDialog.getByRole('checkbox', { name: '웹 프론트' });
    await startWeb.focus();
    await page.keyboard.press('Space');
    await expect(startBackend).toBeChecked();
    await expect(startWeb).toBeChecked();
    const startResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/api/v1/issues/${analysisCreated.issue.id}/start`) &&
        response.status() === 200,
    );
    await startDialog.getByRole('button', { exact: true, name: '작업 시작' }).click();
    const started = (await (await startResponse).json()) as CreateIssueResponseDto;
    expect(started.createdTeamTasks.map((task) => task.projectRole).sort()).toEqual([
      'BACKEND',
      'WEB_FRONTEND',
    ]);
    await expect(startDialog).toBeHidden();
    await page.getByRole('tab', { name: '연결' }).click();
    const analysisWorkflow = page.getByRole('region', { name: '작업 흐름' });
    const startedWork = analysisWorkflow.getByRole('region', { name: '현재 작업' });
    for (const task of started.createdTeamTasks) {
      await expect(
        startedWork.getByRole('link', { name: `${task.identifier} · ${task.title}` }),
      ).toBeVisible();
    }
    await expect(startedWork.locator('li.border-l')).toHaveCount(0);

    await page.goto(`/projects/${uiProject.id}`);

    await selectOption(page, '추가 작업', '단독 팀 작업 만들기');
    const taskCreateDialog = page.getByRole('dialog', { name: '팀 작업 만들기' });
    await expect(taskCreateDialog.getByRole('combobox', { name: '이슈 유형' })).toHaveCount(0);
    await expect(
      taskCreateDialog.getByRole('combobox', { exact: true, name: '프로젝트' }),
    ).toContainText(uiProjectName);
    await taskCreateDialog.getByRole('button', { name: '팀 작업 만들기 닫기' }).click();
    const discardTaskCreate = page.getByRole('alertdialog', {
      name: '작성 중인 이슈를 닫을까요?',
    });
    if (await discardTaskCreate.isVisible()) {
      await discardTaskCreate.getByRole('button', { name: '입력 내용 버리기' }).click();
    }
    await expect(taskCreateDialog).toBeHidden();

    await selectOption(page, '프로젝트 역할', '웹 프론트');
    await expect(page).toHaveURL(/role=WEB_FRONTEND/);
    await expect(
      page.getByRole('link', {
        name: new RegExp(`^${hierarchy.backend.identifier}.*${hierarchy.backend.title}$`),
      }),
    ).toBeHidden();
    await expect(
      page.getByRole('link', {
        name: new RegExp(`^${hierarchy.web.identifier}.*${hierarchy.web.title}$`),
      }),
    ).toBeVisible();
    await selectOption(page, '프로젝트 역할', '모든 역할');
    await checkLayout(page, testInfo.project.name, 'detail-hierarchy');

    await page.goto('/projects');
    await selectOption(page, '프로젝트 상태', '진행 중');
    await expect(page).toHaveURL(/status=IN_PROGRESS/);
    await expect(page.getByRole('link', { name: apiProjectName })).toBeVisible();
    await selectOption(page, '정렬 기준', '목표일');
    await selectOption(page, '정렬 방향', '오름차순');
    await expect(page).toHaveURL(/sort=targetDate/);
    await expect(page).toHaveURL(/direction=asc/);
    await page.getByRole('button', { name: '조건 초기화' }).click();
    await expect(page).toHaveURL(/sort=targetDate/);
    await expect(page.getByRole('link', { name: uiProjectName })).toBeVisible();
    await checkLayout(page, testInfo.project.name, 'list-filtered');

    await page.getByRole('link', { name: uiProjectName }).click();
    await page.getByRole('link', { name: '프로젝트 편집' }).click();
    await selectOption(page, '백엔드', 'API (API)');
    await page.getByRole('button', { name: '변경 저장' }).click();
    const roleInUse = page
      .getByRole('alert')
      .filter({ hasText: '사용 중인 역할의 팀은 바꿀 수 없습니다' });
    await expect(roleInUse).toBeVisible();
    await expect(roleInUse.getByText(hierarchy.backend.title, { exact: false })).toBeVisible();
    await roleInUse.getByRole('button', { name: '최신값으로 복구' }).click();
    await expect(page.getByRole('combobox', { name: '백엔드' })).toContainText('웹 (WEB)');

    await page.route('**/api/v1/events', (route) => route.abort('failed'));
    await page.reload();
    await expect(page.getByRole('combobox', { name: '백엔드' })).toContainText('웹 (WEB)');
    await expect(
      page.getByRole('status').filter({ hasText: '실시간 연결이 끊겼습니다' }),
    ).toBeVisible();

    const beforeConcurrentUpdate = await apiRequest<ProjectResponseDto>(
      page,
      `/projects/${uiProject.id}`,
    );
    await apiRequest<ProjectResponseDto>(page, `/projects/${uiProject.id}`, {
      body: { status: 'IN_PROGRESS', version: beforeConcurrentUpdate.version },
      method: 'PATCH',
    });
    await selectOption(page, '상태', '완료');
    await page.getByRole('button', { name: '변경 저장' }).click();
    const conflict = page.getByRole('alert').filter({ hasText: '다른 변경이 먼저 저장되었습니다' });
    await expect(conflict).toBeVisible();
    await conflict.getByRole('button', { name: '내 변경 다시 적용' }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${uiProject.id}$`));
    await expect(page.locator('article > header').getByText('완료', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: '프로젝트 보관' }).click();
    const archiveDialog = page.getByRole('alertdialog', {
      name: `${uiProjectName} 프로젝트를 보관할까요?`,
    });
    await archiveDialog.getByRole('button', { name: '프로젝트 보관' }).click();
    await expect(archiveDialog).toBeHidden();
    await expect(page.getByText('보관된 프로젝트입니다')).toBeVisible();
    await expect(page.getByRole('link', { name: '프로젝트 편집' })).toHaveCount(0);
    await checkLayout(page, testInfo.project.name, 'archived-read-only');

    await page.goto(`/projects/${uiProject.id}/edit`);
    await expect(
      page.getByRole('heading', { name: '보관된 프로젝트는 편집할 수 없습니다' }),
    ).toBeVisible();
    await page.goto('/projects');
    await expect(page.getByRole('link', { name: uiProjectName })).toHaveCount(0);
    await page.getByRole('checkbox', { name: '보관된 프로젝트 포함' }).click();
    await expect(page.getByRole('link', { name: uiProjectName })).toBeVisible();
  } finally {
    await cleanupM2Users([email]);
    await clearM1RateLimits();
  }
});

test('E05 백엔드 완료와 최초 작업 전달이 웹·앱 후행 작업을 독립적으로 해제한다', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-chromium',
    'E05 작업 전달 대표 게이트는 데스크톱에서만 실행합니다.',
  );
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);

  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const email = `m4.handoff.browser.${runId}@example.com`;
  const password = `M4 작업 전달 검증 전용 비밀번호! ${runId}`;
  const handoffNote = `웹과 앱은 ${runId} 계약을 각각 적용합니다.`;

  await clearM1RateLimits();

  try {
    await completeOnboarding(page, { email, password, slug: `m4-handoff-${runId}` });

    const [session, teams] = await Promise.all([
      apiRequest<AuthenticatedSessionDto>(page, '/auth/session'),
      apiRequest<TeamListResponseDto>(page, '/teams?includeArchived=false'),
    ]);
    const webTeam = teams.items.find((team) => team.key === 'WEB');
    if (!session.membership || !webTeam) {
      throw new Error('E05 E2E 관리자와 WEB 팀을 준비하지 못했습니다.');
    }

    const [apiTeam, appTeam] = await Promise.all([
      apiRequest<TeamResponseDto>(page, '/teams', {
        body: { key: 'API', memberIds: [session.membership.id], name: 'API' },
        method: 'POST',
      }),
      apiRequest<TeamResponseDto>(page, '/teams', {
        body: { key: 'APP', memberIds: [session.membership.id], name: '앱' },
        method: 'POST',
      }),
    ]);
    const [apiStates, webStates, appStates] = await Promise.all([
      apiRequest<WorkflowStateListResponseDto>(
        page,
        `/teams/${encodeURIComponent(apiTeam.id)}/workflow-states`,
      ),
      apiRequest<WorkflowStateListResponseDto>(
        page,
        `/teams/${encodeURIComponent(webTeam.id)}/workflow-states`,
      ),
      apiRequest<WorkflowStateListResponseDto>(
        page,
        `/teams/${encodeURIComponent(appTeam.id)}/workflow-states`,
      ),
    ]);
    const apiDefault = apiStates.items.find((state) => state.isDefault);
    const apiCompleted = apiStates.items.find((state) => state.category === 'COMPLETED');
    const webDefault = webStates.items.find((state) => state.isDefault);
    const webStarted = webStates.items.find((state) => state.category === 'STARTED');
    const appDefault = appStates.items.find((state) => state.isDefault);
    if (!apiDefault || !apiCompleted || !webDefault || !webStarted || !appDefault) {
      throw new Error('E05 E2E 팀별 워크플로 상태를 준비하지 못했습니다.');
    }

    const project = await apiRequest<ProjectResponseDto>(page, '/projects', {
      body: {
        leadMembershipId: session.membership.id,
        name: `E05 작업 전달 프로젝트 ${runId}`,
        roleTeams: [
          { role: 'BACKEND', teamId: apiTeam.id },
          { role: 'WEB_FRONTEND', teamId: webTeam.id },
          { role: 'APP_FRONTEND', teamId: appTeam.id },
        ],
        status: 'IN_PROGRESS',
      },
      method: 'POST',
    });
    const createdFeature = await apiRequest<CreateIssueResponseDto>(page, '/issues', {
      body: {
        featureStatus: 'IN_PROGRESS',
        initialRoles: ['BACKEND'],
        projectId: project.id,
        title: `E05 결제 기능 ${runId}`,
        type: 'FEATURE',
      },
      method: 'POST',
    });
    const feature = createdFeature.issue;
    expect(createdFeature.createdTeamTasks).toHaveLength(1);
    const backendSummary = createdFeature.createdTeamTasks.find(
      (task) => task.projectRole === 'BACKEND',
    );
    if (!backendSummary) throw new Error('E05 자동 생성 백엔드 작업을 찾지 못했습니다.');
    const backend = await apiRequest<IssueDetailResponseDto>(
      page,
      `/issues/${encodeURIComponent(backendSummary.id)}`,
    );
    expect(backend.status.workflowState?.id).toBe(apiDefault.id);

    await page.goto(`/issues/${feature.identifier}`);
    await expect(page.getByRole('progressbar', { name: '0/1 완료 · 0%' })).toHaveAttribute(
      'value',
      '0',
    );
    await page.getByRole('tab', { name: '연결' }).click();
    await expect(page.getByText('전달 후 생성')).toHaveCount(2);
    await expect(page.getByText(/0\/0 완료/)).toHaveCount(0);
    await page.getByRole('link', { name: `${backend.identifier} · ${backend.title}` }).click();
    await expect(page.getByLabel('이슈 제목')).toHaveValue(backend.title);
    await expect(page.getByRole('button', { name: '전달하고 완료' })).toBeEnabled();
    await selectOption(page, '상태', apiCompleted.name);

    const handoffDialog = page.getByRole('dialog', { name: '작업 전달 후 완료' });
    await expect(handoffDialog.getByRole('checkbox', { name: '웹 프론트' })).toBeChecked();
    await expect(handoffDialog.getByRole('checkbox', { name: '앱 프론트' })).toBeChecked();
    const handoffEditor = handoffDialog.getByRole('textbox', {
      name: 'Markdown 본문 편집기',
    });
    const frontendNotice = handoffEditor.locator('p').last();
    await expect(frontendNotice).toHaveText('해당 없음');
    await frontendNotice.click();
    await page.keyboard.press('End');
    await page.keyboard.insertText(` · ${handoffNote}`);
    await expect(frontendNotice).toContainText(handoffNote);
    const completedRequest = page.waitForRequest(
      (request) =>
        request.method() === 'PATCH' &&
        new URL(request.url()).pathname === `/api/v1/issues/${backend.id}`,
    );
    await expect(handoffDialog.getByRole('button', { name: '전달하고 완료' })).toBeEnabled();
    await handoffDialog.getByRole('button', { name: '전달하고 완료' }).click();
    const request = await completedRequest;
    const response = await request.response();
    expect(response, request.failure()?.errorText).not.toBeNull();
    if (!response) throw new Error('E05 이슈 완료 응답을 받지 못했습니다.');
    const responseBody: unknown = await response.json();
    expect(response.status(), JSON.stringify(responseBody)).toBe(200);
    const completedBackend = responseBody as UpdateIssueResponseDto;
    expect(completedBackend.status.category).toBe('COMPLETED');
    expect(completedBackend.handoffSummary).toMatchObject({ count: 1, hasInitial: true });
    if (!completedBackend.handoff) throw new Error('E05 최초 전달 응답을 찾지 못했습니다.');
    expect(completedBackend.blockRelations).toHaveLength(2);
    expect(completedBackend.updatedParentIssue?.progress).toEqual({
      completed: 1,
      percentage: 33,
      total: 3,
    });
    const webSummary = completedBackend.downstreamTeamTasks?.find(
      (task) => task.projectRole === 'WEB_FRONTEND',
    );
    const appSummary = completedBackend.downstreamTeamTasks?.find(
      (task) => task.projectRole === 'APP_FRONTEND',
    );
    if (!webSummary || !appSummary) throw new Error('E05 자동 생성 후행 작업을 찾지 못했습니다.');
    await expect(handoffDialog).toBeHidden();

    const [web, app] = await Promise.all([
      apiRequest<IssueDetailResponseDto>(page, `/issues/${encodeURIComponent(webSummary.id)}`),
      apiRequest<IssueDetailResponseDto>(page, `/issues/${encodeURIComponent(appSummary.id)}`),
    ]);
    expect(web.blocked).toBe(false);
    expect(app.blocked).toBe(false);
    expect(web.status.workflowState?.id).toBe(webDefault.id);
    expect(app.status.workflowState?.id).toBe(appDefault.id);

    await expect(page).toHaveURL(
      new RegExp(`/issues/${feature.identifier}\\?tab=relations#feature-progress-title$`),
    );
    await expect(page.getByRole('progressbar', { name: '1/3 완료 · 33%' })).toHaveAttribute(
      'value',
      '33',
    );
    await expect(page.getByText('완료 작업')).toBeVisible();
    const workflow = page.getByRole('region', { name: '작업 흐름' });
    await expect(workflow.getByText('현재 작업')).toHaveCount(3);
    const currentWork = workflow.getByRole('region', { name: '현재 작업' });
    await expect(
      currentWork.getByRole('link', { name: `${web.identifier} · ${web.title}` }),
    ).toBeVisible();
    await expect(
      currentWork.getByRole('link', { name: `${app.identifier} · ${app.title}` }),
    ).toBeVisible();
    await expect(workflow.getByRole('heading', { name: '작업 전달' })).toBeVisible();
    const workflowHandoff = workflow
      .getByRole('heading', { name: '최초 전달' })
      .locator('xpath=ancestor::article[1]');
    await expect(workflowHandoff).toContainText('M4 브라우저 사용자');
    await expect(workflowHandoff.getByRole('link', { name: /API-/ })).toBeVisible();
    await expect(workflowHandoff.getByRole('link', { name: /WEB-/ })).toBeVisible();
    await workflowHandoff.getByText('전체 전달 내용 보기').click();
    await expect(workflowHandoff.getByText(handoffNote, { exact: false })).toBeVisible();
    await page.getByRole('tab', { name: '활동' }).click();
    const featureActivity = page
      .getByRole('heading', { name: '활동' })
      .locator('xpath=ancestor::section[1]');
    await expect(featureActivity.getByText('백엔드 작업을 전달했습니다')).toBeVisible();
    await featureActivity.getByRole('link', { name: '전달 내용 보기' }).click();
    await expect(page.getByRole('tab', { name: '연결' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(`#handoff-${completedBackend.handoff.id} details`)).toHaveAttribute(
      'open',
      '',
    );

    await page.goto(
      `/issues/${web.identifier}?tab=relations#handoff-${completedBackend.handoff.id}`,
    );
    await expect(page).toHaveURL(
      new RegExp(`/issues/${web.identifier}\\?tab=work#handoff-${completedBackend.handoff.id}$`),
    );
    await expect(page.getByLabel('이슈 제목')).toHaveValue(web.title);
    await expect(page.getByRole('tab', { name: '업무' })).toHaveAttribute('aria-selected', 'true');
    const receivedHandoff = page
      .getByRole('heading', { name: '전달받은 내용' })
      .locator('xpath=ancestor::section[1]');
    await expect(receivedHandoff.getByRole('heading', { name: '최초 전달' })).toBeVisible();
    await expect(
      receivedHandoff.getByRole('link', { name: `${backend.identifier} · ${backend.title}` }),
    ).toBeVisible();
    await expect(
      receivedHandoff.getByRole('link', { name: `${feature.identifier} · ${feature.title}` }),
    ).toBeVisible();
    await expect(
      receivedHandoff.locator(`#handoff-${completedBackend.handoff.id} details`),
    ).toHaveAttribute('open', '');
    await expect(receivedHandoff.getByText(handoffNote, { exact: false })).toBeVisible();
    await page.goto(`/issues/${backend.identifier}`);
    await expect(page.getByLabel('이슈 제목')).toHaveValue(backend.title);
    await page.getByRole('tab', { name: '연결' }).click();
    const handoffHistory = page
      .getByRole('heading', { name: '전체 작업 전달 이력' })
      .locator('xpath=ancestor::section[1]');
    await expect(handoffHistory.getByRole('heading', { name: '최초 전달' })).toBeVisible();
    await handoffHistory.getByText('전체 전달 내용 보기', { exact: true }).click();
    await expect(handoffHistory.getByText(handoffNote, { exact: false })).toBeVisible();

    await page.goto(`/issues/${web.identifier}`);
    const webStartedResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        response.url().endsWith(`/api/v1/issues/${web.id}`) &&
        response.status() === 200,
    );
    await selectOption(page, '상태', webStarted.name);
    const startedWeb = (await (await webStartedResponse).json()) as IssueDetailResponseDto;
    expect(startedWeb.status.category).toBe('STARTED');

    const unchangedApp = await apiRequest<IssueDetailResponseDto>(
      page,
      `/issues/${encodeURIComponent(app.id)}`,
    );
    expect(unchangedApp.blocked).toBe(false);
    expect(unchangedApp.status.workflowState?.id).toBe(appDefault.id);
  } finally {
    await cleanupM2Users([email]);
    await clearM1RateLimits();
  }
});
