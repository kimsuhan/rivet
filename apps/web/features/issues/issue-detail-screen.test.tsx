import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type IssueDetailResponseDto,
  type TeamWorkSummaryResponseDto,
  useAuthControllerGetSession,
  useIssueCollaborationControllerCreateHandoff,
  useIssuesControllerGet,
  useIssuesControllerStart,
  useIssuesControllerUpdate,
  useMembersControllerList,
  useProjectsControllerGet,
  useTeamsControllerListWorkflowStates,
  useTeamWorksControllerGet,
} from '@rivet/api-client';

import messages from '@/messages/ko.json';

import { IssueDetailScreen } from './issue-detail-screen';

vi.mock('@rivet/api-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  teamWorksControllerUpdate: vi.fn(),
  useAuthControllerGetSession: vi.fn(),
  useIssueCollaborationControllerCreateHandoff: vi.fn(),
  useIssuesControllerGet: vi.fn(),
  useIssuesControllerStart: vi.fn(),
  useIssuesControllerUpdate: vi.fn(),
  useMembersControllerList: vi.fn(),
  useProjectsControllerGet: vi.fn(),
  useTeamsControllerListWorkflowStates: vi.fn(),
  useTeamWorksControllerGet: vi.fn(),
}));

let search = 'tab=work';
let pathname = '/issues/F-2';
const navigationMocks = vi.hoisted(() => ({
  back: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, scroll, ...props }: ComponentProps<'a'> & { scroll?: boolean }) => {
    void scroll;
    return (
      <a href={String(href)} {...props}>
        {children}
      </a>
    );
  },
  usePathname: () => pathname,
  useRouter: () => navigationMocks,
}));

vi.mock('@/features/collaboration/markdown-editor', () => ({
  HandoffEditor: () => <div />,
  IssueDescriptionEditor: () => <div />,
  WorkNoteEditor: () => <div />,
}));

vi.mock('@/features/collaboration/markdown-renderer', () => ({
  MarkdownRenderer: ({ markdown }: { markdown: string }) => <div>{markdown}</div>,
}));

vi.mock('./issue-attachments', () => ({ IssueAttachments: () => <div /> }));
vi.mock('./issue-timeline', () => ({ IssueTimeline: () => <div /> }));
vi.mock('./team-work-completion-modal', () => ({ TeamWorkCompletionModal: () => null }));
vi.mock('./team-work-primary-action', () => ({ TeamWorkPrimaryAction: () => null }));
vi.mock('./issue-attribute-presentation', () => ({
  CompactAssigneeTrigger: () => <button type="button">담당자</button>,
  IssueStatusDisplay: ({ status }: { status: string }) => <span>{status}</span>,
  PriorityDisplay: ({ priority }: { priority: string }) => <span>{priority}</span>,
  StatusTrigger: () => <button type="button">상태</button>,
  TeamWorkStatusDisplay: ({ name }: { name: string }) => <span>{name}</span>,
}));

const project = {
  archived: false,
  id: 'project-1',
  logoFileId: null,
  name: 'Rivet',
  status: 'IN_PROGRESS' as const,
};
const member = {
  id: 'member-1',
  role: 'MEMBER',
  status: 'ACTIVE',
  user: { avatarFileId: null, displayName: '김리벳', id: 'user-1' },
};

function work(
  id: string,
  identifier: string,
  stateCategory: TeamWorkSummaryResponseDto['stateCategory'],
  teamKey: string,
): TeamWorkSummaryResponseDto {
  return {
    assignee: null,
    createdAt: new Date(0).toISOString(),
    id,
    identifier,
    issue: {
      id: 'issue-1',
      identifier: 'F-2',
      labels: [],
      priority: 'MEDIUM',
      project,
      status: 'TODO',
      title: '상세 화면 점검',
    },
    projectTeam: {
      active: true,
      id: `project-team-${id}`,
      team: { archived: false, id: `team-${id}`, key: teamKey, name: `${teamKey} 팀` },
    },
    stateCategory,
    stateProgress: stateCategory === 'STARTED' ? 0.5 : null,
    updatedAt: new Date(0).toISOString(),
    version: 1,
    workflowState: {
      category: stateCategory,
      color: null,
      id: `state-${id}`,
      isDefault: true,
      name: stateCategory,
      position: 0,
      version: 1,
    },
    workNoteMarkdown: null,
  };
}

