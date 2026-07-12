import { type InfiniteData, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  getIssuesControllerGetQueryKey,
  getIssuesControllerListQueryKey,
  type IssueDetailResponseDto,
  type IssueListResponseDto,
  issuesControllerGet,
  issuesControllerUpdate,
} from '@rivet/api-client';

import { getIssuePagesQueryKey } from './issue-list-queries';
import { applyIssueChange, useIssueInlineMutation } from './issue-mutations';

vi.mock('@rivet/api-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  issuesControllerGet: vi.fn(),
  issuesControllerUpdate: vi.fn(),
}));

const issue = {
  assignee: null,
  attachments: [],
  blocked: false,
  blockers: [],
  blocking: [],
  createdAt: '2026-07-01T00:00:00.000Z',
  createdBy: {
    id: 'membership-creator',
    role: 'MEMBER',
    status: 'ACTIVE',
    user: { avatarFileId: null, displayName: '작성자', id: 'user-creator' },
  },
  descriptionMarkdown: null,
  handoffSummary: null,
  id: '7c8fc5da-cccb-4478-b9b0-78ec539e9271',
  identifier: 'API-1',
  labels: [],
  parentIssue: null,
  priority: 'NONE',
  progress: null,
  project: null,
  projectRole: null,
  status: {
    category: 'UNSTARTED',
    featureStatus: null,
    workflowState: {
      category: 'UNSTARTED',
      id: '93331a10-3dc7-44cd-820c-33b74c63dc2f',
      isDefault: true,
      name: '할 일',
      position: 0,
      version: 1,
    },
  },
  team: {
    archived: false,
    id: '6f83906f-6883-4434-b7e2-4156fca910a1',
    key: 'API',
    name: 'API',
  },
  title: '첫 이슈',
  type: 'TEAM_TASK',
  updatedAt: '2026-07-01T00:00:00.000Z',
  version: 1,
} satisfies IssueDetailResponseDto;

const params = {
  assigneeMembershipId: 'me',
  limit: 50,
  sort: 'updatedAt' as const,
  sortDirection: 'desc' as const,
  stateCategory: 'BACKLOG,UNSTARTED,STARTED',
  type: 'TEAM_TASK' as const,
};
const listQueryKey = getIssuePagesQueryKey(params);
const regularListQueryKey = getIssuesControllerListQueryKey({ limit: 100 });
let queryClient: QueryClient;

function QueryWrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function seedIssue() {
  const list: InfiniteData<IssueListResponseDto> = {
    pageParams: [undefined],
    pages: [{ items: [issue], nextCursor: null }],
  };
  queryClient.setQueryData(listQueryKey, list);
  queryClient.setQueryData(regularListQueryKey, { items: [issue], nextCursor: null });
  queryClient.setQueryData(getIssuesControllerGetQueryKey(issue.identifier), issue);
}

function listedIssue() {
  return queryClient.getQueryData<InfiniteData<IssueListResponseDto>>(listQueryKey)?.pages[0]
    ?.items[0];
}

function regularlyListedIssue() {
  return queryClient.getQueryData<IssueListResponseDto>(regularListQueryKey)?.items[0];
}

