import { cleanup, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useProjectsControllerList,
  useTeamsControllerList,
  useTeamWorksControllerList,
} from '@rivet/api-client';

import { GroupedMyWorkList } from './grouped-issue-lists';
import { useTeamWorkPages } from './issue-list-queries';
import { IssueListScreen } from './issue-list-screen';

const mocks = vi.hoisted(() => ({
  configuration: {} as Record<string, unknown>,
  search: '',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mocks.search),
}));

vi.mock('@rivet/api-client', () => ({
  useProjectsControllerList: vi.fn(),
  useTeamsControllerList: vi.fn(),
  useTeamWorksControllerList: vi.fn(),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
  usePathname: () => '/my-issues',
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('./grouped-issue-lists', () => ({
  GroupedMyWorkList: vi.fn(() => <div>그룹 목록</div>),
}));
vi.mock('./issue-filter-menu', () => ({ IssueFilterMenu: () => null }));
vi.mock('./issue-list-display-controls', () => ({ IssueListDisplayControls: () => null }));
vi.mock('./issue-list-queries', () => ({ useTeamWorkPages: vi.fn() }));
vi.mock('./issue-list-toolbar', () => ({ IssueListToolbar: () => null }));
vi.mock('./my-work-list-row', () => ({ MyWorkListRow: () => null }));
vi.mock('./team-work-list-row', () => ({ TeamWorkListRow: () => null }));
vi.mock('./saved-view-controls', () => ({
  SavedViewControls: ({
    activeFilters,
    children,
    configuration,
  }: {
    activeFilters?: ReactNode;
    children?: ReactNode;
    configuration: Record<string, unknown>;
  }) => {
    mocks.configuration = configuration;
    return (
      <div>
        {activeFilters}
        {children}
      </div>
    );
  },
}));

describe('IssueListScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configuration = {};
    mocks.search =
      'view=view-1&priority=HIGH%2CURGENT&teamId=team-1%2Cteam-2&workflowStateId=state-1%2Cstate-2&groupBy=priority';
    vi.mocked(useTeamsControllerList).mockReturnValue({
      data: { items: [], nextCursor: null },
      isError: false,
      isPending: false,
      refetch: vi.fn(),
    } as never);
    vi.mocked(useProjectsControllerList).mockReturnValue({
      data: { items: [], nextCursor: null },
      isError: false,
      isPending: false,
    } as never);
    vi.mocked(useTeamWorkPages).mockReturnValue({
      data: undefined,
      hasNextPage: false,
      isError: false,
      isPending: false,
    } as never);
    vi.mocked(useTeamWorksControllerList).mockReturnValue({
      data: undefined,
      isError: false,
      isPending: false,
      refetch: vi.fn(),
    } as never);
  });

  afterEach(cleanup);

  it('내 작업 저장 보기의 모든 전용 필터를 목록과 그룹 요청에 적용한다', () => {
    render(<IssueListScreen mode="my" />);

    const expectedParams = {
      assigneeMembershipId: 'me',
      limit: 50,
      priority: 'HIGH,URGENT',
      sort: 'executionOrder',
      sortDirection: 'desc',
      stateCategory: 'BACKLOG,UNSTARTED,STARTED',
      teamId: 'team-1,team-2',
      workflowStateId: 'state-1,state-2',
    };
    expect(useTeamWorkPages).toHaveBeenCalledWith(expectedParams, false);
    expect(GroupedMyWorkList).toHaveBeenCalledWith(
      expect.objectContaining({ baseParams: expectedParams, groupBy: 'priority' }),
      undefined,
    );
    expect(mocks.configuration).toEqual(
      expect.objectContaining({
        priority: 'HIGH,URGENT',
        teamId: 'team-1,team-2',
        workflowStateId: 'state-1,state-2',
      }),
    );
    expect(screen.getByText('우선순위: 2개 조건')).toBeVisible();
    expect(screen.getByText('팀: 2개 조건')).toBeVisible();
    expect(screen.getByText('워크플로 상태: 2개 조건')).toBeVisible();
  });
});
