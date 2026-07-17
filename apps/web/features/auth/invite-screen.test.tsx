import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InviteScreen } from './invite-screen';

const mocks = vi.hoisted(() => ({
  acceptHook: vi.fn(),
  acceptMutate: vi.fn(),
  acceptReset: vi.fn(),
  currentHook: vi.fn(),
  currentRefetch: vi.fn(),
  dismissHook: vi.fn(),
  dismissMutate: vi.fn(),
  replace: vi.fn(),
  sessionRefetch: vi.fn(),
  sessionHook: vi.fn(),
  setCsrfToken: vi.fn(),
  startHook: vi.fn(),
  startMutate: vi.fn(),
  startReset: vi.fn(),
}));

vi.mock('@rivet/api-client', () => ({
  getAuthControllerGetSessionQueryKey: () => ['/api/v1/auth/session'],
  setCsrfToken: mocks.setCsrfToken,
  useAuthControllerGetSession: mocks.sessionHook,
  useInvitationAuthControllerAccept: mocks.acceptHook,
  useInvitationAuthControllerDismissContinuation: mocks.dismissHook,
  useInvitationAuthControllerGetContinuation: mocks.currentHook,
  useInvitationAuthControllerStartContinuation: mocks.startHook,
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: React.ComponentProps<'a'>) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ replace: mocks.replace }),
}));

const labels = {
  accept: '초대 수락',
  accepting: '초대를 수락하는 중입니다.',
  accountSwitchLink: '다른 계정으로 로그인',
  currentAccountLabel: '현재 로그인 계정',
  currentWorkspace: '현재 워크스페이스로 이동',
  description: '초대 내용을 확인하세요.',
  emailMismatchDescription: '초대받은 이메일과 같은 계정으로 다시 로그인해 주세요.',
  emailMismatchTitle: '다른 이메일 계정으로 로그인했습니다',
  expiredDescription: '관리자에게 새 초대를 요청해 주세요.',
  expiredTitle: '초대 링크를 사용할 수 없습니다',
  invalidDescription: '초대 메일의 원래 링크를 확인해 주세요.',
  invalidTitle: '올바르지 않은 초대 링크입니다',
  inviteEmailLabel: '초대받은 이메일',
  invitedByLabel: '초대한 사람',
  loading: '초대 링크를 확인하는 중입니다.',
  loginLink: '로그인',
  loginRequiredDescription: '같은 이메일 계정으로 로그인하거나 가입하세요.',
  loginRequiredTitle: '로그인 또는 가입이 필요합니다',
  productName: 'Rivet',
  continuationDescription: '인증을 마치면 이 초대로 자동으로 돌아옵니다.',
  retry: '다시 시도',
  sessionErrorDescription: '잠시 후 다시 시도해 주세요.',
  sessionErrorTitle: '로그인 상태를 확인하지 못했습니다',
  sessionLoading: '로그인 상태를 확인하는 중입니다.',
  signUpLink: '가입하기',
  title: '워크스페이스 초대',
  unexpectedDescription: '잠시 후 다시 시도해 주세요.',
  unexpectedTitle: '초대를 확인하지 못했습니다',
  usedDescription: '이미 참여했다면 현재 워크스페이스에서 계속하세요.',
  usedTitle: '이미 사용한 초대입니다',
  workspaceLabel: '워크스페이스',
  workspaceLimitDescription: '계정 하나로 한 워크스페이스에만 참여할 수 있습니다.',
  workspaceLimitTitle: '다른 워크스페이스에 참여할 수 없습니다',
};

const previewData = {
  emailMasked: 'me***@example.com',
  expiresAt: '2026-07-18T00:00:00.000Z',
  invitedByDisplayName: '김관리',
  workspaceName: '제품 개발팀',
};

function mockPreview(value: Record<string, unknown> = {}) {
  mocks.startHook.mockReturnValue({
    data: previewData,
    error: null,
    isPending: false,
    mutate: mocks.startMutate,
    reset: mocks.startReset,
    ...value,
  } as never);
  mocks.currentHook.mockReturnValue({
    data: previewData,
    error: null,
    isPending: false,
    refetch: mocks.currentRefetch,
  } as never);
}

