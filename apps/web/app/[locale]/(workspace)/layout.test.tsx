import { isValidElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/messages/ko.json';

import WorkspaceLayout from './layout';

const intl = vi.hoisted(() => ({
  getMessages: vi.fn(),
  getTranslations: vi.fn(),
  setRequestLocale: vi.fn(),
}));

vi.mock('next-intl/server', () => intl);
vi.mock('@/components/layout/app-shell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/features/auth/session-boundary', () => ({
  SessionBoundary: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/features/realtime/realtime-sync', () => ({
  RealtimeSync: ({ children }: { children: ReactNode }) => children,
}));

describe('WorkspaceLayout', () => {
  beforeEach(() => {
    const translate = Object.assign((key: string) => key, { raw: (key: string) => key });
    intl.getMessages.mockResolvedValue(messages);
    intl.getTranslations.mockResolvedValue(translate);
  });

  it('로딩과 오류 경계에서 사용할 상태 메시지를 제공한다', async () => {
    const result = await WorkspaceLayout({
      children: <div />,
      params: Promise.resolve({ locale: 'ko' }),
    });

    expect(isValidElement(result)).toBe(true);
    expect(result.props.messages.States).toBe(messages.States);
  });
});
