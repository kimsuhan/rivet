import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useIssuesControllerList,
  useLabelsControllerList,
  useMembersControllerList,
  useProjectsControllerList,
} from '@rivet/api-client';

import messages from '@/messages/ko.json';

import {
  FEATURE_ISSUE_LIST_GRID_CLASS,
  FEATURE_ISSUE_LIST_GRID_ORDER,
} from './feature-issue-list-layout';
import { FeatureIssueListScreen } from './feature-issue-list-screen';

const mocks = vi.hoisted(() => ({
  issueRefetch: vi.fn(),
  push: vi.fn(),
  search: '',
}));

vi.mock('@rivet/api-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getIssuesControllerListQueryKey: vi.fn(() => ['/api/v1/issues']),
  useIssuesControllerList: vi.fn(),
  useLabelsControllerList: vi.fn(),
  useMembersControllerList: vi.fn(),
  useProjectsControllerList: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mocks.search),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    scroll,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    scroll?: boolean;
  }) => {
    void scroll;
    return <a href={href} {...props} />;
  },
  usePathname: () => '/issues',
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock('./feature-issue-row', () => ({
  FeatureIssueRow: ({ issue }: { issue: { identifier: string; title: string } }) => (
    <li>
      {issue.identifier} · {issue.title}
    </li>
  ),
}));

function queryResult(data: unknown) {
  return {
    data,
    error: null,
    isError: false,
    isPending: false,
    refetch: vi.fn(),
  };
}

const featureIssue = {
  assignee: null,
  blocked: false,
  createdAt: '2026-07-01T00:00:00.000Z',
  createdBy: {
    id: 'creator-membership-id',
    role: 'MEMBER' as const,
    status: 'ACTIVE' as const,
    user: { avatarFileId: null, displayName: '만든 사람', id: 'creator-user-id' },
  },
  id: 'feature-id',
  identifier: 'ISSUE-12',
  labels: [],
  parentIssue: null,
  priority: 'HIGH' as const,
  progress: null,
  project: {
    archived: false,
    id: 'project-id',
    name: '결제 프로젝트',
    status: 'IN_PROGRESS' as const,
  },
  projectRole: null,
  status: { category: 'BACKLOG' as const, featureStatus: 'TODO' as const, workflowState: null },
  team: null,
  title: '결제 수단 추가',
  type: 'FEATURE' as const,
  updatedAt: '2026-07-02T00:00:00.000Z',
  version: 1,
  workflowSummary: {
    activeRoles: [],
    activeRoleTeams: [],
    allTargetTasksCompleted: false,
    canceledCount: 0,
    completedCount: 0,
    currentUserAssignedTeamTasks: [],
    currentUserTeamRoles: [],
    teamTaskCount: 0,
    unassignedCount: 0,
    waitingOn: [],
  },
};

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="ko" messages={messages} timeZone="Asia/Seoul">
      {children}
    </NextIntlClientProvider>
  );
}

function renderScreen() {
  return render(<FeatureIssueListScreen />, { wrapper: Wrapper });
}

