import { randomUUID } from 'node:crypto';

import { expect, type Locator, type Page, type Route, test } from '@playwright/test';

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

const ONE_PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

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
  await page.getByLabel('표시 이름').fill('M5 브라우저 사용자');
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
  await page.getByLabel('워크스페이스 이름').fill('M5 브라우저 워크스페이스');
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

function sectionByHeading(page: Page, name: string): Locator {
  return page.getByRole('heading', { exact: true, name }).locator('xpath=ancestor::section[1]');
}

async function failGets(page: Page, pattern: RegExp) {
  let failedCount = 0;
  const handler = async (route: Route) => {
    if (route.request().method() === 'GET') {
      failedCount += 1;
      await route.abort('failed');
      return;
    }
    await route.continue();
  };

  await page.route(pattern, handler);
  return {
    didFail: () => failedCount > 0,
    stop: () => page.unroute(pattern, handler),
  };
}

async function checkLayout(page: Page, projectName: string, stage: string): Promise<void> {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);

  const screenshotPrefix = process.env.RIVET_VISUAL_QA_PREFIX;
  if (screenshotPrefix) {
    await page.screenshot({
      fullPage: true,
      path: `${screenshotPrefix}-${projectName}-m5-${stage}.png`,
    });
  }
}

async function pasteImage(editor: Locator, name: string): Promise<void> {
  await editor.focus();
  await editor.evaluate(
    (element, input) => {
      const bytes = Uint8Array.from(atob(input.base64), (character) => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], input.name, { type: 'image/png' }));
      element.dispatchEvent(
        new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer,
        }),
      );
    },
    { base64: ONE_PIXEL_PNG, name },
  );
}

