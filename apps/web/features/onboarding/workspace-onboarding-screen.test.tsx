import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getAuthControllerGetSessionQueryKey,
  useAuthControllerGetSession,
  useWorkspacesControllerCreate,
} from '@rivet/api-client';

import { WorkspaceOnboardingScreen } from './workspace-onboarding-screen';

type ApiFailure = {
  body: {
    code: string;
    fieldErrors: Record<string, string[]>;
  };
};

type WorkspaceMutationCallbacks = {
  onError?: (error: ApiFailure) => void;
  onSuccess?: () => Promise<void>;
};

const mocks = vi.hoisted(() => ({
  mutate:
    vi.fn<
      (
        variables: { data: { name: string; slug: string } },
        callbacks?: WorkspaceMutationCallbacks,
      ) => void
    >(),
  replace: vi.fn(),
  reset: vi.fn(),
}));

vi.mock('@rivet/api-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuthControllerGetSession: vi.fn(),
  useWorkspacesControllerCreate: vi.fn(),
}));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

const labels = {
  addressPrefix: 'rivet.local/',
  addressPreviewLabel: '워크스페이스 주소 미리보기',
  backToChoices: '시작 방법 다시 선택',
  completedStepStatus: '완료',
  creationChoiceDescription:
    '새로운 팀을 시작합니다. 만든 뒤에는 다른 워크스페이스의 초대를 수락할 수 없어요.',
  creationChoiceTitle: '새 워크스페이스 만들기',
  creationWarningDescription:
    '이 워크스페이스를 만들면 다른 워크스페이스의 초대를 수락할 수 없습니다.',
  creationWarningTitle: '워크스페이스는 한 곳에만 참여할 수 있어요',
  currentStepStatus: '현재 단계',
  description: '팀이 함께 사용할 업무 공간을 만드세요.',
  entryDescription: 'Rivet에서는 하나의 워크스페이스에만 참여할 수 있어요.',
  entryTitle: '어떻게 시작할까요?',
  errorDescription: '입력값을 유지했습니다. 잠시 후 다시 시도해 주세요.',
  errorTitle: '워크스페이스를 만들지 못했습니다',
  invitationChoiceDescription:
    '초대 메일을 받았거나 팀 관리자의 초대를 기다리고 있다면 선택하세요.',
  invitationChoiceTitle: '초대받은 워크스페이스에 참여하기',
  inviteStep: '동료 초대',
  nameInvalid: '워크스페이스 이름을 확인해 주세요.',
  nameLabel: '워크스페이스 이름',
  namePlaceholder: '제품 개발팀',
  nameRequired: '워크스페이스 이름을 입력해 주세요.',
  nameTooLong: '워크스페이스 이름은 100자 이하여야 합니다.',
  productName: 'Rivet',
  slugDescription:
    '이름을 바탕으로 자동 생성됩니다. 필요하면 영문 소문자, 숫자와 단어 사이 하이픈으로 수정할 수 있습니다.',
  slugExample: 'product-team',
  slugFormat: '영문 소문자, 숫자와 단어 사이 하이픈으로 입력해 주세요.',
  slugInUse: '이미 사용 중인 주소입니다. 다른 슬러그를 입력해 주세요.',
  slugInvalid: '워크스페이스 슬러그를 확인해 주세요.',
  slugLabel: '슬러그',
  slugPlaceholder: 'product-team',
  slugTooLong: '슬러그는 50자 이하여야 합니다.',
  slugTooShort: '슬러그는 3자 이상이어야 합니다.',
  stepsLabel: '초기 설정 단계',
  submit: '워크스페이스 만들기',
  submitting: '워크스페이스를 만드는 중입니다.',
  teamStep: '기본 팀',
  title: '워크스페이스 만들기',
  waitingDescription:
    '지금 워크스페이스를 만들지 않아도 괜찮아요. 아래 이메일로 초대받으면 메일의 링크를 열어 참여하세요.',
  waitingEmailLabel: '초대를 받을 이메일',
  waitingEmailUnavailable: '현재 로그인한 이메일을 확인하지 못했습니다.',
  waitingHelpDescription: '초대자가 위 이메일 주소를 사용했는지 확인하고 스팸함도 확인해 주세요.',
  waitingHelpTitle: '초대 메일이 오지 않았나요?',
  waitingTitle: '초대를 기다리고 있어요',
  workspaceStep: '워크스페이스',
};

