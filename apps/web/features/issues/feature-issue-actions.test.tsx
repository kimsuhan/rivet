import { QueryClient, QueryClientProvider, useQueries, useQuery } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  issuesControllerList,
  membersControllerList,
  useIssuesControllerAssignTeamTasks,
  useIssuesControllerClaim,
  useIssuesControllerStart,
  useProjectsControllerGet,
} from '@rivet/api-client';

import messages from '@/messages/ko.json';

import {
  FeatureIssueActions,
  listAllActiveTeamMembers,
  listAllFeatureTeamTasks,
} from './feature-issue-actions';
import type { FeatureIssueListItem } from './feature-issue-row';
import { useIssueInlineMutation } from './issue-mutations';

const mocks = vi.hoisted(() => ({
  assign: vi.fn(),
  claim: vi.fn(),
  complete: vi.fn(),
  onClose: vi.fn(),
  start: vi.fn(),
}));

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useQueries: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock('@rivet/api-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getIssuesControllerGetQueryKey: (issueRef: string) => ['/api/v1/issues', issueRef],
  getIssuesControllerListQueryKey: () => ['/api/v1/issues'],
  getMembersControllerListQueryKey: (params: unknown) => ['/api/v1/members', params],
  getProjectsControllerGetQueryKey: (projectId: string) => ['/api/v1/projects', projectId],
  issuesControllerList: vi.fn(),
  membersControllerList: vi.fn(),
  useIssuesControllerAssignTeamTasks: vi.fn(),
  useIssuesControllerClaim: vi.fn(),
  useIssuesControllerStart: vi.fn(),
  useProjectsControllerGet: vi.fn(),
}));

vi.mock('./issue-mutations', () => ({
  useIssueInlineMutation: vi.fn(),
}));

const apiTeam = { archived: false, id: 'api-team-id', key: 'API', name: 'API 팀' };
const member = {
  deactivatedAt: null,
  id: 'api-member-id',
  joinedAt: '2026-07-01T00:00:00.000Z',
  role: 'MEMBER' as const,
  status: 'ACTIVE' as const,
  user: { avatarFileId: null, displayName: 'API 담당자', id: 'api-user-id' },
};
const issue: FeatureIssueListItem = {
  assignee: null,
  blocked: false,
  createdAt: '2026-07-01T00:00:00.000Z',
  createdBy: member,
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
    currentUserTeamRoles: ['BACKEND'],
    teamTaskCount: 0,
    unassignedCount: 0,
    waitingOn: [],
  },
};

function queryResult(data: unknown) {
  return {
    data,
    error: null,
    isError: false,
    isFetching: false,
    isPending: false,
    refetch: vi.fn(),
  };
}

function mutation(mutate: ReturnType<typeof vi.fn>) {
  return { error: null, isPending: false, mutate };
}

let queryClient: QueryClient;

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="ko" messages={messages} timeZone="Asia/Seoul">
        {children}
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

function renderAction(action: Parameters<typeof FeatureIssueActions>[0]['action']) {
  return render(<FeatureIssueActions action={action} issue={issue} onClose={mocks.onClose} />, {
    wrapper: Wrapper,
  });
}

