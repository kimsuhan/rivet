import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ForgotPasswordScreen } from './forgot-password-screen';

const auth = vi.hoisted(() => ({
  mutate: vi.fn(),
  state: {
    error: null as { body: { code: string } } | null,
    isPending: false,
    isSuccess: false,
  },
}));

vi.mock('@rivet/api-client', () => ({
  useAuthControllerRequestPasswordReset: () => ({ ...auth.state, mutate: auth.mutate }),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const labels = {
  productName: 'Rivet',
  title: '비밀번호 찾기',
  description: '재설정 링크를 요청하세요.',
  email: '이메일',
  submit: '재설정 메일 받기',
  submitting: '요청 중',
  loginLink: '로그인으로 돌아가기',
  completeTitle: '메일을 확인하세요',
  completeDescription: '계정이 있다면 재설정 링크를 보냈습니다.',
  emailInvalid: '올바른 이메일을 입력하세요.',
  rateLimited: '잠시 후 다시 시도하세요.',
  unexpectedError: '메일을 요청하지 못했습니다.',
};

afterEach(cleanup);

describe('ForgotPasswordScreen', () => {
  beforeEach(() => {
    auth.mutate.mockReset();
    auth.state.error = null;
    auth.state.isPending = false;
    auth.state.isSuccess = false;
  });

  it('이메일을 생성된 재설정 요청 mutation에 전달한다', async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordScreen labels={labels} loginHref="/login" />);

    await user.type(screen.getByLabelText('이메일'), ' user@example.com ');
    await user.click(screen.getByRole('button', { name: '재설정 메일 받기' }));

    expect(auth.mutate).toHaveBeenCalledWith({ data: { email: 'user@example.com' } });
  });

  it('완료 시 계정 존재 여부를 드러내지 않는 공통 안내를 표시한다', () => {
    auth.state.isSuccess = true;
    render(<ForgotPasswordScreen labels={labels} loginHref="/login" />);

    expect(screen.getByRole('heading', { name: '메일을 확인하세요' })).toBeVisible();
    expect(screen.getByText('계정이 있다면 재설정 링크를 보냈습니다.')).toBeVisible();
  });

  it('이메일 오류를 입력과 연결한다', async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordScreen labels={labels} loginHref="/login" />);

    await user.click(screen.getByRole('button', { name: labels.submit }));

    expect(await screen.findByText(labels.emailInvalid)).toHaveAttribute(
      'id',
      'forgot-password-email-error',
    );
    expect(screen.getByLabelText(labels.email)).toHaveAttribute(
      'aria-errormessage',
      'forgot-password-email-error',
    );
  });
});