describe('issue inline optimistic mutation', () => {
  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedIssue();
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.clearAllMocks();
  });

  it.each([
    ['UNSORTED', 'BACKLOG'],
    ['PAUSED', 'BACKLOG'],
    ['TODO', 'UNSTARTED'],
    ['IN_PROGRESS', 'STARTED'],
    ['REVIEW', 'STARTED'],
    ['DONE', 'COMPLETED'],
    ['CANCELED', 'CANCELED'],
  ] as const)('기능 상태 %s의 낙관적 범주를 %s로 계산한다', (featureStatus, category) => {
    const feature = {
      ...issue,
      project: {
        archived: false,
        id: 'project-id',
        name: '프로젝트',
        status: 'IN_PROGRESS' as const,
      },
      status: {
        category: 'BACKLOG' as const,
        featureStatus: 'UNSORTED' as const,
        workflowState: null,
      },
      team: null,
      type: 'FEATURE' as const,
    };

    expect(
      applyIssueChange(feature, { kind: 'featureStatus', value: featureStatus }, false).status,
    ).toEqual({ category, featureStatus, workflowState: null });
  });

  it('요청 중 목록과 상세를 낙관적으로 바꾸고 성공 응답으로 교체한다', async () => {
    let resolveUpdate: ((value: IssueDetailResponseDto) => void) | undefined;
    vi.mocked(issuesControllerUpdate).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    const updated = { ...issue, priority: 'HIGH' as const, version: 2 };
    const { result } = renderHook(() => useIssueInlineMutation(), { wrapper: QueryWrapper });

    act(() => {
      result.current.mutate({
        change: { kind: 'priority', value: 'HIGH' },
        issue,
      });
    });

    await waitFor(() => expect(listedIssue()?.priority).toBe('HIGH'));
    expect(regularlyListedIssue()?.priority).toBe('HIGH');
    expect(listedIssue()?.version).toBe(2);
    expect(
      queryClient.getQueryData<IssueDetailResponseDto>(
        getIssuesControllerGetQueryKey(issue.identifier),
      )?.priority,
    ).toBe('HIGH');

    await act(async () => {
      resolveUpdate?.(updated);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(issuesControllerUpdate).toHaveBeenCalledWith(issue.id, {
      priority: 'HIGH',
      version: 1,
    });
    expect(listedIssue()).toMatchObject({ priority: 'HIGH', version: 2 });
  });

  it('라벨 변경은 선택한 ID를 전송하고 목록과 상세에 낙관적으로 반영한다', async () => {
    const label = {
      archived: false,
      color: '#2AA198',
      id: '8b03a987-9450-43d1-a14b-dfc0b2dca166',
      name: '핵심',
    };
    let resolveUpdate: ((value: IssueDetailResponseDto) => void) | undefined;
    vi.mocked(issuesControllerUpdate).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    const updated = { ...issue, labels: [label], version: 2 };
    const { result } = renderHook(() => useIssueInlineMutation(), { wrapper: QueryWrapper });

    act(() => {
      result.current.mutate({
        change: { kind: 'labels', value: [label] },
        issue,
      });
    });

    await waitFor(() => expect(listedIssue()?.labels).toEqual([label]));
    expect(
      queryClient.getQueryData<IssueDetailResponseDto>(
        getIssuesControllerGetQueryKey(issue.identifier),
      )?.labels,
    ).toEqual([label]);
    expect(issuesControllerUpdate).toHaveBeenCalledWith(issue.id, {
      labelIds: [label.id],
      version: 1,
    });

    await act(async () => {
      resolveUpdate?.(updated);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('설명 저장 성공은 후속 목록 재검증 실패와 무관하게 상세 캐시에 남긴다', async () => {
    const updated = { ...issue, descriptionMarkdown: '## 새 설명', version: 2 };
    vi.mocked(issuesControllerUpdate).mockResolvedValueOnce(updated);
    vi.spyOn(queryClient, 'invalidateQueries').mockRejectedValueOnce(new Error('refetch failed'));
    const { result } = renderHook(() => useIssueInlineMutation(), { wrapper: QueryWrapper });

    act(() => {
      result.current.mutate({
        change: { kind: 'description', value: '## 새 설명' },
        issue,
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(issuesControllerUpdate).toHaveBeenCalledWith(issue.id, {
      descriptionMarkdown: '## 새 설명',
      version: 1,
    });
    expect(
      queryClient.getQueryData<IssueDetailResponseDto>(
        getIssuesControllerGetQueryKey(issue.identifier),
      ),
    ).toMatchObject({ descriptionMarkdown: '## 새 설명', version: 2 });
  });

  it('상세 전용 전달과 작업 순서는 인라인 수정 응답에서 생략돼도 캐시에 유지한다', async () => {
    const handoffFlows: NonNullable<IssueDetailResponseDto['handoffFlows']> = [
      {
        downstreamIssues: [
          {
            category: 'UNSTARTED',
            featureStatus: null,
            id: issue.id,
            identifier: issue.identifier,
            projectRole: 'WEB_FRONTEND',
            title: issue.title,
          },
        ],
        handoffs: [
          {
            author: issue.createdBy,
            bodyMarkdown: '이메일 API를 전달합니다.',
            changeSummary: '이메일 API 추가',
            createdAt: '2026-07-02T00:00:00.000Z',
            id: 'handoff-id',
            kind: 'INITIAL',
            sequenceNumber: 1,
          },
        ],
        sourceIssue: {
          category: 'COMPLETED',
          featureStatus: null,
          id: 'backend-task-id',
          identifier: 'API-0',
          projectRole: 'BACKEND',
          title: '이메일 API 구현',
        },
      },
    ];
    const workflowRelations: NonNullable<IssueDetailResponseDto['workflowRelations']> = [
      {
        blockedIssueId: issue.id,
        blockingIssueId: 'backend-task-id',
        createdAt: '2026-07-02T00:00:00.000Z',
        id: 'relation-id',
        resolved: true,
      },
    ];
    const detail = { ...issue, handoffFlows, workflowRelations };
    queryClient.setQueryData(getIssuesControllerGetQueryKey(issue.identifier), detail);
    queryClient.setQueryData(getIssuesControllerGetQueryKey(issue.id), detail);
    vi.mocked(issuesControllerUpdate).mockResolvedValueOnce({
      ...issue,
      priority: 'HIGH',
      version: 2,
    });
    const { result } = renderHook(() => useIssueInlineMutation(), { wrapper: QueryWrapper });

    act(() => {
      result.current.mutate({
        change: { kind: 'priority', value: 'HIGH' },
        issue: detail,
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    for (const issueRef of [issue.id, issue.identifier]) {
      expect(
        queryClient.getQueryData<IssueDetailResponseDto>(getIssuesControllerGetQueryKey(issueRef)),
      ).toMatchObject({ handoffFlows, priority: 'HIGH', workflowRelations });
    }
  });

  it('실패하면 모든 목록과 상세 캐시를 스냅샷으로 되돌린다', async () => {
    vi.mocked(issuesControllerUpdate).mockRejectedValueOnce(
      new ApiError(
        500,
        {
          code: 'INTERNAL_ERROR',
          fieldErrors: {},
          message: '실패',
          requestId: 'request-id',
        },
        'request-id',
      ),
    );
    const { result } = renderHook(() => useIssueInlineMutation(), { wrapper: QueryWrapper });

    act(() => {
      result.current.mutate({
        change: { kind: 'priority', value: 'URGENT' },
        issue,
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(listedIssue()).toMatchObject({ priority: 'NONE', version: 1 });
    expect(
      queryClient.getQueryData<IssueDetailResponseDto>(
        getIssuesControllerGetQueryKey(issue.identifier),
      ),
    ).toMatchObject({ priority: 'NONE', version: 1 });
  });

  it('프로젝트 불변 충돌이면 재적용 상태를 만들지 않고 최신 서버값으로 캐시를 복구한다', async () => {
    const latest = {
      ...issue,
      project: {
        archived: false,
        id: 'project-id',
        name: '서버 프로젝트',
        status: 'IN_PROGRESS' as const,
      },
      title: '서버 최신 제목',
      version: 4,
    };
    vi.mocked(issuesControllerUpdate).mockRejectedValueOnce(
      new ApiError(
        409,
        {
          code: 'ISSUE_PROJECT_IMMUTABLE',
          fieldErrors: {},
          message: '프로젝트를 변경할 수 없습니다.',
          requestId: 'request-id',
        },
        'request-id',
      ),
    );
    vi.mocked(issuesControllerGet).mockResolvedValueOnce(latest);
    const { result } = renderHook(() => useIssueInlineMutation(), { wrapper: QueryWrapper });

    act(() => {
      result.current.mutate({
        change: { kind: 'priority', value: 'HIGH' },
        issue,
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    await waitFor(() => expect(listedIssue()?.version).toBe(4));
    expect(issuesControllerGet).toHaveBeenCalledWith(issue.identifier);
    expect(result.current.conflict).toBeNull();
    expect(result.current.latestRecoveryFailed).toBe(false);
    expect(listedIssue()).toMatchObject({
      project: { id: 'project-id', name: '서버 프로젝트' },
      title: '서버 최신 제목',
      version: 4,
    });
    expect(regularlyListedIssue()).toMatchObject({ title: '서버 최신 제목', version: 4 });
    expect(
      queryClient.getQueryData<IssueDetailResponseDto>(getIssuesControllerGetQueryKey(issue.id)),
    ).toMatchObject({ title: '서버 최신 제목', version: 4 });
    expect(
      queryClient.getQueryData<IssueDetailResponseDto>(
        getIssuesControllerGetQueryKey(issue.identifier),
      ),
    ).toMatchObject({ title: '서버 최신 제목', version: 4 });
  });

  it('프로젝트 불변 충돌의 최신 조회가 실패하면 같은 변경 대신 최신값 조회만 다시 시도한다', async () => {
    const latest = { ...issue, title: '재조회한 최신 제목', version: 5 };
    vi.mocked(issuesControllerUpdate).mockRejectedValueOnce(
      new ApiError(
        409,
        {
          code: 'ISSUE_PROJECT_IMMUTABLE',
          fieldErrors: {},
          message: '프로젝트를 변경할 수 없습니다.',
          requestId: 'request-id',
        },
        'request-id',
      ),
    );
    vi.mocked(issuesControllerGet)
      .mockRejectedValueOnce(new Error('latest read failed'))
      .mockResolvedValueOnce(latest);
    const { result } = renderHook(() => useIssueInlineMutation(), { wrapper: QueryWrapper });

    act(() => {
      result.current.mutate({
        change: { kind: 'priority', value: 'HIGH' },
        issue,
      });
    });

    await waitFor(() => expect(result.current.latestRecoveryFailed).toBe(true));
    expect(result.current.conflict).toBeNull();
    expect(listedIssue()).toMatchObject({ priority: 'NONE', version: 1 });

    await act(async () => {
      await result.current.refreshLatest();
    });

    expect(issuesControllerUpdate).toHaveBeenCalledOnce();
    expect(issuesControllerGet).toHaveBeenCalledTimes(2);
    expect(result.current.latestRecoveryFailed).toBe(false);
    expect(listedIssue()).toMatchObject({ title: '재조회한 최신 제목', version: 5 });
  });

  it('버전 충돌이면 최신 상세를 반영하고 같은 변경을 최신 버전에 다시 적용한다', async () => {
    const latest = { ...issue, title: '다른 사람이 바꾼 제목', version: 4 };
    const reapplied = { ...latest, priority: 'URGENT' as const, version: 5 };
    vi.mocked(issuesControllerUpdate)
      .mockRejectedValueOnce(
        new ApiError(
          409,
          {
            code: 'VERSION_CONFLICT',
            currentVersion: 4,
            fieldErrors: {},
            message: '충돌',
            requestId: 'request-id',
          },
          'request-id',
        ),
      )
      .mockResolvedValueOnce(reapplied);
    vi.mocked(issuesControllerGet).mockResolvedValueOnce(latest);
    const { result } = renderHook(() => useIssueInlineMutation(), { wrapper: QueryWrapper });

    act(() => {
      result.current.mutate({
        change: { kind: 'priority', value: 'URGENT' },
        issue,
      });
    });

    await waitFor(() => expect(result.current.conflict?.latest?.version).toBe(4));
    expect(listedIssue()).toMatchObject({ title: '다른 사람이 바꾼 제목', version: 4 });

    await act(async () => {
      await result.current.reapplyConflict();
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(issuesControllerUpdate).toHaveBeenNthCalledWith(2, issue.id, {
      priority: 'URGENT',
      version: 4,
    });
    expect(listedIssue()).toMatchObject({ priority: 'URGENT', version: 5 });
  });

  it('성공 응답이 현재 내 이슈 조건을 벗어나면 성공 뒤에만 행을 제거한다', async () => {
    vi.mocked(issuesControllerUpdate).mockResolvedValueOnce({
      ...issue,
      assignee: {
        id: 'someone-else',
        role: 'MEMBER',
        status: 'ACTIVE',
        user: { avatarFileId: null, displayName: '다른 담당자', id: 'user-other' },
      },
      version: 2,
    });
    const { result } = renderHook(
      () =>
        useIssueInlineMutation({
          currentQueryKey: listQueryKey,
          removeAfterSuccess: (updated) => updated.assignee?.id !== 'membership-me',
        }),
      { wrapper: QueryWrapper },
    );

    act(() => {
      result.current.mutate({
        change: {
          kind: 'assignee',
          value: {
            id: 'someone-else',
            role: 'MEMBER',
            status: 'ACTIVE',
            user: { avatarFileId: null, displayName: '다른 담당자', id: 'user-other' },
          },
        },
        issue,
      });
    });

    expect(listedIssue()).toBeDefined();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listedIssue()).toBeUndefined();
  });
});
