import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/messages/ko.json';

import { type MemberSettingsLabels, MemberSettingsScreen } from './member-settings-screen';

const mocks = vi.hoisted(() => ({
  cancelHook: vi.fn(),
  cancelMutate: vi.fn(),
  createHook: vi.fn(),
  createMutate: vi.fn(),
  deactivateHook: vi.fn(),
  deactivateMutate: vi.fn(),
  fetchMoreActiveMembers: vi.fn(),
  fetchMoreInactiveMembers: vi.fn(),
  fetchMoreInvitationHistory: vi.fn(),
  fetchMorePendingInvitations: vi.fn(),
  invitationPagesHook: vi.fn(),
  invitationsRefetch: vi.fn(),
  memberPagesHook: vi.fn(),
  membersRefetch: vi.fn(),
  resendHook: vi.fn(),
  resendMutate: vi.fn(),
  sessionHook: vi.fn(),
  sessionRefetch: vi.fn(),
}));

vi.mock('@rivet/api-client', () => ({
  getInvitationsControllerListQueryKey: () => ['/api/v1/invitations'],
  getMembersControllerListQueryKey: () => ['/api/v1/members'],
  useAuthControllerGetSession: mocks.sessionHook,
  useInvitationsControllerCancel: mocks.cancelHook,
  useInvitationsControllerCreate: mocks.createHook,
  useInvitationsControllerResend: mocks.resendHook,
  useMembersControllerDeactivate: mocks.deactivateHook,
}));

vi.mock('./member-settings-queries', () => ({
  useInvitationPages: mocks.invitationPagesHook,
  useMemberPages: mocks.memberPagesHook,
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { children: ReactNode }) => (
    <a {...props}>{children}</a>
  ),
}));

const labels: MemberSettingsLabels = messages.Settings.members;
const admin = {
  deactivatedAt: null,
  email: 'admin@example.com',
  id: 'admin-membership',
  joinedAt: '2026-07-01T00:00:00.000Z',
  role: 'ADMIN',
  status: 'ACTIVE',
  user: { avatarFileId: null, displayName: '관리자 김', id: 'admin-user' },
} as const;
const activeMember = {
  deactivatedAt: null,
  email: 'member@example.com',
  id: 'member-membership',
  joinedAt: '2026-07-02T00:00:00.000Z',
  role: 'MEMBER',
  status: 'ACTIVE',
  user: { avatarFileId: null, displayName: '활성 멤버', id: 'member-user' },
} as const;
const inactiveMember = {
  deactivatedAt: '2026-07-10T00:00:00.000Z',
  email: 'inactive@example.com',
  id: 'inactive-membership',
  joinedAt: '2026-07-03T00:00:00.000Z',
  role: 'MEMBER',
  status: 'INACTIVE',
  user: { avatarFileId: null, displayName: '비활성 멤버', id: 'inactive-user' },
} as const;
const pendingInvitation = {
  acceptedAt: null,
  canceledAt: null,
  createdAt: '2026-07-11T00:00:00.000Z',
  email: 'pending@example.com',
  expiresAt: '2026-07-18T00:00:00.000Z',
  id: 'pending-invitation',
  invitedByDisplayName: '관리자 김',
  invitedByMembershipId: 'admin-membership',
  status: 'PENDING',
} as const;
const acceptedInvitation = {
  ...pendingInvitation,
  acceptedAt: '2026-07-12T00:00:00.000Z',
  email: 'accepted@example.com',
  id: 'accepted-invitation',
  status: 'ACCEPTED',
} as const;

