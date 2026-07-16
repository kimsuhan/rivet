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

  it('정렬 방향과 표시 밀도를 각각 한 번에 전환한다', async () => {
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

    await user.click(screen.getByRole('button', { name: '내림차순 정렬. 오름차순으로 변경' }));
    await user.click(screen.getByRole('button', { name: '여유 보기. 촘촘히 보기로 변경' }));

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

    const trigger = screen.getByRole('combobox', { name: '이슈 정렬 기준' });
    await user.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute('data-popup-open'));

    expect(screen.getAllByRole('option', { name: '최근 수정일' })).toHaveLength(1);
    expect(screen.getAllByRole('option', { name: '생성일' })).toHaveLength(1);
  });
});