function mockAccept(value: Record<string, unknown> = {}) {
  mocks.acceptHook.mockReturnValue({
    error: null,
    isPending: false,
    mutate: mocks.acceptMutate,
    reset: mocks.acceptReset,
    ...value,
  } as never);
}

function mockSession(data: unknown) {
  mocks.sessionHook.mockReturnValue({
    data,
    isError: false,
    isPending: false,
    refetch: mocks.sessionRefetch,
  } as never);
}

function renderScreen(token = 'invite-token') {
  window.history.replaceState(null, '', `/invite#token=${token}`);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <InviteScreen
        invitationSignUpHref="/signup?invitation=1"
        labels={labels}
        loginHref="/login"
        signUpHref="/signup"
      />
    </QueryClientProvider>,
  );
  return { invalidate, unmount: rendered.unmount };
}

describe('InviteScreen', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessionRefetch.mockResolvedValue({ data: { authenticated: false } });
    mocks.dismissHook.mockReturnValue({
      isPending: false,
      mutate: mocks.dismissMutate,
    });
    mockPreview();
    mockAccept();
    mockSession({ authenticated: false });
  });

  it('URL fragment 토큰을 메모리에 읽고 주소에서 즉시 제거한다', async () => {
    renderScreen();

    await waitFor(() =>
      expect(mocks.startMutate).toHaveBeenCalledWith(
        { data: { token: 'invite-token' } },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      ),
    );
    expect(window.location.hash).toBe('');
    expect(screen.getByText(previewData.workspaceName)).toBeVisible();
    expect(screen.getByText(previewData.invitedByDisplayName)).toBeVisible();
    expect(screen.getByText(previewData.emailMasked)).toBeVisible();
  });

  it('비로그인 사용자에게 가입·로그인 뒤 자동으로 초대를 이어 간다고 안내한다', async () => {
    renderScreen();

    expect(await screen.findByText(labels.loginRequiredTitle)).toBeVisible();
    expect(screen.getByText(labels.continuationDescription)).toBeVisible();
    expect(screen.getByRole('link', { name: labels.loginLink })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: labels.signUpLink })).toHaveAttribute(
      'href',
      '/signup?invitation=1',
    );
    expect(screen.queryByRole('button', { name: labels.accept })).not.toBeInTheDocument();
  });

  it('구조화되지 않은 미리보기 오류에서도 링크를 유지하고 다시 시도한다', async () => {
    mockPreview({ data: undefined, error: {} });
    renderScreen();
    const user = userEvent.setup();

    expect(await screen.findByText(labels.unexpectedTitle)).toBeVisible();
    await user.click(screen.getByRole('button', { name: labels.retry }));

    expect(mocks.startReset).toHaveBeenCalled();
    expect(mocks.startMutate).toHaveBeenLastCalledWith(
      { data: { token: 'invite-token' } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('이미 사용된 링크를 새로 열어도 세션을 갱신해 참여한 워크스페이스로 이동한다', async () => {
    mockPreview({ data: undefined, error: { body: { code: 'TOKEN_ALREADY_USED' } } });
    mocks.sessionRefetch.mockResolvedValue({
      data: {
        authenticated: true,
        membership: { id: 'membership-id' },
      },
    });

    renderScreen();

    expect(await screen.findByText(labels.usedTitle)).toBeVisible();
    await waitFor(() => expect(mocks.sessionRefetch).toHaveBeenCalledOnce());
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/my-issues'));
  });

  it('워크스페이스가 없는 로그인 계정이 수락하면 세션을 갱신하고 내 이슈로 이동한다', async () => {
    mockSession({
      authenticated: true,
      csrfToken: 'csrf-token',
      membership: null,
      onboardingStep: 'CREATE_WORKSPACE',
      user: { email: 'member@example.com' },
      workspace: null,
    });
    const { invalidate } = renderScreen();
    const user = userEvent.setup();
    mocks.acceptMutate.mockImplementation((_variables, options) => {
      void options?.onSuccess?.();
    });

    await user.click(await screen.findByRole('button', { name: labels.accept }));

    expect(mocks.setCsrfToken).toHaveBeenCalledWith('csrf-token');
    expect(mocks.acceptMutate).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/my-issues'));
  });

  it('기존 워크스페이스 멤버에게는 수락 대신 현재 워크스페이스 이동만 제공한다', async () => {
    mockSession({
      authenticated: true,
      csrfToken: 'csrf-token',
      membership: { id: 'membership-id' },
      onboardingStep: 'COMPLETE',
      user: { email: 'member@example.com' },
      workspace: { id: 'workspace-id' },
    });
    renderScreen();
    const user = userEvent.setup();
    mocks.dismissMutate.mockImplementation((_variables, options) => {
      void options?.onSuccess?.();
    });

    expect(await screen.findByText(labels.workspaceLimitTitle)).toBeVisible();
    expect(screen.queryByRole('button', { name: labels.accept })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: labels.currentWorkspace }));
    expect(mocks.dismissMutate).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/my-issues'));
  });

  it('다른 탭에서 먼저 수락한 초대는 세션을 다시 확인해 워크스페이스로 이동한다', async () => {
    mockSession({
      authenticated: true,
      csrfToken: 'csrf-token',
      membership: null,
      onboardingStep: 'CREATE_WORKSPACE',
      user: { email: 'member@example.com' },
      workspace: null,
    });
    mocks.sessionRefetch.mockResolvedValue({
      data: {
        authenticated: true,
        membership: { id: 'membership-id' },
      },
    });
    mocks.acceptMutate.mockImplementation((_variables, options) => {
      void options?.onError?.({ body: { code: 'TOKEN_ALREADY_USED' } });
    });
    renderScreen();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: labels.accept }));

    await waitFor(() => expect(mocks.sessionRefetch).toHaveBeenCalledOnce());
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/my-issues'));
  });

  it('사용 완료 상태에서 세션 복구를 다시 시도할 수 있다', async () => {
    mockSession({
      authenticated: true,
      csrfToken: 'csrf-token',
      membership: null,
      onboardingStep: 'CREATE_WORKSPACE',
      user: { email: 'member@example.com' },
      workspace: null,
    });
    mockAccept({ error: { body: { code: 'TOKEN_ALREADY_USED' } } });
    mocks.sessionRefetch.mockResolvedValue({
      data: {
        authenticated: true,
        membership: { id: 'membership-id' },
      },
    });
    renderScreen();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: labels.retry }));

    expect(mocks.sessionRefetch).toHaveBeenCalledOnce();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/my-issues'));
  });

  it('이메일 불일치와 만료 상태에서 수락을 숨기고 만료 초대는 일반 가입으로 연결한다', async () => {
    mockSession({
      authenticated: true,
      csrfToken: 'csrf-token',
      membership: null,
      onboardingStep: 'CREATE_WORKSPACE',
      user: { email: 'other@example.com' },
      workspace: null,
    });
    mockAccept({ error: { body: { code: 'INVITATION_EMAIL_MISMATCH' } } });
    const { unmount } = renderScreen();

    expect(await screen.findByText(labels.emailMismatchTitle)).toBeVisible();
    expect(screen.getByRole('link', { name: labels.accountSwitchLink })).toBeVisible();
    expect(screen.queryByRole('button', { name: labels.accept })).not.toBeInTheDocument();
    unmount();

    mockPreview({ data: undefined, error: { body: { code: 'TOKEN_EXPIRED' } } });
    renderScreen('expired-token');
    expect(await screen.findByText(labels.expiredTitle)).toBeVisible();
    expect(screen.getByRole('link', { name: labels.signUpLink })).toHaveAttribute(
      'href',
      '/signup',
    );
    expect(screen.queryByRole('button', { name: labels.accept })).not.toBeInTheDocument();
  });
});
