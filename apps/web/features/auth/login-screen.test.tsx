import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LoginScreen } from './login-screen';

type LoginSession = {
  csrfToken: string;
  onboardingStep: 'ACCEPT_INVITATION' | 'CREATE_WORKSPACE' | 'CREATE_TEAM' | 'COMPLETE';
};

type LoginOptions = {
  mutation?: {
    onSuccess?: (session: LoginSession) => void;
  };
};

const auth = vi.hoisted(() => ({
  mutate: vi.fn(),
  options: null as LoginOptions | null,
  setQueryData: vi.fn(),
  replace: vi.fn(),
  setCsrfToken: vi.fn(),
  state: {
    error: null as { body: { code: string } } | null,
    isPending: false,
  },
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ setQueryData: auth.setQueryData }),
}));

vi.mock('@rivet/api-client', () => ({
  getAuthControllerGetSessionQueryKey: () => ['/api/v1/auth/session'],
  setCsrfToken: auth.setCsrfToken,
  useAuthControllerLogin: (options: LoginOptions) => {
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
  useRouter: () => ({ replace: auth.replace }),
}));

const labels = {
  productName: 'Rivet',
  title: '로그인',
  description: '업무 공간으로 돌아갑니다.',
  email: '이메일',
  password: '비밀번호',
  showPassword: '비밀번호 표시',
  hidePassword: '비밀번호 숨기기',
  submit: '로그인',
  submitting: '로그인 중',
  forgotPassword: '비밀번호를 잊으셨나요?',
  signUpPrompt: '계정이 없나요?',
  signUpLink: '회원가입',
  emailInvalid: '올바른 이메일을 입력하세요.',
  passwordRequired: '비밀번호를 입력하세요.',
  invalidCredentialsTitle: '로그인 정보가 맞지 않습니다.',
  invalidCredentialsDescription: '이메일과 비밀번호를 다시 확인하세요.',
  emailNotVerifiedTitle: '이메일 인증이 필요합니다.',
  emailNotVerifiedDescription: '인증 메일을 다시 요청할 수 있습니다.',
  verifyEmailLink: '인증 메일 다시 받기',
  membershipInactiveTitle: '비활성화된 계정입니다.',
  membershipInactiveDescription: '워크스페이스 관리자에게 문의하세요.',
  rateLimited: '잠시 후 다시 시도하세요.',
  unexpectedError: '로그인하지 못했습니다.',
};

afterEach(cleanup);

function renderLogin(returnTo: string | null = null) {
  return render(
    <LoginScreen
      labels={labels}
      forgotPasswordHref="/forgot-password"
      signUpHref="/signup"
      verifyEmailHref="/verify-email"
      returnTo={returnTo}
    />,
  );
}

describe('LoginScreen', () => {
  beforeEach(() => {
    auth.mutate.mockReset();
    auth.replace.mockReset();
    auth.setQueryData.mockReset();
    auth.setCsrfToken.mockReset();
    auth.options = null;
    auth.state.error = null;
    auth.state.isPending = false;
  });

  it('온보딩 단계가 남아 있으면 복귀 주소보다 정식 단계로 이동한다', () => {
    renderLogin('/projects');

    const session: LoginSession = {
      csrfToken: 'csrf-token',
      onboardingStep: 'CREATE_WORKSPACE',
    };

    act(() => auth.options?.mutation?.onSuccess?.(session));

    expect(auth.setCsrfToken).toHaveBeenCalledWith('csrf-token');
    expect(auth.setQueryData).toHaveBeenCalledWith(['/api/v1/auth/session'], session);
    expect(auth.replace).toHaveBeenCalledWith('/onboarding/workspace');
  });

  it('진행 중인 초대가 있으면 워크스페이스 생성보다 초대 수락으로 이동한다', () => {
    renderLogin('/onboarding/workspace');

    act(() => {
      auth.options?.mutation?.onSuccess?.({
        csrfToken: 'csrf-token',
        onboardingStep: 'ACCEPT_INVITATION',
      });
    });

    expect(auth.replace).toHaveBeenCalledWith('/invite');
  });

  it.each([
    ['https://evil.example', '/my-issues'],
    ['//evil.example', '/my-issues'],
    ['/\\evil.example', '/my-issues'],
    ['/projects?mine=true', '/projects?mine=true'],
  ])('완료 세션의 복귀 주소 %s를 안전하게 처리한다', (returnTo, expected) => {
    renderLogin(returnTo);

    act(() => {
      auth.options?.mutation?.onSuccess?.({
        csrfToken: 'csrf-token',
        onboardingStep: 'COMPLETE',
      });
    });

    expect(auth.replace).toHaveBeenCalledWith(expected);
  });

  it.each([
    ['INVALID_CREDENTIALS', '로그인 정보가 맞지 않습니다.'],
    ['EMAIL_NOT_VERIFIED', '이메일 인증이 필요합니다.'],
    ['MEMBERSHIP_INACTIVE', '비활성화된 계정입니다.'],
  ])('%s 오류를 폼 안에서 안내한다', (code, message) => {
    auth.state.error = { body: { code } };
    renderLogin();

    expect(screen.getByText(message)).toBeVisible();
  });

  it('필드 오류를 해당 입력의 접근 가능한 오류 설명으로 연결한다', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole('button', { name: /^로그인$/ }));

    expect(screen.getByLabelText('이메일')).toHaveAttribute(
      'aria-errormessage',
      'login-email-error',
    );
    expect(screen.getByLabelText('비밀번호')).toHaveAttribute(
      'aria-errormessage',
      'login-password-error',
    );
    expect(document.getElementById('login-email-error')).toHaveTextContent(labels.emailInvalid);
    expect(document.getElementById('login-password-error')).toHaveTextContent(
      labels.passwordRequired,
    );
  });
});
