import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SignUpScreen } from './sign-up-screen';

type SignUpOptions = {
  mutation?: {
    onError?: (error: { body: { fieldErrors: Record<string, string[]> } }) => void;
  };
};

type ResendError = {
  body: { code: string };
  retryAfterSeconds: number | null;
};

type ResendOptions = {
  mutation?: {
    onError?: (error: ResendError) => void;
    onSuccess?: () => void;
  };
};

const auth = vi.hoisted(() => ({
  accept: vi.fn(),
  invalidateQueries: vi.fn(),
  invitationState: {
    data: null as { email: string } | null,
    error: null as { body: { code: string } } | null,
    isPending: false,
  },
  mutate: vi.fn(),
  invitationLogin: vi.fn(),
  options: null as SignUpOptions | null,
  resend: vi.fn(),
  resendOptions: null as ResendOptions | null,
  resendState: {
    data: null as { emailMasked: string } | null,
    error: null as { body: { code: string } } | null,
    isPending: false,
  },
  replace: vi.fn(),
  setCsrfToken: vi.fn(),
  setQueryData: vi.fn(),
  state: {
    data: null as { emailMasked: string; nextStep: 'LOGIN' | 'VERIFY_EMAIL' } | null,
    error: null as { body: { code: string } } | null,
    isPending: false,
  },
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: auth.invalidateQueries,
    setQueryData: auth.setQueryData,
  }),
}));

vi.mock('@rivet/api-client', () => ({
  getAuthControllerGetSessionQueryKey: () => ['/api/v1/auth/session'],
  setCsrfToken: auth.setCsrfToken,
  useAuthControllerLogin: () => ({ mutate: auth.invitationLogin }),
  useAuthControllerResendEmailVerification: (options: ResendOptions) => {
    auth.resendOptions = options;
    return { ...auth.resendState, mutate: auth.resend };
  },
  useAuthControllerSignUp: (options: SignUpOptions) => {
    auth.options = options;
    return { ...auth.state, mutate: auth.mutate };
  },
  useInvitationAuthControllerAccept: () => ({ mutate: auth.accept }),
  useInvitationAuthControllerGetContinuation: () => auth.invitationState,
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (_key: string, values: { seconds: number }) =>
    `재전송 요청이 너무 많습니다. ${values.seconds}초 후 다시 시도해 주세요.`,
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ replace: auth.replace }),
}));

