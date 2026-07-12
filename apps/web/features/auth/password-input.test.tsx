import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { PasswordInput } from './password-input';

afterEach(cleanup);

describe('PasswordInput', () => {
  it('비밀번호 표시 상태와 접근 가능한 이름을 함께 전환한다', async () => {
    const user = userEvent.setup();
    render(
      <PasswordInput
        aria-label="비밀번호"
        labels={{ show: '비밀번호 표시', hide: '비밀번호 숨기기' }}
      />,
    );

    const input = screen.getByLabelText('비밀번호');
    const group = input.closest('[data-slot="input-group"]');
    const toggle = screen.getByRole('button', { name: '비밀번호 표시' });
    expect(input).toHaveAttribute('type', 'password');
    expect(group).toHaveClass('h-11', 'lg:h-9');
    expect(toggle).toHaveClass('size-11', 'lg:size-8');

    await user.click(toggle);
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: '비밀번호 숨기기' })).toBeVisible();
  });
});
