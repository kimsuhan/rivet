import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnchorHTMLAttributes } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useTeamsControllerCreateWorkflowState,
  useTeamsControllerDeleteWorkflowState,
  useTeamsControllerDisableWorkflowState,
  useTeamsControllerList,
  useTeamsControllerListWorkflowStates,
  useTeamsControllerReorderWorkflowStates,
  useTeamsControllerRestoreWorkflowState,
  useTeamsControllerSetDefaultWorkflowState,
  useTeamsControllerUpdateWorkflowState,
} from '@rivet/api-client';

import messages from '@/messages/ko.json';

import { type WorkflowSettingsLabels, WorkflowSettingsScreen } from './workflow-settings-screen';

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
  onSuccess?: (data: unknown) => Promise<void> | void;
};

const mocks = vi.hoisted(() => ({
  create: vi.fn<(variables: unknown, callbacks?: MutationCallbacks) => void>(),
  deleteState: vi.fn<(variables: unknown, callbacks?: MutationCallbacks) => void>(),
  disable: vi.fn<(variables: unknown, callbacks?: MutationCallbacks) => void>(),
  restore: vi.fn<(variables: unknown, callbacks?: MutationCallbacks) => void>(),
  setDefault: vi.fn<(variables: unknown, callbacks?: MutationCallbacks) => void>(),
  rename: vi.fn<(variables: unknown, callbacks?: MutationCallbacks) => void>(),
  reorder: vi.fn<(variables: unknown, callbacks?: MutationCallbacks) => void>(),
  replace: vi.fn(),
}));

vi.mock('@rivet/api-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTeamsControllerCreateWorkflowState: vi.fn(),
  useTeamsControllerDeleteWorkflowState: vi.fn(),
  useTeamsControllerDisableWorkflowState: vi.fn(),
  useTeamsControllerList: vi.fn(),
  useTeamsControllerListWorkflowStates: vi.fn(),
  useTeamsControllerReorderWorkflowStates: vi.fn(),
  useTeamsControllerRestoreWorkflowState: vi.fn(),
  useTeamsControllerSetDefaultWorkflowState: vi.fn(),
  useTeamsControllerUpdateWorkflowState: vi.fn(),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props} />
  ),
  useRouter: () => ({ replace: mocks.replace }),
}));

const labels: WorkflowSettingsLabels = messages.Settings.workflow;
const team = {
  archived: false,
  canManage: true,
  description: null,
  id: 'team-web',
  key: 'WEB',
  leaderCount: 1,
  memberCount: 3,
  name: '웹',
  version: 2,
};
const states = [
  {
    category: 'BACKLOG' as const,
    color: null,
    disabledAt: null,
    id: 'state-backlog',
    isDefault: true,
    name: '미분류',
    position: 0,
    version: 1,
  },
  {
    category: 'BACKLOG' as const,
    color: 'BROWN' as const,
    disabledAt: null,
    id: 'state-paused',
    isDefault: false,
    name: '보류',
    position: 1,
    version: 6,
  },
  {
    category: 'UNSTARTED' as const,
    color: null,
    disabledAt: null,
    id: 'state-todo',
    isDefault: false,
    name: '할 일',
    position: 2,
    version: 2,
  },
  {
    category: 'STARTED' as const,
    color: 'INDIGO' as const,
    disabledAt: null,
    id: 'state-doing',
    isDefault: false,
    name: '진행 중',
    position: 3,
    version: 3,
  },
  {
    category: 'STARTED' as const,
    color: 'TEAL' as const,
    disabledAt: null,
    id: 'state-review',
    isDefault: false,
    name: '검토',
    position: 4,
    version: 4,
  },
  {
    category: 'COMPLETED' as const,
    color: null,
    disabledAt: null,
    id: 'state-done',
    isDefault: false,
    name: '완료',
    position: 5,
    version: 5,
  },
  {
    category: 'CANCELED' as const,
    color: 'RED' as const,
    disabledAt: null,
    id: 'state-canceled',
    isDefault: false,
    name: '취소',
    position: 6,
    version: 7,
  },
];

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

function queryResult(data: unknown) {
  return {
    data,
    error: null,
    isError: false,
    isPending: false,
    refetch: vi.fn(),
  };
}

function mutationResult(mutate: typeof mocks.reorder) {
  return { isPending: false, mutate };
}

let queryClient: QueryClient;
let invalidateQueries: ReturnType<typeof vi.spyOn>;

function renderScreen() {
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkflowSettingsScreen labels={labels} teamId={team.id} />
    </QueryClientProvider>,
  );
}

function stateRow(name: string): HTMLLIElement {
  const row = screen.getByText(name, { selector: 'li > span' }).closest('li');
  if (!(row instanceof HTMLLIElement)) throw new Error(`${name} 상태 행을 찾을 수 없습니다.`);
  return row;
}