function issue(
  status: IssueDetailResponseDto['status'],
  teamWorks: TeamWorkSummaryResponseDto[] = [],
): IssueDetailResponseDto {
  return {
    attachments: [],
    createdAt: new Date(0).toISOString(),
    createdBy: member as IssueDetailResponseDto['createdBy'],
    descriptionMarkdown: null,
    handoffFlows: [],
    id: 'issue-1',
    identifier: 'F-2',
    labels: [],
    priority: 'MEDIUM',
    progress: { completed: 1, percentage: 25, total: 4 },
    project,
    status,
    teamWorks,
    title: '상세 화면 점검',
    updatedAt: new Date(0).toISOString(),
    version: 1,
    workflowSummary: {
      activeTeams: [],
      allTeamWorksCompleted: false,
      canceledCount: 0,
      completedCount: 1,
      teamWorkCount: teamWorks.length,
      unassignedCount: 0,
    },
  };
}

let currentIssue: IssueDetailResponseDto;
let queryClient: QueryClient;

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="ko" messages={{ Markdown: messages.Markdown }}>
        {children}
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

function renderDetail() {
  return render(<IssueDetailScreen issueRef="F-2" />, { wrapper: Wrapper });
}

describe('IssueDetailScreen', () => {
  beforeEach(() => {
    pathname = '/issues/F-2';
    search = 'tab=work';
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    currentIssue = issue('TODO');
    vi.mocked(useIssuesControllerGet).mockImplementation(
      () =>
        ({
          data: currentIssue,
          isError: false,
          isPending: false,
          refetch: vi.fn(),
        }) as never,
    );
    vi.mocked(useTeamWorksControllerGet).mockReturnValue({
      data: undefined,
      isError: false,
      isPending: false,
      refetch: vi.fn(),
    } as never);
    vi.mocked(useAuthControllerGetSession).mockReturnValue({
      data: { authenticated: false },
    } as never);
    vi.mocked(useMembersControllerList).mockReturnValue({
      data: { items: [] },
      isPending: false,
    } as never);
    vi.mocked(useProjectsControllerGet).mockReturnValue({
      data: {
        projectTeams: [
          {
            active: true,
            id: 'project-team-plan',
            team: { archived: false, id: 'team-plan', key: 'PLAN', name: '기획' },
          },
          {
            active: true,
            id: 'project-team-design',
            team: { archived: false, id: 'team-design', key: 'DESIGN', name: '디자인' },
          },
          {
            active: true,
            id: 'project-team-ops',
            team: { archived: false, id: 'team-ops', key: 'OPS', name: '운영' },
          },
        ],
      },
    } as never);
    vi.mocked(useTeamsControllerListWorkflowStates).mockReturnValue({
      data: { items: [] },
      isPending: false,
    } as never);
    vi.mocked(useIssuesControllerStart).mockReturnValue({
      error: null,
      isPending: false,
      mutateAsync: vi.fn(),
    } as never);
    vi.mocked(useIssuesControllerUpdate).mockReturnValue({
      error: null,
      isPending: false,
      mutateAsync: vi.fn(),
    } as never);
    vi.mocked(useIssueCollaborationControllerCreateHandoff).mockReturnValue({
      error: null,
      isPending: false,
      mutate: vi.fn(),
    } as never);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('미시작 상태에서는 일시 중지를 숨기고 진행 중일 때만 표시한다', () => {
    const view = renderDetail();
    expect(screen.queryByRole('button', { name: '일시 중지' })).not.toBeInTheDocument();

    currentIssue = issue('IN_PROGRESS');
    view.rerender(<IssueDetailScreen issueRef="F-2" />);
    expect(screen.getByRole('button', { name: '일시 중지' })).toBeVisible();
  });

  it('텍스트와 함께 접근 가능한 진행률 막대를 표시한다', () => {
    renderDetail();

    expect(screen.getByText('작업 1/4 완료 · 25%')).toBeVisible();
    expect(screen.getByRole('progressbar', { name: '작업 진행률 25%' })).toHaveAttribute(
      'aria-valuenow',
      '25',
    );
  });

  it('저장된 이슈 보기에서 진입하면 복귀와 상세 내부 이동에 보기 문맥을 유지한다', () => {
    currentIssue = issue('IN_PROGRESS', [work('work-1', 'WEB-1', 'STARTED', 'PLAN')]);
    search = 'tab=work&work=WEB-1&view=saved-issues';

    renderDetail();

    expect(screen.getByRole('link', { name: '이슈 목록' })).toHaveAttribute(
      'href',
      '/issues?view=saved-issues',
    );
    expect(screen.getByRole('link', { name: '활동' })).toHaveAttribute(
      'href',
      '/issues/F-2?tab=activity&work=WEB-1&view=saved-issues',
    );
  });

  it('저장된 내 작업 보기에서 진입하면 복귀와 작업 전환에 보기 문맥을 유지한다', () => {
    currentIssue = issue('IN_PROGRESS', [
      work('work-1', 'WEB-1', 'STARTED', 'PLAN'),
      work('work-2', 'WEB-2', 'UNSTARTED', 'OPS'),
    ]);
    pathname = '/my-issues/WEB-1';
    search = 'tab=work&view=saved-my-work';

    render(<IssueDetailScreen entry="my-work" issueRef="WEB-1" />, { wrapper: Wrapper });

    expect(screen.getByRole('link', { name: '내 작업' })).toHaveAttribute(
      'href',
      '/my-issues?view=saved-my-work',
    );
    expect(screen.getByRole('link', { name: /WEB-2/ })).toHaveAttribute(
      'href',
      '/my-issues/WEB-2?tab=work&view=saved-my-work',
    );
  });

  it('프로젝트 진입은 프로젝트 이름과 상세 경로를 이동 문맥으로 유지한다', () => {
    currentIssue = issue('IN_PROGRESS', [work('work-1', 'WEB-1', 'STARTED', 'PLAN')]);
    pathname = '/projects/project-1/issues/F-2';
    search = 'tab=work&work=WEB-1';

    render(<IssueDetailScreen entry="project" issueRef="F-2" projectId="project-1" />, {
      wrapper: Wrapper,
    });

    expect(screen.getByRole('link', { name: 'Rivet' })).toHaveAttribute(
      'href',
      '/projects/project-1',
    );
    expect(screen.getByRole('link', { name: '활동' })).toHaveAttribute(
      'href',
      '/projects/project-1/issues/F-2?tab=activity&work=WEB-1',
    );
  });

  it('경로의 프로젝트와 이슈 소속이 다르면 전역 정본 주소로 복구한다', async () => {
    search = 'tab=activity&work=WEB-1';

    render(<IssueDetailScreen entry="project" issueRef="F-2" projectId="project-2" />, {
      wrapper: Wrapper,
    });

    expect(screen.getByText('올바른 이슈 주소로 이동 중입니다')).toBeVisible();
    await waitFor(() =>
      expect(navigationMocks.replace).toHaveBeenCalledWith('/issues/F-2?tab=activity&work=WEB-1', {
        scroll: false,
      }),
    );
  });

  it('사용자가 접은 팀 작업 추가 패널은 재렌더에도 유지하고 다른 작업 선택 시 초기화한다', async () => {
    const user = userEvent.setup();
    const first = work('work-1', 'WEB-1', 'UNSTARTED', 'PLAN');
    const second = work('work-2', 'WEB-2', 'UNSTARTED', 'OPS');
    currentIssue = issue('IN_PROGRESS', [first, second]);
    search = 'tab=work&work=WEB-1';
    const view = renderDetail();
    const disclosure = screen.getByText('팀 작업 추가').closest('details');

    expect(disclosure).toHaveAttribute('open');

    currentIssue = issue('IN_PROGRESS', [{ ...first, stateCategory: 'STARTED' }, second]);
    view.rerender(<IssueDetailScreen issueRef="F-2" />);
    expect(screen.getByText('팀 작업 추가').closest('details')).toHaveAttribute('open');

    await user.click(screen.getByText('팀 작업 추가'));
    expect(disclosure).not.toHaveAttribute('open');

    currentIssue = { ...currentIssue, updatedAt: new Date(1).toISOString() };
    view.rerender(<IssueDetailScreen issueRef="F-2" />);
    expect(screen.getByText('팀 작업 추가').closest('details')).not.toHaveAttribute('open');

    search = 'tab=work&work=WEB-2';
    view.rerender(<IssueDetailScreen issueRef="F-2" />);
    expect(screen.getByText('팀 작업 추가').closest('details')).toHaveAttribute('open');
  });
});
