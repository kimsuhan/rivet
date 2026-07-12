import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  SearchIssueResultResponseDto,
  SearchIssueSummaryResponseDto,
} from '@rivet/api-client';

import { GlobalSearch, type GlobalSearchLabels } from './global-search';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  search: vi.fn(),
}));

vi.mock('@rivet/api-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  searchControllerIssues: mocks.search,
}));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}));

const labels: GlobalSearchLabels = {
  close: '검색 닫기',
  description: '현재 워크스페이스의 이슈를 표시 ID나 제목으로 찾습니다.',
  emptyDescription: '표시 ID 또는 제목을 입력하세요.',
  emptyTitle: '검색어를 입력하세요',
  errorDescription: '입력한 검색어는 유지됩니다.',
  errorTitle: '이슈를 검색하지 못했습니다',
  exactMatch: 'ID 일치',
  feature: '기능 이슈',
  featureStatuses: {
    CANCELED: '취소',
    DONE: '완료',
    IN_PROGRESS: '진행 중',
    PAUSED: '보류',
    REVIEW: '검토',
    TODO: '할 일',
    UNSORTED: '미분류',
  },
  inputLabel: '검색어',
  loadMore: '결과 더 보기',
  loadMoreError: '결과를 더 불러오지 못했습니다.',
  loading: '이슈를 검색하는 중입니다.',
  loadingMore: '결과를 더 불러오는 중',
  minimumDescription: '제목 부분 검색은 두 글자부터 시작합니다.',
  minimumTitle: '두 글자 이상 입력하세요',
  noProject: '프로젝트 없음',
  noResultsDescription: '검색어를 바꿔 보세요.',
  noResultsTitle: '조건에 맞는 이슈가 없습니다',
  placeholder: '이슈 ID 또는 제목 검색',
  resultCount: '검색 결과 {count}개',
  results: '이슈 검색 결과',
  retry: '다시 시도',
  roles: {
    APP_FRONTEND: '앱 프론트',
    BACKEND: '백엔드',
    WEB_FRONTEND: '웹 프론트',
  },
  stateCategories: {
    BACKLOG: '백로그',
    CANCELED: '취소',
    COMPLETED: '완료',
    STARTED: '진행 중',
    UNSTARTED: '할 일',
  },
  teamTask: '팀 작업',
  title: '검색',
};

const featureIssue: SearchIssueSummaryResponseDto = {
  assignee: null,
  blocked: false,
  createdAt: '2026-07-11T01:00:00.000Z',
  id: 'feature-1',
  identifier: 'F-1',
  labels: [],
  parentIssue: null,
  priority: 'MEDIUM',
  progress: { completed: 1, percentage: 50, total: 2 },
  project: {
    archived: false,
    id: 'project-1',
    name: '검색 개선',
    status: 'IN_PROGRESS',
  },
  projectRole: null,
  status: { category: 'STARTED', featureStatus: 'IN_PROGRESS', workflowState: null },
  team: null,
  title: '전역 검색 흐름 정리',
  type: 'FEATURE',
  updatedAt: '2026-07-11T02:00:00.000Z',
  version: 1,
};

const teamTaskIssue: SearchIssueSummaryResponseDto = {
  ...featureIssue,
  assignee: null,
  id: 'team-task-42',
  identifier: 'WEB-42',
  parentIssue: {
    id: featureIssue.id,
    identifier: featureIssue.identifier,
    title: featureIssue.title,
  },
  progress: null,
  projectRole: 'WEB_FRONTEND',
  status: {
    category: 'STARTED',
    featureStatus: null,
    workflowState: {
      category: 'STARTED',
      id: 'state-progress',
      isDefault: false,
      name: '개발 중',
      position: 2,
      version: 1,
    },
  },
  team: { archived: false, id: 'team-web', key: 'WEB', name: '웹 팀' },
  title: '검색 결과 화면 연결',
  type: 'TEAM_TASK',
};

const exactResult: SearchIssueResultResponseDto = {
  issue: teamTaskIssue,
  matchType: 'IDENTIFIER_EXACT',
};

const partialResult: SearchIssueResultResponseDto = {
  issue: featureIssue,
  matchType: 'TITLE_PARTIAL',
};

let queryClient: QueryClient;