function mockQueries({
  activeMembers = {},
  inactiveMembers = {},
  invitationHistory = {},
  pendingInvitations = {},
  session = {},
}: {
  activeMembers?: Record<string, unknown>;
  inactiveMembers?: Record<string, unknown>;
  invitationHistory?: Record<string, unknown>;
  pendingInvitations?: Record<string, unknown>;
  session?: Record<string, unknown>;
} = {}) {
  mocks.memberPagesHook.mockImplementation((status: string) =>
    status === 'ACTIVE'
      ? ({
          data: { pageParams: [undefined], pages: [{ items: [admin, activeMember] }] },
          error: null,
          fetchNextPage: mocks.fetchMoreActiveMembers,
          hasNextPage: false,
          isError: false,
          isFetchingNextPage: false,
          isPending: false,
          refetch: mocks.membersRefetch,
          ...activeMembers,
        } as never)
      : ({
          data: { pageParams: [undefined], pages: [{ items: [inactiveMember] }] },
          error: null,
          fetchNextPage: mocks.fetchMoreInactiveMembers,
          hasNextPage: false,
          isError: false,
          isFetchingNextPage: false,
          isPending: false,
          refetch: mocks.membersRefetch,
          ...inactiveMembers,
        } as never),
  );
  mocks.invitationPagesHook.mockImplementation((status: string) =>
    status === 'PENDING'
      ? ({
          data: { pageParams: [undefined], pages: [{ items: [pendingInvitation] }] },
          error: null,
          fetchNextPage: mocks.fetchMorePendingInvitations,
          hasNextPage: false,
          isError: false,
          isFetching: false,
          isFetchingNextPage: false,
          isPending: false,
          refetch: mocks.invitationsRefetch,
          ...pendingInvitations,
        } as never)
      : ({
          data: { pageParams: [undefined], pages: [{ items: [acceptedInvitation] }] },
          error: null,
          fetchNextPage: mocks.fetchMoreInvitationHistory,
          hasNextPage: false,
          isError: false,
          isFetching: false,
          isFetchingNextPage: false,
          isPending: false,
          refetch: mocks.invitationsRefetch,
          ...invitationHistory,
        } as never),
  );
  mocks.sessionHook.mockReturnValue({
    data: {
      authenticated: true,
      membership: { id: admin.id, role: 'ADMIN', status: 'ACTIVE' },
    },
    error: null,
    isError: false,
    isPending: false,
    refetch: mocks.sessionRefetch,
    ...session,
  } as never);
}

function mockMutations() {
  mocks.createHook.mockReturnValue({ isPending: false, mutate: mocks.createMutate } as never);
  mocks.resendHook.mockReturnValue({ isPending: false, mutate: mocks.resendMutate } as never);
  mocks.cancelHook.mockReturnValue({ isPending: false, mutate: mocks.cancelMutate } as never);
  mocks.deactivateHook.mockReturnValue({
    isPending: false,
    mutate: mocks.deactivateMutate,
  } as never);
}

function renderScreen() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
  render(
    <QueryClientProvider client={queryClient}>
      <MemberSettingsScreen labels={labels} />
    </QueryClientProvider>,
  );
  return { invalidate };
}

