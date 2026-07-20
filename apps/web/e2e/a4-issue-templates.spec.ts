import { randomUUID } from 'node:crypto';

import { expect, type Page, test } from '@playwright/test';

import {
  cleanupM2Users,
  clearM1RateLimits,
  getLatestM1Token,
} from '../../../scripts/e2e/m1-auth-fixture';

type Session = { membership: { id: string } | null };
type Team = { id: string; key: string };
type TeamList = { items: Team[] };
type Project = {
  id: string;
  name: string;
  projectTeams: Array<{
    active: boolean;
    id: string;
    team: { id: string; key: string; name: string };
  }>;
};
type IssueTemplate = {
  archived: boolean;
  descriptionMarkdown: string;
  id: string;
  name: string;
  version: number;
};
type IssueTemplateList = { items: IssueTemplate[] };

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
      return { body: (await response.json()) as unknown, status: response.status };
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
  await page.getByLabel('표시 이름').fill('A4 브라우저 사용자');
  await page.getByLabel('이메일').fill(input.email);
  await page.getByLabel('비밀번호', { exact: true }).fill(input.password);
  await page.getByLabel('비밀번호 확인').fill(input.password);
  await page.getByRole('button', { name: '가입하기' }).click();
  await expect(page.getByRole('heading', { name: '이메일을 확인해 주세요' })).toBeVisible();

  const token = await getLatestM1Token(input.email, 'EMAIL_VERIFICATION');
  await page.goto(`/verify-email#token=${encodeURIComponent(token)}`);
  await page.getByRole('link', { name: '로그인' }).click();
  await page.getByLabel('이메일').fill(input.email);
  await page.getByLabel('비밀번호', { exact: true }).fill(input.password);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.getByRole('button', { name: '새 워크스페이스 만들기' }).click();
  await page.getByLabel('워크스페이스 이름').fill('A4 템플릿 워크스페이스');
  await page.getByLabel('슬러그').fill(input.slug);
  await page.getByRole('button', { name: '워크스페이스 만들기' }).click();
  await page.getByLabel('팀 이름').fill('웹');
  await page.getByLabel('팀 키').fill('WEB');
  await page.getByRole('button', { name: '팀 만들기' }).click();
  await page.getByRole('button', { name: '건너뛰기' }).click();
  await expect(page).toHaveURL(/\/my-issues$/u);
}

