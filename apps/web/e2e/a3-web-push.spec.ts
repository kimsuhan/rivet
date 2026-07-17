import { randomUUID } from 'node:crypto';

import { expect, type Page, test } from '@playwright/test';

import {
  cleanupM2Users,
  clearM1RateLimits,
  getLatestM1Token,
} from '../../../scripts/e2e/m1-auth-fixture';

async function completeOnboarding(
  page: Page,
  input: { email: string; password: string; slug: string },
): Promise<void> {
  await page.goto('/signup');
  await page.getByLabel('표시 이름').fill('A3 브라우저 사용자');
  await page.getByLabel('이메일').fill(input.email);
  await page.getByLabel('비밀번호', { exact: true }).fill(input.password);
  await page.getByLabel('비밀번호 확인').fill(input.password);
  await page.getByRole('button', { name: '가입하기' }).click();
  await expect(page.getByRole('heading', { name: '이메일을 확인해 주세요' })).toBeVisible();

  const token = await getLatestM1Token(input.email, 'EMAIL_VERIFICATION');
  await page.goto(`/verify-email#token=${encodeURIComponent(token)}`);
  await expect(page.getByRole('heading', { name: '이메일 인증을 마쳤습니다' })).toBeVisible();
  await page.getByRole('link', { name: '로그인' }).click();
  await page.getByLabel('이메일').fill(input.email);
  await page.getByLabel('비밀번호', { exact: true }).fill(input.password);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.getByLabel('워크스페이스 이름').fill('A3 브라우저 워크스페이스');
  await page.getByLabel('슬러그').fill(input.slug);
  await page.getByRole('button', { name: '워크스페이스 만들기' }).click();
  await page.getByLabel('팀 이름').fill('웹');
  await page.getByLabel('팀 키').fill('WEB');
  await page.getByRole('button', { name: '팀 만들기' }).click();
  await page.getByRole('button', { name: '건너뛰기' }).click();
  await expect(page).toHaveURL(/\/my-issues$/u);
}

test('A3 Web Push 지원과 권한 기본 상태를 브라우저별로 분리한다', async ({ page }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(20_000);
  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const email = `a3.browser.${runId}@example.com`;
  const password = `A3 브라우저 검증 전용 비밀번호! ${runId}`;

  await clearM1RateLimits();
  try {
    await completeOnboarding(page, { email, password, slug: `a3-${runId}` });
    await page.goto('/inbox');
    await expect(page.getByRole('heading', { name: '알림함' })).toBeVisible();
    await page.getByRole('button', { name: '알림 설정' }).click();
    await expect(page.getByText('브라우저 알림', { exact: true })).toBeVisible();

    const capability = await page.evaluate(() => ({
      notifications: 'Notification' in window,
      permission: 'Notification' in window ? Notification.permission : null,
      push: 'PushManager' in window,
      serviceWorker: 'serviceWorker' in navigator,
    }));
    if (capability.notifications && capability.push && capability.serviceWorker) {
      const expectedState = capability.permission === 'denied' ? '권한 거절' : '권한 미선택';
      await expect(page.getByText(expectedState, { exact: true })).toBeVisible();
      if (capability.permission === 'default') {
        await expect(page.getByRole('button', { name: '이 브라우저에서 알림 켜기' })).toBeVisible();
      }
    } else {
      await expect(page.getByText('권한 미지원', { exact: true })).toBeVisible();
      await expect(page.getByRole('alert').filter({ hasText: '해결 방법' })).toBeVisible();
    }

    if (capability.serviceWorker) {
      const scope = await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.register('/rivet-push-sw.js', {
          scope: '/',
          updateViaCache: 'none',
        });
        await navigator.serviceWorker.ready;
        return registration.scope;
      });
      expect(scope).toBe(`${new URL(page.url()).origin}/`);
    }

    const serviceWorker = await page.request.get('/rivet-push-sw.js');
    expect(serviceWorker.status()).toBe(200);
    expect(await serviceWorker.text()).toContain("self.addEventListener('push'");
  } finally {
    await cleanupM2Users([email]);
    await clearM1RateLimits();
  }
});