describe('FeatureIssueListScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.search = '';
    vi.mocked(useIssuesControllerList).mockReturnValue({
      ...queryResult({
        items: [featureIssue],
        nextCursor: null,
        totalCount: 37,
        workQueueCounts: {
          ALL: 37,
          ASSIGNMENT_REQUIRED: 9,
          COMPLETED: 6,
          COMPLETION_REQUIRED: 0,
          IN_PROGRESS: 18,
          REVIEW_REQUIRED: 4,
        },
      }),
      refetch: mocks.issueRefetch,
    } as never);
    vi.mocked(useProjectsControllerList).mockReturnValue(queryResult({ items: [] }) as never);
    vi.mocked(useLabelsControllerList).mockReturnValue(queryResult({ items: [] }) as never);
    vi.mocked(useMembersControllerList).mockReturnValue(queryResult({ items: [] }) as never);
  });

  afterEach(cleanup);

  it('FEATURE 기본 목록과 빠른 필터, 정확한 결과 수를 표시한다', () => {
    renderScreen();

    expect(useIssuesControllerList).toHaveBeenCalledWith(
      {
        limit: 50,
        sort: 'updatedAt',
        sortDirection: 'desc',
        type: 'FEATURE',
      },
      { query: { retry: false } },
    );
    expect(screen.getByRole('heading', { level: 1, name: '이슈' })).toBeVisible();
    expect(screen.getByText('37개')).toBeVisible();
    expect(screen.getByText('ISSUE-12 · 결제 수단 추가')).toBeVisible();
    expect(screen.getByRole('tab', { name: '전체 37개' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '검토 필요 4개' })).toBeVisible();
    expect(screen.getByRole('tab', { name: '담당 필요 9개' })).toBeVisible();
    expect(screen.getByRole('tab', { name: '완료 확인 0개' })).toBeEnabled();
    expect(screen.queryByLabelText('활성 필터')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '이슈 만들기' })).toHaveAttribute(
      'href',
      '/issues?create=1',
    );
  });

  it('제목·결과 수·생성을 한 헤더에 두고 검색과 빠른 필터를 같은 도구 영역에 표시한다', () => {
    renderScreen();

    const heading = screen.getByRole('heading', { level: 1, name: '이슈' });
    const header = heading.closest('header');
    const search = screen.getByRole('search');

    expect(screen.getByTestId('feature-issue-list-content')).toHaveClass(
      'mx-auto',
      'max-w-[96rem]',
    );
    expect(header).toContainElement(screen.getByText('37개'));
    expect(header).toContainElement(screen.getByRole('link', { name: '이슈 만들기' }));
    expect(screen.queryByText(messages.FeatureIssues.description)).not.toBeInTheDocument();
    expect(search.parentElement).toContainElement(
      screen.getByRole('tablist', { name: '빠른 필터' }),
    );
    expect(screen.getByTestId('feature-issue-toolbar')).toContainElement(
      screen.getByRole('button', { name: '세부 필터' }),
    );
    expect(screen.getByRole('button', { name: '세부 필터' })).toHaveClass(
      'border-transparent',
      'bg-transparent',
      'before:h-8',
    );
    expect(screen.getByRole('combobox', { name: '정렬 기준' })).toHaveAttribute(
      'data-variant',
      'inline',
    );
    expect(screen.getByRole('combobox', { name: '정렬 방향: 내림차순' })).toHaveAttribute(
      'data-variant',
      'inline',
    );
    expect(screen.getByText('업데이트')).toBeVisible();
    expect(screen.queryByText('만든 사람')).not.toBeInTheDocument();
    const grid = document.querySelector(
      '[aria-hidden="true"][data-layout="feature-issue-list-grid"]',
    );
    expect(grid).not.toBeNull();
    expect(grid).toHaveClass('hidden', 'xl:grid', ...FEATURE_ISSUE_LIST_GRID_CLASS.split(' '));
    expect(
      Array.from(grid?.querySelectorAll(':scope > [data-column]') ?? []).map((element) =>
        element.getAttribute('data-column'),
      ),
    ).toEqual([
      'issue',
      'status',
      'priority',
      'current-work',
      'progress',
      'updated-at',
      'next-action',
    ]);
    expect(grid?.querySelector('[data-column="priority"]')).toHaveClass(
      FEATURE_ISSUE_LIST_GRID_ORDER.priority,
    );
    expect(grid?.querySelector('[data-column="issue"]')).toHaveClass(
      FEATURE_ISSUE_LIST_GRID_ORDER.issue,
    );
    expect(grid?.querySelector('[data-column="status"]')).toHaveClass(
      FEATURE_ISSUE_LIST_GRID_ORDER.status,
    );
  });

  it('모바일 필터 닫기 조작에 44px 최소 영역을 지정한다', async () => {
    const user = userEvent.setup();
    renderScreen();

    const trigger = screen.getByRole('button', { name: '세부 필터' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveClass('before:bg-muted');
    expect(screen.getByRole('button', { name: '세부 필터 닫기' })).toHaveClass(
      'min-h-11',
      'min-w-11',
    );
  });

  it('세부 필터 옵션 오류 재시도에 44px 최소 영역을 지정한다', async () => {
    const refetch = vi.fn();
    vi.mocked(useProjectsControllerList).mockReturnValue({
      data: undefined,
      error: new Error('프로젝트 옵션 오류'),
      isError: true,
      isPending: false,
      refetch,
    } as never);
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: '세부 필터' }));
    const retry = screen.getByRole('button', { name: '다시 시도' });
    expect(retry).toHaveClass('h-11', 'sm:h-10');
    await user.click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('URL의 빠른 필터·세부 필터·정렬을 API 요청에 복원한다', () => {
    mocks.search =
      'workQueue=ASSIGNMENT_REQUIRED&priority=HIGH,URGENT&activeProjectRole=BACKEND&query=결제&sort=progress&sortDirection=asc';

    renderScreen();

    expect(useIssuesControllerList).toHaveBeenCalledWith(
      expect.objectContaining({
        activeProjectRole: 'BACKEND',
        priority: 'HIGH,URGENT',
        query: '결제',
        sort: 'progress',
        sortDirection: 'asc',
        type: 'FEATURE',
        workQueue: 'ASSIGNMENT_REQUIRED',
      }),
      { query: { retry: false } },
    );
  });

  it('빠른 필터 변경 시 현재 조건을 보존하고 커서를 제거한다', async () => {
    mocks.search = 'priority=HIGH&cursor=next-page';
    renderScreen();

    expect(screen.getByRole('tab', { name: '검토 필요 4개' })).toHaveAttribute(
      'href',
      '/issues?priority=HIGH&workQueue=REVIEW_REQUIRED',
    );
  });

  it('필터 결과가 비었을 때 전체 이슈 보기로 조건을 초기화한다', async () => {
    const user = userEvent.setup();
    mocks.search = 'workQueue=REVIEW_REQUIRED&priority=HIGH';
    vi.mocked(useIssuesControllerList).mockReturnValue(
      queryResult({
        items: [],
        nextCursor: null,
        totalCount: 0,
        workQueueCounts: {
          ALL: 8,
          ASSIGNMENT_REQUIRED: 0,
          COMPLETED: 0,
          COMPLETION_REQUIRED: 0,
          IN_PROGRESS: 0,
          REVIEW_REQUIRED: 0,
        },
      }) as never,
    );
    renderScreen();

    expect(screen.getByText('검토를 기다리는 이슈가 없습니다')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '전체 이슈 보기' }));
    expect(mocks.push).toHaveBeenCalledWith('/issues', { scroll: false });
  });

  it('활성 세부 필터를 이름과 값이 있는 칩으로 표시하고 개별 제거한다', async () => {
    const user = userEvent.setup();
    mocks.search =
      'workQueue=IN_PROGRESS&query=결제&projectId=project-id&priority=HIGH&sort=progress';
    vi.mocked(useProjectsControllerList).mockReturnValue(
      queryResult({
        items: [
          {
            id: 'project-id',
            name: '결제 프로젝트',
          },
        ],
      }) as never,
    );
    renderScreen();

    expect(screen.getByLabelText('활성 필터')).toBeVisible();
    expect(screen.getByRole('button', { name: '세부 필터 2' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: '프로젝트: 결제 프로젝트 필터 제거' }));

    expect(mocks.push).toHaveBeenCalledWith(
      '/issues?workQueue=IN_PROGRESS&query=%EA%B2%B0%EC%A0%9C&priority=HIGH&sort=progress',
      { scroll: false },
    );
  });

  it('세부 필터 전체 초기화는 검색·빠른 필터·정렬을 유지한다', async () => {
    const user = userEvent.setup();
    mocks.search =
      'workQueue=IN_PROGRESS&query=login&projectId=project-id&priority=HIGH&sort=progress&cursor=next';
    renderScreen();

    await user.click(screen.getByRole('button', { name: '세부 필터 전체 초기화' }));

    expect(mocks.push).toHaveBeenCalledWith(
      '/issues?workQueue=IN_PROGRESS&query=login&sort=progress',
      { scroll: false },
    );
  });

  it('목록 로딩과 오류 상태에서도 현재 화면 구조와 재시도 동작을 유지한다', async () => {
    vi.mocked(useIssuesControllerList).mockReturnValue({
      data: undefined,
      error: null,
      isError: false,
      isPending: true,
      refetch: mocks.issueRefetch,
    } as never);
    const view = renderScreen();

    expect(screen.getByText('이슈 목록을 불러오는 중입니다.')).toBeVisible();
    expect(screen.getByTestId('feature-issue-toolbar')).toBeVisible();

    view.unmount();
    vi.mocked(useIssuesControllerList).mockReturnValue({
      data: undefined,
      error: new Error('목록 오류'),
      isError: true,
      isPending: false,
      refetch: mocks.issueRefetch,
    } as never);
    renderScreen();

    const user = userEvent.setup();
    expect(screen.getByText('이슈 목록을 불러오지 못했습니다')).toBeVisible();
    const retry = screen.getByRole('button', { name: '다시 시도' });
    expect(retry).toHaveClass('min-h-11', 'sm:min-h-10');
    await user.click(retry);
    expect(mocks.issueRefetch).toHaveBeenCalledTimes(1);
  });
});
