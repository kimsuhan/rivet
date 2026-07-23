import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IssueListDisplayControls } from './issue-list-display-controls';

const sortOptions = [
  { label: '최근 수정일', value: 'updatedAt' },
  { label: '생성일', value: 'createdAt' },
];

describe('IssueListDisplayControls', () => {
  afterEach(cleanup);

  it('팝오버에서 정렬 방향과 표시 밀도를 변경한다', async () => {
    const user = userEvent.setup();
    const onSortDirectionChange = vi.fn();
    const onDensityChange = vi.fn();

    render(
      <IssueListDisplayControls
        density="comfortable"
        sort="updatedAt"
        sortDirection="desc"
        sortLabel="이슈 정렬 기준"
        sortOptions={sortOptions}
        onSortChange={vi.fn()}
        onSortDirectionChange={onSortDirectionChange}
        onDensityChange={onDensityChange}
      />,
    );

    const sortTrigger = screen.getByRole('button', {
      name: '이슈 정렬 기준: 최근 수정일, 내림차순',
    });
    await user.click(sortTrigger);
    await waitFor(() => expect(sortTrigger).toHaveAttribute('data-popup-open'));
    await user.click(screen.getByRole('button', { name: '오름차순' }));
    await user.click(sortTrigger);

    const viewTrigger = screen.getByRole('button', { name: '보기 설정: 여유 보기' });
    await user.click(viewTrigger);
    await waitFor(() => expect(viewTrigger).toHaveAttribute('data-popup-open'));
    await user.click(screen.getByRole('button', { name: '촘촘히 보기' }));

    expect(onSortDirectionChange).toHaveBeenCalledWith('asc');
    expect(onDensityChange).toHaveBeenCalledWith('compact');
  });

  it('정렬 메뉴에는 기준만 한 번씩 노출한다', async () => {
    const user = userEvent.setup();
    render(
      <IssueListDisplayControls
        density="compact"
        sort="updatedAt"
        sortDirection="asc"
        sortLabel="이슈 정렬 기준"
        sortOptions={sortOptions}
        onSortChange={vi.fn()}
        onSortDirectionChange={vi.fn()}
        onDensityChange={vi.fn()}
      />,
    );

    const popoverTrigger = screen.getByRole('button', {
      name: '이슈 정렬 기준: 최근 수정일, 오름차순',
    });
    await user.click(popoverTrigger);
    const selectTrigger = screen.getByRole('combobox', { name: '이슈 정렬 기준' });
    await user.click(selectTrigger);
    await waitFor(() => expect(selectTrigger).toHaveAttribute('data-popup-open'));

    expect(screen.getAllByRole('option', { name: '최근 수정일' })).toHaveLength(1);
    expect(screen.getAllByRole('option', { name: '생성일' })).toHaveLength(1);
  });
});
