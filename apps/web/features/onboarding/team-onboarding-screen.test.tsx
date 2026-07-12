import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthControllerGetSession, useTeamsControllerCreate } from '@rivet/api-client';

import { TeamOnboardingScreen } from './team-onboarding-screen';

type ApiFailure = {
  body: {
    code: string;
    fieldErrors: Record<string, string[]>;
  };
};

type TeamMutationCallbacks = {
  onError?: (error: ApiFailure) => void;
  onSuccess?: () => void;
};

const mocks = vi.hoisted(() => ({
  mutate:
    vi.fn<
      (
        variables: { data: { key: string; memberIds: string[]; name: string } },
        callbacks?: TeamMutationCallbacks,
      ) => void
    >(),
  hardReplace: vi.fn(),
  reset: vi.fn(),
}));

vi.mock('@rivet/api-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuthControllerGetSession: vi.fn(),
  useTeamsControllerCreate: vi.fn(),
}));

const labels = {
  completedStepStatus: '완료',
  creatorDescription: '생성자는 기본 팀 멤버에서 제외할 수 없습니다.',
  creatorTitle: '초기 팀 멤버',
  currentStepStatus: '현재 단계',
  description: '첫 업무를 시작할 기본 팀을 만드세요.',
  errorDescription: '입력값을 유지했습니다. 잠시 후 다시 시도해 주세요.',
  errorTitle: '팀을 만들지 못했습니다',
  inviteStep: '동료 초대',
  issueIdExampleLabel: '표시 ID 예시',
  issueIdPlaceholder: 'TEAM',
  keyFormat: '팀 키는 영문 대문자 2~5자로 입력해 주세요.',
  keyImmutableDescription: '첫 이슈를 만든 뒤에는 팀 키를 변경할 수 없습니다.',
  keyInUse: '이미 사용 중인 팀 키입니다. 다른 키를 입력해 주세요.',
  keyLabel: '팀 키',
  keyPlaceholder: 'WEB',
  nameInUse: '이미 사용 중인 팀 이름입니다. 다른 이름을 입력해 주세요.',
  nameInvalid: '팀 이름을 확인해 주세요.',
  nameLabel: '팀 이름',
  namePlaceholder: '웹',
  nameRequired: '팀 이름을 입력해 주세요.',
  nameTooLong: '팀 이름은 100자 이하여야 합니다.',
  productName: 'Rivet',
  sessionErrorDescription: '활성 관리자 멤버십을 확인한 뒤 다시 시도해 주세요.',
  sessionErrorTitle: '팀을 만들 권한을 확인하지 못했습니다',
  sessionLoadingDescription: '생성자 멤버십을 확인하고 있습니다.',
  sessionLoadingTitle: '팀 설정을 준비하는 중입니다.',
  stepsLabel: '초기 설정 단계',
  submit: '팀 만들기',
  submitting: '팀을 만드는 중입니다.',
  teamStep: '기본 팀',
  title: '기본 팀 만들기',
  workspaceStep: '워크스페이스',
};

const activeAdminSession = {
  authenticated: true as const,
  csrfToken: 'csrf-token',
  membership: { id: 'membership-id', role: 'ADMIN' as const, status: 'ACTIVE' as const },
  onboardingStep: 'CREATE_TEAM' as const,
  user: {
    avatarFileId: null,
    displayName: '김리벳',
    email: 'user@example.com',
    id: 'user-id',
  },
  workspace: { id: 'workspace-id', name: '제품팀', slug: 'product-team' },
};

let queryClient: QueryClient;

function mockSession({
  data = activeAdminSession,
  isError = false,
  isPending = false,
}: {
  data?: typeof activeAdminSession | { authenticated: false };
  isError?: boolean;
  isPending?: boolean;
} = {}) {
  vi.mocked(useAuthControllerGetSession).mockReturnValue({
    data,
    isError,
    isPending,
  } as never);
}

