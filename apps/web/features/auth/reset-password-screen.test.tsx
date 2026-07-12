import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ResetPasswordScreen } from './reset-password-screen';

type ResetOptions = {
  mutation?: { onSuccess?: () => void };
};

const auth = vi.hoisted(() => ({
  mutate: vi.fn(),
  options: null as ResetOptions | null,
  setCsrfToken: vi.fn(),
  state: {
    error: null as { body: { code: string } } | null,
    isPending: false,
    isSuccess: false,
  },
}));

vi.mock('@rivet/api-client', () => ({
  setCsrfToken: auth.setCsrfToken,
  useAuthControllerConfirmPasswordReset: (options: ResetOptions) => {
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
  title: '새 비밀번호 설정',
  description: '새 비밀번호를 입력하세요.',
  password: '새 비밀번호',
  confirmPassword: '새 비밀번호 확인',
  passwordHelp: '12자 이상 입력하세요.',
  showPassword: '비밀번호 표시',
  hidePassword: '비밀번호 숨기기',
  submit: '비밀번호 변경',
  submitting: '변경 중',
  loading: '링크를 확인하는 중',
  passwordTooShort: '비밀번호가 너무 짧습니다.',
  passwordTooLong: '비밀번호가 너무 깁니다.',
  passwordMismatch: '비밀번호가 일치하지 않습니다.',
  invalidTitle: '사용할 수 없는 링크입니다.',
  invalidDescription: '새 재설정 링크를 요청하세요.',
  expiredTitle: '링크가 만료되었습니다.',
  expiredDescription: '새 재설정 링크가 필요합니다.',
  requestNewLink: '새 링크 요청하기',
  completeTitle: '비밀번호를 변경했습니다.',
  completeDescription: '기존 링크와 로그인 세션은 더 이상 사용할 수 없습니다.',
  loginLink: '로그인',
  unexpectedError: '비밀번호를 변경하지 못했습니다.',
};

afterEach(cleanup);

function renderReset() {
  return render(
    <ResetPasswordScreen
      labels={labels}
      forgotPasswordHref="/forgot-password"
      loginHref="/login"
    />,
  );
}

describe('ResetPasswordScreen', () => {
  beforeEach(() => {
    auth.mutate.mockReset();
    auth.setCsrfToken.mockReset();
    auth.options = null;
    auth.state.error = null;
    auth.state.isPending = false;
    auth.state.isSuccess = false;
    window.history.replaceState(null, '', '/reset-password');
  });

  it('fragment 토큰을 주소에서 제거하고 확인된 비밀번호와 함께 제출한다', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/reset-password#token=reset-secret');
    renderReset();

    const password = await screen.findByLabelText('새 비밀번호', {
      selector: '#reset-password',
    });
    expect(window.location.hash).toBe('');

    await user.type(password, 'correct-password');
    await user.type(screen.getByLabelText('새 비밀번호 확인'), 'correct-password');
    await user.click(screen.getByRole('button', { name: '비밀번호 변경' }));

    expect(auth.mutate).toHaveBeenCalledWith({
      data: { token: 'reset-secret', password: 'correct-password' },
    });
  });

  it('성공하면 남아 있는 CSRF 토큰을 제거하고 로그인 안내를 표시한다', async () => {
    window.history.replaceState(null, '', '/reset-password#token=reset-secret');
    const view = renderReset();
    await screen.findByLabelText('새 비밀번호', { selector: '#reset-password' });

    act(() => auth.options?.mutation?.onSuccess?.());
    expect(auth.setCsrfToken).toHaveBeenCalledWith(null);

    auth.state.isSuccess = true;
    view.rerender(
      <ResetPasswordScreen
        labels={labels}
        forgotPasswordHref="/forgot-password"
        loginHref="/login"
      />,
    );
    expect(screen.getByRole('heading', { name: '비밀번호를 변경했습니다.' })).toBeVisible();
  });

  it('NFC 정규화 뒤 Unicode code point 길이와 확인 값을 검증한다', async () => {
    const user = userEvent.setup();
    const decomposedPassword = 'e\u0301'.repeat(128);
    const normalizedPassword = 'é'.repeat(128);
    window.history.replaceState(null, '', '/reset-password#token=reset-secret');
    renderReset();

    const password = await screen.findByLabelText('새 비밀번호', {
      selector: '#reset-password',
    });
    await user.type(password, decomposedPassword);
    await user.type(screen.getByLabelText('새 비밀번호 확인'), normalizedPassword);
    await user.click(screen.getByRole('button', { name: labels.submit }));

    expect(auth.mutate).toHaveBeenCalledWith({
      data: { token: 'reset-secret', password: normalizedPassword },
    });
    expect(password).toHaveAttribute('aria-describedby', 'reset-password-description');
  });

  it('확인 비밀번호 오류를 입력과 연결한다', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/reset-password#token=reset-secret');
    renderReset();

    await user.type(
      await screen.findByLabelText('새 비밀번호', { selector: '#reset-password' }),
      'correct-password',
    );
    const confirmation = screen.getByLabelText('새 비밀번호 확인');
    await user.type(confirmation, 'different-password');
    await user.click(screen.getByRole('button', { name: labels.submit }));

    expect(await screen.findByText(labels.passwordMismatch)).toHaveAttribute(
      'id',
      'reset-confirm-password-error',
    );
    expect(confirmation).toHaveAttribute('aria-errormessage', 'reset-confirm-password-error');
  });

  it('만료 토큰은 새 링크 요청으로 연결한다', async () => {
    auth.state.error = { body: { code: 'TOKEN_EXPIRED' } };
    window.history.replaceState(null, '', '/reset-password#token=expired');
    renderReset();

    await waitFor(() => expect(window.location.hash).toBe(''));
    expect(await screen.findByText('링크가 만료되었습니다.')).toBeVisible();
    expect(screen.getByRole('link', { name: '새 링크 요청하기' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('이미 사용한 토큰도 사용할 수 없는 링크로 안내한다', async () => {
    auth.state.error = { body: { code: 'TOKEN_ALREADY_USED' } };
    window.history.replaceState(null, '', '/reset-password#token=used');
    renderReset();

    await waitFor(() => expect(window.location.hash).toBe(''));
    expect(await screen.findByText('사용할 수 없는 링크입니다.')).toBeVisible();
  });
});
