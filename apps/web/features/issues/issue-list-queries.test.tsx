import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  issuesControllerList,
  type IssuesControllerListParams,
  type IssueSummaryResponseDto,
} from '@rivet/api-client';

import { useIssuePages } from './issue-list-queries';

vi.mock('@rivet/api-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  issuesControllerList: vi.fn(),
}));

const issue = {
  assignee: null,
  blocked: false,
  createdAt: '2026-07-01T00:00:00.000Z',
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
} satisfies IssueSummaryResponseDto;

let queryClient: QueryClient;

function QueryWrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('issue infinite query', () => {
  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.clearAllMocks();
  });

  it('다음 커서를 같은 필터와 함께 전달하고 페이지를 누적한다', async () => {
    vi.mocked(issuesControllerList)
      .mockResolvedValueOnce({ items: [issue], nextCursor: 'next-issue' })
      .mockResolvedValueOnce({ items: [{ ...issue, id: 'issue-2' }], nextCursor: null });
    const params = {
      assigneeMembershipId: 'me',
      limit: 50,
      sort: 'updatedAt',
      sortDirection: 'desc',
      stateCategory: 'BACKLOG,UNSTARTED,STARTED',
      type: 'TEAM_TASK',
    } satisfies IssuesControllerListParams;

    const { result } = renderHook(() => useIssuePages(params), { wrapper: QueryWrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    expect(issuesControllerList).toHaveBeenNthCalledWith(
      1,
      params,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));

    expect(issuesControllerList).toHaveBeenNthCalledWith(
      2,
      { ...params, cursor: 'next-issue' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.current.data?.pages.flatMap((page) => page.items)).toHaveLength(2);
    expect(result.current.hasNextPage).toBe(false);
  });
});