test('UF-08·UF-11 설명, 댓글과 첨부 흐름을 갱신 실패에도 보존한다', async ({
  page,
  isMobile,
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(12_000);

  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const email = `m5.browser.${runId}@example.com`;
  const password = `M5 브라우저 검증 전용 비밀번호! ${runId}`;
  const title = `M5 협업 흐름 ${runId}`;
  const initialDescription = `초기 협업 설명 ${runId}`;
  const updatedDescription = `수정한 협업 설명 ${runId}`;
  const initialAttachmentName = `m5-create-${runId}.txt`;
  const detailAttachmentName = `m5-detail-${runId}.txt`;
  const initialComment = `첫 협업 댓글 ${runId}`;
  const updatedComment = `수정한 협업 댓글 ${runId}`;
  const inlineImageName = `m5-inline-${runId}.png`;
  const inlineImageAlt = `M5 본문 이미지 ${runId}`;
  const profileImageName = `m5-profile-${runId}.png`;

  await clearM1RateLimits();

  try {
    await completeOnboarding(page, { email, password, slug: `m5-${runId}` });

    const [session, teams] = await Promise.all([
      apiRequest<AuthenticatedSessionDto>(page, '/auth/session'),
      apiRequest<TeamListResponseDto>(page, '/teams?includeArchived=false'),
    ]);
    const team = teams.items.find((item) => item.key === 'WEB');
    expect(team).toBeDefined();
    expect(session.membership).not.toBeNull();
    if (!team || !session.membership) throw new Error('M5 E2E 팀과 멤버십을 준비하지 못했습니다.');

    const states = await apiRequest<WorkflowStateListResponseDto>(
      page,
      `/teams/${encodeURIComponent(team.id)}/workflow-states`,
    );
    const defaultState = states.items.find((state) => state.isDefault);
    if (!defaultState) throw new Error('M5 E2E 기본 상태를 찾지 못했습니다.');

    let issue: IssueDetailResponseDto;

    if (isMobile) {
      issue = await apiRequest<IssueDetailResponseDto>(page, '/issues', {
        body: {
          attachmentFileIds: [],
          descriptionMarkdown: initialDescription,
          teamId: team.id,
          title,
          type: 'TEAM_TASK',
          workflowStateId: defaultState.id,
        },
        method: 'POST',
      });
      await page.goto(`/issues/${issue.identifier}`);
    } else {
      await page.goto('/teams/WEB/issues');
      await page.getByRole('button', { name: '이슈 만들기 열기' }).click();
      const createDialog = page.getByRole('dialog', { name: '이슈 만들기' });
      await createDialog.getByRole('textbox', { name: '제목' }).fill(title);
      await createDialog
        .getByRole('textbox', { name: 'Markdown 본문 편집기' })
        .fill(initialDescription);
      await createDialog
        .locator('label')
        .filter({ hasText: '파일 선택' })
        .locator('input[type="file"]')
        .setInputFiles({
          buffer: Buffer.from(`M5 생성 첨부 ${runId}`),
          mimeType: 'text/plain',
          name: initialAttachmentName,
        });
      await expect(createDialog.getByText('업로드 완료')).toBeVisible();

      const failedListRefresh = await failGets(page, /\/api\/v1\/issues(?:\?.*)?$/);
      await createDialog.getByRole('button', { exact: true, name: '이슈 만들기' }).click();
      await expect(page).toHaveURL(/\/issues\/WEB-\d+$/);
      await expect.poll(failedListRefresh.didFail).toBe(true);
      await failedListRefresh.stop();

      const identifier = new URL(page.url()).pathname.split('/').at(-1);
      if (!identifier) throw new Error('M5 E2E 생성 이슈 식별자를 찾지 못했습니다.');
      issue = await apiRequest<IssueDetailResponseDto>(page, `/issues/${identifier}`);
      expect(issue.attachments.map((attachment) => attachment.file.originalName)).toContain(
        initialAttachmentName,
      );
    }

    await expect(page.getByLabel('이슈 제목')).toHaveValue(title);
    await expect(sectionByHeading(page, '설명').getByText(initialDescription)).toBeVisible();
    if (!isMobile) {
      await expect(
        sectionByHeading(page, '첨부파일').getByRole('button', {
          name: `${initialAttachmentName} 다운로드`,
        }),
      ).toBeVisible();
    }
    await checkLayout(page, testInfo.project.name, 'initial');

    const description = sectionByHeading(page, '설명');
    await description.getByRole('button', { name: '설명 편집' }).click();
    const descriptionEditor = description.getByRole('textbox', {
      name: 'Markdown 본문 편집기',
    });
    await descriptionEditor.fill(updatedDescription);
    await description.getByRole('combobox', { name: '멤버 멘션' }).selectOption({
      label: 'M5 브라우저 사용자',
    });
    await pasteImage(descriptionEditor, inlineImageName);
    const inlineImageAltInput = description.getByLabel('이미지 대체 텍스트');
    await expect(inlineImageAltInput).toBeEnabled({ timeout: 20_000 });
    await inlineImageAltInput.fill(inlineImageAlt);
    await description.getByRole('button', { name: '설명 저장' }).click();
    await expect(description.getByText(updatedDescription, { exact: false })).toBeVisible();
    await expect(description.locator('[data-mention-membership-id]')).toHaveText(
      '@M5 브라우저 사용자',
    );
    await expect(description.getByRole('img', { name: inlineImageAlt })).toBeVisible();

    const timeline = sectionByHeading(page, '댓글과 활동');
    await timeline.getByRole('textbox', { name: 'Markdown 본문 편집기' }).fill(initialComment);
    const failedTimelineRefresh = await failGets(
      page,
      new RegExp(`/api/v1/issues/${issue.id}/timeline(?:\\?.*)?$`),
    );
    await timeline.getByRole('button', { name: '댓글 남기기' }).click();
    await expect(timeline.getByText(initialComment)).toBeVisible();
    await expect.poll(failedTimelineRefresh.didFail).toBe(true);
    await expect(timeline.getByText('활동을 불러오지 못했습니다')).toBeVisible();
    await failedTimelineRefresh.stop();
    await timeline.getByRole('button', { name: '다시 시도' }).click();
    await expect(timeline.getByText('활동을 불러오지 못했습니다')).toBeHidden();

    const commentElementId = await timeline
      .getByText(initialComment)
      .locator('xpath=ancestor::li[1]')
      .getAttribute('id');
    if (!commentElementId) throw new Error('M5 E2E 댓글 요소 ID를 찾지 못했습니다.');
    const commentItem = timeline.locator(`[id="${commentElementId}"]`);
    await commentItem.getByRole('button', { name: '댓글 편집' }).click();
    await commentItem.getByRole('textbox', { name: 'Markdown 본문 편집기' }).fill(updatedComment);
    await commentItem.getByRole('button', { name: '댓글 저장' }).click();
    await expect(timeline.getByText(updatedComment)).toBeVisible();

    await commentItem.getByRole('button', { name: '댓글 삭제' }).click();
    const deleteComment = page.getByRole('alertdialog', { name: '댓글을 삭제할까요?' });
    await deleteComment.getByRole('button', { name: '댓글 삭제' }).click();
    await expect(commentItem.getByText('삭제된 댓글입니다.')).toBeVisible();

    const attachments = sectionByHeading(page, '첨부파일');
    const failedAttachmentRefresh = await failGets(
      page,
      new RegExp(`/api/v1/issues/${issue.id}/attachments(?:\\?.*)?$`),
    );
    await attachments
      .locator('label')
      .filter({ hasText: '파일 선택' })
      .locator('input[type="file"]')
      .setInputFiles({
        buffer: Buffer.from(`M5 상세 첨부 ${runId}`),
        mimeType: 'text/plain',
        name: detailAttachmentName,
      });
    const downloadAttachment = attachments.getByRole('button', {
      name: `${detailAttachmentName} 다운로드`,
    });
    await expect(downloadAttachment).toBeVisible();
    await expect.poll(failedAttachmentRefresh.didFail).toBe(true);
    await expect(attachments.getByText('첨부파일을 불러오지 못했습니다')).toBeVisible();
    await failedAttachmentRefresh.stop();
    await attachments.getByRole('button', { name: '다시 시도' }).click();
    await expect(attachments.getByText('첨부파일을 불러오지 못했습니다')).toBeHidden();

    await attachments.getByRole('button', { name: `${detailAttachmentName} 연결 해제` }).click();
    const removeAttachment = page.getByRole('alertdialog', {
      name: '첨부파일 연결을 해제할까요?',
    });
    await removeAttachment.getByRole('button', { name: '연결 해제' }).click();
    await expect(downloadAttachment).toHaveCount(0);

    await page.getByRole('button', { name: '프로필 설정 열기' }).click();
    const profileDialog = page.getByRole('dialog', { name: '프로필 설정' });
    const profileUpload = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith('/api/v1/files') &&
        response.status() === 201,
    );
    await profileDialog
      .locator('label')
      .filter({ hasText: '사진 선택' })
      .locator('input[type="file"]')
      .setInputFiles({
        buffer: Buffer.from(ONE_PIXEL_PNG, 'base64'),
        mimeType: 'image/png',
        name: profileImageName,
      });
    const profileFile = (await (await profileUpload).json()) as { id: string };
    await expect(profileDialog.getByRole('button', { name: '프로필 사진 저장' })).toBeEnabled({
      timeout: 20_000,
    });
    await profileDialog.getByRole('button', { name: '프로필 사진 저장' }).click();
    await expect(profileDialog).toBeHidden();
    await expect(page.getByRole('img', { name: 'M5 브라우저 사용자' }).first()).toBeVisible();

    const unauthorizedFile = await request.get(
      `/api/v1/files/${encodeURIComponent(profileFile.id)}/content`,
    );
    expect(unauthorizedFile.status()).toBe(401);
    await checkLayout(page, testInfo.project.name, 'collaboration-complete');
  } finally {
    await cleanupM2Users([email]);
    await clearM1RateLimits();
  }
});