let queryClient: QueryClient;
let invalidateQueries: ReturnType<typeof vi.spyOn>;

function mockMutation({
  error = null,
  isPending = false,
}: { error?: ApiFailure | null; isPending?: boolean } = {}) {
  vi.mocked(useWorkspacesControllerCreate).mockReturnValue({
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
      <WorkspaceOnboardingScreen labels={labels} />
    </QueryClientProvider>,
  );
}

async function openCreateForm() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: labels.creationChoiceTitle }));
  return user;
}

function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('WorkspaceOnboardingScreen', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    vi.mocked(useAuthControllerGetSession).mockReturnValue({
      data: {
        authenticated: true,
        csrfToken: 'csrf-token',
        membership: null,
        onboardingStep: 'CREATE_WORKSPACE',
        user: {
          avatarFileId: null,
          displayName: '가입 사용자',
          email: 'user@example.com',
          id: 'user-id',
        },
        workspace: null,
      },
    } as never);
    mockMutation();
  });

  it('초대 대기와 새 워크스페이스 생성 경로를 먼저 선택하게 한다', async () => {
    const user = userEvent.setup();
    renderScreen();

    expect(screen.getByRole('heading', { level: 1, name: labels.entryTitle })).toBeVisible();
    expect(screen.getByRole('navigation', { name: labels.stepsLabel })).toBeVisible();
    expect(screen.queryByLabelText(labels.nameLabel)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: labels.invitationChoiceTitle }));

    expect(screen.getByRole('heading', { level: 1, name: labels.waitingTitle })).toBeVisible();
    expect(screen.getByText('user@example.com')).toBeVisible();
    expect(screen.getByText(labels.waitingHelpTitle)).toBeVisible();
    expect(screen.getByText(labels.waitingHelpDescription)).toBeVisible();
    expect(screen.getByRole('navigation', { name: labels.stepsLabel })).toBeVisible();

    await user.click(screen.getByRole('button', { name: labels.creationChoiceTitle }));

    expect(screen.getByRole('heading', { level: 1, name: labels.title })).toBeVisible();
    expect(screen.getByText(labels.creationWarningDescription)).toBeVisible();
    expect(screen.getByRole('navigation', { name: labels.stepsLabel })).toBeVisible();
  });

  it('초대 대기와 생성 화면에서 시작 방법 선택 버튼을 콘텐츠보다 먼저 제공한다', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: labels.invitationChoiceTitle }));

    const waitingBackButton = screen.getByRole('button', { name: labels.backToChoices });
    const waitingHeading = screen.getByRole('heading', { level: 1, name: labels.waitingTitle });
    expect(waitingBackButton.compareDocumentPosition(waitingHeading)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    await user.click(screen.getByRole('button', { name: labels.creationChoiceTitle }));

    const createBackButton = screen.getByRole('button', { name: labels.backToChoices });
    const createHeading = screen.getByRole('heading', { level: 1, name: labels.title });
    expect(createBackButton.compareDocumentPosition(createHeading)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('슬러그 형식을 검증하고 입력과 함께 주소 미리보기를 갱신한다', async () => {
    renderScreen();
    const user = await openCreateForm();

    expect(screen.getByRole('heading', { level: 1, name: labels.title })).toBeVisible();
    await user.click(screen.getByRole('button', { name: labels.submit }));

    expect(await screen.findByText(labels.nameRequired)).toBeVisible();
    expect(screen.getByText(labels.slugTooShort)).toBeVisible();
    expect(screen.getByLabelText(labels.nameLabel)).toHaveAttribute('aria-invalid', 'true');

    await user.type(screen.getByLabelText(labels.slugLabel), 'Bad_slug');
    await user.click(screen.getByRole('button', { name: labels.submit }));

    expect(await screen.findByText(labels.slugFormat)).toBeVisible();
    expect(mocks.mutate).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText(labels.slugLabel));
    await user.type(screen.getByLabelText(labels.slugLabel), 'mobile-team');
    expect(await screen.findByText(`${window.location.host}/mobile-team`)).toBeVisible();
  });

  it('워크스페이스 이름으로 슬러그를 자동 생성하고 이름 변경과 함께 갱신한다', async () => {
    renderScreen();
    const user = await openCreateForm();

    await user.type(screen.getByLabelText(labels.nameLabel), 'Product Design Team');

    expect(screen.getByLabelText(labels.slugLabel)).toHaveValue('product-design-team');
    expect(await screen.findByText(`${window.location.host}/product-design-team`)).toBeVisible();

    await user.clear(screen.getByLabelText(labels.nameLabel));
    await user.type(screen.getByLabelText(labels.nameLabel), 'Rivet Web');

    expect(screen.getByLabelText(labels.slugLabel)).toHaveValue('rivet-web');
  });

  it('한글 이름에는 유효한 기본 슬러그를 생성하고 직접 수정한 값은 덮어쓰지 않는다', async () => {
    renderScreen();
    const user = await openCreateForm();
    const nameInput = screen.getByLabelText(labels.nameLabel);
    const slugInput = screen.getByLabelText(labels.slugLabel);

    await user.type(nameInput, '제품 개발팀');

    expect((slugInput as HTMLInputElement).value).toMatch(/^workspace-[a-z0-9]{6}$/);

    await user.clear(slugInput);
    await user.type(slugInput, 'custom-workspace');
    await user.clear(nameInput);
    await user.type(nameInput, '다른 팀 이름');

    expect(slugInput).toHaveValue('custom-workspace');
  });

  it('시작 방법을 다시 확인해도 작성 중인 생성 입력을 유지한다', async () => {
    renderScreen();
    const user = await openCreateForm();

    await user.type(screen.getByLabelText(labels.nameLabel), '작성 중인 팀');
    await user.click(screen.getByRole('button', { name: labels.backToChoices }));
    await user.click(screen.getByRole('button', { name: labels.creationChoiceTitle }));

    expect(screen.getByLabelText(labels.nameLabel)).toHaveValue('작성 중인 팀');
  });

  it('생성 성공 후 세션을 무효화하고 기본 팀 단계로 이동한다', async () => {
    render(<WorkspaceOnboardingScreen labels={labels} />, { wrapper: Wrapper });
    const user = await openCreateForm();

    await user.type(screen.getByLabelText(labels.nameLabel), '모바일 팀');
    await user.clear(screen.getByLabelText(labels.slugLabel));
    await user.type(screen.getByLabelText(labels.slugLabel), 'mobile-team');
    await user.click(screen.getByRole('button', { name: labels.submit }));

    await waitFor(() =>
      expect(mocks.mutate).toHaveBeenCalledWith(
        { data: { name: '모바일 팀', slug: 'mobile-team' } },
        expect.any(Object),
      ),
    );

    await act(async () => {
      await mocks.mutate.mock.calls[0]?.[1]?.onSuccess?.();
    });

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: getAuthControllerGetSessionQueryKey(),
    });
    expect(mocks.replace).toHaveBeenCalledWith('/onboarding/team');
  });

  it('중복 슬러그를 필드 오류로 표시하고 입력값을 유지한다', async () => {
    renderScreen();
    const user = await openCreateForm();

    const nameInput = screen.getByLabelText(labels.nameLabel);
    const slugInput = screen.getByLabelText(labels.slugLabel);
    await user.type(nameInput, '모바일 팀');
    await user.clear(slugInput);
    await user.type(slugInput, 'mobile-team');
    await user.click(screen.getByRole('button', { name: labels.submit }));

    act(() => {
      mocks.mutate.mock.calls[0]?.[1]?.onError?.({
        body: { code: 'WORKSPACE_SLUG_IN_USE', fieldErrors: {} },
      });
    });

    expect(await screen.findByText(labels.slugInUse)).toBeVisible();
    expect(slugInput).toHaveValue('mobile-team');
    expect(slugInput).toHaveAttribute('aria-invalid', 'true');
    expect(nameInput).toHaveValue('모바일 팀');
  });

  it('제출 중에는 라벨을 유지하고 중복 제출을 막는다', async () => {
    mockMutation({ isPending: true });
    renderScreen();
    await openCreateForm();

    const submit = screen.getByRole('button', { name: labels.submit });
    expect(submit).toBeDisabled();
    expect(screen.getByText(labels.submitting)).toBeInTheDocument();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('필드에 속하지 않는 실패는 폼 오류로 안내한다', async () => {
    mockMutation({
      error: { body: { code: 'INTERNAL_ERROR', fieldErrors: {} } },
    });
    renderScreen();
    await openCreateForm();

    expect(screen.getByText(labels.errorTitle).closest('[role="alert"]')).toHaveTextContent(
      labels.errorTitle,
    );
    expect(screen.getByText(labels.errorDescription)).toBeVisible();
  });
});
