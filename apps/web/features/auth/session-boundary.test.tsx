import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setCsrfToken, useAuthControllerGetSession } from '@rivet/api-client';

import { SessionBoundary } from './session-boundary';

const replace = vi.fn();
const refetch = vi.fn();

vi.mock('@rivet/api-client', () => ({
  setCsrfToken: vi.fn(),
  useAuthControllerGetSession: vi.fn(),
}));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace }),
}));

const labels = {
  errorDescription: '잠시 후 다시 시도해 주세요.',
  errorTitle: '세션을 확인하지 못했습니다',
  loading: '세션을 확인하는 중입니다.',
  retry: '다시 시도',
};

function mockSession(value: Record<string, unknown>) {
  vi.mocked(useAuthControllerGetSession).mockReturnValue(value as never);
}

describe('SessionBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/');
  });

  it('세션을 확인하는 동안 접근 가능한 로딩 상태를 표시한다', () => {
    mockSession({ data: undefined, isError: false, isPending: true, refetch });

    render(
      <SessionBoundary expectedStep="COMPLETE" labels={labels}>
        <div>업무 화면</div>
      </SessionBoundary>,
    );

    expect(screen.getByRole('status')).toHaveTextContent(labels.loading);
    expect(screen.queryByText('업무 화면')).not.toBeInTheDocument();
  });

  it('비로그인 사용자를 현재 주소와 함께 로그인으로 보내고 CSRF 토큰을 지운다', async () => {
    window.history.replaceState(null, '', '/my-issues?view=mine');
    mockSession({
      data: { authenticated: false },
      isError: false,
      isPending: false,
      refetch,
    });

    render(
      <SessionBoundary expectedStep="COMPLETE" labels={labels}>
        <div>업무 화면</div>
      </SessionBoundary>,
    );

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/login?returnTo=%2Fmy-issues%3Fview%3Dmine'),
    );
    expect(setCsrfToken).toHaveBeenCalledWith(null);
    expect(screen.queryByText('업무 화면')).not.toBeInTheDocument();
  });

  it('완료 세션에 CSRF 토큰을 저장하고 자식을 표시한다', async () => {
    mockSession({
      data: {
        authenticated: true,
        csrfToken: 'csrf-token',
        membership: {},
        onboardingStep: 'COMPLETE',
        user: {},
        workspace: {},
      },
      isError: false,
      isPending: false,
      refetch,
    });

    render(
      <SessionBoundary expectedStep="COMPLETE" labels={labels}>
        <div>업무 화면</div>
      </SessionBoundary>,
    );

    expect(screen.getByText('업무 화면')).toBeInTheDocument();
    await waitFor(() => expect(setCsrfToken).toHaveBeenCalledWith('csrf-token'));
    expect(replace).not.toHaveBeenCalled();
  });

  it('조회 실패에서 다시 시도할 수 있다', async () => {
    mockSession({ data: undefined, isError: true, isPending: false, refetch });
    const user = userEvent.setup();

    render(
      <SessionBoundary expectedStep="COMPLETE" labels={labels}>
        <div>업무 화면</div>
      </SessionBoundary>,
    );

    await user.click(screen.getByRole('button', { name: labels.retry }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(setCsrfToken).toHaveBeenCalledWith(null);
  });
});
