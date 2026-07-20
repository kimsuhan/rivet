import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnchorHTMLAttributes } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useAuthControllerGetSession,
  useTeamInvitationsControllerCreate,
  useTeamsControllerAddMember,
  useTeamsControllerArchive,
  useTeamsControllerCreate,
  useTeamsControllerGet,
  useTeamsControllerList,
  useTeamsControllerRemoveLeader,
  useTeamsControllerRemoveMember,
  useTeamsControllerSetLeader,
  useTeamsControllerUpdate,
} from '@rivet/api-client';

import messages from '@/messages/ko.json';

import { type TeamSettingsLabels, TeamSettingsScreen } from './team-settings-screen';

type ApiFailure = {
  body: {
    code: string;
    currentVersion?: number;
    fieldErrors: Record<string, string[]>;
    message: string;
    requestId: string;
  };
};

type MutationCallbacks = {
  onError?: (error: ApiFailure) => void;
  onSuccess?: (data?: unknown) => Promise<void> | void;
};

const mocks = vi.hoisted(() => ({
  addMember: vi.fn<(variables: unknown, callbacks?: MutationCallbacks) => void>(),
  archive: vi.fn<(variables: unknown, callbacks?: MutationCallbacks) => void>(),
  create: vi.fn<(variables: unknown, callbacks?: MutationCallbacks) => void>(),
  fetchMoreMembers: vi.fn(),
  memberPagesHook: vi.fn(),
  removeMember: vi.fn<(variables: unknown, callbacks?: MutationCallbacks) => void>(),
  removeLeader: vi.fn<(variables: unknown, callbacks?: MutationCallbacks) => void>(),
  setLeader: vi.fn<(variables: unknown, callbacks?: MutationCallbacks) => void>(),
  invite: vi.fn<(variables: unknown, callbacks?: MutationCallbacks) => void>(),
  update: vi.fn<(variables: unknown, callbacks?: MutationCallbacks) => void>(),
}));

vi.mock('@rivet/api-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuthControllerGetSession: vi.fn(),
  useTeamsControllerAddMember: vi.fn(),
  useTeamsControllerArchive: vi.fn(),
  useTeamsControllerCreate: vi.fn(),
  useTeamsControllerGet: vi.fn(),
  useTeamsControllerList: vi.fn(),
  useTeamsControllerRemoveMember: vi.fn(),
  useTeamsControllerRemoveLeader: vi.fn(),
  useTeamsControllerSetLeader: vi.fn(),
  useTeamsControllerUpdate: vi.fn(),
  useTeamInvitationsControllerCreate: vi.fn(),
}));

vi.mock('@/features/members/member-settings-queries', () => ({
  useMemberPages: mocks.memberPagesHook,
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props} />
  ),
}));

const labels: TeamSettingsLabels = messages.Settings.teams;
const activeAdmin = {
  deactivatedAt: null,
  email: 'admin@example.com',
  id: 'membership-admin',
  joinedAt: '2026-01-01T00:00:00.000Z',
  role: 'ADMIN' as const,
  status: 'ACTIVE' as const,
  user: { avatarFileId: null, displayName: '관리자', id: 'user-admin' },
};
const activeMember = {
  deactivatedAt: null,
  email: 'member@example.com',
  id: 'membership-member',
  joinedAt: '2026-01-02T00:00:00.000Z',
  role: 'MEMBER' as const,
  status: 'ACTIVE' as const,
  user: { avatarFileId: null, displayName: '팀원', id: 'user-member' },
};
const nextPageMember = {
  ...activeMember,
  email: 'next@example.com',
  id: 'membership-next',
  user: { ...activeMember.user, displayName: '다음 페이지 팀원', id: 'user-next' },
};
const activeTeam = {
  archived: false,
  canManage: true,
  description: null,
  id: 'team-active',
  key: 'WEB',
  leaderCount: 0,
  memberCount: 1,
  name: '웹',
  version: 3,
};
const archivedTeam = {
  archived: true,
  canManage: true,
  description: null,
  id: 'team-archived',
  key: 'OLD',
  leaderCount: 0,
  memberCount: 2,
  name: '이전 웹',
  version: 4,
};
const teamDetail = {
  ...activeTeam,
  leaderIds: [],
  memberIds: [activeAdmin.id],
  workflowStates: [],
};

function apiFailure(code: string, currentVersion?: number): ApiFailure {
  return {
    body: {
      code,
      ...(currentVersion ? { currentVersion } : {}),
      fieldErrors: {},
      message: code,
      requestId: 'request-id',
    },
  };
}

