import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useLabelsControllerList,
  useMembersControllerList,
  useTeamsControllerList,
  useTeamsControllerListWorkflowStates,
} from '@rivet/api-client';

import messages from '@/messages/ko.json';

import { IssueBoardScreen } from './issue-board-screen';
import { useIssuePages } from './issue-list-queries';
import { useIssueInlineMutation } from './issue-mutations';
import type { TeamTaskIssue } from './issue-types';

vi.mock('@rivet/api-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useLabelsControllerList: vi.fn(),
  useMembersControllerList: vi.fn(),
  useTeamsControllerList: vi.fn(),
  useTeamsControllerListWorkflowStates: vi.fn(),
}));

vi.mock('./issue-list-queries', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useIssuePages: vi.fn(),
}));

vi.mock('./issue-mutations', () => ({
  useIssueInlineMutation: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props} />
  ),
  usePathname: () => '/teams/WEB/board',
  useRouter: () => ({ replace: vi.fn() }),
}));

const team = {
  archived: false,
  id: 'team-web',
  key: 'WEB',
  memberCount: 1,
  name: '웹',
  version: 1,
};
const todo = {
  category: 'UNSTARTED' as const,
  id: 'state-todo',
  isDefault: true,
  name: '할 일',
  position: 0,
  version: 1,
};
const started = {
  category: 'STARTED' as const,
  id: 'state-started',
  isDefault: false,
  name: '진행 중',
  position: 1,
  version: 1,
};
const assignee = {
  deactivatedAt: null,
  id: 'member-assignee',
  joinedAt: '2026-07-01T00:00:00.000Z',
  role: 'MEMBER' as const,
  status: 'ACTIVE' as const,
  user: { avatarFileId: null, displayName: '김담당', id: 'user-assignee' },
};
const issue = {
  assignee,
  blocked: false,
  createdAt: '2026-07-01T00:00:00.000Z',
  createdBy: assignee,
  id: 'issue-web-1',
  identifier: 'WEB-1',
  labels: [
    { archived: false, color: '#72A7F2', id: 'label-1', name: '퍼렁퍼렁' },
    { archived: false, color: '#9A8CF2', id: 'label-2', name: '라벤더' },
    { archived: false, color: '#45C46B', id: 'label-3', name: '완료 조건' },
  ],
  parentIssue: { id: 'feature-1', identifier: 'ISSUE-1', title: '상위 이슈' },
  priority: 'HIGH',
  progress: null,
  project: { archived: false, id: 'project-1', name: '결제 프로젝트', status: 'IN_PROGRESS' },
  projectRole: 'WEB_FRONTEND',
  status: { category: 'UNSTARTED' as const, featureStatus: null, workflowState: todo },
  team,
  title: '보드 카드 속성',
  type: 'TEAM_TASK' as const,
  updatedAt: '2026-07-02T00:00:00.000Z',
  version: 1,
  workflowSummary: null,
} satisfies TeamTaskIssue;

function queryResult(data: unknown) {
  return { data, error: null, isError: false, isPending: false, refetch: vi.fn() };
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="ko" messages={messages} timeZone="Asia/Seoul">
      {children}
    </NextIntlClientProvider>
  );
}

