import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IssueMultiSortControls } from './issue-multi-sort-controls';

describe('IssueMultiSortControls', () => {
  afterEach(cleanup);

  it('changes direction and adds the next unused condition', async () => {
    const user = userEvent.setup();
    const onSortsChange = vi.fn();
    render(
      <IssueMultiSortControls
        density="comfortable"
        sorts={[{ direction: 'desc', field: 'updatedAt' }]}
        onSortsChange={onSortsChange}
        onDensityChange={vi.fn()}
      />,
    );

    const trigger = screen.getByRole('button', { name: '이슈 다중 정렬 1개' });
    await user.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute('data-popup-open'));
    await user.click(
      screen.getByRole('button', { name: '1번째 정렬 내림차순. 오름차순으로 변경' }),
    );
    await user.click(screen.getByRole('button', { name: '정렬 추가' }));

    expect(onSortsChange).toHaveBeenNthCalledWith(1, [{ direction: 'asc', field: 'updatedAt' }]);
    expect(onSortsChange).toHaveBeenNthCalledWith(2, [
      { direction: 'desc', field: 'updatedAt' },
      { direction: 'desc', field: 'priority' },
    ]);
  });

  it('does not allow removing the final condition', async () => {
    const user = userEvent.setup();
    render(
      <IssueMultiSortControls
        density="comfortable"
        sorts={[{ direction: 'desc', field: 'updatedAt' }]}
        onSortsChange={vi.fn()}
        onDensityChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: '이슈 다중 정렬 1개' }));
    expect(screen.getByRole('button', { name: '1번째 정렬 제거' })).toBeDisabled();
  });

  it('opens view settings before changing the list density', async () => {
    const user = userEvent.setup();
    const onDensityChange = vi.fn();
    render(
      <IssueMultiSortControls
        density="comfortable"
        sorts={[{ direction: 'desc', field: 'updatedAt' }]}
        onSortsChange={vi.fn()}
        onDensityChange={onDensityChange}
      />,
    );

    const trigger = screen.getByRole('button', { name: '보기 설정: 여유 보기' });
    await user.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute('data-popup-open'));
    await user.click(screen.getByRole('button', { name: '촘촘히 보기' }));

    expect(onDensityChange).toHaveBeenCalledWith('compact');
  });
});
