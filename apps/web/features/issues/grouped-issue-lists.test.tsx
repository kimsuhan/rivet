import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as ApiClientModule from '@rivet/api-client';
import { useIssuesControllerGroups } from '@rivet/api-client';

import { GroupedIssueList } from './grouped-issue-lists';
import type * as IssueQueriesModule from './issue-list-queries';
import { useIssuePages } from './issue-list-queries';

vi.mock('@rivet/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return {
    ...actual,
    useIssuesControllerGroups: vi.fn(),
    useTeamWorksControllerGroups: vi.fn(),
  };
});

vi.mock('./issue-list-queries', async (importOriginal) => {
  const actual = await importOriginal<typeof IssueQueriesModule>();
  return {
    ...actual,
    useIssuePages: vi.fn(),
    useTeamWorkPages: vi.fn(),
  };
});

vi.mock('./issue-list-row', () => ({
  IssueListRow: () => <li>이슈 행</li>,
}));

vi.mock('./issue-work-routing', () => ({
  issueWorkHref: () => '/issues/RIV-1',
}));

vi.mock('./my-work-list-row', () => ({
  MyWorkListRow: () => <li>내 작업 행</li>,
}));

const mockedUseIssuesControllerGroups = vi.mocked(useIssuesControllerGroups);
const mockedUseIssuePages = vi.mocked(useIssuePages);

describe('GroupedIssueList', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('메인·서브 그룹의 정확한 개수를 표시하고 각각 접고 펼친다', async () => {
    const user = userEvent.setup();
    mockedUseIssuesControllerGroups.mockReturnValue({
      data: {
        groupBy: 'projectId',
        groups: [
          {
            count: 3,
            imageFileId: null,
            label: '리벳',
            subGroups: [
              { count: 1, imageFileId: null, label: 'DONE', value: 'DONE' },
              { count: 2, imageFileId: null, label: 'IN_PROGRESS', value: 'IN_PROGRESS' },
            ],
            value: 'project-1',
          },
        ],
        subGroupBy: 'status',
        totalCount: 3,
      },
      isError: false,
      isPending: false,
    } as never);
    mockedUseIssuePages.mockReturnValue({
      data: {
        pageParams: [undefined],
        pages: [{ items: [], nextCursor: null, totalCount: 0 }],
      },
      hasNextPage: false,
      isError: false,
      isPending: false,
    } as never);

    render(
      <GroupedIssueList
        baseParams={{ sorts: 'updatedAt:desc' }}
        density="comfortable"
        groupBy="projectId"
        savedViewId="view-1"
        subGroupBy="status"
        visibleFields={['createdAt']}
      />,
    );

    expect(mockedUseIssuesControllerGroups).toHaveBeenCalledWith({
      groupBy: 'projectId',
      subGroupBy: 'status',
    });
    const main = screen.getByRole('button', { name: /리벳\s*3/ });
    const inProgress = screen.getByRole('button', { name: /진행 중\s*2/ });
    const done = screen.getByRole('button', { name: /완료\s*1/ });
    expect(main).toHaveAttribute('aria-expanded', 'true');
    expect(main).toHaveAttribute('data-group-field', 'projectId');
    expect(main.querySelector('.lucide-folder-kanban')).toBeInTheDocument();
    expect(inProgress).toHaveAttribute('data-group-field', 'status');
    expect(inProgress.querySelector('.lucide-circle-dot-dashed')).toBeInTheDocument();
    expect(
      inProgress.compareDocumentPosition(done) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(mockedUseIssuePages).toHaveBeenCalledWith({
      projectId: 'project-1',
      sorts: 'updatedAt:desc',
      status: 'IN_PROGRESS',
    });

    await user.click(inProgress);
    expect(inProgress).toHaveAttribute('aria-expanded', 'false');
    await user.click(main);
    expect(main).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /완료\s*1/ })).not.toBeInTheDocument();
    await user.click(main);
    expect(screen.getByRole('button', { name: /완료\s*1/ })).toBeVisible();
  });

  it('그룹 결과가 비어 있으면 빈 상태를 표시한다', () => {
    mockedUseIssuesControllerGroups.mockReturnValue({
      data: {
        groupBy: 'status',
        groups: [],
        subGroupBy: null,
        totalCount: 0,
      },
      isError: false,
      isPending: false,
    } as never);

    render(
      <GroupedIssueList
        baseParams={{ sorts: 'updatedAt:desc' }}
        density="comfortable"
        groupBy="status"
        savedViewId={null}
        visibleFields={[]}
      />,
    );

    expect(screen.getByRole('heading', { name: '조건에 맞는 이슈가 없습니다' })).toBeVisible();
  });

  it('담당자 없음 그룹은 담당자 없음 필터로 목록을 조회한다', () => {
    mockedUseIssuesControllerGroups.mockReturnValue({
      data: {
        groupBy: 'assigneeMembershipId',
        groups: [
          {
            count: 2,
            imageFileId: null,
            label: '담당자 없음',
            subGroups: [],
            value: '__unassigned__',
          },
          {
            count: 1,
            imageFileId: '4c1bc360-5ce9-42dc-9497-3c26c2039f3a',
            label: '김민창',
            subGroups: [],
            value: 'member-1',
          },
        ],
        subGroupBy: null,
        totalCount: 2,
      },
      isError: false,
      isPending: false,
    } as never);
    mockedUseIssuePages.mockReturnValue({
      data: {
        pageParams: [undefined],
        pages: [{ items: [], nextCursor: null, totalCount: 0 }],
      },
      hasNextPage: false,
      isError: false,
      isPending: false,
    } as never);

    render(
      <GroupedIssueList
        baseParams={{
          assigneeMembershipId: 'member-1',
          sorts: 'updatedAt:desc',
          unassigned: 'true',
        }}
        density="comfortable"
        groupBy="assigneeMembershipId"
        savedViewId={null}
        visibleFields={[]}
      />,
    );

    expect(mockedUseIssuePages).toHaveBeenCalledWith({
      sorts: 'updatedAt:desc',
      unassigned: 'true',
    });
    expect(screen.getByRole('button', { name: /김민창\s*1/ })).toHaveAttribute(
      'data-group-image-file-id',
      '4c1bc360-5ce9-42dc-9497-3c26c2039f3a',
    );
  });
});
