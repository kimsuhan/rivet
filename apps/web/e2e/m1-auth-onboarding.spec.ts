import { randomUUID } from 'node:crypto';

import { expect, type Page, test } from '@playwright/test';

import {
  cleanupM1User,
  cleanupM2Users,
  clearM1RateLimits,
  getLatestM1Token,
  getLatestWorkspaceInvitationToken,
} from '../../../scripts/e2e/m1-auth-fixture';

async function checkLayout(page: Page, projectName: string, stage: string): Promise<void> {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);

  const screenshotPrefix = process.env.RIVET_VISUAL_QA_PREFIX;
  if (screenshotPrefix) {
    await page.screenshot({
      fullPage: true,
      path: `${screenshotPrefix}-${projectName}-${stage}.png`,
    });
  }
}

test('토큰 화면은 브라우저와 중간 캐시에 저장하지 않는다', async ({ request }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-chromium',
    '응답 헤더는 한 프로젝트에서 확인합니다.',
  );

  for (const path of ['/verify-email', '/reset-password', '/invite']) {
    const response = await request.get(path);

    expect(response.headers()['cache-control']).toContain('no-store');
    expect(response.headers()['referrer-policy']).toBe('no-referrer');
  }
});

test('가입부터 이메일 인증과 기본 팀 생성까지 완료한다', async ({ page }, testInfo) => {
  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const email = `m1.browser.${runId}@example.com`;
  const password = `M1 브라우저 검증 전용 비밀번호! ${runId}`;
  const slug = `m1-${runId}`;

  await clearM1RateLimits();

  try {
    await page.goto('/signup');
    await checkLayout(page, testInfo.project.name, 'signup');
    await page.getByLabel('표시 이름').fill('브라우저 사용자');
    await page.getByLabel('이메일').fill(email);
    await page.getByLabel('비밀번호', { exact: true }).fill(password);
    await page.getByLabel('비밀번호 확인').fill(password);
    await page.getByRole('button', { name: '가입하기' }).click();

    await expect(page.getByRole('heading', { name: '요청을 접수했습니다' })).toBeVisible();

    const verificationToken = await getLatestM1Token(email, 'EMAIL_VERIFICATION');
    await page.goto(`/verify-email#token=${encodeURIComponent(verificationToken)}`);

    await expect(page).toHaveURL(/\/verify-email$/);
    await expect(page.getByRole('heading', { name: '이메일 인증을 마쳤습니다' })).toBeVisible();
    await page.getByRole('link', { name: '로그인' }).click();

    await page.getByLabel('이메일').fill(email);
    await page.getByLabel('비밀번호', { exact: true }).fill(password);
    await page.getByRole('button', { name: '로그인', exact: true }).click();

    await expect(page).toHaveURL(/\/onboarding\/workspace$/);
    await expect(page.getByRole('heading', { name: '워크스페이스 만들기' })).toBeVisible();
    await checkLayout(page, testInfo.project.name, 'workspace');
    await page.getByLabel('워크스페이스 이름').fill('브라우저 워크스페이스');
    await page.getByLabel('슬러그').fill(slug);
    await expect(page.getByText(`${new URL(page.url()).host}/${slug}`)).toBeVisible();
    await page.getByRole('button', { name: '워크스페이스 만들기' }).click();

    await expect(page).toHaveURL(/\/onboarding\/team$/);
    await expect(page.getByRole('heading', { name: '기본 팀 만들기' })).toBeVisible();
    await checkLayout(page, testInfo.project.name, 'team');
    await expect(page.getByText('브라우저 사용자')).toBeVisible();
    await page.getByLabel('팀 이름').fill('웹');
    await page.getByLabel('팀 키').fill('WEB');
    await expect(page.getByText('WEB-1')).toBeVisible();
    await page.getByRole('button', { name: '팀 만들기' }).click();

    await expect(page).toHaveURL(/\/onboarding\/invite$/);
    await expect(page.getByRole('heading', { name: '동료 초대' })).toBeVisible();
    await page.getByRole('button', { name: '건너뛰기' }).click();

    await expect(page).toHaveURL(/\/my-issues$/);
    await expect(page.getByRole('heading', { name: '내 작업' })).toBeVisible();
    await checkLayout(page, testInfo.project.name, 'my-issues');
  } finally {
    await cleanupM1User(email);
    await clearM1RateLimits();
  }
});