test('A4 템플릿 관리·적용·충돌·과거 이슈 불변성을 검증한다', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-chromium',
    '관리자 설정을 포함한 A4 전체 흐름은 데스크톱 Chromium에서 한 번 검증합니다.',
  );
  test.setTimeout(180_000);
  page.setDefaultTimeout(20_000);

  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const email = `a4.template.${runId}@example.com`;
  const password = `A4 템플릿 브라우저 검증 전용 비밀번호! ${runId}`;
  const templateName = `버그 신고 ${runId}`;
  const projectName = `A4 프로젝트 ${runId}`;
  const issueTitle = `A4 템플릿 적용 이슈 ${runId}`;

  await clearM1RateLimits();
  try {
    await completeOnboarding(page, { email, password, slug: `a4-${runId}` });
    const [session, teams] = await Promise.all([
      apiRequest<Session>(page, '/auth/session'),
      apiRequest<TeamList>(page, '/teams?includeArchived=false'),
    ]);
    const membership = session.membership;
    const webTeam = teams.items.find((team) => team.key === 'WEB');
    if (!membership || !webTeam) throw new Error('A4 프로젝트 준비 정보를 찾지 못했습니다.');
    const project = await apiRequest<Project>(page, '/projects', {
      body: {
        leadMembershipId: membership.id,
        name: projectName,
        teamIds: [webTeam.id],
        status: 'PLANNED',
      },
      method: 'POST',
    });
    const webProjectTeam = project.projectTeams.find(({ team }) => team.id === webTeam.id);
    if (!webProjectTeam) throw new Error('A4 프로젝트 참여 팀을 찾지 못했습니다.');

    await page.goto('/issues?create=1');
    const emptyTemplateDialog = page.getByRole('dialog', { name: '이슈 만들기' });
    await expect(emptyTemplateDialog).toBeVisible();
    await expect(emptyTemplateDialog.getByRole('button', { name: /^템플릿(?:$|:)/u })).toHaveCount(
      0,
    );
    await expect(emptyTemplateDialog.getByRole('button', { name: '파일 선택' })).toBeVisible();
    expect(
      await emptyTemplateDialog
        .locator('[data-slot="dialog-scroll-body"]')
        .evaluate((element) => element.scrollHeight <= element.clientHeight + 1),
    ).toBe(true);

    await page.goto('/settings/templates');
    await expect(page.getByRole('heading', { name: '이슈 템플릿', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '템플릿 만들기' }).first().click();
    const createDialog = page.getByRole('dialog', { name: '이슈 템플릿 만들기' });
    const templateEditor = createDialog.getByRole('textbox', {
      name: 'Markdown 본문 편집기',
    });
    await expect(templateEditor).toHaveCSS('resize', 'none');
    await expect(createDialog).toHaveCSS('overflow-y', 'hidden');
    await expect(createDialog.locator('[data-slot="dialog-scroll-body"]')).toHaveCSS(
      'overflow-y',
      'auto',
    );
    await createDialog.getByLabel('템플릿 이름').fill(templateName);
    await templateEditor.fill('## 최초 템플릿\n\n재현 절차를 적어 주세요.');
    await createDialog.getByLabel('기본 우선순위').click();
    await page.getByRole('option', { name: '높음', exact: true }).click();
    await createDialog.getByLabel('프로젝트 (선택)').click();
    await page.getByRole('option', { name: projectName, exact: true }).click();
    await createDialog.getByLabel('처음 작업할 팀 (선택)').click();
    await page.getByRole('option', { name: '웹', exact: true }).click();
    await createDialog.getByRole('button', { name: '템플릿 저장' }).click();
    await expect(createDialog).toBeHidden();
    await expect(page.getByText(templateName, { exact: true })).toBeVisible();

    const templateList = await apiRequest<IssueTemplateList>(
      page,
      '/issue-templates?includeArchived=true',
    );
    const createdTemplate = templateList.items.find((template) => template.name === templateName);
    if (!createdTemplate) throw new Error('A4 생성 템플릿을 찾지 못했습니다.');

    await page.goto('/issues?create=1');
    const issueDialog = page.getByRole('dialog', { name: '이슈 만들기' });
    const titleInput = issueDialog.getByRole('textbox', { name: '제목', exact: true });
    await titleInput.focus();
    await titleInput.pressSequentially(issueTitle);
    const editor = issueDialog.getByRole('textbox', { name: 'Markdown 본문 편집기' });
    await expect(editor).toHaveCSS('resize', 'none');
    await expect(issueDialog).toHaveCSS('overflow-y', 'hidden');
    await expect(issueDialog.locator('[data-slot="dialog-scroll-body"]')).toHaveCSS(
      'overflow-y',
      'auto',
    );
    const templateTrigger = issueDialog.getByRole('button', { name: /^템플릿(?:$|:)/u });
    expect(
      await templateTrigger.evaluate((trigger, titleId) => {
        const titleInput = document.getElementById(titleId);
        return Boolean(
          titleInput &&
          trigger.compareDocumentPosition(titleInput) & Node.DOCUMENT_POSITION_FOLLOWING,
        );
      }, 'issue-create-title'),
    ).toBe(true);
    await editor.fill('사용자가 먼저 입력한 설명');
    await templateTrigger.click();
    await page.getByRole('option', { name: templateName, exact: true }).click();
    const overwrite = page.getByRole('alertdialog', {
      name: '입력한 값을 템플릿으로 바꿀까요?',
    });
    await expect(overwrite.getByText('설명', { exact: false })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(overwrite).toBeHidden();
    await expect(editor).toHaveText('사용자가 먼저 입력한 설명');
    await expect(templateTrigger).toBeFocused();

    const serverLatest = await apiRequest<IssueTemplate>(
      page,
      `/issue-templates/${createdTemplate.id}`,
      {
        body: {
          descriptionMarkdown: '## 최신 템플릿\n\n서버에서 바뀐 설명',
          version: createdTemplate.version,
        },
        method: 'PATCH',
      },
    );
    await templateTrigger.click();
    await page.getByRole('option', { name: templateName, exact: true }).click();
    const refetchedTemplates = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/issue-templates' &&
        response.request().method() === 'GET',
    );
    await page
      .getByRole('alertdialog', { name: '입력한 값을 템플릿으로 바꿀까요?' })
      .getByRole('button', { name: '템플릿 적용' })
      .click();
    await refetchedTemplates;
    await expect(page.getByText('템플릿을 다시 선택해 주세요')).toBeVisible();
    await expect(editor).toHaveText('사용자가 먼저 입력한 설명');

    await expect(templateTrigger).toBeEnabled();
    await templateTrigger.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    const applyAction = page
      .getByRole('alertdialog', { name: '입력한 값을 템플릿으로 바꿀까요?' })
      .getByRole('button', { name: '템플릿 적용' });
    const latestApplyResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/v1/issue-templates/${createdTemplate.id}/apply` &&
        response.request().method() === 'POST',
    );
    await applyAction.press('Enter');
    expect((await latestApplyResponse).status()).toBe(200);
    await expect(editor).toContainText('서버에서 바뀐 설명');
    await expect(titleInput).toHaveValue(issueTitle);
    await expect(templateTrigger).toHaveAccessibleName(`템플릿: ${templateName}`);
    await issueDialog.getByRole('button', { name: /^참여 팀(?:$|:)/u }).click();
    await expect(page.getByRole('checkbox', { name: '웹' })).toBeChecked();
    await page.keyboard.press('Escape');

    await editor.fill('사용자가 적용 후 수정한 설명');
    await expect(editor).toHaveText('사용자가 적용 후 수정한 설명');
    const createIssue = issueDialog.getByRole('button', { name: '이슈 만들기', exact: true });
    await createIssue.focus();
    await page.keyboard.press('Enter');
    await expect(issueDialog).toBeHidden();
    await expect(page.getByRole('heading', { name: issueTitle })).toBeVisible();
    await expect(page.getByText('사용자가 적용 후 수정한 설명')).toBeVisible();
    const issueUrl = page.url();

    const changedAgain = await apiRequest<IssueTemplate>(
      page,
      `/issue-templates/${createdTemplate.id}`,
      {
        body: {
          descriptionMarkdown: '과거 이슈에 반영되면 안 되는 설명',
          version: serverLatest.version,
        },
        method: 'PATCH',
      },
    );
    await page.reload();
    await expect(page.getByText('사용자가 적용 후 수정한 설명')).toBeVisible();
    await expect(page.getByText('과거 이슈에 반영되면 안 되는 설명')).toHaveCount(0);

    await page.goto('/settings/templates');
    await page.getByRole('button', { name: `${templateName} 보관` }).click();
    const archiveDialog = page.getByRole('alertdialog', {
      name: '이슈 템플릿을 보관할까요?',
    });
    await archiveDialog.getByRole('button', { name: '템플릿 보관' }).click();
    await page.getByRole('tab', { name: '보관됨' }).click();
    await expect(page.getByText(templateName, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: `${templateName} 복구` })).toBeVisible();

    await page.goto('/issues?create=1');
    const nextIssueDialog = page.getByRole('dialog', { name: '이슈 만들기' });
    await expect(nextIssueDialog.getByRole('button', { name: /^템플릿(?:$|:)/u })).toHaveCount(0);

    await page.goto('/settings/templates');
    await page.getByRole('tab', { name: '보관됨' }).click();
    await page.getByRole('button', { name: `${templateName} 복구` }).click();
    const restoreDialog = page.getByRole('alertdialog', {
      name: '이슈 템플릿을 복구할까요?',
    });
    await restoreDialog.getByRole('button', { name: '템플릿 복구' }).click();
    await page.getByRole('tab', { name: '활성' }).click();
    await expect(page.getByText(templateName, { exact: true })).toBeVisible();

    await page.goto('/issues?create=1');
    const restoredIssueDialog = page.getByRole('dialog', { name: '이슈 만들기' });
    const restoredTemplateTrigger = restoredIssueDialog.getByRole('button', {
      name: /^템플릿(?:$|:)/u,
    });
    await expect(restoredTemplateTrigger).toBeVisible();
    await restoredTemplateTrigger.click();
    await expect(page.getByRole('option', { name: templateName, exact: true })).toBeVisible();
    await page.goto(issueUrl);
    await expect(page.getByText('사용자가 적용 후 수정한 설명')).toBeVisible();
    expect(changedAgain.archived).toBe(false);
  } finally {
    await cleanupM2Users([email]);
    await clearM1RateLimits();
  }
});

test('빈 템플릿 로딩과 적용 후 보관된 템플릿의 입력·포커스를 보존한다', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-chromium',
    'A4 템플릿 동시성 엣지케이스는 데스크톱 Chromium에서 한 번 검증합니다.',
  );
  test.setTimeout(180_000);
  page.setDefaultTimeout(20_000);

  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const email = `a4.template.edge.${runId}@example.com`;
  const password = `A4 템플릿 엣지 브라우저 검증 전용 비밀번호! ${runId}`;
  const templateName = `보관 재현 ${runId}`;
  const issueTitle = `보관 재현 이슈 ${runId}`;

  await clearM1RateLimits();
  try {
    await completeOnboarding(page, { email, password, slug: `a4-edge-${runId}` });

    let releaseTemplateList: (() => void) | undefined;
    await page.route('**/api/v1/issue-templates', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await new Promise<void>((resolve) => {
        releaseTemplateList = resolve;
      });
      await route.continue();
    });
    await page.goto('/issues?create=1');
    const emptyDialog = page.getByRole('dialog', { name: '이슈 만들기' });
    await expect(emptyDialog).toBeVisible();
    const templateTrigger = emptyDialog.getByRole('button', { name: /^템플릿(?:$|:)/u });
    await expect(templateTrigger).toHaveCount(0);
    if (!releaseTemplateList) throw new Error('템플릿 목록 지연 요청을 찾지 못했습니다.');
    releaseTemplateList();
    await expect(templateTrigger).toHaveCount(0);
    await page.unroute('**/api/v1/issue-templates');

    const [session, teams] = await Promise.all([
      apiRequest<Session>(page, '/auth/session'),
      apiRequest<TeamList>(page, '/teams?includeArchived=false'),
    ]);
    const membership = session.membership;
    const webTeam = teams.items.find((team) => team.key === 'WEB');
    if (!membership || !webTeam) throw new Error('A4 엣지 프로젝트 준비 정보를 찾지 못했습니다.');
    const project = await apiRequest<Project>(page, '/projects', {
      body: {
        leadMembershipId: membership.id,
        name: `A4 엣지 프로젝트 ${runId}`,
        teamIds: [webTeam.id],
        status: 'PLANNED',
      },
      method: 'POST',
    });
    const projectTeam = project.projectTeams.find(({ team }) => team.id === webTeam.id);
    if (!projectTeam) throw new Error('A4 엣지 프로젝트 참여 팀을 찾지 못했습니다.');
    const template = await apiRequest<IssueTemplate>(page, '/issue-templates', {
      body: {
        descriptionMarkdown: '보관 뒤에도 보존할 설명',
        initialProjectTeamId: projectTeam.id,
        labelIds: [],
        name: templateName,
        priority: 'MEDIUM',
        projectId: project.id,
      },
      method: 'POST',
    });

    await page.goto('/issues?create=1');
    const issueDialog = page.getByRole('dialog', { name: '이슈 만들기' });
    const titleInput = issueDialog.getByRole('textbox', { name: '제목', exact: true });
    const editor = issueDialog.getByRole('textbox', { name: 'Markdown 본문 편집기' });
    await titleInput.fill(issueTitle);
    const activeTemplateTrigger = issueDialog.getByRole('button', {
      name: /^템플릿(?:$|:)/u,
    });
    await activeTemplateTrigger.click();
    await page.getByRole('option', { name: templateName, exact: true }).click();
    await expect(activeTemplateTrigger).toHaveAccessibleName(`템플릿: ${templateName}`);

    await apiRequest<IssueTemplate>(page, `/issue-templates/${template.id}/archive`, {
      body: { version: template.version },
      method: 'POST',
    });
    await issueDialog.getByRole('button', { name: '이슈 만들기', exact: true }).click();

    await expect(page.getByText('적용한 템플릿을 더 이상 사용할 수 없습니다')).toBeVisible();
    await expect(issueDialog.getByRole('button', { name: /^템플릿(?:$|:)/u })).toHaveCount(0);
    await expect(titleInput).toHaveValue(issueTitle);
    await expect(editor).toContainText('보관 뒤에도 보존할 설명');
    await expect(titleInput).toBeFocused();
    const createIssue = issueDialog.getByRole('button', { name: '이슈 만들기', exact: true });
    await expect(createIssue).toBeDisabled();
    await issueDialog.getByRole('button', { name: '템플릿 사용 안 함' }).click();
    await expect(createIssue).toBeEnabled();
    await createIssue.click();
    await expect(issueDialog).toBeHidden();
    await expect(page.getByRole('heading', { name: issueTitle })).toBeVisible();
  } finally {
    await cleanupM2Users([email]);
    await clearM1RateLimits();
  }
});
