const BODY_BY_TYPE = {
  API_HANDOFF_CREATED: '새 작업 전달 알림이 있습니다.',
  API_HANDOFF_FOLLOW_UP_CREATED: '작업 전달 후속 알림이 있습니다.',
  COMMENT_ADDED: '구독한 이슈에 새 알림이 있습니다.',
  ISSUE_CANCELED: '구독한 이슈의 상태 알림이 있습니다.',
  ISSUE_COMPLETED: '구독한 이슈의 상태 알림이 있습니다.',
  MENTIONED: '새 멘션 알림이 있습니다.',
  TEAM_WORK_ASSIGNED: '새 담당 업무 알림이 있습니다.',
  WEB_PUSH_TEST: '브라우저 알림이 정상적으로 연결되었습니다.',
};

function validPayload(value) {
  if (!value || typeof value !== 'object' || value.version !== 1) return null;
  if (typeof value.type !== 'string' || !(value.type in BODY_BY_TYPE)) return null;
  if (typeof value.targetPath !== 'string' || !value.targetPath.startsWith('/')) return null;

  const target = new URL(value.targetPath, self.location.origin);
  if (target.origin !== self.location.origin) return null;

  const sourceId = value.notificationId ?? value.testEventId;
  if (typeof sourceId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sourceId)) return null;

  return {
    sourceId,
    targetPath: `${target.pathname}${target.search}${target.hash}`,
    type: value.type,
  };
}

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload;
  try {
    payload = validPayload(event.data?.json());
  } catch {
    return;
  }
  if (!payload) return;

  event.waitUntil(
    self.registration.showNotification(
      payload.type === 'WEB_PUSH_TEST' ? 'Rivet Web Push' : 'Rivet 알림',
      {
        body: BODY_BY_TYPE[payload.type],
        data: { sourceId: payload.sourceId, targetPath: payload.targetPath, type: payload.type },
        icon: '/brand/symbol.png',
        renotify: false,
        tag: `rivet:${payload.sourceId}`,
      },
    ),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetPath = event.notification.data?.targetPath;
  if (typeof targetPath !== 'string' || !targetPath.startsWith('/')) return;

  const target = new URL(targetPath, self.location.origin);
  if (target.origin !== self.location.origin) return;
  const sourceId = event.notification.data?.sourceId;
  if (
    event.notification.data?.type &&
    event.notification.data.type !== 'WEB_PUSH_TEST' &&
    typeof sourceId === 'string' &&
    /^[0-9a-f-]{36}$/i.test(sourceId)
  ) {
    target.searchParams.set('rivetPushClick', sourceId);
  }

  event.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then(async (windows) => {
      const exact = windows.find((client) => client.url === target.href);
      if (exact) return exact.focus();

      const current = windows[0];
      if (current) {
        await current.navigate(target.href);
        return current.focus();
      }
      return self.clients.openWindow(target.href);
    }),
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then((windows) => {
      for (const client of windows) {
        client.postMessage({ type: 'RIVET_PUSH_SUBSCRIPTION_EXPIRED' });
      }
    }),
  );
});
