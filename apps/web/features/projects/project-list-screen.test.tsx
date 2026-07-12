import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useProjectsControllerList } from '@rivet/api-client';

import messages from '@/messages/ko.json';

import { ProjectListScreen } from './project-list-screen';

const mocks = vi.hoisted(() => ({
  pathname: '/projects',
  push: vi.fn(),
  refetch: vi.fn(),
  search: '',
}));

vi.mock('@rivet/api-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useProjectsControllerList: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mocks.search),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props} />
  ),
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push }),
}));

const project = {
  archived: false,
  createdAt: '2026-07-01T00:00:00.000Z',
  description: '웹과 API가 함께 만드는 프로젝트',
  id: '54c95ae9-cad5-44e6-b95f-2c71a5290ef4',
  lead: {
    id: 'membership-1',
    role: 'MEMBER' as const,
    status: 'ACTIVE' as const,
    user: { avatarFileId: null, displayName: '프로젝트 리드', id: 'user-1' },
  },
  name: '첫 프로젝트',
  progress: { completed: 2, percentage: 50, total: 4 },
  roleTeams: [
    {
      role: 'BACKEND' as const,
      team: { archived: false, id: 'team-api', key: 'API', name: 'API 팀' },
    },
    {
      role: 'WEB_FRONTEND' as const,
      team: { archived: false, id: 'team-web', key: 'WEB', name: '웹 팀' },
    },
  ],
  startDate: '2026-07-01',
  status: 'IN_PROGRESS' as const,
  targetDate: '2026-07-31',
  updatedAt: '2026-07-10T00:00:00.000Z',
  version: 2,
};

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="ko" messages={messages} timeZone="Asia/Seoul">
      {children}
    </NextIntlClientProvider>
  );
}

describe('ProjectListScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.search = '';
    vi.mocked(useProjectsControllerList).mockReturnValue({
      data: { items: [project], nextCursor: 'next-page' },
      error: null,
      isError: false,
      isPending: false,
      refetch: mocks.refetch,
    } as never);
  });

  afterEach(cleanup);

  it('프로젝트의 상태, 역할별 팀과 실제 진행률을 함께 표시한다', () => {
    render(<ProjectListScreen />, { wrapper: Wrapper });

    expect(useProjectsControllerList).toHaveBeenCalledWith(
      {
        includeArchived: false,
        limit: 50,
        sort: 'updatedAt',
        sortDirection: 'desc',
      },
      { query: { retry: false } },
    );
    expect(screen.getByRole('heading', { level: 1, name: '프로젝트' })).toBeVisible();
    expect(screen.getByRole('link', { name: '첫 프로젝트' })).toHaveAttribute(
      'href',
      `/projects/${project.id}`,
    );
    expect(screen.getByText('진행 중')).toBeVisible();
    expect(screen.getByText('백엔드')).toBeVisible();
    expect(screen.getByText('웹 프론트')).toBeVisible();
    expect(screen.getByRole('progressbar', { name: '완료 2 / 4 · 50%' })).toHaveValue(50);
  });

  it('URL 조건을 복원하고 다음 커서를 브라우저 기록에 남긴다', async () => {
    const user = userEvent.setup();
    mocks.search = 'status=PLANNED&archived=true&sort=targetDate&direction=asc';
    render(<ProjectListScreen />, { wrapper: Wrapper });

    expect(useProjectsControllerList).toHaveBeenCalledWith(
      expect.objectContaining({
        includeArchived: true,
        sort: 'targetDate',
        sortDirection: 'asc',
        status: 'PLANNED',
      }),
      { query: { retry: false } },
    );

    await user.click(screen.getByRole('button', { name: '다음 프로젝트' }));
    expect(mocks.push).toHaveBeenCalledWith(
      '/projects?status=PLANNED&archived=true&sort=targetDate&direction=asc&cursor=next-page',
      { scroll: false },
    );
  });
});