let queryClient: QueryClient;

function queryResult(data: unknown) {
  return {
    data,
    error: null,
    isError: false,
    isPending: false,
    refetch: vi.fn(),
  };
}

function mutationResult(mutate: typeof mocks.create) {
  return {
    error: null,
    isError: false,
    isPending: false,
    mutate,
    reset: vi.fn(),
  };
}

function renderScreen(): ReturnType<typeof render> {
  return render(
    <QueryClientProvider client={queryClient}>
      <TeamSettingsScreen labels={labels} />
    </QueryClientProvider>,
  );
}

describe('TeamSettingsScreen', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(useAuthControllerGetSession).mockReturnValue(
      queryResult({
        authenticated: true,
        membership: { id: activeAdmin.id, ledTeamIds: [], role: 'ADMIN', status: 'ACTIVE' },
      }) as never,
    );
    mocks.memberPagesHook.mockReturnValue({
      ...queryResult({
        pageParams: [undefined],
        pages: [{ items: [activeAdmin, activeMember], nextCursor: null }],
      }),
      fetchNextPage: mocks.fetchMoreMembers,
      hasNextPage: false,
      isFetchingNextPage: false,
    } as never);
    vi.mocked(useTeamsControllerList).mockReturnValue(
      queryResult({ items: [activeTeam, archivedTeam], nextCursor: null }) as never,
    );
    vi.mocked(useTeamsControllerGet).mockReturnValue(queryResult(teamDetail) as never);
    vi.mocked(useTeamsControllerArchive).mockReturnValue(mutationResult(mocks.archive) as never);
    vi.mocked(useTeamsControllerCreate).mockReturnValue(mutationResult(mocks.create) as never);
    vi.mocked(useTeamsControllerUpdate).mockReturnValue(mutationResult(mocks.update) as never);
    vi.mocked(useTeamsControllerAddMember).mockReturnValue(
      mutationResult(mocks.addMember) as never,
    );
    vi.mocked(useTeamsControllerRemoveMember).mockReturnValue(
      mutationResult(mocks.removeMember) as never,
    );
    vi.mocked(useTeamsControllerSetLeader).mockReturnValue(
      mutationResult(mocks.setLeader) as never,
    );
    vi.mocked(useTeamsControllerRemoveLeader).mockReturnValue(
      mutationResult(mocks.removeLeader) as never,
    );
    vi.mocked(useTeamInvitationsControllerCreate).mockReturnValue(
      mutationResult(mocks.invite) as never,
    );
  });

  it('활성·보관 팀을 분리하고 워크플로 링크를 제공한다', async () => {
    const user = userEvent.setup();
    renderScreen();

    expect(screen.getByText(activeTeam.name)).toBeVisible();
    expect(screen.getByRole('link', { name: labels.workflow })).toHaveAttribute(
      'href',
      '/settings/teams/team-active/workflow',
    );

    await user.click(screen.getByRole('tab', { name: new RegExp(labels.archivedTab) }));

    expect(screen.getByText(archivedTeam.name)).toBeVisible();
    expect(screen.queryByRole('button', { name: labels.archive })).not.toBeInTheDocument();
  });

  it('팀장은 관리하는 팀만 보고 팀 키와 보관 기능 없이 팀 정보를 편집한다', async () => {
    const user = userEvent.setup();
    vi.mocked(useAuthControllerGetSession).mockReturnValue(
      queryResult({
        authenticated: true,
        membership: {
          id: activeMember.id,
          ledTeamIds: [activeTeam.id],
          role: 'MEMBER',
          status: 'ACTIVE',
        },
      }) as never,
    );
    vi.mocked(useTeamsControllerGet).mockReturnValue(
      queryResult({ ...teamDetail, canManage: true, leaderIds: [activeMember.id] }) as never,
    );

    renderScreen();

    expect(screen.queryByRole('button', { name: labels.create })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: labels.workflow })).toBeVisible();
    await user.click(screen.getByRole('button', { name: labels.edit }));
    expect(await screen.findByLabelText(labels.descriptionLabel)).toBeVisible();
    expect(screen.queryByLabelText(labels.keyLabel)).not.toBeInTheDocument();
    expect(screen.queryByText(labels.leadersLabel)).not.toBeInTheDocument();
  });

  it('관리자는 팀 멤버를 팀장으로 지정한다', async () => {
    const user = userEvent.setup();
    vi.mocked(useTeamsControllerGet).mockReturnValue(
      queryResult({
        ...teamDetail,
        leaderIds: [],
        memberIds: [activeAdmin.id, activeMember.id],
      }) as never,
    );

    renderScreen();
    await user.click(screen.getByRole('button', { name: labels.edit }));
    await user.click(
      await screen.findByRole('checkbox', {
        name: new RegExp(activeMember.user.displayName + '.*' + labels.setLeader),
      }),
    );

    expect(mocks.setLeader).toHaveBeenCalledWith(
      { membershipId: activeMember.id, teamId: activeTeam.id },
      expect.any(Object),
    );
  });

  it('관리 중인 팀으로 이메일 초대를 보낸다', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: labels.invite }));
    const dialog = await screen.findByRole('dialog', { name: labels.inviteTitle });
    await user.type(within(dialog).getByLabelText(labels.inviteEmailLabel), 'new@example.com');
    await user.click(within(dialog).getByRole('button', { name: labels.inviteSend }));

    expect(mocks.invite).toHaveBeenCalledWith(
      { data: { emails: ['new@example.com'] }, teamId: activeTeam.id },
      expect.any(Object),
    );
  });

  it('팀 생성 시 현재 관리자를 초기 멤버로 고정하고 선택한 활성 멤버를 전송한다', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: labels.create }));

    const dialog = await screen.findByRole('dialog');
    const adminCheckbox = within(dialog).getByRole('checkbox', { name: /관리자/ });
    expect(adminCheckbox).toBeChecked();
    expect(adminCheckbox).toHaveAttribute('aria-disabled', 'true');
    await user.click(within(dialog).getByRole('checkbox', { name: /팀원/ }));
    await user.type(within(dialog).getByLabelText(labels.nameLabel), '모바일');
    const keyInput = within(dialog).getByLabelText(labels.keyLabel);
    await user.clear(keyInput);
    await user.type(keyInput, 'APP');
    await user.click(within(dialog).getByRole('button', { name: labels.create }));

    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(
        {
          data: {
            key: 'APP',
            memberIds: [activeAdmin.id, activeMember.id],
            name: '모바일',
          },
        },
        expect.any(Object),
      ),
    );
  });

  it('다음 멤버 페이지를 불러와 팀 선택기에 이어서 표시한다', async () => {
    let loaded = false;
    mocks.fetchMoreMembers.mockImplementation(() => {
      loaded = true;
    });
    mocks.memberPagesHook.mockImplementation(
      () =>
        ({
          ...queryResult({
            pageParams: loaded ? [undefined, 'member-cursor'] : [undefined],
            pages: [
              { items: [activeAdmin, activeMember], nextCursor: 'member-cursor' },
              ...(loaded ? [{ items: [nextPageMember], nextCursor: null }] : []),
            ],
          }),
          fetchNextPage: mocks.fetchMoreMembers,
          hasNextPage: !loaded,
          isFetchingNextPage: false,
        }) as never,
    );
    const user = userEvent.setup();
    const view = renderScreen();

    await user.click(screen.getByRole('button', { name: labels.create }));
    expect(screen.queryByRole('checkbox', { name: /다음 페이지 팀원/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: labels.loadMoreMembers }));
    expect(mocks.fetchMoreMembers).toHaveBeenCalledOnce();

    view.rerender(
      <QueryClientProvider client={queryClient}>
        <TeamSettingsScreen labels={labels} />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('checkbox', { name: /다음 페이지 팀원/ })).toBeVisible();
  });

  it('팀 생성 서버 필드 오류를 입력과 연결하고 해당 필드로 포커스한다', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole('button', { name: labels.create }));
    const dialog = await screen.findByRole('dialog', { name: labels.createTitle });
    const nameInput = within(dialog).getByLabelText(labels.nameLabel);
    await user.type(nameInput, '중복 팀');
    await user.type(within(dialog).getByLabelText(labels.keyLabel), 'DUP');
    await user.click(within(dialog).getByRole('button', { name: labels.create }));

    act(() => {
      mocks.create.mock.calls[0]?.[1]?.onError?.(apiFailure('TEAM_NAME_IN_USE'));
    });

    expect(await within(dialog).findByText(labels.nameInUse)).toHaveAttribute(
      'id',
      'create-team-name-error',
    );
    expect(nameInput).toHaveAttribute('aria-errormessage', 'create-team-name-error');
    expect(nameInput).toHaveFocus();
  });

  it('팀 이름에서 키를 자동 생성하고 직접 입력한 키는 영문 대문자로 정규화한다', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole('button', { name: labels.create }));
    const dialog = await screen.findByRole('dialog', { name: labels.createTitle });
    const nameInput = within(dialog).getByLabelText(labels.nameLabel);
    const keyInput = within(dialog).getByLabelText(labels.keyLabel);

    await user.type(nameInput, 'Product Design');
    expect(keyInput).toHaveValue('PD');

    await user.clear(keyInput);
    await user.type(keyInput, 'p3l-a한글n');
    expect(keyInput).toHaveValue('PLAN');

    await user.clear(nameInput);
    await user.type(nameInput, '다른 팀');
    expect(keyInput).toHaveValue('PLAN');
  });

  it('팀 생성·편집의 저장하지 않은 변경을 닫기 전에 확인한다', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: labels.create }));
    let formDialog = await screen.findByRole('dialog', { name: labels.createTitle });
    await user.type(within(formDialog).getByLabelText(labels.nameLabel), '작성 중');
    await user.keyboard('{Escape}');
    let confirmation = await screen.findByRole('alertdialog', { name: labels.discardTitle });
    await user.click(within(confirmation).getByRole('button', { name: labels.keepEditing }));
    expect(formDialog).toBeVisible();
    await user.keyboard('{Escape}');
    confirmation = await screen.findByRole('alertdialog', { name: labels.discardTitle });
    await user.click(within(confirmation).getByRole('button', { name: labels.discardChanges }));
    expect(screen.queryByRole('dialog', { name: labels.createTitle })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: labels.edit }));
    formDialog = await screen.findByRole('dialog', { name: labels.editTitle });
    const editName = within(formDialog).getByLabelText(labels.nameLabel);
    await user.clear(editName);
    await user.type(editName, '바뀐 이름');
    await user.keyboard('{Escape}');
    confirmation = await screen.findByRole('alertdialog', { name: labels.discardTitle });
    await user.click(within(confirmation).getByRole('button', { name: labels.discardChanges }));
    expect(screen.queryByRole('dialog', { name: labels.editTitle })).not.toBeInTheDocument();
  });

  it('팀 편집 서버 필드 오류를 입력과 연결하고 해당 필드로 포커스한다', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole('button', { name: labels.edit }));
    const dialog = await screen.findByRole('dialog', { name: labels.editTitle });
    const nameInput = within(dialog).getByLabelText(labels.nameLabel);
    await user.clear(nameInput);
    await user.type(nameInput, '중복 팀');
    await user.click(within(dialog).getByRole('button', { name: labels.save }));

    act(() => {
      mocks.update.mock.calls[0]?.[1]?.onError?.(apiFailure('TEAM_NAME_IN_USE'));
    });

    expect(await within(dialog).findByText(labels.nameInUse)).toHaveAttribute(
      'id',
      'edit-team-name-error',
    );
    expect(nameInput).toHaveAttribute('aria-errormessage', 'edit-team-name-error');
    expect(nameInput).toHaveFocus();
  });

  it('잠긴 팀 키를 원래 값으로 되돌리고 이름만 다시 저장할 수 있게 안내한다', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: labels.edit }));
    const keyInput = await screen.findByLabelText(labels.keyLabel);
    await user.clear(keyInput);
    await user.type(keyInput, 'NEW');
    await user.click(screen.getByRole('button', { name: labels.save }));

    act(() => {
      mocks.update.mock.calls[0]?.[1]?.onError?.(apiFailure('TEAM_KEY_LOCKED'));
    });

    expect(await screen.findByText(labels.keyLockedTitle)).toBeVisible();
    expect(keyInput).toBeDisabled();
    expect(keyInput).toHaveValue(activeTeam.key);

    const nameInput = screen.getByLabelText(labels.nameLabel);
    await user.clear(nameInput);
    await user.type(nameInput, '새 팀 이름');
    await user.click(screen.getByRole('button', { name: labels.save }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
    expect(mocks.update.mock.calls[1]?.[0]).toEqual({
      data: { name: '새 팀 이름', version: activeTeam.version },
      teamId: activeTeam.id,
    });
  });

  it('stale 상세이 갱신되어도 편집 시작 version을 유지해 동시 변경을 덮어쓰지 않는다', async () => {
    const user = userEvent.setup();
    const view = renderScreen();
    await user.click(screen.getByRole('button', { name: labels.edit }));
    const dialog = await screen.findByRole('dialog', { name: labels.editTitle });

    vi.mocked(useTeamsControllerGet).mockReturnValue(
      queryResult({ ...teamDetail, name: '다른 관리자의 변경', version: 4 }) as never,
    );
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <TeamSettingsScreen labels={labels} />
      </QueryClientProvider>,
    );

    const nameInput = within(dialog).getByLabelText(labels.nameLabel);
    await user.clear(nameInput);
    await user.type(nameInput, '내 변경');
    await user.click(within(dialog).getByRole('button', { name: labels.save }));

    expect(mocks.update).toHaveBeenCalledWith(
      {
        data: { name: '내 변경', version: activeTeam.version },
        teamId: activeTeam.id,
      },
      expect.any(Object),
    );
  });

  it('다음 멤버 페이지 실패를 선택기 안에서 안내하고 재시도한다', async () => {
    mocks.memberPagesHook.mockReturnValue({
      ...queryResult({ pages: [{ items: [activeAdmin, activeMember] }] }),
      fetchNextPage: mocks.fetchMoreMembers,
      hasNextPage: true,
      isFetchNextPageError: true,
      isFetchingNextPage: false,
    } as never);
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole('button', { name: labels.create }));

    expect(await screen.findByText(labels.loadMoreMembersErrorTitle)).toBeVisible();
    await user.click(screen.getByRole('button', { name: labels.retry }));
    expect(mocks.fetchMoreMembers).toHaveBeenCalledOnce();
  });

  it('다음 멤버 페이지 재시도 중에는 중복 요청을 막고 진행 상태를 표시한다', async () => {
    mocks.memberPagesHook.mockReturnValue({
      ...queryResult({ pages: [{ items: [activeAdmin, activeMember] }] }),
      fetchNextPage: mocks.fetchMoreMembers,
      hasNextPage: true,
      isFetchNextPageError: true,
      isFetchingNextPage: true,
    } as never);
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole('button', { name: labels.create }));

    const retry = await screen.findByRole('button', { name: labels.retry });
    expect(retry).toBeDisabled();
    expect(retry.querySelector('[data-slot="spinner"]')).toBeInTheDocument();
  });

  it('팀 상세 조회 실패를 편집 대화상자에서 다시 시도하거나 닫을 수 있다', async () => {
    const refetch = vi.fn();
    vi.mocked(useTeamsControllerGet).mockReturnValue({
      ...queryResult(undefined),
      error: apiFailure('UNEXPECTED_ERROR'),
      isError: true,
      refetch,
    } as never);
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: labels.edit }));

    const dialog = await screen.findByRole('dialog', { name: labels.errorTitle });
    expect(within(dialog).getByText(labels.errorDescription)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: labels.retry }));
    expect(refetch).toHaveBeenCalledOnce();

    await user.click(within(dialog).getByRole('button', { name: labels.close }));
    expect(screen.queryByRole('dialog', { name: labels.errorTitle })).not.toBeInTheDocument();
  });

  it('팀 멤버 제거는 영향과 복구 가능성을 확인한 뒤 실행한다', async () => {
    vi.mocked(useTeamsControllerGet).mockReturnValue(
      queryResult({ ...teamDetail, memberIds: [activeAdmin.id, activeMember.id] }) as never,
    );
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: labels.edit }));
    await user.click((await screen.findAllByRole('checkbox', { name: /팀원/ }))[0]!);

    expect(mocks.removeMember).not.toHaveBeenCalled();
    expect(await screen.findByText(labels.removeMemberTitle)).toBeVisible();
    expect(screen.getByText(/팀원 님은 이 팀의 새 작업에 배정할 수 없게 됩니다/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: labels.removeMemberAction }));

    expect(mocks.removeMember).toHaveBeenCalledWith(
      { membershipId: activeMember.id, teamId: activeTeam.id },
      expect.any(Object),
    );
  });

  it('미완료 이슈가 있는 팀의 보관 제한을 대화상자 안에 표시한다', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: labels.archive }));
    expect(
      screen.getByText(labels.archiveDescription.replace('{team}', activeTeam.name)),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: labels.archiveConfirm }));

    act(() => {
      mocks.archive.mock.calls[0]?.[1]?.onError?.(apiFailure('TEAM_HAS_OPEN_ISSUES'));
    });

    expect(await screen.findByText(labels.archiveBlockedTitle)).toBeVisible();
    expect(screen.getByText(labels.archiveBlockedDescription)).toBeVisible();
  });
});
