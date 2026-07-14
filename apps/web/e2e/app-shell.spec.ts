import { expect, test } from '@playwright/test';

const ONE_PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test.beforeEach(async ({ page }) => {
  const avatarFileId = '4bfe36e1-2a0f-463c-874b-909b25d0cd8a';
  let currentAvatarFileId: string | null = null;
  await page.route('**/api/v1/auth/session', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: {
        authenticated: true,
        csrfToken: 'e2e-csrf-token',
        membership: {
          id: '00000000-0000-4000-8000-000000000002',
          role: 'ADMIN',
          status: 'ACTIVE',
        },
        onboardingStep: 'COMPLETE',
        user: {
          avatarFileId: currentAvatarFileId,
          displayName: 'E2E 사용자',
          email: 'e2e@example.com',
          id: '00000000-0000-4000-8000-000000000001',
        },
        workspace: {
          id: '00000000-0000-4000-8000-000000000003',
          name: 'E2E 워크스페이스',
          slug: 'e2e-workspace',
          version: 1,
        },
      },
      status: 200,
    });
  });
  await page.route(/\/api\/v1\/(?:issues|labels|projects|team-works|teams)(?:\?.*)?$/u, async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: { items: [], nextCursor: null, totalCount: 0 },
      status: 200,
    });
  });
  await page.route('**/api/v1/notifications/unread-count', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: { count: 0 },
      status: 200,
    });
  });
  await page.route('**/api/v1/files', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await route.fulfill({
      contentType: 'application/json',
      json: {
        createdAt: new Date(0).toISOString(),
        detectedMimeType: 'image/webp',
        id: avatarFileId,
        inlineDisplayable: true,
        linked: false,
        originalName: 'avatar.webp',
        scope: 'USER_PROFILE',
        sizeBytes: 128,
      },
      status: 201,
    });
  });
  await page.route('**/api/v1/me/avatar', async (route) => {
    if (route.request().method() === 'PUT') currentAvatarFileId = avatarFileId;
    if (route.request().method() === 'DELETE') currentAvatarFileId = null;
    await route.fulfill({
      contentType: 'application/json',
      json: {
        avatarFileId: currentAvatarFileId,
        displayName: 'E2E 사용자',
        id: '00000000-0000-4000-8000-000000000001',
      },
      status: 200,
    });
  });
  await page.route(`**/api/v1/files/${avatarFileId}/content`, async (route) => {
    await route.fulfill({
      body: Buffer.from(ONE_PIXEL_PNG, 'base64'),
      contentType: 'image/png',
      status: 200,
    });
  });
});

test('기본 경로에서 내 작업으로 이동하고 주 탐색 상태를 표시한다', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveURL(/\/my-issues$/);
  await expect(page.getByRole('heading', { name: '내 작업' })).toBeVisible();
  await expect(page.getByRole('link', { name: '내 작업' }).first()).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('검색을 열고 닫을 때 입력 포커스를 관리한다', async ({ page, isMobile }) => {
  await page.goto('/my-issues');
  const searchTrigger = page.getByRole('button', { name: '검색 열기' });
  await searchTrigger.click();

  const searchInput = page.getByRole('textbox', { name: '검색어' });
  await expect(searchInput).toBeVisible();
  await expect(searchInput).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(searchInput).toBeHidden();
  await expect(searchTrigger).toBeFocused();

  if (!isMobile) {
    await page.keyboard.press('Slash');
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toBeFocused();
  }
});

test('모바일에서는 5개 하단 탐색 항목을 제공한다', async ({ page, isMobile }) => {
  test.skip(!isMobile, '모바일 프로젝트에서만 확인합니다.');
  await page.goto('/my-issues');

  const navigation = page.getByRole('navigation', { name: '모바일 주 탐색' });
  await expect(navigation.getByText('이슈', { exact: true })).toBeVisible();
  await expect(navigation.getByText('내 작업', { exact: true })).toBeVisible();
  await expect(navigation.getByText('알림함', { exact: true })).toBeVisible();
  await expect(navigation.getByText('팀', { exact: true })).toBeVisible();
  await expect(navigation.getByText('프로젝트', { exact: true })).toBeVisible();
  await expect(navigation.locator(':scope > *')).toHaveText([
    '이슈',
    '내 작업',
    '알림함',
    '프로젝트',
    '팀',
  ]);
  await expect(navigation.getByText('검색', { exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: '검색 열기' })).toBeVisible();
});

test('PROFILE-01 프로필 사진을 데스크톱과 모바일 셸에서 교체한다', async ({ page }) => {
  await page.goto('/my-issues');
  const trigger = page.getByRole('button', { name: '프로필 설정 열기' });
  await trigger.click();
  await expect(page.getByRole('heading', { name: '프로필 설정' })).toBeVisible();

  await page.getByLabel('사진 선택').setInputFiles({
    buffer: Buffer.from(ONE_PIXEL_PNG, 'base64'),
    mimeType: 'image/png',
    name: 'avatar.png',
  });
  const save = page.getByRole('button', { name: '프로필 사진 저장' });
  await expect(save).toBeEnabled();
  await save.click();

  await expect(page.getByRole('heading', { name: '프로필 설정' })).toBeHidden();
  await expect(trigger.getByRole('img', { name: 'E2E 사용자' })).toBeVisible();
});
