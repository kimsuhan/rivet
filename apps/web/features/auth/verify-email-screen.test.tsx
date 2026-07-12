import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VerifyEmailScreen } from './verify-email-screen';

type ResendError = {
  body: { code: string; fieldErrors: { email?: string[] } };
  retryAfterSeconds: number | null;
};

type ResendOptions = {
  mutation?: {
    onError?: (error: ResendError) => void;
    onSuccess?: () => void;
  };
};

const auth = vi.hoisted(() => ({
  resend: vi.fn(),
  resendOptions: null as ResendOptions | null,
  verify: vi.fn(),
  resendState: {
    data: null as { emailMasked: string } | null,
    error: null as { body: { code: string } } | null,
    isPending: false,
  },
  verifyState: {
    error: null as { body: { code: string } } | null,
    isPending: false,
    isSuccess: false,
  },
}));

vi.mock('@rivet/api-client', () => ({
  useAuthControllerResendEmailVerification: (options: ResendOptions) => {
    auth.resendOptions = options;
    return {
      ...auth.resendState,
      mutate: auth.resend,
    };
  },
  useAuthControllerVerifyEmail: () => ({ ...auth.verifyState, mutate: auth.verify }),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (_key: string, values: { seconds: number }) =>
    `요청이 너무 많습니다. ${values.seconds}초 후 다시 시도해 주세요.`,
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
  title: '이메일 인증',
  description: '인증 링크를 확인합니다.',
  loading: '인증 링크를 확인하는 중',
  successTitle: '이메일 인증을 완료했습니다.',
  successDescription: '이제 로그인할 수 있습니다.',
  alreadyUsedTitle: '이미 사용한 링크입니다.',
  alreadyUsedDescription: '이미 인증했다면 로그인하세요.',
  expiredTitle: '링크가 만료되었습니다.',
  expiredDescription: '인증 메일을 다시 요청하세요.',
  invalidTitle: '사용할 수 없는 링크입니다.',
  invalidDescription: '이메일 주소를 확인하고 새 메일을 요청하세요.',
  loginLink: '로그인',
  signUpLink: '회원가입으로 돌아가기',
  resendEmail: '인증 메일 다시 받기',
  email: '이메일',
  emailInvalid: '올바른 이메일을 입력하세요.',
  resend: '인증 메일 다시 받기',
  resending: '재발송 중',
  resentTitle: '인증 메일을 요청했습니다.',
  resentDescription: '계정이 있다면 새 인증 메일을 보냈습니다.',
  resentEmailLabel: '요청한 이메일',
  rateLimited: '잠시 후 다시 시도하세요.',
  retry: '인증 다시 시도',
  unexpectedError: '인증 메일을 요청하지 못했습니다.',
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderVerify() {
  return render(<VerifyEmailScreen labels={labels} loginHref="/login" signUpHref="/signup" />);
}

describe('VerifyEmailScreen', () => {
  beforeEach(() => {
    auth.resend.mockReset();
    auth.resendOptions = null;
    auth.verify.mockReset();
    auth.resendState.data = null;
    auth.resendState.error = null;
    auth.resendState.isPending = false;
    auth.verifyState.error = null;
    auth.verifyState.isPending = false;
    auth.verifyState.isSuccess = false;
    window.history.replaceState(null, '', '/verify-email');
  });

  it('fragment를 즉시 제거하고 StrictMode에서도 인증 요청을 한 번만 보낸다', async () => {
    window.history.replaceState(null, '', '/verify-email#token=verify-secret');
    render(
      <StrictMode>
        <VerifyEmailScreen labels={labels} loginHref="/login" signUpHref="/signup" />
      </StrictMode>,
    );

    await waitFor(() => expect(auth.verify).toHaveBeenCalledOnce());
    expect(auth.verify).toHaveBeenCalledWith({ data: { token: 'verify-secret' } });
    expect(window.location.hash).toBe('');
  });

  it('만료된 링크에서 인증 메일을 다시 요청한다', async () => {
    const user = userEvent.setup();
    auth.verifyState.error = { body: { code: 'TOKEN_EXPIRED' } };
    window.history.replaceState(null, '', '/verify-email#token=expired');
    renderVerify();

    expect(await screen.findByText('링크가 만료되었습니다.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '인증 메일 다시 받기' }));
    expect(await screen.findByText(labels.emailInvalid)).toHaveAttribute(
      'id',
      'verify-email-resend-error',
    );
    expect(screen.getByLabelText('이메일')).toHaveAttribute(
      'aria-errormessage',
      'verify-email-resend-error',
    );
    await user.type(screen.getByLabelText('이메일'), ' user@example.com ');
    await user.click(screen.getByRole('button', { name: '인증 메일 다시 받기' }));

    expect(auth.resend).toHaveBeenCalledWith({ data: { email: 'user@example.com' } });
  });

  it('이미 사용한 링크는 로그인으로 연결한다', async () => {
    auth.verifyState.error = { body: { code: 'TOKEN_ALREADY_USED' } };
    window.history.replaceState(null, '', '/verify-email#token=used');
    renderVerify();

    expect(await screen.findByText('이미 사용한 링크입니다.')).toBeVisible();
    expect(screen.getByRole('link', { name: '로그인' })).toHaveAttribute('href', '/login');
  });

  it('재발송 제한 시간을 표시하고 만료될 때까지 버튼을 비활성화한다', async () => {
    auth.verifyState.error = { body: { code: 'TOKEN_EXPIRED' } };
    window.history.replaceState(null, '', '/verify-email#token=expired');
    renderVerify();
    await screen.findByText('링크가 만료되었습니다.');
    vi.useFakeTimers();

    act(() => {
      auth.resendOptions?.mutation?.onError?.({
        body: { code: 'RATE_LIMITED', fieldErrors: {} },
        retryAfterSeconds: 2,
      });
    });

    expect(screen.getByText('요청이 너무 많습니다. 2초 후 다시 시도해 주세요.')).toBeVisible();
    const resendButton = screen.getByRole('button', { name: '인증 메일 다시 받기' });
    expect(resendButton).toBeDisabled();

    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText('요청이 너무 많습니다. 1초 후 다시 시도해 주세요.')).toBeVisible();

    act(() => vi.advanceTimersByTime(1_000));
    expect(resendButton).toBeEnabled();
  });

  it('예상하지 못한 실패는 제거한 fragment의 토큰으로 다시 시도한다', async () => {
    const user = userEvent.setup();
    auth.verifyState.error = { body: { code: 'INTERNAL_ERROR' } };
    window.history.replaceState(null, '', '/verify-email#token=retry-secret');
    renderVerify();

    expect(await screen.findByText(labels.unexpectedError)).toBeVisible();
    expect(window.location.hash).toBe('');
    expect(auth.verify).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: labels.retry }));

    expect(auth.verify).toHaveBeenCalledTimes(2);
    expect(auth.verify).toHaveBeenLastCalledWith({ data: { token: 'retry-secret' } });
  });
});
