import { QueryClient, QueryClientProvider, useQueries } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useAuthControllerGetSession,
  useLabelsControllerList,
  useTeamsControllerList,
} from '@rivet/api-client';

import messages from '@/messages/ko.json';

import { useIssuePages } from './issue-list-queries';
import { IssueListScreen } from './issue-list-screen';

const mocks = vi.hoisted(() => ({
  issueRefetch: vi.fn(),
  pathname: '/my-issues',
  replace: vi.fn(),
  search: '',
}));

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useQueries: vi.fn(),
}));

vi.mock('@rivet/api-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuthControllerGetSession: vi.fn(),
  useLabelsControllerList: vi.fn(),
  useTeamsControllerList: vi.fn(),
}));

vi.mock('./issue-list-queries', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useIssuePages: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mocks.search),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props} />
  ),
  usePathname: () => mocks.pathname,
  useRouter: () => ({ replace: mocks.replace }),
}));

const team = {
  archived: false,
  id: '6f83906f-6883-4434-b7e2-4156fca910a1',
  key: 'WEB',
  memberCount: 2,
  name: '웹',
  version: 1,
};
const workflowState = {
  category: 'UNSTARTED' as const,
  id: '93331a10-3dc7-44cd-820c-33b74c63dc2f',
  isDefault: true,
  name: '할 일',
  position: 0,
  version: 1,
};
const member = {
  deactivatedAt: null,
  id: 'd61793c6-6210-413b-b056-eb421347a2b6',
  joinedAt: '2026-07-01T00:00:00.000Z',
  role: 'MEMBER' as const,
  status: 'ACTIVE' as const,
  user: {
    avatarFileId: null,
    displayName: '담당자',
    id: 'a43a66d7-76f4-4854-b698-27271a36ea6f',
  },
};

let queryClient: QueryClient;

function queryResult(data: unknown) {
  return {
    data,
    error: null,
    isError: false,
    isPending: false,
    refetch: vi.fn(),
  };
}

function issuePages({ error = false }: { error?: boolean } = {}) {
  return {
    data: error ? undefined : { pageParams: [undefined], pages: [{ items: [], nextCursor: null }] },
    error: error ? new Error('failed') : null,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isError: error,
    isFetchNextPageError: false,
    isFetchingNextPage: false,
    isPending: false,
    refetch: mocks.issueRefetch,
  };
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="ko" messages={messages}>
        {children}
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

function renderScreen(mode: 'my' | 'team' = 'my') {
  return render(<IssueListScreen mode={mode} {...(mode === 'team' ? { teamKey: 'WEB' } : {})} />, {
    wrapper: Wrapper,
  });
}

describe('IssueListScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pathname = '/my-issues';
    mocks.search = '';
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(useTeamsControllerList).mockReturnValue(queryResult({ items: [team] }) as never);
    vi.mocked(useAuthControllerGetSession).mockReturnValue(
      queryResult({
        authenticated: true,
        csrfToken: 'csrf',
        membership: { id: member.id, role: 'MEMBER', status: 'ACTIVE' },
        onboardingStep: 'COMPLETE',
        user: member.user,
        workspace: { id: 'workspace-id', name: '워크스페이스', slug: 'workspace' },
      }) as never,
    );
    vi.mocked(useLabelsControllerList).mockReturnValue(queryResult({ items: [] }) as never);
    vi.mocked(useQueries).mockImplementation(
      (options: { queries: Array<{ queryKey: unknown }> }) => {
        const key = JSON.stringify(options.queries[0]?.queryKey ?? '');
        if (key.includes('workflow-states'))
          return [queryResult({ items: [workflowState] })] as never;
        return [queryResult({ items: [member], nextCursor: null })] as never;
      },
    );
    vi.mocked(useIssuePages).mockReturnValue(issuePages() as never);
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
  });

  it('내 이슈 기본 조건으로 조회하고 생성 CTA가 있는 최초 빈 상태를 표시한다', () => {
    renderScreen();

    expect(useIssuePages).toHaveBeenCalledWith(
      {
        assigneeMembershipId: 'me',
        limit: 50,
        sort: 'updatedAt',
        sortDirection: 'desc',
        stateCategory: 'BACKLOG,UNSTARTED,STARTED',
        type: 'TEAM_TASK',
      },
      true,
    );
    expect(screen.getByRole('heading', { level: 1, name: '내 이슈' })).toBeVisible();
    expect(screen.getByText('할당된 이슈가 없습니다')).toBeVisible();
    expect(screen.getAllByRole('link', { name: '이슈 만들기' })[0]).toHaveAttribute(
      'href',
      '/my-issues?create=1',
    );
  });

  it('URL 필터와 정렬을 복원하고 필터 초기화 시 정렬은 보존한다', async () => {
    const user = userEvent.setup();
    mocks.search = `status=${workflowState.id}&team=${team.id}&priority=HIGH&sort=status&direction=asc`;
    renderScreen();

    expect(useIssuePages).toHaveBeenCalledWith(
      expect.objectContaining({
        priority: 'HIGH',
        sort: 'status',
        sortDirection: 'asc',
        teamId: team.id,
        workflowStateId: workflowState.id,
      }),
      true,
    );
    expect(screen.getByText('조건에 맞는 이슈가 없습니다')).toBeVisible();
    await user.click(screen.getAllByRole('button', { name: '필터 초기화' })[0]!);
    expect(mocks.replace).toHaveBeenCalledWith('/my-issues?sort=status&direction=asc', {
      scroll: false,
    });
  });

  it('초기 목록 오류를 인라인 재시도 상태로 표시한다', async () => {
    const user = userEvent.setup();
    vi.mocked(useIssuePages).mockReturnValue(issuePages({ error: true }) as never);
    renderScreen();

    expect(screen.getByText('이슈 목록을 불러오지 못했습니다')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(mocks.issueRefetch).toHaveBeenCalledOnce();
  });

  it('팀 키를 활성 팀 ID로 해석하고 현재 쿼리를 보드 링크에 보존한다', () => {
    mocks.pathname = '/teams/WEB/issues';
    mocks.search = 'tab=backlog&sort=priority';
    renderScreen('team');

    expect(useIssuePages).toHaveBeenCalledWith(
      expect.objectContaining({ stateCategory: 'BACKLOG', teamId: team.id }),
      true,
    );
    expect(screen.getByRole('heading', { level: 1, name: '웹 이슈' })).toBeVisible();
    expect(screen.getByRole('link', { name: '보드로 보기' })).toHaveAttribute(
      'href',
      '/teams/WEB/board?tab=backlog&sort=priority',
    );
  });
});
