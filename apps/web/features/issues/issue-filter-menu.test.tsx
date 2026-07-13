import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IssueFilterMenu } from './issue-filter-menu';

const options = [
  { id: 'label-1', label: '결제', swatch: '#6B7280' },
  { id: 'label-2', label: '고객 요청', swatch: '#8B5CF6' },
];

describe('IssueFilterMenu', () => {
  afterEach(cleanup);

  it('목록 필터도 불투명한 Portal 레이어를 사용한다', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <IssueFilterMenu
        emptyLabel="선택할 항목이 없습니다."
        label="라벨"
        onChange={vi.fn()}
        options={options}
        selected={[]}
      />,
    );

    const trigger = screen.getByRole('button', { name: '라벨' });
    expect(screen.queryByText('결제')).toBeNull();
    await user.click(trigger);
    const popup = screen.getByTestId('issue-filter-menu-popup');
    expect(popup).toHaveClass('bg-popover', 'ring-1', 'shadow-md');
    expect(container).not.toContainElement(popup);
    expect(screen.getByText('결제').closest('label')).toHaveClass('min-h-11', 'lg:min-h-9');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('issue-filter-menu-popup')).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it('행 라벨 메뉴는 불투명한 Portal 레이어에 렌더링하고 선택 기능을 유지한다', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(
      <div data-testid="row">
        <IssueFilterMenu
          ariaLabel="ISSUE-12 라벨"
          emptyLabel="선택할 항목이 없습니다."
          label="라벨"
          onChange={onChange}
          options={options}
          presentation="popover"
          selected={[]}
        />
      </div>,
    );

    const trigger = screen.getByRole('button', { name: 'ISSUE-12 라벨' });
    expect(trigger).toHaveAttribute('title', 'ISSUE-12 라벨');
    await user.click(trigger);
    const popup = screen.getByTestId('issue-filter-menu-popup');
    expect(trigger).toHaveAttribute('data-popup-open');
    expect(popup).toHaveClass('bg-popover', 'ring-1', 'shadow-md');
    expect(screen.getByText('결제').closest('label')).toHaveClass('min-h-11', 'lg:min-h-9');
    expect(container).not.toContainElement(popup);
    expect(popup.closest('[data-testid="row"]')).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: '결제' }));
    expect(onChange).toHaveBeenCalledWith(['label-1']);
  });

  it('Escape로 닫으면 Portal을 제거하고 라벨 트리거로 포커스를 복귀한다', async () => {
    const user = userEvent.setup();
    render(
      <IssueFilterMenu
        ariaLabel="ISSUE-12 라벨"
        emptyLabel="선택할 항목이 없습니다."
        label="라벨"
        onChange={vi.fn()}
        options={options}
        presentation="popover"
        selected={['label-1']}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'ISSUE-12 라벨' });
    await user.click(trigger);
    expect(screen.getByTestId('issue-filter-menu-popup')).toBeVisible();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('issue-filter-menu-popup')).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it('방향키로 옵션을 순환하고 Enter와 Space로 현재 옵션을 선택한다', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <IssueFilterMenu
        emptyLabel="선택할 항목이 없습니다."
        label="라벨"
        onChange={onChange}
        options={options}
        selected={[]}
      />,
    );

    await user.click(screen.getByRole('button', { name: '라벨' }));
    const [first, second] = screen.getAllByRole('checkbox');
    first?.focus();

    await user.keyboard('{ArrowDown}');
    expect(second).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(['label-2']);

    await user.keyboard('{ArrowDown}');
    expect(first).toHaveFocus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenLastCalledWith(['label-1']);

    await user.keyboard('{ArrowUp}');
    expect(second).toHaveFocus();
  });

  it('목록 필터는 32px 시각 표면과 40~44px 조작 영역을 분리한다', () => {
    render(
      <IssueFilterMenu
        emptyLabel="선택할 항목이 없습니다."
        label="상태"
        onChange={vi.fn()}
        options={options}
        selected={['label-1']}
        variant="compact"
      />,
    );

    const trigger = screen.getByRole('button', { name: '상태' });
    expect(trigger).toHaveClass(
      'min-h-11',
      'lg:min-h-10',
      'before:h-8',
      'border-transparent',
      'focus-visible:ring-ring',
      'focus-visible:ring-offset-2',
    );
  });

  it('라벨 저장 중에는 현재 트리거와 포커스를 유지하면서 다시 열기만 막는다', async () => {
    const user = userEvent.setup();
    render(
      <IssueFilterMenu
        ariaLabel="ISSUE-12 라벨: 결제"
        busy
        disabled
        emptyLabel="선택할 항목이 없습니다."
        label="라벨"
        onChange={vi.fn()}
        options={options}
        presentation="popover"
        selected={['label-1']}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'ISSUE-12 라벨: 결제' });
    trigger.focus();
    expect(trigger).toHaveFocus();
    expect(trigger).not.toBeDisabled();
    expect(trigger).toHaveAttribute('aria-busy', 'true');
    expect(trigger).toHaveAttribute('aria-disabled', 'true');
    await user.keyboard('{Enter}');
    expect(screen.queryByTestId('issue-filter-menu-popup')).toBeNull();
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    expect(screen.queryByTestId('issue-filter-menu-popup')).toBeNull();
  });
});
