import { beforeEach, describe, expect, it, vi } from 'vitest';

import WorkflowSettingsPage from './page';

const intl = vi.hoisted(() => ({
  getTranslations: vi.fn(),
  setRequestLocale: vi.fn(),
}));

const translate = vi.fn((key: string) => key);

vi.mock('next-intl/server', () => intl);
vi.mock('@/features/teams/workflow-settings-screen', () => ({
  WorkflowSettingsScreen: () => null,
}));

describe('WorkflowSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    intl.getTranslations.mockResolvedValue(translate);
  });

  it('클라이언트에서 채울 워크플로 상태 메시지의 자리표시자를 보존한다', async () => {
    await WorkflowSettingsPage({ params: Promise.resolve({ locale: 'ko', teamId: 'team-web' }) });

    expect(translate).toHaveBeenCalledWith('createDescription', { category: '{category}' });
    expect(translate).toHaveBeenCalledWith('deleteDescription', { state: '{state}' });
    expect(translate).toHaveBeenCalledWith('reorderSuccess', {
      position: '{position}',
      state: '{state}',
    });
  });
});
