import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getLabelsControllerListQueryKey,
  useLabelsControllerArchive,
  useLabelsControllerCreate,
  useLabelsControllerList,
  useLabelsControllerUpdate,
} from '@rivet/api-client';

import messages from '@/messages/ko.json';

import { type LabelSettingsLabels, LabelSettingsScreen } from './label-settings-screen';

const mocks = vi.hoisted(() => ({
  archiveMutate: vi.fn(),
  archiveReset: vi.fn(),
  createMutate: vi.fn(),
  createReset: vi.fn(),
  refetch: vi.fn(),
  updateMutate: vi.fn(),
  updateReset: vi.fn(),
}));

vi.mock('@rivet/api-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useLabelsControllerArchive: vi.fn(),
  useLabelsControllerCreate: vi.fn(),
  useLabelsControllerList: vi.fn(),
  useLabelsControllerUpdate: vi.fn(),
}));

const labels = messages.Settings.labels satisfies LabelSettingsLabels;
const activeLabel = {
  archived: false,
  color: '#EF6A70',
  id: '953685f0-4921-41cd-8422-d8a1ccc3f547',
  name: '버그',
  version: 1,
};
const archivedLabel = {
  archived: true,
  color: '#8A8F98',
  id: '05ed9724-f207-447d-9f18-7026f493d3fd',
  name: '이전 분류',
  version: 3,
};

type MutationCallbacks = {
  onError?: (error: {
    body: { code: string; fieldErrors: Record<string, string[]> };
    status: number;
  }) => void;
  onSuccess?: () => Promise<void>;
};

let queryClient: QueryClient;
let invalidateQueries: ReturnType<typeof vi.spyOn>;

function mockList({
  data = { items: [activeLabel, archivedLabel], nextCursor: 'next-cursor' },
  error = null,
  isPending = false,
}: {
  data?: { items: Array<typeof activeLabel | typeof archivedLabel>; nextCursor: string | null };
  error?: { body: { code: string }; status: number } | null;
  isPending?: boolean;
} = {}) {
  vi.mocked(useLabelsControllerList).mockReturnValue({
    data: isPending || error ? undefined : data,
    error,
    isError: error !== null,
    isPending,
    refetch: mocks.refetch,
  } as never);
}

function mockMutationHooks({
  archiveError = null,
  createError = null,
  updateError = null,
}: {
  archiveError?: unknown;
  createError?: unknown;
  updateError?: unknown;
} = {}) {
  vi.mocked(useLabelsControllerArchive).mockReturnValue({
    error: archiveError,
    isError: archiveError !== null,
    isPending: false,
    mutate: mocks.archiveMutate,
    reset: mocks.archiveReset,
  } as never);
  vi.mocked(useLabelsControllerCreate).mockReturnValue({
    error: createError,
    isError: createError !== null,
    isPending: false,
    mutate: mocks.createMutate,
    reset: mocks.createReset,
  } as never);
  vi.mocked(useLabelsControllerUpdate).mockReturnValue({
    error: updateError,
    isError: updateError !== null,
    isPending: false,
    mutate: mocks.updateMutate,
    reset: mocks.updateReset,
  } as never);
}

function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function renderScreen() {
  return render(<LabelSettingsScreen labels={labels} />, { wrapper: Wrapper });
}