function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function renderSearch(onOpenChange = vi.fn()) {
  return {
    onOpenChange,
    ...render(<GlobalSearch open onOpenChange={onOpenChange} labels={labels} />, {
      wrapper: Wrapper,
    }),
  };
}

async function searchFor(user: ReturnType<typeof userEvent.setup>, query: string) {
  const input = screen.getByRole('combobox', { name: labels.inputLabel });
  await user.type(input, query);
  await vi.advanceTimersByTimeAsync(250);
  return input;
}

describe('GlobalSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    queryClient = new QueryClient({
      defaultOptions: { queries: { gcTime: Infinity, retry: false } },
    });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.useRealTimers();
  });

  it('빈 입력과 한 글자 안내 뒤 두 글자부터 debounce 조회하고 이슈 맥락을 표시한다', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mocks.search.mockResolvedValue({ items: [exactResult, partialResult], nextCursor: null });
    renderSearch();

    const input = screen.getByRole('combobox', { name: labels.inputLabel });
    const dialog = screen.getByRole('dialog', { name: labels.title });
    expect(dialog).toHaveClass('lg:data-open:zoom-in-95', 'lg:data-closed:zoom-out-95');
    expect(dialog).not.toHaveClass('data-open:zoom-in-95', 'data-closed:zoom-out-95');
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText(labels.emptyTitle)).toBeVisible();

    await user.type(input, 'W');
    await vi.advanceTimersByTimeAsync(250);
    expect(screen.getByText(labels.minimumTitle)).toBeVisible();
    expect(mocks.search).not.toHaveBeenCalled();

    await user.type(input, 'EB');
    await vi.advanceTimersByTimeAsync(250);

    const options = await screen.findAllByRole('option');
    expect(mocks.search).toHaveBeenCalledWith(
      { limit: 20, query: 'WEB' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent('WEB-42');
    expect(options[0]).toHaveTextContent('ID 일치');
    expect(options[0]).toHaveTextContent('검색 개선');
    expect(options[0]).toHaveTextContent('웹 팀 · 웹 프론트');
    expect(options[0]).toHaveTextContent('개발 중');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-controls', 'global-search-results');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', 'global-search-result-team-task-42');
  });

  it('방향키로 결과를 선택하고 Enter로 이슈 상세를 연다', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onOpenChange = vi.fn();
    mocks.search.mockResolvedValue({ items: [exactResult, partialResult], nextCursor: null });
    renderSearch(onOpenChange);

    const input = await searchFor(user, '검색');
    await screen.findAllByRole('option');
    await user.keyboard('{ArrowDown}');

    expect(input).toHaveAttribute('aria-activedescendant', 'global-search-result-feature-1');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{Enter}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.push).toHaveBeenCalledWith('/issues/F-1');
  });

  it('Escape로 닫기를 요청한다', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onOpenChange = vi.fn();
    renderSearch(onOpenChange);

    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('커서가 있으면 다음 결과를 이어 붙인다', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mocks.search.mockImplementation((params: { cursor?: string }) =>
      Promise.resolve(
        params.cursor
          ? { items: [partialResult], nextCursor: null }
          : { items: [exactResult], nextCursor: 'cursor-2' },
      ),
    );
    renderSearch();

    await searchFor(user, '검색');
    await screen.findByRole('option', { name: /WEB-42/ });
    await user.click(screen.getByRole('button', { name: labels.loadMore }));

    await screen.findByRole('option', { name: /F-1/ });
    expect(mocks.search).toHaveBeenLastCalledWith(
      { cursor: 'cursor-2', limit: 20, query: '검색' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('검색 실패 뒤 입력을 유지하고 다시 시도한다', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mocks.search
      .mockRejectedValueOnce(new Error('failed'))
      .mockResolvedValueOnce({ items: [partialResult], nextCursor: null });
    renderSearch();

    const input = await searchFor(user, '검색');
    expect(await screen.findByRole('heading', { name: labels.errorTitle })).toBeVisible();
    expect(input).toHaveValue('검색');

    await user.click(screen.getByRole('button', { name: labels.retry }));
    await waitFor(() => expect(screen.getByRole('option', { name: /F-1/ })).toBeVisible());
    expect(mocks.search).toHaveBeenCalledTimes(2);
  });
});
