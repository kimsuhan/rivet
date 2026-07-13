import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Circle, CircleDashed } from 'lucide-react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IssueInlineSelect } from './issue-inline-select';

const options = [
  {
    icon: CircleDashed,
    iconClassName: 'text-muted-foreground',
    label: '미분류',
    value: 'UNSORTED',
  },
  { icon: Circle, iconClassName: 'text-foreground', label: '할 일', value: 'TODO' },
];

function PendingSelect() {
  const [busy, setBusy] = useState(false);
  return (
    <IssueInlineSelect
      appearance="compact"
      ariaLabel="ISSUE-12 상태: 미분류"
      busy={busy}
      disabled={busy}
      onValueChange={() => setBusy(true)}
      options={options}
      value="UNSORTED"
    />
  );
}

describe('IssueInlineSelect', () => {
  afterEach(cleanup);

  it('compact 읽기 상태에서 아이콘과 이름을 표시하고 폼 Select 표면을 제거한다', () => {
    render(
      <IssueInlineSelect
        appearance="compact"
        ariaLabel="ISSUE-12 상태: 미분류"
        disabled={false}
        onValueChange={vi.fn()}
        options={options}
        triggerClassName="w-[6.75rem]"
        value="UNSORTED"
      />,
    );

    const trigger = screen.getByRole('combobox', { name: 'ISSUE-12 상태: 미분류' });
    expect(trigger).toHaveAttribute('title', '미분류');
    expect(trigger).toHaveClass(
      'min-h-11',
      'lg:min-h-10',
      'border-transparent',
      'bg-transparent',
      'dark:bg-transparent',
      'before:h-8',
      'focus-visible:ring-2',
      'focus-visible:ring-ring',
      'focus-visible:ring-offset-2',
      'data-popup-open:before:bg-muted',
    );
    expect(trigger.querySelector('[data-slot="inline-select-icon"]')).toHaveClass(
      'lucide-circle-dashed',
      'size-4',
    );
    expect(trigger.querySelector('[data-slot="inline-select-label"]')).toHaveClass(
      'text-secondary-foreground',
    );
    expect(trigger.querySelector('[data-slot="inline-select-label"]')).toHaveTextContent('미분류');
  });

  it('comfortable 속성 트리거는 36px 시각 표면과 44px 조작 영역을 구분한다', () => {
    render(
      <IssueInlineSelect
        appearance="comfortable"
        ariaLabel="상태: 미분류"
        busy
        disabled
        onValueChange={vi.fn()}
        options={options}
        value="UNSORTED"
      />,
    );

    const trigger = screen.getByRole('combobox', { name: '상태: 미분류' });
    expect(trigger).toHaveAttribute('data-variant', 'property');
    expect(trigger).toHaveAttribute('aria-busy', 'true');
    expect(trigger).toHaveClass(
      'min-h-11',
      'before:h-9',
      'focus-visible:ring-2',
      'focus-visible:ring-ring',
      'focus-visible:ring-offset-2',
    );
    expect(trigger.querySelector('[data-slot="inline-select-spinner"]')).toBeInTheDocument();
  });

  it('트리거와 메뉴에서 같은 아이콘·이름을 쓰고 선택 기능을 유지한다', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <IssueInlineSelect
        appearance="compact"
        ariaLabel="ISSUE-12 상태: 미분류"
        disabled={false}
        onValueChange={onValueChange}
        options={options}
        value="UNSORTED"
      />,
    );

    const trigger = screen.getByRole('combobox', { name: 'ISSUE-12 상태: 미분류' });
    await user.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute('data-popup-open'));
    const todo = screen.getByRole('option', { name: '할 일' });
    expect(todo).toHaveClass('data-selected:bg-accent/60', 'min-h-11', 'lg:min-h-9');
    expect(todo.closest('[data-slot="select-content"]')).toHaveClass('min-w-60', 'max-w-90');
    expect(todo.querySelector('[data-slot="inline-select-item-icon"]')).toHaveClass(
      'lucide-circle',
    );
    await user.click(todo);
    expect(onValueChange).toHaveBeenCalledWith('TODO');
  });

  it('Space·방향키·Enter로 선택하고 Escape로 닫으면 트리거에 포커스를 돌려준다', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <IssueInlineSelect
        appearance="compact"
        ariaLabel="ISSUE-12 상태: 미분류"
        disabled={false}
        onValueChange={onValueChange}
        options={options}
        value="UNSORTED"
      />,
    );

    const trigger = screen.getByRole('combobox', { name: 'ISSUE-12 상태: 미분류' });
    trigger.focus();
    await user.keyboard(' ');
    expect(screen.getByRole('option', { name: '할 일' })).toBeVisible();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onValueChange).toHaveBeenCalledWith('TODO');
    expect(trigger).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(screen.getByRole('option', { name: '할 일' })).toBeVisible();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('option', { name: '할 일' })).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it('저장 전환 중에는 값과 포커스를 유지하면서 다시 열기만 막는다', async () => {
    const user = userEvent.setup();
    render(<PendingSelect />);

    const trigger = screen.getByRole('combobox', { name: 'ISSUE-12 상태: 미분류' });
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: '할 일' }));

    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toHaveTextContent('미분류');
    expect(trigger).toHaveAttribute('aria-busy', 'true');
    expect(trigger).toHaveAttribute('aria-disabled', 'true');
    expect(trigger).not.toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByRole('option', { name: '할 일' })).toBeNull();
  });
});