test('A3 Chromium은 앱 문서가 열려 있지 않아도 background Push를 표시한다', async ({
  context,
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-chromium',
    '실제 Chromium ServiceWorker Push 전달은 데스크톱 Chromium에서 검증합니다.',
  );
  test.setTimeout(180_000);
  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const email = `a3.background.${runId}@example.com`;
  const password = `A3 background 검증 전용 비밀번호! ${runId}`;
  const notificationId = randomUUID();
  const origin = testInfo.project.use.baseURL as string;

  await clearM1RateLimits();
  try {
    await completeOnboarding(page, { email, password, slug: `a3-bg-${runId}` });
    await context.grantPermissions(['notifications'], { origin });
    await page.goto('/inbox');
    await expect.poll(() => page.evaluate(() => Notification.permission)).toBe('granted');

    const cdp = await context.newCDPSession(page);
    const registrations: Array<{ registrationId: string; scopeURL: string }> = [];
    cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations: updates }) => {
      registrations.splice(0, registrations.length, ...updates);
    });
    await cdp.send('ServiceWorker.enable');
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/rivet-push-sw.js', {
        scope: '/',
        updateViaCache: 'none',
      });
      await navigator.serviceWorker.ready;
    });
    const serviceWorker = context
      .serviceWorkers()
      .find((worker) => worker.url() === `${origin}/rivet-push-sw.js`);
    if (!serviceWorker) throw new Error('A3 서비스 워커 실행 대상을 찾지 못했습니다.');

    await expect
      .poll(() => registrations.find((registration) => registration.scopeURL === `${origin}/`))
      .toBeTruthy();
    const registration = registrations.find((candidate) => candidate.scopeURL === `${origin}/`);
    if (!registration) throw new Error('A3 서비스 워커 등록을 찾지 못했습니다.');

    await page.goto('about:blank');
    await cdp.send('ServiceWorker.deliverPushMessage', {
      data: JSON.stringify({
        notificationId,
        targetPath: '/issues/API-42?tab=work&work=WEB-7',
        type: 'TEAM_WORK_ASSIGNED',
        version: 1,
      }),
      origin,
      registrationId: registration.registrationId,
    });

    await expect
      .poll(() =>
        serviceWorker.evaluate(async (tag) => {
          const current = (
            globalThis as typeof globalThis & { registration: ServiceWorkerRegistration }
          ).registration;
          const notifications = await current.getNotifications({ tag });
          return notifications.map((notification) => ({
            body: notification.body,
            data: notification.data,
            tag: notification.tag,
            title: notification.title,
          }));
        }, `rivet:${notificationId}`),
      )
      .toEqual([
        {
          body: '새 담당 업무 알림이 있습니다.',
          data: {
            sourceId: notificationId,
            targetPath: '/issues/API-42?tab=work&work=WEB-7',
          },
          tag: `rivet:${notificationId}`,
          title: 'Rivet 알림',
        },
      ]);

    await page.goto(`${origin}/inbox`);
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);
    await serviceWorker.evaluate(async (tag) => {
      const current = (
        globalThis as typeof globalThis & { registration: ServiceWorkerRegistration }
      ).registration;
      const [notification] = await current.getNotifications({ tag });
      if (!notification) throw new Error('A3 background 알림을 찾지 못했습니다.');
      const NotificationEventConstructor = (
        globalThis as typeof globalThis & {
          NotificationEvent: new (type: string, init: { notification: Notification }) => Event;
        }
      ).NotificationEvent;
      globalThis.dispatchEvent(
        new NotificationEventConstructor('notificationclick', { notification }),
      );
    }, `rivet:${notificationId}`);
    await expect
      .poll(() =>
        context
          .pages()
          .some((candidate) => candidate.url() === `${origin}/issues/API-42?tab=work&work=WEB-7`),
      )
      .toBe(true);
  } finally {
    await cleanupM2Users([email]);
    await clearM1RateLimits();
  }
});
