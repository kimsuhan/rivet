import { randomUUID } from 'node:crypto';

import { expect, type Page, test, type TestInfo } from '@playwright/test';

import {
  createPrismaClient,
  NotificationType,
  type ProjectRole,
} from '../../../packages/database/src';
import {
  cleanupM2Users,
  clearM1RateLimits,
  getLatestM1Token,
} from '../../../scripts/e2e/m1-auth-fixture';

type Session = {
  membership: { id: string } | null;
  workspace: { id: string } | null;
};
type Team = { id: string; key: string };
type TeamList = { items: Team[] };
type Project = { id: string; name: string };
type WorkflowState = { category: string; id: string; isDefault: boolean; name: string };
type WorkflowStateList = { items: WorkflowState[] };
type Issue = { id: string; identifier: string; status: string; title: string; version: number };
type TeamWork = {
  id: string;
  identifier: string;
  issue: Issue;
  version: number;
  workflowState: WorkflowState;
};
type IssueDetail = {
  handoffFlows: Array<{ id: string; kind: 'FOLLOW_UP' | 'INITIAL' }>;
};

async function captureIssueStep(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
}

async function selectTeamWork(page: Page, identifier: string, isMobile: boolean): Promise<void> {
  if (isMobile) {
    await page.getByLabel('팀 작업 전환').click();
    await page
      .locator('[data-slot="select-content"]')
      .getByRole('option', { name: new RegExp(`^${identifier}\\s·`, 'u') })
      .click();
    return;
  }

  await page
    .getByRole('navigation', { name: '팀 작업 선택' })
    .getByText(identifier, { exact: true })
    .click();
}

