import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getAuthControllerGetSessionQueryKey,
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
  useWorkspacesControllerCreate: vi.fn(),
}));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

const labels = {
  addressPrefix: 'rivet.local/',
  addressPreviewLabel: '워크스페이스 주소 미리보기',
  completedStepStatus: '완료',
  currentStepStatus: '현재 단계',
  description: '팀이 함께 사용할 업무 공간을 만드세요.',
  errorDescription: '입력값을 유지했습니다. 잠시 후 다시 시도해 주세요.',
  errorTitle: '워크스페이스를 만들지 못했습니다',
  inviteStep: '동료 초대',
  nameInvalid: '워크스페이스 이름을 확인해 주세요.',
  nameLabel: '워크스페이스 이름',
  namePlaceholder: '제품 개발팀',
  nameRequired: '워크스페이스 이름을 입력해 주세요.',
  nameTooLong: '워크스페이스 이름은 100자 이하여야 합니다.',
  productName: 'Rivet',
  slugDescription: '영문 소문자, 숫자와 단어 사이 하이픈만 사용할 수 있습니다.',
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

function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('WorkspaceOnboardingScreen', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    mockMutation();
  });

  it('슬러그 형식을 검증하고 입력과 함께 주소 미리보기를 갱신한다', async () => {
    const user = userEvent.setup();
    renderScreen();

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

  it('생성 성공 후 세션을 무효화하고 기본 팀 단계로 이동한다', async () => {
    const user = userEvent.setup();
    render(<WorkspaceOnboardingScreen labels={labels} />, { wrapper: Wrapper });

    await user.type(screen.getByLabelText(labels.nameLabel), '모바일 팀');
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
    const user = userEvent.setup();
    renderScreen();

    const nameInput = screen.getByLabelText(labels.nameLabel);
    const slugInput = screen.getByLabelText(labels.slugLabel);
    await user.type(nameInput, '모바일 팀');
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

  it('제출 중에는 라벨을 유지하고 중복 제출을 막는다', () => {
    mockMutation({ isPending: true });
    renderScreen();

    const submit = screen.getByRole('button', { name: labels.submit });
    expect(submit).toBeDisabled();
    expect(screen.getByText(labels.submitting)).toBeInTheDocument();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('필드에 속하지 않는 실패는 폼 오류로 안내한다', () => {
    mockMutation({
      error: { body: { code: 'INTERNAL_ERROR', fieldErrors: {} } },
    });
    renderScreen();

    expect(screen.getByRole('alert')).toHaveTextContent(labels.errorTitle);
    expect(screen.getByText(labels.errorDescription)).toBeVisible();
  });
});