describe('MemberSettingsScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueries();
    mockMutations();
  });

  afterEach(() => {
    cleanup();
  });

  it('활성·초대 대기·비활성 상태를 구분하고 초대 이력을 함께 확인한다', async () => {
    renderScreen();
    const user = userEvent.setup();

    expect(screen.getByText(admin.user.displayName)).toBeVisible();
    expect(screen.getByText(activeMember.user.displayName)).toBeVisible();
    expect(screen.queryByText(inactiveMember.user.displayName)).not.toBeInTheDocument();

    const activeRow = screen.getByText(activeMember.user.displayName).closest('li');
    const adminRow = screen.getByText(admin.user.displayName).closest('li');
    expect(activeRow).not.toBeNull();
    expect(adminRow).not.toBeNull();
    expect(within(activeRow!).getByRole('link', { name: labels.teamSettings })).toHaveAttribute(
      'href',
      '/settings/teams',
    );
    expect(within(activeRow!).getByRole('button', { name: labels.deactivate })).toBeVisible();
    expect(within(adminRow!).queryByRole('button', { name: labels.deactivate })).toBeNull();
    expect(within(adminRow!).getByText(labels.currentUser)).toBeVisible();

    await user.click(screen.getByRole('tab', { name: new RegExp(labels.pendingTab) }));
    expect(screen.getByText(pendingInvitation.email)).toBeVisible();
    expect(screen.getByText(acceptedInvitation.email)).toBeVisible();
    expect(screen.getByText(labels.acceptedStatus)).toBeVisible();

    await user.click(screen.getByRole('tab', { name: new RegExp(labels.inactiveTab) }));
    expect(screen.getByText(inactiveMember.user.displayName)).toBeVisible();
    expect(
      within(screen.getByText(inactiveMember.user.displayName).closest('li')!).getByText(
        labels.inactiveStatus,
      ),
    ).toBeVisible();
  });

  it('멤버 상태별 목록과 초대 기록의 다음 페이지를 각각 불러온다', async () => {
    mockQueries({
      activeMembers: { hasNextPage: true },
      inactiveMembers: { hasNextPage: true },
      invitationHistory: { hasNextPage: true },
      pendingInvitations: { hasNextPage: true },
    });
    renderScreen();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: labels.loadMoreMembers }));
    expect(mocks.fetchMoreActiveMembers).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('tab', { name: new RegExp(labels.pendingTab) }));
    await user.click(screen.getByRole('button', { name: labels.loadMorePendingInvitations }));
    expect(mocks.fetchMorePendingInvitations).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: labels.loadMoreInvitations }));
    expect(mocks.fetchMoreInvitationHistory).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('tab', { name: new RegExp(labels.inactiveTab) }));
    await user.click(screen.getByRole('button', { name: labels.loadMoreMembers }));
    expect(mocks.fetchMoreInactiveMembers).toHaveBeenCalledOnce();
  });

  it('다음 멤버·초대 페이지 실패를 현재 목록과 함께 안내하고 재시도한다', async () => {
    mockQueries({
      activeMembers: { hasNextPage: true, isFetchNextPageError: true },
      pendingInvitations: { hasNextPage: true, isFetchNextPageError: true },
    });
    renderScreen();
    const user = userEvent.setup();

    expect(screen.getByText(labels.loadMoreErrorTitle)).toBeVisible();
    await user.click(screen.getByRole('button', { name: labels.retry }));
    expect(mocks.fetchMoreActiveMembers).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('tab', { name: new RegExp(labels.pendingTab) }));
    expect(screen.getByText(labels.loadMoreErrorTitle)).toBeVisible();
    await user.click(screen.getByRole('button', { name: labels.retry }));
    expect(mocks.fetchMorePendingInvitations).toHaveBeenCalledOnce();
  });

  it('다음 페이지 재시도 중에는 중복 요청을 막고 진행 상태를 표시한다', () => {
    mockQueries({
      activeMembers: {
        hasNextPage: true,
        isFetchNextPageError: true,
        isFetchingNextPage: true,
      },
    });
    renderScreen();

    const retry = screen.getByRole('button', { name: labels.retry });
    expect(retry).toBeDisabled();
    expect(retry.querySelector('[data-slot="spinner"]')).toBeInTheDocument();
  });

  it('이메일 형식을 확인하고 성공한 초대를 목록에 반영한다', async () => {
    const { invalidate } = renderScreen();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: labels.invite }));
    const input = screen.getByRole('textbox', { name: labels.emailLabel });
    await user.type(input, 'invalid-email');
    await user.click(screen.getByRole('button', { name: labels.inviteAction }));
    expect(await screen.findByText(labels.emailInvalid)).toHaveAttribute(
      'id',
      'invite-member-email-error',
    );
    expect(input).toHaveAttribute('aria-errormessage', 'invite-member-email-error');
    expect(input).toHaveFocus();
    expect(mocks.createMutate).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, 'New@Example.com');
    mocks.createMutate.mockImplementation((_variables, options) => {
      void options?.onSuccess?.({
        items: [{ email: 'New@Example.com', invitationId: 'new-invitation', result: 'INVITED' }],
      });
    });
    await user.click(screen.getByRole('button', { name: labels.inviteAction }));

    expect(mocks.createMutate).toHaveBeenCalledWith(
      { data: { emails: ['New@Example.com'] } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['/api/v1/invitations'] }),
    );
    expect(await screen.findByText(labels.invitedSuccess)).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('작성 중인 초대 모달을 닫을 때 입력 폐기를 확인한다', async () => {
    renderScreen();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: labels.invite }));
    const input = screen.getByRole('textbox', { name: labels.emailLabel });
    await user.type(input, 'draft@example.com');

    await user.keyboard('{Escape}');
    let confirmation = await screen.findByRole('alertdialog', { name: labels.discardTitle });
    await user.click(within(confirmation).getByRole('button', { name: labels.keepEditing }));
    expect(input).toHaveValue('draft@example.com');

    await user.keyboard('{Escape}');
    confirmation = await screen.findByRole('alertdialog', { name: labels.discardTitle });
    await user.click(within(confirmation).getByRole('button', { name: labels.discardChanges }));
    expect(screen.queryByRole('dialog', { name: labels.inviteTitle })).not.toBeInTheDocument();
  });

  it('초대 재발송의 24시간 한도 오류를 별도 안내한다', async () => {
    renderScreen();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: new RegExp(labels.pendingTab) }));
    mocks.resendMutate.mockImplementation((_variables, options) => {
      options?.onError?.({ status: 429 });
    });

    await user.click(
      within(screen.getByText(pendingInvitation.email).closest('li')!).getByRole('button', {
        name: labels.resend,
      }),
    );

    expect(await screen.findByText(labels.rateLimitedTitle)).toBeVisible();
    expect(screen.getByText(labels.rateLimitedDescription)).toBeVisible();
    expect(screen.queryByRole('button', { name: labels.retry })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: labels.refreshList }));
    expect(mocks.membersRefetch).toHaveBeenCalledTimes(2);
    expect(mocks.invitationsRefetch).toHaveBeenCalledTimes(2);
    expect(mocks.sessionRefetch).toHaveBeenCalledOnce();
  });

  it('수락된 초대 이력도 새 초대 시도로 재발송하고 목록을 갱신한다', async () => {
    const { invalidate } = renderScreen();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: new RegExp(labels.pendingTab) }));
    mocks.resendMutate.mockImplementation((_variables, options) => {
      void options?.onSuccess?.({
        ...acceptedInvitation,
        acceptedAt: null,
        id: 'reissued-invitation',
        status: 'PENDING',
      });
    });

    await user.click(
      within(screen.getByText(acceptedInvitation.email).closest('li')!).getByRole('button', {
        name: labels.resend,
      }),
    );

    expect(mocks.resendMutate).toHaveBeenCalledWith(
      { invitationId: acceptedInvitation.id },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['/api/v1/invitations'] }),
    );
    expect(await screen.findByText(labels.resendSuccess)).toBeVisible();
  });

  it('초대 생성의 24시간 한도 오류를 입력을 유지한 채 안내한다', async () => {
    renderScreen();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: labels.invite }));
    const input = screen.getByRole('textbox', { name: labels.emailLabel });
    await user.type(input, 'limit@example.com');
    mocks.createMutate.mockImplementation((_variables, options) => {
      options?.onError?.({ status: 429 });
    });

    await user.click(screen.getByRole('button', { name: labels.inviteAction }));

    const dialog = screen.getByRole('dialog', { name: labels.inviteTitle });
    expect(within(dialog).getByText(labels.rateLimitedTitle)).toBeVisible();
    expect(input).toHaveValue('limit@example.com');
  });

  it('대기 초대 취소를 확인한 뒤 상태 목록을 갱신한다', async () => {
    const { invalidate } = renderScreen();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: new RegExp(labels.pendingTab) }));
    await user.click(screen.getByRole('button', { name: labels.cancelInvitation }));

    expect(screen.getByRole('alertdialog', { name: labels.cancelInvitationTitle })).toBeVisible();
    mocks.cancelMutate.mockImplementation((_variables, options) => {
      void options?.onSuccess?.();
    });
    await user.click(screen.getByRole('button', { name: labels.cancelInvitationAction }));

    expect(mocks.cancelMutate).toHaveBeenCalledWith(
      { invitationId: pendingInvitation.id },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['/api/v1/invitations'] }),
    );
    expect(await screen.findByText(labels.canceledSuccess)).toBeVisible();
  });

  it('멤버 비활성화를 확인하고 서버가 반환한 미완료 작업만 안내한다', async () => {
    renderScreen();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: labels.deactivate }));

    expect(screen.getByRole('alertdialog', { name: labels.deactivateTitle })).toBeVisible();
    mocks.deactivateMutate.mockImplementation((_variables, options) => {
      options?.onError?.({
        body: {
          code: 'MEMBER_HAS_OPEN_ASSIGNMENTS',
          details: {
            issues: [
              { id: 'issue-id', identifier: 'WEB-12', title: '초대 화면 접근성 보완' },
              { id: 123, identifier: 'INVALID', title: '잘못된 응답' },
            ],
          },
        },
        status: 409,
      });
    });
    await user.click(screen.getByRole('button', { name: labels.deactivateAction }));

    expect(await screen.findByText(labels.blockedTitle)).toBeVisible();
    expect(screen.getByRole('link', { name: /WEB-12.*초대 화면 접근성 보완/ })).toHaveAttribute(
      'href',
      '/issues/WEB-12',
    );
    expect(screen.queryByText('잘못된 응답')).not.toBeInTheDocument();
  });

  it('미완료 작업이 없는 멤버를 비활성화하고 목록을 갱신한다', async () => {
    const { invalidate } = renderScreen();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: labels.deactivate }));
    mocks.deactivateMutate.mockImplementation((_variables, options) => {
      void options?.onSuccess?.();
    });

    await user.click(screen.getByRole('button', { name: labels.deactivateAction }));

    expect(mocks.deactivateMutate).toHaveBeenCalledWith(
      { membershipId: activeMember.id },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['/api/v1/members'] }));
    expect(await screen.findByText(labels.deactivatedSuccess)).toBeVisible();
  });

  it('403은 권한 부족 상태로 표시한다', () => {
    mockQueries({ activeMembers: { error: { status: 403 }, isError: true } });
    renderScreen();

    expect(screen.getByRole('heading', { name: labels.forbiddenTitle })).toBeVisible();
    expect(screen.queryByText(activeMember.user.displayName)).not.toBeInTheDocument();
  });

  it('404는 사라진 워크스페이스 상태와 재시도 동작을 표시한다', async () => {
    mockQueries({ pendingInvitations: { error: { status: 404 }, isError: true } });
    renderScreen();
    const user = userEvent.setup();

    expect(screen.getByRole('heading', { name: labels.notFoundTitle })).toBeVisible();
    await user.click(screen.getByRole('button', { name: labels.retry }));
    expect(mocks.membersRefetch).toHaveBeenCalled();
    expect(mocks.invitationsRefetch).toHaveBeenCalled();
    expect(mocks.sessionRefetch).toHaveBeenCalled();
  });

  it('예상 밖 조회 오류는 입력 화면 대신 복구 가능한 오류 상태를 표시한다', () => {
    mockQueries({ activeMembers: { data: undefined, error: { status: 500 }, isError: true } });
    renderScreen();

    expect(screen.getByRole('alert')).toHaveTextContent(labels.errorTitle);
    expect(screen.getByRole('button', { name: labels.retry })).toBeVisible();
  });
});
