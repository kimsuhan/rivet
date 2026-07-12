import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InviteOnboardingScreen } from './invite-onboarding-screen';

const mocks = vi.hoisted(() => ({
  createHook: vi.fn(),
  mutate: vi.fn(),
  replace: vi.fn(),
  reset: vi.fn(),
  sessionHook: vi.fn(),
}));

vi.mock('@rivet/api-client', () => ({
  useAuthControllerGetSession: mocks.sessionHook,
  useInvitationsControllerCreate: mocks.createHook,
}));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

const labels = {
  alreadyInvited: '이미 초대됨',
  alreadyMember: '이미 멤버',
  completedStepStatus: '완료',
  currentStepStatus: '현재 단계',
  description: '동료에게 초대를 보내세요.',
  emailDescription: '한 줄에 하나씩 입력하세요.',
  emailInvalid: '올바르지 않은 이메일 주소가 있습니다.',
  emailLabel: '동료 이메일',
  emailPlaceholder: 'web@example.com',
  emailsRequired: '초대할 이메일을 입력해 주세요.',
  errorDescription: '입력값을 유지했습니다.',
  errorTitle: '초대를 보내지 못했습니다',
  failed: '보내지 못함',
  firstIssue: '첫 이슈 만들기',
  inviteStep: '동료 초대',
  invited: '초대 보냄',
  limitExceeded: '최대 50개까지 보낼 수 있습니다.',
  productName: 'Rivet',
  resultTitle: '주소별 초대 결과',
  retryFailed: '실패한 주소 다시 시도',
  sessionErrorDescription: '활성 관리자 멤버십을 확인해 주세요.',
  sessionErrorTitle: '동료를 초대할 권한을 확인하지 못했습니다',
  sessionLoadingDescription: '관리자 멤버십을 확인하고 있습니다.',
  sessionLoadingTitle: '초대 설정을 준비하는 중입니다.',
  skip: '건너뛰기',
  stepsLabel: '초기 설정 단계',
  submit: '초대 후 계속',
  submitting: '초대를 보내는 중입니다.',
  teamStep: '기본 팀',
  title: '동료 초대',
  toMyIssues: '내 이슈로 이동',
  workspaceStep: '워크스페이스',
};

function mockSession(value: Record<string, unknown> = {}) {
  mocks.sessionHook.mockReturnValue({
    data: {
      authenticated: true,
      membership: { id: 'membership-id', role: 'ADMIN', status: 'ACTIVE' },
    },
    isError: false,
    isPending: false,
    ...value,
  } as never);
}

function mockCreate(value: Record<string, unknown> = {}) {
  mocks.createHook.mockReturnValue({
    data: undefined,
    error: null,
    isError: false,
    isPending: false,
    mutate: mocks.mutate,
    reset: mocks.reset,
    ...value,
  } as never);
}

describe('InviteOnboardingScreen', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
    mockCreate();
  });

  it('이메일을 줄·쉼표로 나누고 정규화 중복을 제거해 한 번만 보낸다', async () => {
    render(<InviteOnboardingScreen labels={labels} />);
    const user = userEvent.setup();
    const input = screen.getByRole('textbox', { name: labels.emailLabel });

    await user.type(input, 'A@example.com{enter} a@example.com, b@example.com');
    await user.click(screen.getByRole('button', { name: labels.submit }));

    await waitFor(() =>
      expect(mocks.mutate).toHaveBeenCalledWith(
        { data: { emails: ['A@example.com', 'b@example.com'] } },
        expect.objectContaining({ onError: expect.any(Function) }),
      ),
    );
  });

  it('잘못된 이메일을 입력 위치에 연결된 오류로 표시한다', async () => {
    render(<InviteOnboardingScreen labels={labels} />);
    const user = userEvent.setup();
    const input = screen.getByRole('textbox', { name: labels.emailLabel });

    await user.type(input, 'not-an-email');
    await user.click(screen.getByRole('button', { name: labels.submit }));

    expect(await screen.findByText(labels.emailInvalid)).toHaveAttribute(
      'id',
      'invite-emails-error',
    );
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('주소별 성공·중복·실패 결과를 알리고 실패 주소를 다시 입력할 수 있다', async () => {
    mockCreate({
      data: {
        items: [
          { email: 'new@example.com', invitationId: 'one', result: 'INVITED' },
          { email: 'member@example.com', invitationId: null, result: 'ALREADY_MEMBER' },
          { email: 'pending@example.com', invitationId: 'two', result: 'ALREADY_INVITED' },
          { email: 'failed@example.com', invitationId: null, result: 'FAILED' },
        ],
      },
    });

    const { rerender } = render(<InviteOnboardingScreen labels={labels} />);
    const user = userEvent.setup();

    expect(screen.getByRole('heading', { name: labels.resultTitle })).toHaveFocus();
    expect(screen.getByText(labels.invited)).toBeVisible();
    expect(screen.getByText(labels.alreadyMember)).toBeVisible();
    expect(screen.getByText(labels.alreadyInvited)).toBeVisible();
    expect(screen.getByText(labels.failed)).toBeVisible();
    expect(screen.getByRole('button', { name: labels.firstIssue })).toBeVisible();
    expect(screen.getByRole('button', { name: labels.toMyIssues })).toBeVisible();

    await user.click(screen.getByRole('button', { name: labels.retryFailed }));
    expect(mocks.reset).toHaveBeenCalled();
    mockCreate();
    rerender(<InviteOnboardingScreen labels={labels} />);
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: labels.emailLabel })).toHaveValue(
        'failed@example.com',
      ),
    );
    expect(screen.getByRole('textbox', { name: labels.emailLabel })).toHaveFocus();
  });

  it('초대 결과에서 첫 이슈 만들기를 주요 동작으로 연다', async () => {
    mockCreate({
      data: {
        items: [{ email: 'new@example.com', invitationId: 'one', result: 'INVITED' }],
      },
    });
    const user = userEvent.setup();
    render(<InviteOnboardingScreen labels={labels} />);

    await user.click(screen.getByRole('button', { name: labels.firstIssue }));

    expect(mocks.replace).toHaveBeenCalledWith('/my-issues?create=1');
    expect(screen.getByRole('button', { name: labels.toMyIssues })).toHaveClass('border-border');
  });

  it('초대를 건너뛰고 내 이슈로 이동할 수 있다', async () => {
    render(<InviteOnboardingScreen labels={labels} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: labels.skip }));
    expect(mocks.replace).toHaveBeenCalledWith('/my-issues');
  });

  it('활성 관리자가 아니면 초대 폼 대신 권한 안내를 표시한다', () => {
    mockSession({ data: { authenticated: true, membership: { role: 'MEMBER' } } });

    render(<InviteOnboardingScreen labels={labels} />);

    expect(screen.getByRole('alert')).toHaveTextContent(labels.sessionErrorTitle);
    expect(screen.queryByRole('textbox', { name: labels.emailLabel })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: labels.submit })).not.toBeInTheDocument();
  });
});