function mockMutation({
  error = null,
  isPending = false,
}: { error?: ApiFailure | null; isPending?: boolean } = {}) {
  vi.mocked(useTeamsControllerCreate).mockReturnValue({
    error,
    isError: error !== null,
    isPending,
    mutate: mocks.mutate,
    reset: mocks.reset,
  } as never);
}

function renderScreen() {
  return render(
    <QueryClientProvider client={queryClient}>
      <TeamOnboardingScreen labels={labels} />
    </QueryClientProvider>,
  );
}

describe('TeamOnboardingScreen', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.stubGlobal('location', {
      pathname: '/ko/onboarding/team',
      replace: mocks.hardReplace,
    });
    mockSession();
    mockMutation();
  });

  it('활성 관리자 생성자를 초기 멤버에 고정하고 성공 후 locale을 보존해 초대 단계로 이동한다', async () => {
    const user = userEvent.setup();
    renderScreen();

    expect(screen.getByRole('heading', { level: 1, name: labels.title })).toBeVisible();
    expect(screen.getByText('김리벳')).toBeVisible();
    await user.type(screen.getByLabelText(labels.nameLabel), '웹');
    await user.type(screen.getByLabelText(labels.keyLabel), 'WEB');
    expect(screen.getByText('WEB-1')).toBeVisible();
    await user.click(screen.getByRole('button', { name: labels.submit }));

    await waitFor(() =>
      expect(mocks.mutate).toHaveBeenCalledWith(
        { data: { key: 'WEB', memberIds: ['membership-id'], name: '웹' } },
        expect.any(Object),
      ),
    );

    act(() => {
      mocks.mutate.mock.calls[0]?.[1]?.onSuccess?.();
    });

    expect(mocks.hardReplace).toHaveBeenCalledWith('/ko/onboarding/invite');
  });

  it('팀 키를 영문 대문자 2~5자로 제한하고 키 불변 안내를 표시한다', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.type(screen.getByLabelText(labels.nameLabel), '웹');
    await user.type(screen.getByLabelText(labels.keyLabel), 'web');
    await user.click(screen.getByRole('button', { name: labels.submit }));

    expect(await screen.findByText(labels.keyFormat)).toBeVisible();
    expect(screen.getByLabelText(labels.keyLabel)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(labels.keyImmutableDescription)).toBeVisible();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it.each([
    ['TEAM_NAME_IN_USE', labels.nameInUse, labels.nameLabel],
    ['TEAM_KEY_IN_USE', labels.keyInUse, labels.keyLabel],
  ])('%s 충돌을 해당 필드 오류로 표시하고 입력값을 유지한다', async (code, message, field) => {
    const user = userEvent.setup();
    renderScreen();

    await user.type(screen.getByLabelText(labels.nameLabel), '웹');
    await user.type(screen.getByLabelText(labels.keyLabel), 'WEB');
    await user.click(screen.getByRole('button', { name: labels.submit }));

    act(() => {
      mocks.mutate.mock.calls[0]?.[1]?.onError?.({ body: { code, fieldErrors: {} } });
    });

    expect(await screen.findByText(message)).toBeVisible();
    expect(screen.getByLabelText(field)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(labels.nameLabel)).toHaveValue('웹');
    expect(screen.getByLabelText(labels.keyLabel)).toHaveValue('WEB');
  });

  it('활성 관리자 멤버십이 없으면 생성 폼 대신 권한 안내를 표시한다', () => {
    mockSession({ data: { authenticated: false } });
    renderScreen();

    expect(screen.getByRole('alert')).toHaveTextContent(labels.sessionErrorTitle);
    expect(screen.queryByRole('button', { name: labels.submit })).not.toBeInTheDocument();
  });

  it('세션 확인 중에는 접근 가능한 진행 상태를 표시한다', () => {
    mockSession({ isPending: true });
    renderScreen();

    expect(screen.getByLabelText(labels.sessionLoadingTitle)).toBeVisible();
    expect(screen.queryByRole('button', { name: labels.submit })).not.toBeInTheDocument();
  });
});
