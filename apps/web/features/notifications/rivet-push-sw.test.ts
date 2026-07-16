import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

import { NotificationResponseDtoType } from '@rivet/api-client';

type WorkerHandler = (event: {
  data?: { json: () => unknown };
  notification?: { close: () => void; data?: unknown };
  waitUntil: (promise: Promise<unknown>) => void;
}) => void;

function workerContext(windows: Array<Record<string, unknown>> = []) {
  const handlers = new Map<string, WorkerHandler>();
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const openWindow = vi.fn().mockResolvedValue(undefined);
  const source = readFileSync(resolve(process.cwd(), 'public/rivet-push-sw.js'), 'utf8');
  const workerSelf = {
    addEventListener: (type: string, handler: WorkerHandler) => handlers.set(type, handler),
    clients: {
      claim: vi.fn().mockResolvedValue(undefined),
      matchAll: vi.fn().mockResolvedValue(windows),
      openWindow,
    },
    location: { origin: 'https://rivet.example.test' },
    registration: { showNotification },
    skipWaiting: vi.fn().mockResolvedValue(undefined),
  };

  runInNewContext(source, { URL, self: workerSelf });
  return { handlers, openWindow, showNotification };
}

async function dispatch(
  handler: WorkerHandler,
  event: Parameters<WorkerHandler>[0],
): Promise<void> {
  let pending: Promise<unknown> = Promise.resolve();
  handler({ ...event, waitUntil: (promise) => (pending = promise) });
  await pending;
}

describe('rivet-push-sw', () => {
  it('shows a generic background notification with the exact canonical target', async () => {
    const { handlers, showNotification } = workerContext();
    const notificationId = '2be769a8-82cb-4a55-bcc6-2da2e81f1fbc';
    const targetPath =
      '/issues/API-42?tab=work&work=WEB-7&handoff=5cb38c29-d14f-4451-bd11-af837a6ac598#handoff-5cb38c29-d14f-4451-bd11-af837a6ac598';

    await dispatch(handlers.get('push')!, {
      data: {
        json: () => ({ notificationId, targetPath, type: 'API_HANDOFF_CREATED', version: 1 }),
      },
      waitUntil: () => undefined,
    });

    expect(showNotification).toHaveBeenCalledWith('Rivet 알림', {
      body: '새 작업 전달 알림이 있습니다.',
      data: { sourceId: notificationId, targetPath },
      icon: '/brand/symbol.png',
      renotify: false,
      tag: `rivet:${notificationId}`,
    });
    expect(JSON.stringify(showNotification.mock.calls[0])).not.toMatch(
      /업무 본문|filename|private@example/u,
    );
  });

  it('focuses and navigates an existing app window on notification click', async () => {
    const navigate = vi.fn().mockResolvedValue(undefined);
    const focus = vi.fn().mockResolvedValue(undefined);
    const { handlers, openWindow } = workerContext([
      { focus, navigate, url: 'https://rivet.example.test/inbox' },
    ]);
    const close = vi.fn();

    await dispatch(handlers.get('notificationclick')!, {
      notification: {
        close,
        data: { targetPath: '/issues/API-42?tab=work&work=WEB-7#comment-abc' },
      },
      waitUntil: () => undefined,
    });

    expect(close).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(
      'https://rivet.example.test/issues/API-42?tab=work&work=WEB-7#comment-abc',
    );
    expect(focus).toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('ignores malformed or cross-origin payloads', async () => {
    const { handlers, showNotification } = workerContext();

    for (const payload of [
      { notificationId: 'invalid', targetPath: '/inbox', type: 'MENTIONED', version: 1 },
      {
        notificationId: '2be769a8-82cb-4a55-bcc6-2da2e81f1fbc',
        targetPath: 'https://evil.example/inbox',
        type: 'MENTIONED',
        version: 1,
      },
    ]) {
      await dispatch(handlers.get('push')!, {
        data: { json: () => payload },
        waitUntil: () => undefined,
      });
    }

    expect(showNotification).not.toHaveBeenCalled();
  });

  it('accepts every notification type exposed by the in-app notification contract', async () => {
    const { handlers, showNotification } = workerContext();
    const notificationId = '2be769a8-82cb-4a55-bcc6-2da2e81f1fbc';

    for (const type of Object.values(NotificationResponseDtoType)) {
      await dispatch(handlers.get('push')!, {
        data: {
          json: () => ({ notificationId, targetPath: '/inbox', type, version: 1 }),
        },
        waitUntil: () => undefined,
      });
    }

    expect(showNotification).toHaveBeenCalledTimes(Object.keys(NotificationResponseDtoType).length);
  });
});