describe('FeatureIssueActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(useProjectsControllerGet).mockReturnValue(
      queryResult({ roleTeams: [{ role: 'BACKEND', team: apiTeam }] }) as never,
    );
    vi.mocked(useQuery).mockReturnValue(
      queryResult({ items: [], nextCursor: null, totalCount: 0 }) as never,
    );
    vi.mocked(useQueries).mockReturnValue([queryResult({ items: [member] })] as never);
    vi.mocked(useIssuesControllerStart).mockReturnValue(mutation(mocks.start) as never);
    vi.mocked(useIssuesControllerClaim).mockReturnValue(mutation(mocks.claim) as never);
    vi.mocked(useIssuesControllerAssignTeamTasks).mockReturnValue(mutation(mocks.assign) as never);
    vi.mocked(useIssueInlineMutation).mockReturnValue({
      ...mutation(mocks.complete),
      conflict: null,
      isError: false,
    } as never);
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
  });

  it('하위 팀 작업의 모든 커서 페이지를 합쳐 동작 후보를 만든다', async () => {
    vi.mocked(issuesControllerList)
      .mockResolvedValueOnce({
        items: [{ id: 'task-1' }],
        nextCursor: 'next-page',
        totalCount: 2,
      } as never)
      .mockResolvedValueOnce({
        items: [{ id: 'task-2' }],
        nextCursor: null,
        totalCount: 2,
      } as never);

    const result = await listAllFeatureTeamTasks(issue.id, new AbortController().signal);

    expect(result.items.map(({ id }) => id)).toEqual(['task-1', 'task-2']);
    expect(result.totalCount).toBe(2);
    expect(issuesControllerList).toHaveBeenNthCalledWith(
      2,
      {
        cursor: 'next-page',
        limit: 100,
        parentIssueId: issue.id,
        type: 'TEAM_TASK',
      },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('역할 팀의 활성 멤버 후보도 모든 커서 페이지에서 합친다', async () => {
    vi.mocked(membersControllerList)
      .mockResolvedValueOnce({
        items: [member],
        nextCursor: 'member-next-page',
      })
      .mockResolvedValueOnce({
        items: [{ ...member, id: 'second-member-id' }],
        nextCursor: null,
      });

    const result = await listAllActiveTeamMembers(apiTeam.id, new AbortController().signal);

    expect(result.items.map(({ id }) => id)).toEqual([member.id, 'second-member-id']);
    expect(membersControllerList).toHaveBeenNthCalledWith(
      2,
      {
        cursor: 'member-next-page',
        limit: 100,
        status: 'ACTIVE',
        teamId: apiTeam.id,
      },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('선택 역할과 담당자 없음으로 작업 시작 계약을 보낸다', async () => {
    const user = userEvent.setup();
    renderAction('START_WORK');

    await user.click(screen.getByRole('checkbox', { name: '백엔드 · API 팀' }));
    await user.click(screen.getByRole('button', { name: '작업 시작' }));

    expect(mocks.start).toHaveBeenCalledWith(
      {
        data: {
          roleAssignments: [{ assigneeMembershipId: null, projectRole: 'BACKEND' }],
        },
        issueId: issue.id,
      },
      expect.any(Object),
    );
  });

  it('작업 다이얼로그의 주요 조작 영역에 모바일과 데스크톱 최소 높이를 적용한다', async () => {
    const user = userEvent.setup();
    renderAction('START_WORK');

    await user.click(screen.getByRole('checkbox', { name: '백엔드 · API 팀' }));

    for (const control of [
      screen.getByRole('button', { name: '작업 창 닫기' }),
      screen.getByRole('button', { name: '취소' }),
      screen.getByRole('button', { name: '작업 시작' }),
    ]) {
      expect(control).toHaveClass('h-11', 'sm:h-10');
    }
    expect(screen.getByRole('combobox', { name: '백엔드 담당자' })).toHaveClass(
      'min-h-11',
      'sm:min-h-10',
    );
  });

  it('작업 시작 담당자가 비활성화되면 오래된 ID를 보내지 않고 새 후보를 요구한다', async () => {
    const user = userEvent.setup();
    const replacement = {
      ...member,
      id: 'replacement-member-id',
      user: { ...member.user, displayName: '새 담당자', id: 'replacement-user-id' },
    };
    const view = renderAction('START_WORK');

    await user.click(screen.getByRole('checkbox', { name: '백엔드 · API 팀' }));
    await user.click(screen.getByRole('combobox', { name: '백엔드 담당자' }));
    await user.click(await screen.findByRole('option', { name: 'API 담당자' }));

    vi.mocked(useQueries).mockReturnValue([queryResult({ items: [replacement] })] as never);
    view.rerender(
      <FeatureIssueActions action="START_WORK" issue={issue} onClose={mocks.onClose} />,
    );

    expect(
      screen.getByText(
        'API 담당자님은 더 이상 이 팀의 활성 후보가 아닙니다. 새 담당자를 선택해 주세요.',
      ),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: '작업 시작' }));
    expect(mocks.start).not.toHaveBeenCalled();

    await user.click(screen.getByRole('combobox', { name: '백엔드 담당자' }));
    await user.click(await screen.findByRole('option', { name: '새 담당자' }));
    await user.click(screen.getByRole('button', { name: '작업 시작' }));
    expect(mocks.start).toHaveBeenCalledWith(
      {
        data: {
          roleAssignments: [{ assigneeMembershipId: replacement.id, projectRole: 'BACKEND' }],
        },
        issueId: issue.id,
      },
      expect.any(Object),
    );
  });

  it('우리 팀 역할 하나는 담당자 없이 멤버십 재검증 옵션으로 시작한다', async () => {
    const user = userEvent.setup();
    renderAction('START_FROM_MY_TEAM');

    await user.click(screen.getByRole('button', { name: '우리 팀에서 시작' }));

    expect(mocks.start).toHaveBeenCalledWith(
      {
        data: { initialRoles: ['BACKEND'], requireCurrentUserTeamMembership: true },
        issueId: issue.id,
      },
      expect.any(Object),
    );
  });

  it('미할당 역할 작업이 한 건이면 별도 선택 없이 내가 맡기 계약을 보낸다', async () => {
    const user = userEvent.setup();
    vi.mocked(useQuery).mockReturnValue(
      queryResult({
        items: [
          {
            assignee: null,
            id: 'team-task-id',
            identifier: 'API-1',
            projectRole: 'BACKEND',
            status: { category: 'UNSTARTED' },
            title: 'API 작업',
            version: 3,
          },
        ],
        nextCursor: null,
        totalCount: 1,
      }) as never,
    );
    renderAction('CLAIM');

    await user.click(screen.getByRole('button', { name: '내가 맡기' }));

    expect(mocks.claim).toHaveBeenCalledWith(
      { data: { projectRole: 'BACKEND' }, issueId: issue.id },
      expect.any(Object),
    );
    expect(useProjectsControllerGet).toHaveBeenCalledWith('project-id', {
      query: { enabled: false, retry: false },
    });
    expect(useQueries).toHaveBeenCalledWith({ queries: [] });
  });

  it('미할당 팀 작업에 활성 팀 멤버와 버전을 담아 일괄 배정한다', async () => {
    const user = userEvent.setup();
    vi.mocked(useQuery).mockReturnValue(
      queryResult({
        items: [
          {
            assignee: null,
            id: 'team-task-id',
            identifier: 'API-1',
            projectRole: 'BACKEND',
            status: { category: 'UNSTARTED' },
            title: 'API 작업',
            version: 3,
          },
        ],
        nextCursor: null,
        totalCount: 1,
      }) as never,
    );
    renderAction('ASSIGN_TEAM_TASKS');

    await user.click(screen.getByRole('combobox', { name: 'API-1 담당자' }));
    await user.click(await screen.findByRole('option', { name: 'API 담당자' }));
    await user.click(screen.getByRole('button', { name: '담당자 지정' }));

    expect(mocks.assign).toHaveBeenCalledWith(
      {
        data: {
          assignments: [
            {
              assigneeMembershipId: member.id,
              teamTaskIssueId: 'team-task-id',
              version: 3,
            },
          ],
        },
        issueId: issue.id,
      },
      expect.any(Object),
    );
  });

  it('배정 충돌 뒤 새 담당자를 표시하고 저장 전 선택을 유지한다', async () => {
    const user = userEvent.setup();
    const task = {
      assignee: null,
      id: 'team-task-id',
      identifier: 'API-1',
      projectRole: 'BACKEND',
      status: { category: 'UNSTARTED' },
      title: 'API 작업',
      version: 3,
    };
    vi.mocked(useQuery).mockReturnValue(
      queryResult({ items: [task], nextCursor: null, totalCount: 1 }) as never,
    );
    const view = renderAction('ASSIGN_TEAM_TASKS');

    await user.click(screen.getByRole('combobox', { name: 'API-1 담당자' }));
    await user.click(await screen.findByRole('option', { name: 'API 담당자' }));

    vi.mocked(useQuery).mockReturnValue(
      queryResult({
        items: [
          {
            ...task,
            assignee: {
              id: 'other-member-id',
              role: 'MEMBER',
              status: 'ACTIVE',
              user: {
                avatarFileId: null,
                displayName: '다른 담당자',
                id: 'other-user-id',
              },
            },
            version: 4,
          },
        ],
        nextCursor: null,
        totalCount: 1,
      }) as never,
    );
    view.rerender(
      <FeatureIssueActions action="ASSIGN_TEAM_TASKS" issue={issue} onClose={mocks.onClose} />,
    );

    expect(screen.getByText('현재 담당자: 다른 담당자')).toBeVisible();
    expect(screen.getByText('저장 전 선택: API 담당자')).toBeVisible();
    expect(screen.getByText('현재 활성 후보 1명')).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'API-1 담당자' })).toBeDisabled();
  });

  it('선택한 후보가 비활성화되면 해당 선택을 재전송하지 않고 새 후보를 요구한다', async () => {
    const user = userEvent.setup();
    const task = {
      assignee: null,
      id: 'team-task-id',
      identifier: 'API-1',
      projectRole: 'BACKEND',
      status: { category: 'UNSTARTED' },
      title: 'API 작업',
      version: 3,
    };
    const secondTask = {
      ...task,
      id: 'team-task-id-2',
      identifier: 'API-2',
      title: '두 번째 API 작업',
    };
    const replacement = {
      ...member,
      id: 'replacement-member-id',
      user: { ...member.user, displayName: '새 담당자', id: 'replacement-user-id' },
    };
    vi.mocked(useQuery).mockReturnValue(
      queryResult({ items: [task, secondTask], nextCursor: null, totalCount: 2 }) as never,
    );
    vi.mocked(useQueries).mockReturnValue([queryResult({ items: [member, replacement] })] as never);
    const view = renderAction('ASSIGN_TEAM_TASKS');

    await user.click(screen.getByRole('combobox', { name: 'API-1 담당자' }));
    await user.click(await screen.findByRole('option', { name: 'API 담당자' }));
    await user.click(screen.getByRole('combobox', { name: 'API-2 담당자' }));
    await user.click(await screen.findByRole('option', { name: '새 담당자' }));

    vi.mocked(useQueries).mockReturnValue([queryResult({ items: [replacement] })] as never);
    view.rerender(
      <FeatureIssueActions action="ASSIGN_TEAM_TASKS" issue={issue} onClose={mocks.onClose} />,
    );

    expect(
      screen.getByText(
        'API 담당자님은 더 이상 이 팀의 활성 후보가 아닙니다. 새 담당자를 선택해 주세요.',
      ),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: '담당자 지정' }));
    expect(mocks.assign).not.toHaveBeenCalled();
    expect(
      screen.getAllByText(
        '사용할 수 없게 된 담당자 선택이 있습니다. 최신 후보에서 다시 선택해 주세요.',
      ),
    ).toHaveLength(2);

    await user.click(screen.getByRole('combobox', { name: 'API-1 담당자' }));
    await user.click(await screen.findByRole('option', { name: '새 담당자' }));
    await user.click(screen.getByRole('button', { name: '담당자 지정' }));
    expect(mocks.assign).toHaveBeenCalledWith(
      {
        data: {
          assignments: [
            {
              assigneeMembershipId: replacement.id,
              teamTaskIssueId: task.id,
              version: task.version,
            },
            {
              assigneeMembershipId: replacement.id,
              teamTaskIssueId: secondTask.id,
              version: secondTask.version,
            },
          ],
        },
        issueId: issue.id,
      },
      expect.any(Object),
    );
  });

  it('완료 충돌 뒤에는 최신 상위 이슈 버전으로만 다시 완료한다', async () => {
    const user = userEvent.setup();
    vi.mocked(useQuery).mockReturnValue(
      queryResult({
        items: [
          {
            assignee: member,
            id: 'team-task-id',
            identifier: 'API-1',
            projectRole: 'BACKEND',
            status: { category: 'COMPLETED' },
            title: 'API 작업',
            version: 4,
          },
        ],
        nextCursor: null,
        totalCount: 1,
      }) as never,
    );
    vi.mocked(useIssueInlineMutation).mockReturnValue({
      ...mutation(mocks.complete),
      conflict: {
        attemptedChange: {
          kind: 'featureStatus',
          requireCompletedTeamTasks: true,
          value: 'DONE',
        },
        issueRef: issue.identifier,
        latest: { ...issue, version: 5 },
      },
      isError: true,
    } as never);
    renderAction('COMPLETE_ISSUE');

    await user.click(screen.getByRole('button', { name: '이슈 완료' }));

    expect(mocks.complete).toHaveBeenCalledWith(
      {
        change: {
          kind: 'featureStatus',
          requireCompletedTeamTasks: true,
          value: 'DONE',
        },
        issue: expect.objectContaining({ id: issue.id, version: 5 }),
      },
      expect.any(Object),
    );
  });

  it('최신 하위 작업에 미완료 작업이 생기면 빠른 완료를 막는다', () => {
    vi.mocked(useQuery).mockReturnValue(
      queryResult({
        items: [
          {
            assignee: member,
            id: 'team-task-id',
            identifier: 'API-1',
            projectRole: 'BACKEND',
            status: { category: 'STARTED' },
            title: 'API 작업',
            version: 5,
          },
        ],
        nextCursor: null,
        totalCount: 1,
      }) as never,
    );
    renderAction('COMPLETE_ISSUE');

    expect(screen.getByText('이슈를 바로 완료할 수 없습니다')).toBeVisible();
    expect(screen.getByRole('button', { name: '이슈 완료' })).toBeDisabled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });
});