const labels = {
  productName: 'Rivet',
  title: '계정 만들기',
  description: '이메일 인증이 필요합니다.',
  displayName: '표시 이름',
  email: '이메일',
  invitationLoading: '초대받은 이메일을 확인하는 중입니다.',
  invitationDescription:
    '초대받은 이메일로 계정을 만드세요. 초대 링크로 이메일 확인까지 완료됩니다.',
  invitationEmailDescription: '초대 메일에서 확인된 주소입니다. 이 가입에서는 변경할 수 없습니다.',
  invitationEmailFixed: '고정됨',
  invitationCompleting: '계정을 만들고 워크스페이스에 참여하는 중입니다.',
  invitationErrorTitle: '초대 정보를 확인할 수 없습니다',
  invitationErrorDescription: '초대 메일의 원래 링크를 다시 열어 주세요.',
  invitationSubmit: '가입하고 참여',
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
  acceptedTitle: '이메일을 확인해 주세요',
  acceptedDescription:
    '입력하신 이메일 주소를 확인했습니다.\n\n새 계정이라면 인증 메일을 보내드립니다.\n이미 가입된 계정이라면 로그인하거나 비밀번호를 재설정해 주세요.',
  acceptedEmailLabel: '이메일',
  resend: '인증 메일 다시 보내기',
  resending: '인증 메일 재전송 중',
  resentTitle: '재전송 요청을 완료했습니다',
  resentDescription: '인증이 필요한 계정이라면 새 메일을 보내드립니다.',
  resendRateLimited: '재전송 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  resendUnexpectedError: '인증 메일을 다시 요청하지 못했습니다.',
  displayNameRequired: '표시 이름을 입력하세요.',
  displayNameTooLong: '표시 이름이 너무 깁니다.',
  emailInvalid: '올바른 이메일을 입력하세요.',
  passwordTooShort: '비밀번호가 너무 짧습니다.',
  passwordTooLong: '비밀번호가 너무 깁니다.',
  passwordMismatch: '비밀번호가 일치하지 않습니다.',
  rateLimited: '잠시 후 다시 시도하세요.',
  unexpectedError: '가입 요청을 처리하지 못했습니다.',
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SignUpScreen', () => {
  beforeEach(() => {
    auth.accept.mockReset();
    auth.invalidateQueries.mockReset();
    auth.invalidateQueries.mockResolvedValue(undefined);
    auth.invitationState.data = null;
    auth.invitationState.error = null;
    auth.invitationState.isPending = false;
    auth.mutate.mockReset();
    auth.invitationLogin.mockReset();
    auth.options = null;
    auth.resend.mockReset();
    auth.resendOptions = null;
    auth.resendState.data = null;
    auth.resendState.error = null;
    auth.resendState.isPending = false;
    auth.replace.mockReset();
    auth.setCsrfToken.mockReset();
    auth.setQueryData.mockReset();
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

  it('필드에서 포커스를 잃으면 제출 전에도 invalid 상태를 표시한다', async () => {
    const user = userEvent.setup();
    render(
      <SignUpScreen labels={labels} loginHref="/login" forgotPasswordHref="/forgot-password" />,
    );

    const email = screen.getByLabelText('이메일');
    await user.type(email, 'not-an-email');
    await user.tab();

    expect(await screen.findByText(labels.emailInvalid)).toBeVisible();
    expect(email).toHaveAttribute('aria-invalid', 'true');

    const password = screen.getByLabelText('비밀번호', { selector: '#sign-up-password' });
    await user.type(password, 'short');
    await user.tab();

    expect(await screen.findByText(labels.passwordTooShort)).toBeVisible();
    expect(password).toHaveAttribute('aria-invalid', 'true');

    const confirmation = screen.getByLabelText('비밀번호 확인');
    await user.type(confirmation, 'different-value');
    await user.tab();

    expect(await screen.findByText(labels.passwordMismatch)).toBeVisible();
    expect(confirmation).toHaveAttribute('aria-invalid', 'true');
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

  it('비밀번호 표시 토글을 건너뛰고 다음 필드로 Tab 이동한다', async () => {
    const user = userEvent.setup();
    render(
      <SignUpScreen labels={labels} loginHref="/login" forgotPasswordHref="/forgot-password" />,
    );

    await user.tab();
    expect(screen.getByLabelText('표시 이름')).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText('이메일')).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText('비밀번호', { selector: '#sign-up-password' })).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText('비밀번호 확인')).toHaveFocus();
  });

  it('초대 가입은 초대받은 이메일을 채우고 수정하지 못하게 한다', async () => {
    const user = userEvent.setup();
    auth.invitationState.data = { email: 'invitee@example.com' };
    render(
      <SignUpScreen
        isInvitationSignUp
        labels={labels}
        loginHref="/login"
        forgotPasswordHref="/forgot-password"
      />,
    );

    const email = screen.getByLabelText('이메일');
    await waitFor(() => expect(email).toHaveValue('invitee@example.com'));
    expect(email).toHaveAttribute('readonly');
    expect(email).toHaveAttribute('aria-describedby', 'sign-up-email-description');
    expect(email.closest('[data-slot="input-group"]')).toHaveAttribute('data-readonly', 'true');
    expect(screen.getByText(labels.invitationEmailFixed)).toBeVisible();
    expect(screen.getByText(labels.invitationDescription)).toBeVisible();
    expect(screen.getByText(labels.invitationEmailDescription)).toBeVisible();

    await user.type(email, 'other@example.com');
    expect(email).toHaveValue('invitee@example.com');

    await user.type(screen.getByLabelText('표시 이름'), '초대 멤버');
    await user.type(
      screen.getByLabelText('비밀번호', { selector: '#sign-up-password' }),
      'correct-password',
    );
    await user.type(screen.getByLabelText('비밀번호 확인'), 'correct-password');
    await user.click(screen.getByRole('button', { name: labels.invitationSubmit }));

    expect(auth.mutate).toHaveBeenCalledWith(
      {
        data: {
          displayName: '초대 멤버',
          email: 'invitee@example.com',
          password: 'correct-password',
        },
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('접수 결과에는 가린 이메일만 표시한다', () => {
    auth.state.data = { emailMasked: 'u***@example.com', nextStep: 'VERIFY_EMAIL' };
    render(
      <SignUpScreen labels={labels} loginHref="/login" forgotPasswordHref="/forgot-password" />,
    );

    expect(screen.getByRole('heading', { name: '이메일을 확인해 주세요' })).toBeVisible();
    expect(
      screen.getByText((_, element) => element?.getAttribute('data-slot') === 'card-description'),
    ).toHaveTextContent(labels.acceptedDescription.replace(/\s+/g, ' '));
    expect(screen.getByText('이메일', { selector: 'div' })).toBeVisible();
    expect(screen.getByText('u***@example.com')).toBeVisible();
    expect(screen.getByRole('button', { name: '인증 메일 다시 보내기' })).toBeVisible();
    expect(screen.getByRole('link', { name: '로그인' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: '비밀번호 재설정' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('초대 가입은 별도 완료 화면 없이 워크스페이스 참여를 진행한다', () => {
    auth.state.data = { emailMasked: 'u***@example.com', nextStep: 'LOGIN' };
    render(
      <SignUpScreen
        isInvitationSignUp
        labels={labels}
        loginHref="/login?invitation=1"
        forgotPasswordHref="/forgot-password"
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(labels.invitationCompleting);
    expect(screen.queryByRole('link', { name: labels.passwordResetLink })).not.toBeInTheDocument();
  });

  it('초대 가입 성공 후 자동 로그인과 초대 수락을 마치고 내 작업으로 이동한다', async () => {
    auth.invitationState.data = { email: 'user@example.com' };
    auth.mutate.mockImplementation((_variables, options) => {
      void options?.onSuccess?.({ emailMasked: 'u***@example.com', nextStep: 'LOGIN' });
    });
    auth.invitationLogin.mockImplementation((_variables, options) => {
      void options?.onSuccess?.({
        csrfToken: 'csrf-token',
        onboardingStep: 'ACCEPT_INVITATION',
      });
    });
    auth.accept.mockImplementation((_variables, options) => {
      void options?.onSuccess?.();
    });
    const user = userEvent.setup();
    render(
      <SignUpScreen
        isInvitationSignUp
        labels={labels}
        loginHref="/login?invitation=1"
        forgotPasswordHref="/forgot-password"
      />,
    );

    await user.type(screen.getByLabelText('표시 이름'), '김리벳');
    await user.type(
      screen.getByLabelText('비밀번호', { selector: '#sign-up-password' }),
      'correct-password',
    );
    await user.type(screen.getByLabelText('비밀번호 확인'), 'correct-password');
    await user.click(screen.getByRole('button', { name: labels.invitationSubmit }));

    expect(auth.invitationLogin).toHaveBeenCalledWith(
      { data: { email: 'user@example.com', password: 'correct-password' } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(auth.setCsrfToken).toHaveBeenCalledWith('csrf-token');
    expect(auth.accept).toHaveBeenCalled();
    await waitFor(() => expect(auth.replace).toHaveBeenCalledWith('/my-issues'));
  });

  it('가입한 이메일로 인증 메일을 다시 요청하고 완료 상태를 표시한다', async () => {
    const user = userEvent.setup();
    const view = render(
      <SignUpScreen labels={labels} loginHref="/login" forgotPasswordHref="/forgot-password" />,
    );

    await user.type(screen.getByLabelText('표시 이름'), '김리벳');
    await user.type(screen.getByLabelText('이메일'), ' user@example.com ');
    await user.type(
      screen.getByLabelText('비밀번호', { selector: '#sign-up-password' }),
      'correct-password',
    );
    await user.type(screen.getByLabelText('비밀번호 확인'), 'correct-password');
    await user.click(screen.getByRole('button', { name: '회원가입' }));

    auth.state.data = { emailMasked: 'u***@example.com', nextStep: 'VERIFY_EMAIL' };
    view.rerender(
      <SignUpScreen labels={labels} loginHref="/login" forgotPasswordHref="/forgot-password" />,
    );
    await user.click(screen.getByRole('button', { name: '인증 메일 다시 보내기' }));

    expect(auth.resend).toHaveBeenCalledWith({ data: { email: 'user@example.com' } });

    auth.resendState.data = { emailMasked: 'u***@example.com' };
    view.rerender(
      <SignUpScreen labels={labels} loginHref="/login" forgotPasswordHref="/forgot-password" />,
    );
    expect(screen.getByText(labels.resentTitle)).toBeVisible();
    expect(screen.getByText(labels.resentDescription)).toBeVisible();
  });

  it('재전송 제한 시간을 표시하고 만료될 때까지 버튼을 비활성화한다', () => {
    vi.useFakeTimers();
    auth.state.data = { emailMasked: 'u***@example.com', nextStep: 'VERIFY_EMAIL' };
    render(
      <SignUpScreen labels={labels} loginHref="/login" forgotPasswordHref="/forgot-password" />,
    );

    act(() => {
      auth.resendOptions?.mutation?.onError?.({
        body: { code: 'RATE_LIMITED' },
        retryAfterSeconds: 2,
      });
    });

    const resendButton = screen.getByRole('button', { name: '인증 메일 다시 보내기' });
    expect(
      screen.getByText('재전송 요청이 너무 많습니다. 2초 후 다시 시도해 주세요.'),
    ).toBeVisible();
    expect(resendButton).toBeDisabled();

    act(() => vi.advanceTimersByTime(1_000));
    expect(
      screen.getByText('재전송 요청이 너무 많습니다. 1초 후 다시 시도해 주세요.'),
    ).toBeVisible();

    act(() => vi.advanceTimersByTime(1_000));
    expect(resendButton).toBeEnabled();
  });
});
