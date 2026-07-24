import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IssueAssigneeFilter } from './issue-assignee-filter';
import { useIssueMemberPages } from './issue-list-queries';

vi.mock('./issue-list-queries', () => ({
  useIssueMemberPages: vi.fn(),
}));

const mockedUseIssueMemberPages = vi.mocked(useIssueMemberPages);

describe('IssueAssigneeFilter', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('활성·비활성 담당자와 담당자 없음을 함께 선택한다', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    mockedUseIssueMemberPages.mockReturnValue({
      data: {
        pageParams: [undefined],
        pages: [
          {
            items: [
              {
                id: 'member-1',
                status: 'ACTIVE',
                user: { displayName: '김리벳' },
              },
              {
                id: 'member-2',
                status: 'INACTIVE',
                user: { displayName: '전멤버' },
              },
            ],
            nextCursor: null,
          },
        ],
      },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isError: false,
      isFetchingNextPage: false,
      isPending: false,
    } as never);

    render(
      <IssueAssigneeFilter
        onChange={onChange}
        selected={{ membershipIds: ['member-1'], unassigned: false }}
      />,
    );

    await user.click(screen.getByRole('button', { name: '담당자 필터' }));
    expect(screen.getByRole('checkbox', { name: '김리벳' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '전멤버비활성' })).not.toBeChecked();

    await user.click(screen.getByRole('checkbox', { name: '담당자 없음' }));
    expect(onChange).toHaveBeenLastCalledWith({
      membershipIds: ['member-1'],
      unassigned: true,
    });

    await user.click(screen.getByRole('checkbox', { name: '전멤버비활성' }));
    expect(onChange).toHaveBeenLastCalledWith({
      membershipIds: ['member-1', 'member-2'],
      unassigned: false,
    });
  });

  it('검색어와 다음 페이지 요청을 담당자 조회에 연결한다', async () => {
    const user = userEvent.setup();
    const fetchNextPage = vi.fn();
    mockedUseIssueMemberPages.mockReturnValue({
      data: { pageParams: [undefined], pages: [{ items: [], nextCursor: 'next' }] },
      fetchNextPage,
      hasNextPage: true,
      isError: false,
      isFetchingNextPage: false,
      isPending: false,
    } as never);

    render(
      <IssueAssigneeFilter
        onChange={vi.fn()}
        selected={{ membershipIds: [], unassigned: false }}
      />,
    );

    await user.click(screen.getByRole('button', { name: '담당자 필터' }));
    await user.type(screen.getByRole('textbox', { name: '담당자 검색' }), '리벳');
    await user.click(screen.getByRole('button', { name: '더 보기' }));

    expect(mockedUseIssueMemberPages).toHaveBeenLastCalledWith({
      limit: 100,
      query: '리벳',
      status: 'ACTIVE,INACTIVE',
    });
    expect(fetchNextPage).toHaveBeenCalled();
  });
});
