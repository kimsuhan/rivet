import { randomUUID } from 'node:crypto';

import { expect, type Locator, type Page, test } from '@playwright/test';

import type {
  AuthenticatedSessionDto,
  IssueBlockRelationMutationResponseDto,
  IssueDetailResponseDto,
  ProjectResponseDto,
  TeamListResponseDto,
  TeamResponseDto,
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

async function createBlockRelation(
  page: Page,
  blockingIssueId: string,
  blockedIssueId: string,
): Promise<IssueBlockRelationMutationResponseDto> {
  const [blockingIssue, blockedIssue] = await Promise.all([
    apiRequest<IssueDetailResponseDto>(page, `/issues/${encodeURIComponent(blockingIssueId)}`),
    apiRequest<IssueDetailResponseDto>(page, `/issues/${encodeURIComponent(blockedIssueId)}`),
  ]);

  return apiRequest<IssueBlockRelationMutationResponseDto>(page, '/issue-block-relations', {
    body: {
      blockedIssueId,
      blockedIssueVersion: blockedIssue.version,
      blockingIssueId,
      blockingIssueVersion: blockingIssue.version,
    },
    method: 'POST',
  });
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
  const feature = await apiRequest<IssueDetailResponseDto>(page, '/issues', {
    body: {
      featureStatus: 'IN_PROGRESS',
      projectId: input.projectId,
      title: `M4 결제 기능 ${input.runId}`,
      type: 'FEATURE',
    },
    method: 'POST',
  });
  const backend = await apiRequest<IssueDetailResponseDto>(page, '/issues', {
    body: {
      assigneeMembershipId: input.assigneeMembershipId,
      parentIssueId: feature.id,
      priority: 'HIGH',
      projectId: input.projectId,
      projectRole: 'BACKEND',
      teamId: input.teamId,
      title: `M4 결제 API ${input.runId}`,
      type: 'TEAM_TASK',
      workflowStateId: input.defaultStateId,
    },
    method: 'POST',
  });
  const web = await apiRequest<IssueDetailResponseDto>(page, '/issues', {
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
  });

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
        page.getByRole('link', { name: new RegExp(hierarchy.feature.title) }),
      ).toBeVisible();
      await expect(
        page.getByRole('link', { name: new RegExp(hierarchy.backend.title) }),
      ).toBeVisible();
      await expect(page.getByRole('link', { name: new RegExp(hierarchy.web.title) })).toBeVisible();
      await expect(page.getByRole('link', { name: '프로젝트 편집' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: '기능 이슈 만들기' })).toHaveCount(0);
      await checkLayout(page, testInfo.project.name, 'detail-mobile');

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
    const featureCard = page
      .locator('[data-slot="card"]')
      .filter({ has: page.getByRole('link', { name: new RegExp(hierarchy.feature.title) }) });
    await expect(featureCard.getByText('1/2 · 50%')).toBeVisible();
    await expect(
      featureCard.getByRole('link', { name: new RegExp(hierarchy.backend.title) }),
    ).toBeVisible();
    await expect(
      featureCard.getByRole('link', { name: new RegExp(hierarchy.web.title) }),
    ).toBeVisible();

    await page.getByRole('link', { name: '기능 이슈 만들기' }).click();
    const featureCreateDialog = page.getByRole('dialog', { name: '이슈 만들기' });
    await expect(featureCreateDialog.getByRole('combobox', { name: '이슈 유형' })).toContainText(
      '기능 이슈',
    );
    await expect(featureCreateDialog.getByRole('combobox', { name: '프로젝트' })).toContainText(
      uiProjectName,
    );
    await featureCreateDialog.getByRole('button', { name: '이슈 만들기 닫기' }).click();

    await featureCard.getByRole('link', { name: '백엔드 작업 추가' }).click();
    const taskCreateDialog = page.getByRole('dialog', { name: '이슈 만들기' });
    await expect(taskCreateDialog.getByRole('combobox', { name: '이슈 유형' })).toContainText(
      '팀 작업',
    );
    await expect(taskCreateDialog.getByRole('combobox', { name: '프로젝트 역할' })).toContainText(
      '백엔드 · 웹',
    );
    await expect(taskCreateDialog.getByRole('combobox', { name: '상위 기능 이슈' })).toContainText(
      hierarchy.feature.title,
    );
    await taskCreateDialog.getByRole('button', { name: '이슈 만들기 닫기' }).click();
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
      page.getByRole('link', { name: new RegExp(hierarchy.backend.title) }),
    ).toBeHidden();
    await expect(page.getByRole('link', { name: new RegExp(hierarchy.web.title) })).toBeVisible();
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
    const feature = await apiRequest<IssueDetailResponseDto>(page, '/issues', {
      body: {
        featureStatus: 'IN_PROGRESS',
        projectId: project.id,
        title: `E05 결제 기능 ${runId}`,
        type: 'FEATURE',
      },
      method: 'POST',
    });
    const [backend, web, app] = await Promise.all([
      apiRequest<IssueDetailResponseDto>(page, '/issues', {
        body: {
          assigneeMembershipId: session.membership.id,
          parentIssueId: feature.id,
          priority: 'HIGH',
          projectId: project.id,
          projectRole: 'BACKEND',
          teamId: apiTeam.id,
          title: `E05 결제 API ${runId}`,
          type: 'TEAM_TASK',
          workflowStateId: apiDefault.id,
        },
        method: 'POST',
      }),
      apiRequest<IssueDetailResponseDto>(page, '/issues', {
        body: {
          assigneeMembershipId: session.membership.id,
          parentIssueId: feature.id,
          priority: 'MEDIUM',
          projectId: project.id,
          projectRole: 'WEB_FRONTEND',
          teamId: webTeam.id,
          title: `E05 결제 웹 ${runId}`,
          type: 'TEAM_TASK',
          workflowStateId: webDefault.id,
        },
        method: 'POST',
      }),
      apiRequest<IssueDetailResponseDto>(page, '/issues', {
        body: {
          assigneeMembershipId: session.membership.id,
          parentIssueId: feature.id,
          priority: 'MEDIUM',
          projectId: project.id,
          projectRole: 'APP_FRONTEND',
          teamId: appTeam.id,
          title: `E05 결제 앱 ${runId}`,
          type: 'TEAM_TASK',
          workflowStateId: appDefault.id,
        },
        method: 'POST',
      }),
    ]);

    await page.goto(`/issues/${backend.identifier}`);
    await expect(page.getByLabel('이슈 제목')).toHaveValue(backend.title);
    const backendRelations = page
      .getByRole('heading', { name: '차단 관계' })
      .locator('xpath=ancestor::section[1]');
    const webRelationName = `${web.identifier} · ${web.title}`;
    await selectOption(page, '관계 방향', '차단함', backendRelations);
    await selectOption(page, '연결할 팀 작업', webRelationName, backendRelations);
    await backendRelations.getByRole('button', { name: '관계 추가' }).click();
    await expect(backendRelations.getByRole('link', { name: webRelationName })).toBeVisible();

    await backendRelations.getByRole('button', { name: `${web.identifier} 관계 해제` }).click();
    await expect(backendRelations.getByRole('link', { name: webRelationName })).toHaveCount(0);
    await selectOption(page, '연결할 팀 작업', webRelationName, backendRelations);
    await backendRelations.getByRole('button', { name: '관계 추가' }).click();
    await expect(backendRelations.getByRole('link', { name: webRelationName })).toBeVisible();

    await page.goto(`/issues/${web.identifier}`);
    await expect(page.getByLabel('이슈 제목')).toHaveValue(web.title);
    const webRelations = page
      .getByRole('heading', { name: '차단 관계' })
      .locator('xpath=ancestor::section[1]');
    await selectOption(page, '관계 방향', '차단함', webRelations);
    await selectOption(
      page,
      '연결할 팀 작업',
      `${backend.identifier} · ${backend.title}`,
      webRelations,
    );
    await webRelations.getByRole('button', { name: '관계 추가' }).click();
    await expect(webRelations.getByRole('alert')).toContainText(
      '순환하는 차단 관계는 만들 수 없습니다.',
    );

    await createBlockRelation(page, backend.id, app.id);
    const [blockedWeb, blockedApp] = await Promise.all([
      apiRequest<IssueDetailResponseDto>(page, `/issues/${encodeURIComponent(web.id)}`),
      apiRequest<IssueDetailResponseDto>(page, `/issues/${encodeURIComponent(app.id)}`),
    ]);
    expect(blockedWeb.blocked).toBe(true);
    expect(blockedApp.blocked).toBe(true);

    await page.goto(`/issues/${backend.identifier}`);
    await expect(page.getByLabel('이슈 제목')).toHaveValue(backend.title);
    await selectOption(page, '상태', apiCompleted.name);

    const handoffDialog = page.getByRole('dialog', { name: '작업 전달 후 완료' });
    await expect(handoffDialog).toContainText(
      '미완료 프론트 작업의 차단을 해제하려면 최초 전달을 같은 변경에서 저장해야 합니다.',
    );
    await expect(
      page.getByRole('alert').filter({ hasText: '변경을 저장하지 못했습니다' }),
    ).toHaveCount(0);
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
    const completedBackend = responseBody as IssueDetailResponseDto;
    expect(completedBackend.status.category).toBe('COMPLETED');
    expect(completedBackend.handoffSummary).toMatchObject({ count: 1, hasInitial: true });
    await expect(handoffDialog).toBeHidden();

    const [unblockedWeb, unblockedApp] = await Promise.all([
      apiRequest<IssueDetailResponseDto>(page, `/issues/${encodeURIComponent(web.id)}`),
      apiRequest<IssueDetailResponseDto>(page, `/issues/${encodeURIComponent(app.id)}`),
    ]);
    expect(unblockedWeb.blocked).toBe(false);
    expect(unblockedApp.blocked).toBe(false);
    expect(unblockedWeb.status.workflowState?.id).toBe(webDefault.id);
    expect(unblockedApp.status.workflowState?.id).toBe(appDefault.id);

    await page.goto(`/issues/${web.identifier}`);
    await expect(page.getByLabel('이슈 제목')).toHaveValue(web.title);
    await page.goto(`/issues/${backend.identifier}`);
    await expect(page.getByLabel('이슈 제목')).toHaveValue(backend.title);
    const timeline = page
      .getByRole('heading', { name: '댓글과 활동' })
      .locator('xpath=ancestor::section[1]');
    await expect(timeline.getByRole('heading', { name: '최초 전달' })).toBeVisible();
    await timeline.getByText('전체 전달 내용 보기', { exact: true }).click();
    await expect(timeline.getByText(handoffNote, { exact: false })).toBeVisible();

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