async function apiRequest<T>(
  page: Page,
  path: string,
  options: { body?: unknown; method?: 'GET' | 'PATCH' | 'POST' } = {},
): Promise<T> {
  const result = await page.evaluate(
    async ({ body, method, path }) => {
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
    { body: options.body ?? null, method: options.method ?? 'GET', path },
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
  await page.getByLabel('표시 이름').fill('M9 브라우저 사용자');
  await page.getByLabel('이메일').fill(input.email);
  await page.getByLabel('비밀번호', { exact: true }).fill(input.password);
  await page.getByLabel('비밀번호 확인').fill(input.password);
  await page.getByRole('button', { name: '가입하기' }).click();
  await expect(page.getByRole('heading', { name: '요청을 접수했습니다' })).toBeVisible();

  const token = await getLatestM1Token(input.email, 'EMAIL_VERIFICATION');
  await page.goto(`/verify-email#token=${encodeURIComponent(token)}`);
  await expect(page.getByRole('heading', { name: '이메일 인증을 마쳤습니다' })).toBeVisible();
  await page.getByRole('link', { name: '로그인' }).click();
  await page.getByLabel('이메일').fill(input.email);
  await page.getByLabel('비밀번호', { exact: true }).fill(input.password);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding\/workspace$/u);
  await page.getByLabel('워크스페이스 이름').fill('M9 브라우저 워크스페이스');
  await page.getByLabel('슬러그').fill(input.slug);
  await page.getByRole('button', { name: '워크스페이스 만들기' }).click();
  await page.getByLabel('팀 이름').fill('웹');
  await page.getByLabel('팀 키').fill('WEB');
  await page.getByRole('button', { name: '팀 만들기' }).click();
  await page.getByRole('button', { name: '건너뛰기' }).click();
  await expect(page).toHaveURL(/\/my-issues$/u);
}

async function createIssueFromDialog(
  page: Page,
  input: { initialBackend: boolean; projectName: string; title: string; withAttachment: boolean },
): Promise<void> {
  await page.goto('/issues?create=1');
  const dialog = page.getByRole('dialog', { name: '이슈 만들기' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: '제목', exact: true }).fill(input.title);
  await dialog.getByLabel('프로젝트').click();
  await page
    .locator('[data-slot="select-content"]')
    .getByRole('option', { name: input.projectName, exact: true })
    .click();
  await dialog
    .getByRole('textbox', { name: 'Markdown 본문 편집기' })
    .fill('# 공유 설명\n\n모든 팀 작업이 같은 본문을 사용합니다.');
  if (input.initialBackend) await dialog.getByRole('checkbox', { name: '백엔드' }).click();
  if (input.withAttachment) {
    await dialog.getByRole('button', { name: '파일 선택' }).setInputFiles({
      buffer: Buffer.from('M9 shared attachment', 'utf8'),
      mimeType: 'text/plain',
      name: 'm9-shared.txt',
    });
    await expect(dialog.getByText('업로드 완료')).toBeVisible();
  }
  await dialog.getByRole('button', { name: '이슈 만들기', exact: true }).click();
  await expect(dialog).toBeHidden();
}

test('M9 이슈 콘텐츠와 팀 실행의 정본 통합 흐름을 검증한다', async ({
  page,
  isMobile,
}, testInfo) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(20_000);
  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const email = `m9.browser.${runId}@example.com`;
  const password = `M9 브라우저 검증 전용 비밀번호! ${runId}`;
  const projectName = `M9 통합 프로젝트 ${runId}`;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('M9 E2E DATABASE_URL이 필요합니다.');
  const database = createPrismaClient({
    connectionTimeoutMs: 5_000,
    databaseUrl,
    idleTimeoutMs: 10_000,
    poolMax: 2,
  });

  await clearM1RateLimits();
  try {
    await completeOnboarding(page, { email, password, slug: `m9-${runId}` });
    const [session, teams] = await Promise.all([
      apiRequest<Session>(page, '/auth/session'),
      apiRequest<TeamList>(page, '/teams?includeArchived=false'),
    ]);
    const membership = session.membership;
    const workspace = session.workspace;
    const webTeam = teams.items.find((team) => team.key === 'WEB');
    if (!membership || !workspace || !webTeam)
      throw new Error('M9 사용자와 WEB 팀을 준비하지 못했습니다.');
    const apiTeam = await apiRequest<Team>(page, '/teams', {
      body: { key: 'API', memberIds: [membership.id], name: '백엔드' },
      method: 'POST',
    });
    await apiRequest<Project>(page, '/projects', {
      body: {
        leadMembershipId: membership.id,
        name: projectName,
        roleTeams: [
          { role: 'BACKEND' satisfies ProjectRole, teamId: apiTeam.id },
          { role: 'WEB_FRONTEND' satisfies ProjectRole, teamId: webTeam.id },
        ],
        status: 'PLANNED',
      },
      method: 'POST',
    });

    await createIssueFromDialog(page, {
      initialBackend: false,
      projectName,
      title: `시작 역할 없는 이슈 ${runId}`,
      withAttachment: true,
    });
    await expect(page).toHaveURL(/\/issues\/F-\d+\?tab=work$/u);
    await expect(page.getByRole('heading', { name: `시작 역할 없는 이슈 ${runId}` })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: '이슈에서 팀 작업을 시작하세요' }),
    ).toBeVisible();
    await expect(page.getByText('모든 팀 작업이 같은 본문을 사용합니다.')).toBeVisible();
    await expect(page.getByText('m9-shared.txt')).toBeVisible();
    await page.getByRole('checkbox', { name: '웹 프론트' }).click();
    await page.getByRole('button', { name: '선택한 작업 시작' }).click();
    await expect(page.getByRole('button', { name: /: 담당자를 선택해 주세요$/u })).toBeVisible();
    await captureIssueStep(page, testInfo, 'frontend-only-ready');

    const editor = page.getByRole('textbox', { name: 'Markdown 본문 편집기' }).first();
    await editor.fill('공유 댓글도 이슈에 한 번만 남습니다.');
    await page.getByRole('button', { name: '댓글 남기기' }).click();
    await expect(page.getByText('공유 댓글도 이슈에 한 번만 남습니다.')).toBeVisible();

    await createIssueFromDialog(page, {
      initialBackend: true,
      projectName,
      title: `초기 백엔드 이슈 ${runId}`,
      withAttachment: false,
    });
    await expect(page).toHaveURL(/\/issues\/F-\d+\?tab=work&work=/u);
    const issueIdentifier = (
      await page.locator('article header p.font-mono').first().textContent()
    )?.trim();
    const backendIdentifier = isMobile
      ? (await page.getByLabel('팀 작업 전환').textContent())?.split(' · ')[0]?.trim()
      : (
          await page
            .getByRole('navigation', { name: '팀 작업 선택' })
            .locator('a')
            .first()
            .locator('span')
            .first()
            .textContent()
        )?.trim();
    if (!issueIdentifier || !backendIdentifier)
      throw new Error('M9 이슈와 백엔드 작업 표시 ID를 찾지 못했습니다.');

    await page.getByLabel(/팀 작업 담당자/u).click();
    await page
      .locator('[data-slot="select-content"]')
      .getByRole('option', { name: 'M9 브라우저 사용자', exact: true })
      .click();
    await expect(page.getByText('담당자 저장 중…')).toBeVisible();
    await expect(page.getByRole('heading', { name: `초기 백엔드 이슈 ${runId}` })).toBeVisible();
    await expect(page.getByText('모든 팀 작업이 같은 본문을 사용합니다.')).toBeVisible();
    await expect(page.getByText('담당자 저장 중…')).toBeHidden();

    await page.getByRole('checkbox', { name: '웹 프론트' }).click();
    await page.getByRole('button', { name: '선택한 작업 시작' }).click();
    await expect(page).toHaveURL(/&work=WEB-/u);
    const webIdentifier = new URL(page.url()).searchParams.get('work');
    if (!webIdentifier) throw new Error('M9 웹 팀 작업 표시 ID를 찾지 못했습니다.');
    await expect(page.getByText('모든 팀 작업이 같은 본문을 사용합니다.')).toBeVisible();
    await expect(page.getByRole('button', { name: /: 담당자를 선택해 주세요$/u })).toBeVisible();

    // 백엔드의 API 전달을 기다리지 않고 프론트 작업을 담당자 지정과 함께 즉시 시작할 수 있다.
    await page.getByLabel(/팀 작업 담당자/u).click();
    await page
      .locator('[data-slot="select-content"]')
      .getByRole('option', { name: 'M9 브라우저 사용자', exact: true })
      .click();
    await expect(page.getByText('담당자 저장 중…')).toBeHidden();
    await expect(page.getByRole('button', { name: /: 작업 시작$/u })).toBeVisible();
    await page.getByRole('button', { name: /: 작업 시작$/u }).click();
    await expect(page.getByRole('button', { name: /: 완료$/u })).toBeVisible();

    const workNoteRegion = page.getByRole('region', { name: '작업 노트' });
    await workNoteRegion.getByRole('button', { name: '작업 노트 편집' }).click();
    await workNoteRegion
      .getByRole('textbox', { name: 'Markdown 본문 편집기' })
      .fill('웹 구현 시 응답 계약을 확인합니다.');
    const noteResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/team-works/') && response.request().method() === 'PATCH',
    );
    await workNoteRegion.getByRole('button', { name: '노트 저장' }).click();
    const savedNote = await noteResponse;
    expect(savedNote.status(), await savedNote.text()).toBe(200);
    await page.reload();
    await expect(page.getByText('웹 구현 시 응답 계약을 확인합니다.')).toBeVisible();
    await expect(page.getByLabel('선행 팀 작업')).toHaveCount(0);
    await captureIssueStep(page, testInfo, 'api-handoff-pending');

    await page.goto(`/my-issues`);
    await expect(page.getByRole('heading', { name: '내 작업' })).toBeVisible();
    await page.getByText(backendIdentifier, { exact: true }).click();
    await expect(page).toHaveURL(
      new RegExp(`/my-issues/${backendIdentifier}\\?tab=work$`, 'u'),
    );
    await expect(page.getByRole('link', { name: '내 작업', exact: true })).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/my-issues/${backendIdentifier}\\?tab=work$`, 'u'));
    await page.getByRole('link', { name: '전달', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/my-issues/${backendIdentifier}\\?tab=handoffs$`, 'u'));
    await page.goto(`/teams/${encodeURIComponent(apiTeam.key)}/issues`);
    await page.getByText(backendIdentifier, { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`work=${backendIdentifier}$`, 'u'));

    const backendStates = await apiRequest<WorkflowStateList>(
      page,
      `/teams/${apiTeam.id}/workflow-states`,
    );
    const backendDone = backendStates.items.find((state) => state.category === 'COMPLETED');
    if (!backendDone) throw new Error('M9 백엔드 완료 상태를 찾지 못했습니다.');
    await page.getByLabel(/팀 작업 상태/u).click();
    await page
      .locator('[data-slot="select-content"]')
      .getByRole('option', { name: '완료', exact: true })
      .click();
    const backendCompletionDialog = page.getByRole('dialog', { name: /완료$/u });
    await expect(backendCompletionDialog).toBeVisible();
    await backendCompletionDialog.getByText('프론트에 전달 후 완료').click();
    await backendCompletionDialog
      .getByRole('textbox', { name: 'Markdown 본문 편집기' })
      .fill('## 변경 요약\n\n웹 구현에 필요한 API 응답을 배포했습니다.');
    await backendCompletionDialog.getByRole('button', { name: '전달하고 완료' }).click();
    await expect(backendCompletionDialog).toBeHidden();
    await expect(page.getByText('최초 전달 #1')).toBeVisible();

    await selectTeamWork(page, webIdentifier, isMobile);
    await expect(page.getByRole('button', { name: /: 완료$/u })).toBeVisible();
    await page.getByRole('button', { name: '내용 펼치기' }).click();
    await expect(page.getByText('웹 구현에 필요한 API 응답을 배포했습니다.')).toBeVisible();
    await captureIssueStep(page, testInfo, 'received-initial-handoff');
    const webStates = await apiRequest<WorkflowStateList>(
      page,
      `/teams/${webTeam.id}/workflow-states`,
    );
    const webDone = webStates.items.find((state) => state.category === 'COMPLETED');
    if (!webDone) throw new Error('M9 웹 완료 상태를 찾지 못했습니다.');
    await page.getByRole('button', { name: /: 완료$/u }).click();
    const webCompletionDialog = page.getByRole('dialog', { name: /완료$/u });
    await expect(webCompletionDialog).toBeVisible();
    await expect(webCompletionDialog.getByText('작업 전달은 필요하지 않습니다.')).toBeVisible();
    await webCompletionDialog.getByRole('button', { name: '완료', exact: true }).click();
    await expect(webCompletionDialog).toBeHidden();
    await expect(page.getByText('완료 확인')).toBeVisible();
    await page.getByRole('button', { name: '이슈 완료' }).click();
    await expect(page.getByText('완료', { exact: true }).first()).toBeVisible();

    await selectTeamWork(page, backendIdentifier, isMobile);
    await page.getByRole('button', { name: '추가 전달 작성' }).click();
    const followUpDialog = page.getByRole('dialog', { name: '추가 전달 작성' });
    await expect(followUpDialog).toBeVisible();
    await expect(followUpDialog.getByText('알림 대상')).toBeVisible();
    await followUpDialog
      .getByRole('textbox', { name: 'Markdown 본문 편집기' })
      .fill('## 변경 요약\n\n응답 필드 설명을 보완했습니다.');
    await followUpDialog.getByRole('button', { name: '추가 전달 저장' }).click();
    await expect(page.getByText('추가 전달 #2이 이력에 저장되었습니다')).toBeVisible();
    await expect(page.getByText('추가 전달 #2')).toBeVisible();

    const issueDetail = await apiRequest<IssueDetail>(page, `/issues/${issueIdentifier}`);
    const followUp = issueDetail.handoffFlows.find((handoff) => handoff.kind === 'FOLLOW_UP');
    if (!followUp) throw new Error('M9 추가 전달을 찾지 못했습니다.');

    const work = await apiRequest<TeamWork>(
      page,
      `/team-works/${encodeURIComponent(webIdentifier)}`,
    );
    await database.notification.create({
      data: {
        eventId: randomUUID(),
        handoffId: followUp.id,
        issueId: work.issue.id,
        recipientMembershipId: membership.id,
        teamWorkId: work.id,
        type: NotificationType.API_HANDOFF_FOLLOW_UP_CREATED,
        workspaceId: workspace.id,
      },
    });
    await page.goto('/inbox');
    await page.getByText('API 추가 전달이 추가되었습니다.').first().click();
    await expect(page).toHaveURL(
      new RegExp(
        `/issues/${issueIdentifier}\\?tab=work&work=${webIdentifier}&handoff=${followUp.id}#handoff-${followUp.id}$`,
        'u',
      ),
    );
    await expect(page.getByText('응답 필드 설명을 보완했습니다.')).toBeVisible();
    await captureIssueStep(page, testInfo, 'follow-up-handoff-deep-link');

    await page.reload();
    await expect(page.getByRole('heading', { name: `초기 백엔드 이슈 ${runId}` })).toBeVisible();
    await page.goto(`/issues/${encodeURIComponent(backendIdentifier)}`);
    await expect(page).toHaveURL(
      new RegExp(`/issues/${issueIdentifier}\\?tab=work&work=${backendIdentifier}$`, 'u'),
    );
    await page.goto(`/issues/${issueIdentifier}?tab=work&work=${webIdentifier}`);
    await page.goto(`/issues/${issueIdentifier}?tab=work&work=${backendIdentifier}`);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`work=${webIdentifier}$`, 'u'));
    await expect(page.getByText('웹 구현 시 응답 계약을 확인합니다.')).toBeVisible();

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
    if (isMobile) {
      await expect(page.getByRole('navigation', { name: '모바일 주 탐색' })).toBeVisible();
      await expect(page.getByLabel('팀 작업 전환')).toBeVisible();
    }
  } finally {
    await database.$disconnect();
    await cleanupM2Users([email]);
  }
});
