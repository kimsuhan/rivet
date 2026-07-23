import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IssueListToolbar } from './issue-list-toolbar';

describe('IssueListToolbar', () => {
  afterEach(cleanup);

  it('검색 상태를 전환하고 화면별 컨트롤을 같은 순서로 배치한다', async () => {
    const user = userEvent.setup();
    const onSearchOpenChange = vi.fn();
    render(
      <IssueListToolbar
        activeFilterCount={0}
        filterContent={<div>필터 내용</div>}
        filterTitle="목록 필터"
        query=""
        searchOpen={false}
        sortAndViewControls={<button type="button">정렬과 보기</button>}
        onSearchOpenChange={onSearchOpenChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: '검색' }));

    expect(onSearchOpenChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole('button', { name: '필터' })).toBeVisible();
    expect(screen.getByRole('button', { name: '정렬과 보기' })).toBeVisible();
  });

  it('활성 필터 개수를 표시하고 전달받은 필터 내용을 연다', async () => {
    const user = userEvent.setup();
    render(
      <IssueListToolbar
        activeFilterCount={2}
        filterContent={<div>프로젝트와 상태</div>}
        filterTitle="내 작업 필터"
        query="긴급"
        searchOpen={false}
        sortAndViewControls={null}
        onSearchOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '검색: 긴급' })).toBeVisible();
    const filterTrigger = screen.getByRole('button', { name: '필터 2개' });
    await user.click(filterTrigger);
    await waitFor(() => expect(filterTrigger).toHaveAttribute('data-popup-open'));

    expect(screen.getByRole('dialog', { name: '내 작업 필터' })).toBeVisible();
    expect(screen.getByText('프로젝트와 상태')).toBeVisible();
  });
});