describe('WorkflowSettingsScreen', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    vi.mocked(useTeamsControllerList).mockReturnValue(
      queryResult({ items: [team], nextCursor: null }) as never,
    );
    vi.mocked(useTeamsControllerListWorkflowStates).mockReturnValue(
      queryResult({ items: states, nextCursor: null }) as never,
    );
    vi.mocked(useTeamsControllerReorderWorkflowStates).mockReturnValue(
      mutationResult(mocks.reorder) as never,
    );
    vi.mocked(useTeamsControllerCreateWorkflowState).mockReturnValue(
      mutationResult(mocks.create) as never,
    );
    vi.mocked(useTeamsControllerSetDefaultWorkflowState).mockReturnValue(
      mutationResult(mocks.setDefault) as never,
    );
    vi.mocked(useTeamsControllerUpdateWorkflowState).mockReturnValue(
      mutationResult(mocks.rename) as never,
    );
    vi.mocked(useTeamsControllerDeleteWorkflowState).mockReturnValue(
      mutationResult(mocks.deleteState) as never,
    );
    vi.mocked(useTeamsControllerDisableWorkflowState).mockReturnValue(
      mutationResult(mocks.disable) as never,
    );
    vi.mocked(useTeamsControllerRestoreWorkflowState).mockReturnValue(
      mutationResult(mocks.restore) as never,
    );
  });

  it('같은 범주 안에서 위 버튼으로 상태 순서를 교체한다', async () => {
    const user = userEvent.setup();
    renderScreen();

    expect(screen.getByRole('heading', { name: labels.categoryStarted })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '검토 ' + labels.moveUp }));

    expect(mocks.reorder).toHaveBeenCalledWith(
      {
        data: {
          states: [
            { id: 'state-backlog', version: 1 },
            { id: 'state-paused', version: 6 },
            { id: 'state-todo', version: 2 },
            { id: 'state-review', version: 4 },
            { id: 'state-doing', version: 3 },
            { id: 'state-done', version: 5 },
            { id: 'state-canceled', version: 7 },
          ],
        },
        teamId: team.id,
      },
      expect.any(Object),
    );
  });

  it('범주를 고정 순서로 한 번씩 표시하고 범주 경계를 넘어 이동하지 않는다', async () => {
    const user = userEvent.setup();
    renderScreen();

    expect(screen.getAllByRole('heading', { name: labels.categoryBacklog })).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(5);
    expect(screen.getByRole('button', { name: '미분류 ' + labels.moveUp })).toBeDisabled();
    expect(screen.getByRole('button', { name: '보류 ' + labels.moveDown })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '보류 ' + labels.moveDown }));
    expect(mocks.reorder).not.toHaveBeenCalled();
  });

  it('진행 중 상태의 범주 내 순서에 따라 파이 진행도를 계산한다', () => {
    renderScreen();

    const doingProgress = stateRow('진행 중')
      .querySelector('[data-workflow-state-progress]')
      ?.getAttribute('data-workflow-state-progress');
    const reviewProgress = stateRow('검토')
      .querySelector('[data-workflow-state-progress]')
      ?.getAttribute('data-workflow-state-progress');

    expect(Number(doingProgress)).toBeCloseTo(1 / 3);
    expect(Number(reviewProgress)).toBeCloseTo(2 / 3);
  });

  it('상태 관리 메뉴에서 범주 경계에 맞는 순서 이동 항목을 제공한다', async () => {
    const user = userEvent.setup();
    renderScreen();

    const firstBacklogRow = stateRow('미분류');
    await user.click(
      within(firstBacklogRow).getByRole('button', { name: '미분류 ' + labels.manage }),
    );
    expect(screen.getByRole('button', { name: labels.moveUp })).toBeDisabled();
    expect(screen.getByRole('button', { name: labels.moveDown })).toBeEnabled();

    await user.keyboard('{Escape}');
    const lastBacklogRow = stateRow('보류');
    await user.click(within(lastBacklogRow).getByRole('button', { name: '보류 ' + labels.manage }));
    expect(screen.getByRole('button', { name: labels.moveUp })).toBeEnabled();
    expect(screen.getByRole('button', { name: labels.moveDown })).toBeDisabled();
  });

  it('상태 관리 메뉴에서 같은 범주 안의 상태를 위로 이동하고 메뉴를 닫는다', async () => {
    const user = userEvent.setup();
    renderScreen();

    const reviewRow = stateRow('검토');
    await user.click(within(reviewRow).getByRole('button', { name: '검토 ' + labels.manage }));
    await user.click(screen.getByRole('button', { name: labels.moveUp }));

    expect(mocks.reorder).toHaveBeenCalledWith(
      {
        data: {
          states: [
            { id: 'state-backlog', version: 1 },
            { id: 'state-paused', version: 6 },
            { id: 'state-todo', version: 2 },
            { id: 'state-review', version: 4 },
            { id: 'state-doing', version: 3 },
            { id: 'state-done', version: 5 },
            { id: 'state-canceled', version: 7 },
          ],
        },
        teamId: team.id,
      },
      expect.any(Object),
    );
    expect(screen.queryByRole('button', { name: labels.moveUp })).not.toBeInTheDocument();
  });

  it('순서 변경 성공을 보조 기술에 알린다', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: '검토 ' + labels.moveUp }));
    act(() => {
      mocks.reorder.mock.calls[0]?.[1]?.onSuccess?.({ items: states, nextCursor: null });
    });

    expect(screen.getByRole('status')).toHaveTextContent(
      labels.reorderSuccess.replace('{state}', '검토').replace('{position}', '1'),
    );
  });

  it('순서 변경 버전 충돌 시 최신 워크플로를 다시 불러오라고 안내한다', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: '검토 ' + labels.moveUp }));
    act(() => {
      mocks.reorder.mock.calls[0]?.[1]?.onError?.(apiFailure('VERSION_CONFLICT', 7));
    });

    expect(await screen.findByText(labels.conflictTitle)).toBeVisible();
    await waitFor(() => expect(invalidateQueries).toHaveBeenCalled());
  });

  it('범주 헤더에서 새 상태를 해당 범주의 끝에 추가한다', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(
      screen.getByRole('button', { name: labels.categoryCompleted + ' ' + labels.create }),
    );
    const dialog = screen.getByRole('dialog', { name: labels.createTitle });
    await user.type(within(dialog).getByLabelText(labels.nameLabel), '검증 완료');
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(dialog).getByText(labels.categoryCompleted, { exact: false })).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: labels.colors.TEAL }));
    await user.click(within(dialog).getByRole('button', { name: labels.create }));

    expect(mocks.create).toHaveBeenCalledWith(
      {
        data: { category: 'COMPLETED', color: 'TEAL', name: '검증 완료' },
        teamId: team.id,
      },
      expect.any(Object),
    );
  });

  it('종료 범주 상태는 영향 확인 후 기본값으로 지정한다', async () => {
    const user = userEvent.setup();
    renderScreen();

    const completedRow = stateRow('완료');
    await user.click(within(completedRow).getByRole('button', { name: '완료 ' + labels.manage }));
    await user.click(screen.getByRole('button', { name: labels.defaultSet }));
    expect(mocks.setDefault).not.toHaveBeenCalled();
    const confirmation = screen.getByRole('alertdialog', { name: labels.terminalDefaultTitle });
    expect(within(confirmation).getByText(labels.terminalDefaultDescription)).toBeVisible();
    await user.click(
      within(confirmation).getByRole('button', { name: labels.terminalDefaultConfirm }),
    );

    expect(mocks.setDefault).toHaveBeenCalledWith(
      { data: { version: 5 }, stateId: 'state-done' },
      expect.any(Object),
    );

    act(() => {
      mocks.setDefault.mock.calls[0]?.[1]?.onSuccess?.({
        items: states.map((state) => ({
          ...state,
          isDefault: state.id === 'state-done',
        })),
        nextCursor: null,
      });
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      labels.defaultSuccess.replace('{state}', '완료'),
    );
  });

  it('종료되지 않은 범주 상태는 메뉴에서 바로 기본값으로 지정한다', async () => {
    const user = userEvent.setup();
    renderScreen();

    const todoRow = stateRow('할 일');
    await user.click(within(todoRow).getByRole('button', { name: '할 일 ' + labels.manage }));
    await user.click(screen.getByRole('button', { name: labels.defaultSet }));

    expect(mocks.setDefault).toHaveBeenCalledWith(
      { data: { version: 2 }, stateId: 'state-todo' },
      expect.any(Object),
    );
    expect(screen.queryByRole('alertdialog', { name: labels.terminalDefaultTitle })).toBeNull();
  });

  it('기본 상태 삭제 전에 대체 상태 선택을 요구한다', async () => {
    const user = userEvent.setup();
    renderScreen();

    const defaultRow = stateRow('미분류');
    await user.click(within(defaultRow).getByRole('button', { name: '미분류 ' + labels.manage }));
    await user.click(screen.getByRole('button', { name: labels.delete }));
    expect(screen.getByText(labels.deleteDescription.replace('{state}', '미분류'))).toBeVisible();
    await user.click(screen.getByRole('button', { name: labels.deleteConfirm }));

    expect(await screen.findByText(labels.replacementRequired)).toBeVisible();
    expect(screen.getByLabelText(labels.replacementLabel)).toHaveFocus();
    expect(screen.getByLabelText(labels.replacementLabel)).toHaveAttribute(
      'aria-errormessage',
      'replacement-state-error',
    );
    expect(mocks.deleteState).not.toHaveBeenCalled();
  });

  it('사용 중인 일반 상태 삭제 실패 시 대체 상태 선택으로 이어지는 안내를 표시한다', async () => {
    const user = userEvent.setup();
    renderScreen();

    const todoRow = stateRow('할 일');
    await user.click(within(todoRow).getByRole('button', { name: '할 일 ' + labels.manage }));
    await user.click(screen.getByRole('button', { name: labels.delete }));
    await user.click(screen.getByRole('button', { name: labels.deleteConfirm }));
    act(() => {
      mocks.deleteState.mock.calls[0]?.[1]?.onError?.(apiFailure('WORKFLOW_STATE_IN_USE'));
    });

    expect(await screen.findByText(labels.deleteInUseTitle)).toBeVisible();
    expect(screen.getByLabelText(labels.replacementLabel)).toHaveFocus();
  });

  it('상태 이름 서버 검증 오류를 입력과 연결하고 입력으로 포커스를 옮긴다', async () => {
    const user = userEvent.setup();
    renderScreen();

    const todoRow = stateRow('할 일');
    await user.click(within(todoRow).getByRole('button', { name: '할 일 ' + labels.manage }));
    await user.click(screen.getByRole('button', { name: labels.rename }));
    const input = screen.getByLabelText(labels.nameLabel);
    await user.click(screen.getByRole('button', { name: labels.save }));
    act(() => {
      mocks.rename.mock.calls[0]?.[1]?.onError?.({
        ...apiFailure('VALIDATION_ERROR'),
        body: {
          ...apiFailure('VALIDATION_ERROR').body,
          fieldErrors: { name: ['invalid'] },
        },
      });
    });

    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('aria-errormessage', 'workflow-state-name-error');
    expect(document.getElementById('workflow-state-name-error')).toHaveTextContent(
      labels.nameInvalid,
    );
  });

  it('기본값이 아닌 상태를 사용 중지한다', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: '보류 ' + labels.manage }));
    await user.click(screen.getByRole('button', { name: labels.disable }));

    expect(mocks.disable).toHaveBeenCalledWith(
      { data: { version: 6 }, stateId: 'state-paused' },
      expect.any(Object),
    );
  });

  it('상태 이름을 유지하면서 선택한 색을 저장한다', async () => {
    const user = userEvent.setup();
    renderScreen();

    const todoRow = stateRow('할 일');
    await user.click(within(todoRow).getByRole('button', { name: '할 일 ' + labels.manage }));
    await user.click(screen.getByRole('button', { name: labels.rename }));
    const dialog = screen.getByRole('dialog', { name: labels.renameTitle });
    await user.click(within(dialog).getByRole('button', { name: labels.colors.ORANGE }));
    await user.click(within(dialog).getByRole('button', { name: labels.save }));

    expect(mocks.rename).toHaveBeenCalledWith(
      {
        data: { color: 'ORANGE', name: '할 일', version: 2 },
        stateId: 'state-todo',
      },
      expect.any(Object),
    );
  });

  it('수정한 상태 이름을 모든 닫기 경로에서 바로 버리지 않는다', async () => {
    const user = userEvent.setup();
    renderScreen();

    const todoRow = stateRow('할 일');
    await user.click(within(todoRow).getByRole('button', { name: '할 일 ' + labels.manage }));
    await user.click(screen.getByRole('button', { name: labels.rename }));
    const dialog = screen.getByRole('dialog', { name: labels.renameTitle });
    await user.clear(within(dialog).getByLabelText(labels.nameLabel));
    await user.type(within(dialog).getByLabelText(labels.nameLabel), '새 이름');

    await user.keyboard('{Escape}');
    let confirmation = await screen.findByRole('alertdialog', { name: labels.discardTitle });
    await user.click(within(confirmation).getByRole('button', { name: labels.keepEditing }));

    await user.click(within(dialog).getByRole('button', { name: labels.close }));
    confirmation = await screen.findByRole('alertdialog', { name: labels.discardTitle });
    await user.click(within(confirmation).getByRole('button', { name: labels.keepEditing }));

    const overlay = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]');
    expect(overlay).not.toBeNull();
    await user.click(overlay!);
    confirmation = await screen.findByRole('alertdialog', { name: labels.discardTitle });
    await user.click(within(confirmation).getByRole('button', { name: labels.keepEditing }));

    await user.click(within(dialog).getByRole('button', { name: labels.cancel }));
    confirmation = await screen.findByRole('alertdialog', { name: labels.discardTitle });
    await user.click(within(confirmation).getByRole('button', { name: labels.discardChanges }));

    expect(screen.queryByRole('dialog', { name: labels.renameTitle })).not.toBeInTheDocument();
  });
});
