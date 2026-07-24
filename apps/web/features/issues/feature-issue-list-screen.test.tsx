import { cleanup, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useProjectsControllerList } from '@rivet/api-client';

import { FeatureIssueListScreen } from './feature-issue-list-screen';
import { GroupedIssueList } from './grouped-issue-lists';
import { getIssuePagesQueryKey, useIssuePages } from './issue-list-queries';

const mocks = vi.hoisted(() => ({
  configuration: {} as Record<string, unknown>,
  search: '',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mocks.search),
}));

vi.mock('@rivet/api-client', () => ({
  useProjectsControllerList: vi.fn(),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
  usePathname: () => '/issues',
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('./grouped-issue-lists', () => ({
  GroupedIssueList: vi.fn(() => <div>그룹 목록</div>),
}));

vi.mock('./issue-assignee-filter', () => ({ IssueAssigneeFilter: () => null }));
vi.mock('./issue-filter-menu', () => ({ IssueFilterMenu: () => null }));
vi.mock('./issue-list-queries', () => ({
  getIssuePagesQueryKey: vi.fn(() => ['issues']),
  useIssuePages: vi.fn(),
}));
vi.mock('./issue-list-row', () => ({ IssueListRow: () => null }));
vi.mock('./issue-list-toolbar', () => ({ IssueListToolbar: () => null }));
vi.mock('./issue-multi-sort-controls', () => ({ IssueMultiSortControls: () => null }));
vi.mock('./issue-work-routing', () => ({ issueWorkHref: () => '/issues/RIV-1' }));
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

describe('FeatureIssueListScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configuration = {};
    mocks.search =
      'view=view-1&priority=HIGH%2CURGENT&labelId=label-1%2Clabel-2&createdByMembershipId=member-1%2Cmember-2&groupBy=priority';
    vi.mocked(useProjectsControllerList).mockReturnValue({
      data: { items: [], nextCursor: null },
      isError: false,
      isPending: false,
    } as never);
    vi.mocked(useIssuePages).mockReturnValue({
      data: undefined,
      hasNextPage: false,
      isError: false,
      isPending: false,
    } as never);
  });

  afterEach(cleanup);

  it('저장 보기의 우선순위·라벨·생성자 필터를 목록과 그룹 요청에 적용한다', () => {
    render(<FeatureIssueListScreen />);

    const expectedParams = {
      createdByMembershipId: 'member-1,member-2',
      labelId: 'label-1,label-2',
      priority: 'HIGH,URGENT',
      sorts: 'updatedAt:desc',
    };
    expect(useIssuePages).toHaveBeenCalledWith(expectedParams, false);
    expect(getIssuePagesQueryKey).toHaveBeenCalledWith(expectedParams);
    expect(GroupedIssueList).toHaveBeenCalledWith(
      expect.objectContaining({ baseParams: expectedParams, groupBy: 'priority' }),
      undefined,
    );
    expect(mocks.configuration).toEqual(
      expect.objectContaining({
        createdByMembershipId: 'member-1,member-2',
        labelId: 'label-1,label-2',
        priority: 'HIGH,URGENT',
      }),
    );
    expect(screen.getByText('우선순위: 2개 조건')).toBeVisible();
    expect(screen.getByText('라벨: 2개 조건')).toBeVisible();
    expect(screen.getByText('생성자: 2개 조건')).toBeVisible();
  });
});