test('미가입 사용자가 가입과 인증 후 초대를 다시 열어 수락한다', async ({ page }, testInfo) => {
  test.setTimeout(90_000);

  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const adminEmail = `m2.admin.browser.${runId}@example.com`;
  const inviteeEmail = `m2.invitee.browser.${runId}@example.com`;
  const password = `M2 브라우저 검증 전용 비밀번호! ${runId}`;
  const slug = `m2-${runId}`;

  await clearM1RateLimits();

  try {
    await page.goto('/signup');
    await page.getByLabel('표시 이름').fill('M2 관리자');
    await page.getByLabel('이메일').fill(adminEmail);
    await page.getByLabel('비밀번호', { exact: true }).fill(password);
    await page.getByLabel('비밀번호 확인').fill(password);
    await page.getByRole('button', { name: '가입하기' }).click();
    await expect(page.getByRole('heading', { name: '요청을 접수했습니다' })).toBeVisible();

    const adminVerificationToken = await getLatestM1Token(adminEmail, 'EMAIL_VERIFICATION');
    await page.goto(`/verify-email#token=${encodeURIComponent(adminVerificationToken)}`);
    await expect(page.getByRole('heading', { name: '이메일 인증을 마쳤습니다' })).toBeVisible();
    await page.getByRole('link', { name: '로그인' }).click();
    await page.getByLabel('이메일').fill(adminEmail);
    await page.getByLabel('비밀번호', { exact: true }).fill(password);
    await page.getByRole('button', { name: '로그인', exact: true }).click();

    await expect(page).toHaveURL(/\/onboarding\/workspace$/);
    await page.getByLabel('워크스페이스 이름').fill('M2 브라우저 워크스페이스');
    await page.getByLabel('슬러그').fill(slug);
    await page.getByRole('button', { name: '워크스페이스 만들기' }).click();
    await expect(page).toHaveURL(/\/onboarding\/team$/);
    await page.getByLabel('팀 이름').fill('제품');
    await page.getByLabel('팀 키').fill('PROD');
    await page.getByRole('button', { name: '팀 만들기' }).click();

    await expect(page).toHaveURL(/\/onboarding\/invite$/);
    await expect(page.getByRole('heading', { name: '동료 초대' })).toBeVisible();
    await expect(page.getByLabel('동료 이메일')).toBeVisible();
    await checkLayout(page, testInfo.project.name, 'invite-onboarding');
    await page.getByLabel('동료 이메일').fill(`${inviteeEmail}\n${inviteeEmail.toUpperCase()}`);
    await page.getByRole('button', { name: '초대 후 계속' }).click();
    await expect(page.getByRole('heading', { name: '주소별 초대 결과' })).toBeVisible();
    await expect(page.getByText(inviteeEmail, { exact: true })).toBeVisible();
    await expect(page.getByText('초대 보냄', { exact: true })).toBeVisible();

    const invitationToken = await getLatestWorkspaceInvitationToken(inviteeEmail);
    if (testInfo.project.name !== 'mobile-chromium') {
      await page.goto('/settings/members');
      await expect(page.getByRole('heading', { name: '멤버', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '이메일 초대' }).click();
      const inviteMemberDialog = page.getByRole('dialog', { name: '멤버 초대' });
      await inviteMemberDialog.getByLabel('이메일').fill('draft@example.com');
      await page.keyboard.press('Escape');
      await page
        .getByRole('alertdialog', { name: '작성 중인 초대를 닫을까요?' })
        .getByRole('button', { name: '입력 버리기' })
        .click();
      await expect(inviteMemberDialog).toBeHidden();
      await page.getByRole('tab', { name: /초대 대기/ }).click();
      await expect(page.getByText(inviteeEmail, { exact: true })).toBeVisible();
      await checkLayout(page, testInfo.project.name, 'settings-members');

      await page.goto('/settings/teams');
      await expect(page.getByRole('heading', { name: '팀과 워크플로', exact: true })).toBeVisible();
      await expect(
        page.getByRole('tabpanel', { name: /^활성/ }).getByText('제품', { exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: '팀 만들기' }).click();
      const createTeamDialog = page.getByRole('dialog', { name: '팀 만들기' });
      await createTeamDialog.getByLabel('팀 이름').fill('작성 중인 팀');
      await page.keyboard.press('Escape');
      await page
        .getByRole('alertdialog', { name: '작성 중인 팀 변경을 버릴까요?' })
        .getByRole('button', { name: '변경 버리기' })
        .click();
      await expect(createTeamDialog).toBeHidden();
      await checkLayout(page, testInfo.project.name, 'settings-teams');
      await page.getByRole('link', { name: '워크플로', exact: true }).click();
      await expect(page.getByRole('heading', { name: '워크플로 설정' })).toBeVisible();
      await page
        .getByRole('button', { name: /이름 변경/ })
        .first()
        .click();
      const renameStateDialog = page.getByRole('dialog', { name: '상태 이름 변경' });
      const stateNameInput = renameStateDialog.getByLabel('상태 이름');
      await stateNameInput.fill(`${await stateNameInput.inputValue()} 임시`);
      await page.keyboard.press('Escape');
      await page
        .getByRole('alertdialog', { name: '작성 중인 변경을 버릴까요?' })
        .getByRole('button', { name: '변경 버리기' })
        .click();
      await expect(renameStateDialog).toBeHidden();
      await checkLayout(page, testInfo.project.name, 'settings-workflow');

      await page.goto('/settings/labels');
      await expect(page.getByRole('heading', { name: '라벨', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '라벨 만들기' }).first().click();
      const labelDialog = page.getByRole('dialog', { name: '라벨 만들기' });
      await expect(labelDialog).toBeVisible();
      await labelDialog.getByLabel('라벨 이름').fill('E2E 작성 중');
      await page.keyboard.press('Escape');
      const discardDialog = page.getByRole('alertdialog', {
        name: '작성 중인 변경을 버릴까요?',
      });
      await expect(discardDialog).toBeVisible();
      await discardDialog.getByRole('button', { name: '계속 편집' }).click();
      await expect(labelDialog).toBeVisible();
      await page.keyboard.press('Escape');
      await page
        .getByRole('alertdialog', { name: '작성 중인 변경을 버릴까요?' })
        .getByRole('button', { name: '변경 버리기' })
        .click();
      await expect(labelDialog).toBeHidden();

      await page.getByRole('button', { name: '라벨 만들기' }).first().click();
      const createLabelDialog = page.getByRole('dialog', { name: '라벨 만들기' });
      await createLabelDialog.getByLabel('라벨 이름').fill('E2E 실제 라벨');
      const tealColor = createLabelDialog.getByRole('radio', { name: '청록' });
      await createLabelDialog.getByText('청록', { exact: true }).click();
      await expect(tealColor).toBeChecked();
      await createLabelDialog.getByRole('button', { name: '라벨 만들기' }).click();
      await expect(page.getByText('E2E 실제 라벨', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'E2E 실제 라벨 보관' }).click();
      const archiveDialog = page.getByRole('alertdialog', { name: '라벨을 보관할까요?' });
      await expect(archiveDialog).toBeVisible();
      await archiveDialog.getByRole('button', { name: '라벨 보관' }).click();
      await page.getByRole('tab', { name: '보관됨' }).click();
      await expect(page.getByText('E2E 실제 라벨', { exact: true })).toBeVisible();
      await checkLayout(page, testInfo.project.name, 'settings-labels');
    } else {
      await page.goto('/settings/members');
      await expect(
        page.getByRole('heading', { name: '설정은 데스크톱에서 사용할 수 있습니다' }),
      ).toBeVisible();
      await checkLayout(page, testInfo.project.name, 'settings-mobile-guidance');
    }

    await page.context().clearCookies();
    await page.goto(`/invite#token=${encodeURIComponent(invitationToken)}`);
    await expect(page).toHaveURL(/\/invite$/);
    await expect(page.getByRole('heading', { name: '워크스페이스 초대' })).toBeVisible();
    await expect(page.getByText('M2 브라우저 워크스페이스')).toBeVisible();
    await expect(page.getByText('로그인 또는 가입이 필요합니다')).toBeVisible();
    await checkLayout(page, testInfo.project.name, 'invite-preview');
    await page.getByRole('link', { name: '가입하기' }).click();

    await page.getByLabel('표시 이름').fill('M2 초대 멤버');
    await page.getByLabel('이메일').fill(inviteeEmail);
    await page.getByLabel('비밀번호', { exact: true }).fill(password);
    await page.getByLabel('비밀번호 확인').fill(password);
    await page.getByRole('button', { name: '가입하기' }).click();
    await expect(page.getByRole('heading', { name: '요청을 접수했습니다' })).toBeVisible();

    const inviteeVerificationToken = await getLatestM1Token(inviteeEmail, 'EMAIL_VERIFICATION');
    await page.goto(`/verify-email#token=${encodeURIComponent(inviteeVerificationToken)}`);
    await expect(page.getByRole('heading', { name: '이메일 인증을 마쳤습니다' })).toBeVisible();
    await page.getByRole('link', { name: '로그인' }).click();
    await page.getByLabel('이메일').fill(inviteeEmail);
    await page.getByLabel('비밀번호', { exact: true }).fill(password);
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await expect(page).toHaveURL(/\/onboarding\/workspace$/);

    await page.goto(`/invite#token=${encodeURIComponent(invitationToken)}`);
    await expect(page.getByText(inviteeEmail, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '초대 수락' }).click();
    await expect(page).toHaveURL(/\/my-issues$/);
    await expect(page.getByRole('heading', { name: '내 작업' })).toBeVisible();

    await page.goto(`/invite#token=${encodeURIComponent(invitationToken)}`);
    await expect(page).toHaveURL(/\/my-issues$/);
  } finally {
    await cleanupM2Users([adminEmail, inviteeEmail]);
    await clearM1RateLimits();
  }
});
