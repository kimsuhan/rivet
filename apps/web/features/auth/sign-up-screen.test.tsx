import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SignUpScreen } from './sign-up-screen';

type SignUpOptions = {
  mutation?: {
    onError?: (error: { body: { fieldErrors: Record<string, string[]> } }) => void;
  };
};

const auth = vi.hoisted(() => ({
  mutate: vi.fn(),
  options: null as SignUpOptions | null,
  state: {
    data: null as { emailMasked: string } | null,
    error: null as { body: { code: string } } | null,
    isPending: false,
  },
}));

vi.mock('@rivet/api-client', () => ({
  useAuthControllerSignUp: (options: SignUpOptions) => {
    auth.options = options;
    return { ...auth.state, mutate: auth.mutate };
  },
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
  title: '계정 만들기',
  description: '이메일 인증이 필요합니다.',
  displayName: '표시 이름',
  email: '이메일',
  password: '비밀번호',
  confirmPassword: '비밀번호 확인',
  passwordHelp: '12자 이상 입력하세요.',
  showPassword: '비밀번호 표시',
  hidePassword: '비밀번호 숨기기',
  submit: '회원가입',
  submitting: '회원가입 중',
  loginPrompt: '이미 계정이 있나요?',
  loginLink: '로그인',
  passwordResetLink: '비밀번호 재설정',
  acceptedTitle: '메일을 확인하세요',
  acceptedDescription: '계정이 있으면 인증 메일을 보냈습니다.',
  acceptedEmailLabel: '요청한 이메일',
  displayNameRequired: '표시 이름을 입력하세요.',
  displayNameTooLong: '표시 이름이 너무 깁니다.',
  emailInvalid: '올바른 이메일을 입력하세요.',
  passwordTooShort: '비밀번호가 너무 짧습니다.',
  passwordTooLong: '비밀번호가 너무 깁니다.',
  passwordMismatch: '비밀번호가 일치하지 않습니다.',
  rateLimited: '잠시 후 다시 시도하세요.',
  unexpectedError: '가입 요청을 처리하지 못했습니다.',
};

afterEach(cleanup);

describe('SignUpScreen', () => {
  beforeEach(() => {
    auth.mutate.mockReset();
    auth.options = null;
    auth.state.data = null;
    auth.state.error = null;
    auth.state.isPending = false;
  });

  it('확인 비밀번호가 다르면 입력을 유지하고 요청하지 않는다', async () => {
    const user = userEvent.setup();
    render(
      <SignUpScreen labels={labels} loginHref="/login" forgotPasswordHref="/forgot-password" />,
    );

    await user.type(screen.getByLabelText('표시 이름'), '김리벳');
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    await user.type(
      screen.getByLabelText('비밀번호', { selector: '#sign-up-password' }),
      'correct-password',
    );
    await user.type(screen.getByLabelText('비밀번호 확인'), 'different-password');
    await user.click(screen.getByRole('button', { name: '회원가입' }));

    expect(await screen.findByText('비밀번호가 일치하지 않습니다.')).toBeVisible();
    expect(screen.getByLabelText('표시 이름')).toHaveValue('김리벳');
    expect(screen.getByLabelText('비밀번호 확인')).toHaveAttribute(
      'aria-errormessage',
      'sign-up-confirm-password-error',
    );
    expect(document.getElementById('sign-up-confirm-password-error')).toHaveTextContent(
      '비밀번호가 일치하지 않습니다.',
    );
    expect(auth.mutate).not.toHaveBeenCalled();
  });

  it('정규화한 폼 값을 생성된 mutation에 전달하고 서버 필드 오류를 연결한다', async () => {
    const user = userEvent.setup();
    render(
      <SignUpScreen labels={labels} loginHref="/login" forgotPasswordHref="/forgot-password" />,
    );

    await user.type(screen.getByLabelText('표시 이름'), '  김리벳  ');
    await user.type(screen.getByLabelText('이메일'), '  user@example.com  ');
    await user.type(
      screen.getByLabelText('비밀번호', { selector: '#sign-up-password' }),
      'correct-password',
    );
    await user.type(screen.getByLabelText('비밀번호 확인'), 'correct-password');
    await user.click(screen.getByRole('button', { name: '회원가입' }));

    expect(auth.mutate).toHaveBeenCalledWith({
      data: {
        displayName: '김리벳',
        email: 'user@example.com',
        password: 'correct-password',
      },
    });

    act(() => {
      auth.options?.mutation?.onError?.({
        body: { fieldErrors: { email: ['이 이메일은 사용할 수 없습니다.'] } },
      });
    });
    expect(await screen.findByText('이 이메일은 사용할 수 없습니다.')).toBeVisible();
    expect(screen.getByLabelText('이메일')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('이메일')).toHaveAttribute(
      'aria-errormessage',
      'sign-up-email-error',
    );
  });

  it('표시 이름과 비밀번호 길이를 Unicode code point로 검증한다', async () => {
    const user = userEvent.setup();
    const displayName = '😀'.repeat(26);
    const acceptedPassword = '😀'.repeat(65);
    render(
      <SignUpScreen labels={labels} loginHref="/login" forgotPasswordHref="/forgot-password" />,
    );

    await user.type(screen.getByLabelText('표시 이름'), displayName);
    await user.type(screen.getByLabelText('이메일'), 'user@example.com');
    const password = screen.getByLabelText('비밀번호', { selector: '#sign-up-password' });
    const confirmation = screen.getByLabelText('비밀번호 확인');
    await user.type(password, '😀'.repeat(6));
    await user.type(confirmation, '😀'.repeat(6));
    await user.click(screen.getByRole('button', { name: '회원가입' }));

    expect(await screen.findByText(labels.passwordTooShort)).toBeVisible();
    expect(password).toHaveAttribute('aria-errormessage', 'sign-up-password-error');
    expect(auth.mutate).not.toHaveBeenCalled();

    await user.clear(password);
    await user.clear(confirmation);
    await user.type(password, acceptedPassword);
    await user.type(confirmation, acceptedPassword);
    await user.click(screen.getByRole('button', { name: '회원가입' }));

    expect(auth.mutate).toHaveBeenCalledWith({
      data: { displayName, email: 'user@example.com', password: acceptedPassword },
    });
    expect(screen.getByLabelText('표시 이름')).toHaveClass('h-11', 'lg:h-9');
    expect(password).toHaveAttribute('aria-describedby', 'sign-up-password-description');
  });

  it('접수 결과에는 가린 이메일만 표시한다', () => {
    auth.state.data = { emailMasked: 'u***@example.com' };
    render(
      <SignUpScreen labels={labels} loginHref="/login" forgotPasswordHref="/forgot-password" />,
    );

    expect(screen.getByRole('heading', { name: '메일을 확인하세요' })).toBeVisible();
    expect(screen.getByText('u***@example.com')).toBeVisible();
    expect(screen.getByRole('link', { name: '로그인' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: '비밀번호 재설정' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });
});
