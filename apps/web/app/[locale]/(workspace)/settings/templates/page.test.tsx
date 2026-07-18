import { beforeEach, describe, expect, it, vi } from 'vitest';

import IssueTemplateSettingsPage from './page';

const intl = vi.hoisted(() => ({
  getTranslations: vi.fn(),
  setRequestLocale: vi.fn(),
}));

const translate = Object.assign(
  vi.fn((key: string) => key),
  {
    raw: vi.fn((key: string) => key),
  },
);

vi.mock('next-intl/server', () => intl);
vi.mock('@/features/settings/issue-template-settings-screen', () => ({
  IssueTemplateSettingsScreen: () => null,
}));

describe('IssueTemplateSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    intl.getTranslations.mockResolvedValue(translate);
  });

  it('클라이언트에서 템플릿 이름을 채우도록 보관 문구 자리표시자를 보존한다', async () => {
    await IssueTemplateSettingsPage({ params: Promise.resolve({ locale: 'ko' }) });

    expect(translate.raw).toHaveBeenCalledWith('archiveDescription');
    expect(translate).not.toHaveBeenCalledWith('archiveDescription');
  });
});