describe('LabelSettingsScreen', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    mockList();
    mockMutationHooks();
  });

  it('활성·보관 탭, 검색과 커서 페이지 이동을 생성 라벨 훅으로 조회한다', async () => {
    const user = userEvent.setup();
    renderScreen();

    expect(screen.getByRole('heading', { level: 1, name: labels.title })).toBeVisible();
    expect(screen.getByText(activeLabel.name)).toBeVisible();
    expect(screen.queryByText(archivedLabel.name)).not.toBeInTheDocument();
    expect(useLabelsControllerList).toHaveBeenLastCalledWith(
      { archivedOnly: false, includeArchived: false, limit: 20 },
      { query: { retry: false } },
    );

    await user.click(screen.getByRole('button', { name: labels.nextPage }));
    expect(useLabelsControllerList).toHaveBeenLastCalledWith(
      { archivedOnly: false, cursor: 'next-cursor', includeArchived: false, limit: 20 },
      { query: { retry: false } },
    );

    await user.click(screen.getByRole('tab', { name: labels.archivedTab }));
    expect(await screen.findByText(archivedLabel.name)).toBeVisible();
    expect(screen.getByText(labels.archivedNoticeDescription)).toBeVisible();
    expect(useLabelsControllerList).toHaveBeenLastCalledWith(
      { archivedOnly: true, includeArchived: true, limit: 20 },
      { query: { retry: false } },
    );

    await user.type(screen.getByLabelText(labels.searchLabel), '이전');
    await user.click(screen.getByRole('button', { name: labels.search }));
    expect(useLabelsControllerList).toHaveBeenLastCalledWith(
      { archivedOnly: true, includeArchived: true, limit: 20, query: '이전' },
      { query: { retry: false } },
    );
  });

  it('생성 모달에서 8색 팔레트를 제공하고 중복 오류를 이름 입력 가까이에 표시한다', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: labels.createLabel }));
    const dialog = screen.getByRole('dialog', { name: labels.createTitle });
    const nameInput = within(dialog).getByLabelText(labels.nameLabel);
    const colorOptions = within(dialog).getAllByRole('radio');

    await user.type(nameInput, '새 분류');
    expect(colorOptions).toHaveLength(8);
    await user.click(within(dialog).getByRole('radio', { name: labels.colorCyan }));
    expect(within(dialog).getByText('#4BC7C7')).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: labels.createLabel }));

    expect(mocks.createMutate).toHaveBeenCalledWith(
      { data: { color: '#4BC7C7', name: '새 분류' } },
      expect.any(Object),
    );

    act(() => {
      const callbacks = mocks.createMutate.mock.calls[0]?.[1] as MutationCallbacks | undefined;
      callbacks?.onError?.({
        body: { code: 'LABEL_NAME_IN_USE', fieldErrors: {} },
        status: 409,
      });
    });

    expect(await within(dialog).findByText(labels.nameInUse)).toBeVisible();
    expect(nameInput).toHaveValue('새 분류');
    expect(nameInput).toHaveFocus();
  });

  it('편집 저장에 현재 version을 보내고 라벨 query key를 무효화한다', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: `${activeLabel.name} ${labels.edit}` }));
    const dialog = screen.getByRole('dialog', { name: labels.editTitle });
    const nameInput = within(dialog).getByLabelText(labels.nameLabel);
    await user.clear(nameInput);
    await user.type(nameInput, '결함');
    await user.click(within(dialog).getByRole('button', { name: labels.saveChanges }));

    expect(mocks.updateMutate).toHaveBeenCalledWith(
      {
        data: { name: '결함', version: activeLabel.version },
        labelId: activeLabel.id,
      },
      expect.any(Object),
    );

    await act(async () => {
      const callbacks = mocks.updateMutate.mock.calls[0]?.[1] as MutationCallbacks | undefined;
      await callbacks?.onSuccess?.();
    });

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: getLabelsControllerListQueryKey(),
    });
    expect(screen.queryByRole('dialog', { name: labels.editTitle })).not.toBeInTheDocument();
  });

  it('보관 확인 뒤 현재 version으로 요청한다', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: `${activeLabel.name} ${labels.archive}` }));
    const dialog = screen.getByRole('alertdialog', { name: labels.archiveTitle });
    expect(within(dialog).getByText(activeLabel.name)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: labels.archiveAction }));

    expect(mocks.archiveMutate).toHaveBeenCalledWith(
      { data: { version: activeLabel.version }, labelId: activeLabel.id },
      expect.any(Object),
    );
  });

  it('version 충돌은 최신 값 재조회 동작을 모달 안에서 안내한다', async () => {
    const user = userEvent.setup();
    mockMutationHooks({
      updateError: {
        body: { code: 'VERSION_CONFLICT', currentVersion: 2, fieldErrors: {} },
        status: 409,
      },
    });
    renderScreen();

    await user.click(screen.getByRole('button', { name: `${activeLabel.name} ${labels.edit}` }));
    const dialog = screen.getByRole('dialog', { name: labels.editTitle });
    const nameInput = within(dialog).getByLabelText(labels.nameLabel);
    await user.clear(nameInput);
    await user.type(nameInput, '내 변경');
    expect(within(dialog).getByText(labels.conflictDescription)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: labels.reloadLatest }));

    expect(mocks.updateReset).toHaveBeenCalled();
    expect(nameInput).toHaveValue('내 변경');
    expect(screen.getByRole('dialog', { name: labels.editTitle })).toBeVisible();

    await user.click(within(dialog).getByRole('button', { name: labels.saveChanges }));
    expect(mocks.updateMutate).toHaveBeenLastCalledWith(
      {
        data: { name: '내 변경', version: 2 },
        labelId: activeLabel.id,
      },
      expect.any(Object),
    );
  });

  it('기존 사용자 지정 색상은 이름만 편집할 때 보존한다', async () => {
    const customLabel = { ...activeLabel, color: '#123456', name: '사용자 지정' };
    mockList({ data: { items: [customLabel], nextCursor: null } });
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: `${customLabel.name} ${labels.edit}` }));
    const dialog = screen.getByRole('dialog', { name: labels.editTitle });
    expect(
      within(dialog).getByRole('radio', {
        name: `${labels.colorCustom} (${customLabel.color})`,
      }),
    ).toBeChecked();
    expect(within(dialog).getByText(customLabel.color)).toBeVisible();

    const nameInput = within(dialog).getByLabelText(labels.nameLabel);
    await user.clear(nameInput);
    await user.type(nameInput, '이름만 변경');
    await user.click(within(dialog).getByRole('button', { name: labels.saveChanges }));

    expect(mocks.updateMutate).toHaveBeenCalledWith(
      {
        data: { name: '이름만 변경', version: customLabel.version },
        labelId: customLabel.id,
      },
      expect.any(Object),
    );
  });

  it('작성 중 모달을 닫을 때 변경 폐기를 확인한다', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: labels.createLabel }));
    const dialog = screen.getByRole('dialog', { name: labels.createTitle });
    await user.type(within(dialog).getByLabelText(labels.nameLabel), '작성 중');
    await user.keyboard('{Escape}');

    const confirmation = await screen.findByRole('alertdialog', { name: labels.discardTitle });
    await user.click(within(confirmation).getByRole('button', { name: labels.keepEditing }));
    expect(screen.getByRole('dialog', { name: labels.createTitle })).toBeVisible();

    await user.keyboard('{Escape}');
    await user.click(
      within(await screen.findByRole('alertdialog', { name: labels.discardTitle })).getByRole(
        'button',
        { name: labels.discardChanges },
      ),
    );
    expect(screen.queryByRole('dialog', { name: labels.createTitle })).not.toBeInTheDocument();
  });

  it('로딩, 빈 상태, 일반 오류와 403을 각각 복구 가능한 상태로 표시한다', async () => {
    const { rerender } = renderScreen();

    mockList({ isPending: true });
    rerender(<LabelSettingsScreen labels={labels} />);
    expect(screen.getByRole('status')).toHaveTextContent(labels.loading);

    mockList({ data: { items: [], nextCursor: null } });
    rerender(<LabelSettingsScreen labels={labels} />);
    expect(screen.getByText(labels.emptyActiveTitle)).toBeVisible();

    mockList({ error: { body: { code: 'INTERNAL_SERVER_ERROR' }, status: 500 } });
    rerender(<LabelSettingsScreen labels={labels} />);
    expect(screen.getByRole('alert')).toHaveTextContent(labels.errorTitle);
    await userEvent.click(screen.getByRole('button', { name: labels.retry }));
    expect(mocks.refetch).toHaveBeenCalled();

    mockList({ error: { body: { code: 'FORBIDDEN' }, status: 403 } });
    rerender(<LabelSettingsScreen labels={labels} />);
    expect(screen.getByText(labels.permissionTitle)).toBeVisible();
  });
});