describe('IssueBoardScreen card', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useTeamsControllerList).mockReturnValue(queryResult({ items: [team] }) as never);
    vi.mocked(useTeamsControllerListWorkflowStates).mockReturnValue(
      queryResult({ items: [todo], nextCursor: null }) as never,
    );
    vi.mocked(useMembersControllerList).mockReturnValue(
      queryResult({ items: [assignee], nextCursor: null }) as never,
    );
    vi.mocked(useLabelsControllerList).mockReturnValue(
      queryResult({ items: issue.labels, nextCursor: null }) as never,
    );
    vi.mocked(useIssuePages).mockReturnValue({
      data: { pageParams: [undefined], pages: [{ items: [issue], nextCursor: null }] },
      error: null,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isError: false,
      isFetchNextPageError: false,
      isFetchingNextPage: false,
      isPending: false,
      refetch: vi.fn(),
    } as never);
  });

  afterEach(cleanup);

  it('상태·담당자·우선순위와 라벨을 공통 Compact 표현으로 연결한다', async () => {
    const user = userEvent.setup();
    const mutate = vi.fn();
    vi.mocked(useIssueInlineMutation).mockReturnValue({
      conflict: null,
      isError: false,
      isPending: false,
      mutate,
    } as never);

    render(<IssueBoardScreen teamKey="WEB" />, { wrapper: Wrapper });

    const state = screen.getByRole('combobox', { name: 'WEB-1 상태: 할 일' });
    const assigneeTrigger = screen.getByRole('combobox', { name: 'WEB-1 담당자: 김담당' });
    const priority = screen.getByRole('combobox', { name: 'WEB-1 우선순위: 높음' });
    for (const trigger of [state, assigneeTrigger, priority]) {
      expect(trigger).toHaveAttribute('data-variant', 'inline');
    }
    expect(state.querySelector('[data-slot="inline-select-icon"]')).toHaveClass('lucide-circle');
    expect(priority.querySelector('[data-slot="inline-select-icon"]')).toHaveClass(
      'lucide-signal-high',
    );
    const card = screen
      .getByRole('link', { name: '보드 카드 속성' })
      .closest<HTMLElement>('[data-slot="card"]');
    if (!card) throw new Error('issue board card missing');
    expect(within(card).getByText('웹 프론트')).toBeVisible();
    expect(within(card).getByText('퍼렁퍼렁')).toBeVisible();
    expect(within(card).getByText('라벤더')).toBeVisible();
    expect(within(card).getByText('+1')).toBeVisible();

    await user.click(priority);
    await user.click(await screen.findByRole('option', { name: '긴급' }));
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith({
        change: { kind: 'priority', value: 'URGENT' },
        issue,
      }),
    );
  });

  it('저장 중에도 현재 값을 유지하고 변경한 셀만 busy로 표시한다', () => {
    vi.mocked(useIssueInlineMutation).mockReturnValue({
      conflict: null,
      isError: false,
      isPending: true,
      mutate: vi.fn(),
      variables: { change: { kind: 'priority', value: 'URGENT' }, issue },
    } as never);

    render(<IssueBoardScreen teamKey="WEB" />, { wrapper: Wrapper });

    const card = screen
      .getByRole('link', { name: '보드 카드 속성' })
      .closest<HTMLElement>('[data-slot="card"]');
    expect(card).not.toHaveAttribute('aria-busy');
    const priority = screen.getByRole('combobox', { name: 'WEB-1 우선순위: 높음' });
    expect(priority).toHaveTextContent('높음');
    expect(priority).toHaveAttribute('aria-busy', 'true');
  });

  it('다른 카드 요청이 시작돼도 실패한 셀의 재시도 안내를 유지한다', async () => {
    const user = userEvent.setup();
    const secondIssue = {
      ...issue,
      id: 'issue-web-2',
      identifier: 'WEB-2',
      title: '다른 보드 카드',
    };
    const retryFor = vi.fn();
    vi.mocked(useIssuePages).mockReturnValue({
      data: { pageParams: [undefined], pages: [{ items: [issue, secondIssue], nextCursor: null }] },
      error: null,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isError: false,
      isFetchNextPageError: false,
      isFetchingNextPage: false,
      isPending: false,
      refetch: vi.fn(),
    } as never);
    vi.mocked(useIssueInlineMutation).mockReturnValue({
      conflict: null,
      failureFor: (issueId: string, kind: string) =>
        issueId === issue.id && kind === 'priority' ? { isConflict: false } : undefined,
      isError: false,
      isPending: false,
      mutate: vi.fn(),
      retryFor,
      variables: { change: { kind: 'priority', value: 'LOW' }, issue: secondIssue },
    } as never);

    render(<IssueBoardScreen teamKey="WEB" />, { wrapper: Wrapper });

    const card = screen
      .getByRole('link', { name: '보드 카드 속성' })
      .closest<HTMLElement>('[data-slot="card"]');
    if (!card) throw new Error('issue board card missing');
    expect(within(card).getByRole('alert')).toHaveTextContent(
      '이전 값으로 되돌렸습니다. 다시 시도해 주세요.',
    );

    await user.click(within(card).getByRole('button', { name: '다시 시도' }));
    expect(retryFor).toHaveBeenCalledWith(issue.id, 'priority');
  });

  it('다른 카드의 상태 저장은 현재 드래그 카드의 열 이동을 막지 않는다', () => {
    const secondIssue = {
      ...issue,
      id: 'issue-web-2',
      identifier: 'WEB-2',
      title: '다른 보드 카드',
    };
    const dataTransfer = {
      dropEffect: '',
      effectAllowed: '',
      getData: vi.fn(() => secondIssue.id),
      setData: vi.fn(),
    };
    vi.mocked(useTeamsControllerListWorkflowStates).mockReturnValue(
      queryResult({ items: [todo, started], nextCursor: null }) as never,
    );
    vi.mocked(useIssuePages).mockReturnValue({
      data: { pageParams: [undefined], pages: [{ items: [issue, secondIssue], nextCursor: null }] },
      error: null,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isError: false,
      isFetchNextPageError: false,
      isFetchingNextPage: false,
      isPending: false,
      refetch: vi.fn(),
    } as never);
    vi.mocked(useIssueInlineMutation).mockReturnValue({
      conflict: null,
      isError: false,
      isPending: true,
      isPendingFor: (issueId: string, kind?: string) =>
        issueId === issue.id && kind === 'workflowState',
      mutate: vi.fn(),
      variables: { change: { kind: 'workflowState', value: started }, issue },
    } as never);

    render(<IssueBoardScreen teamKey="WEB" />, { wrapper: Wrapper });

    const card = screen
      .getByRole('link', { name: secondIssue.title })
      .closest<HTMLElement>('[data-slot="card"]');
    const startedColumn = screen
      .getByRole('heading', { level: 2, name: started.name })
      .closest<HTMLElement>('section');
    if (!card || !startedColumn) throw new Error('board test targets missing');

    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(startedColumn, { dataTransfer });

    expect(startedColumn).toHaveClass('ring-2');
  });

  it('라벨이 없는 보드 카드는 추가 편집기를 상시 노출하지 않는다', () => {
    vi.mocked(useIssuePages).mockReturnValue({
      data: {
        pageParams: [undefined],
        pages: [{ items: [{ ...issue, labels: [] }], nextCursor: null }],
      },
      error: null,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isError: false,
      isFetchNextPageError: false,
      isFetchingNextPage: false,
      isPending: false,
      refetch: vi.fn(),
    } as never);
    vi.mocked(useIssueInlineMutation).mockReturnValue({
      conflict: null,
      isError: false,
      isPending: false,
      mutate: vi.fn(),
    } as never);

    render(<IssueBoardScreen teamKey="WEB" />, { wrapper: Wrapper });

    expect(screen.getByRole('button', { name: 'WEB-1 라벨: 라벨 없음' })).toHaveClass(
      'pointer-events-none',
      'opacity-0',
      'group-focus-within/card:pointer-events-auto',
      'group-hover/card:pointer-events-auto',
    );
  });

  it('상태 변경으로 카드가 다른 열에 이동해도 새 상태 트리거로 포커스를 잇는다', async () => {
    const user = userEvent.setup();
    let currentIssue: TeamTaskIssue = issue;
    const mutate = vi.fn();
    vi.mocked(useTeamsControllerListWorkflowStates).mockReturnValue(
      queryResult({ items: [todo, started], nextCursor: null }) as never,
    );
    vi.mocked(useIssuePages).mockImplementation(
      () =>
        ({
          data: { pageParams: [undefined], pages: [{ items: [currentIssue], nextCursor: null }] },
          error: null,
          fetchNextPage: vi.fn(),
          hasNextPage: false,
          isError: false,
          isFetchNextPageError: false,
          isFetchingNextPage: false,
          isPending: false,
          refetch: vi.fn(),
        }) as never,
    );
    vi.mocked(useIssueInlineMutation).mockReturnValue({
      conflict: null,
      isError: false,
      isPending: false,
      mutate,
    } as never);

    const view = render(<IssueBoardScreen teamKey="WEB" />, { wrapper: Wrapper });
    const state = screen.getByRole('combobox', { name: 'WEB-1 상태: 할 일' });
    await user.click(state);
    await user.click(await screen.findByRole('option', { name: '진행 중' }));

    currentIssue = {
      ...issue,
      status: { category: 'STARTED', featureStatus: null, workflowState: started },
    };
    view.rerender(<IssueBoardScreen teamKey="WEB" />);

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'WEB-1 상태: 진행 중' })).toHaveFocus(),
    );
    expect(mutate).toHaveBeenCalledWith(
      { change: { kind: 'workflowState', value: started }, issue },
      expect.objectContaining({ onSettled: expect.any(Function) }),
    );
  });
});
