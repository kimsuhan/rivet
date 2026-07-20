import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useIssueTemplatesControllerArchive,
  useIssueTemplatesControllerCreate,
  useIssueTemplatesControllerList,
  useIssueTemplatesControllerRestore,
  useIssueTemplatesControllerUpdate,
  useMembersControllerList,
} from '@rivet/api-client';

import { useIssueTemplateTargetOptions } from '@/features/issues/issue-template-target-queries';
import messages from '@/messages/ko.json';

import {
  type IssueTemplateSettingsLabels,
  IssueTemplateSettingsScreen,
} from './issue-template-settings-screen';

const mocks = vi.hoisted(() => ({
  archive: vi.fn(),
  create: vi.fn(),
  refetch: vi.fn(),
  restore: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@rivet/api-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useIssueTemplatesControllerArchive: vi.fn(),
  useIssueTemplatesControllerCreate: vi.fn(),
  useIssueTemplatesControllerList: vi.fn(),
  useIssueTemplatesControllerRestore: vi.fn(),
  useIssueTemplatesControllerUpdate: vi.fn(),
  useMembersControllerList: vi.fn(),
}));

vi.mock('@/features/issues/issue-template-target-queries', () => ({
  useIssueTemplateTargetOptions: vi.fn(),
}));

vi.mock('@/features/collaboration/markdown-editor', () => ({
  TemplateDescriptionEditor: ({
    boundedHeight,
    onChange,
    value,
  }: {
    boundedHeight?: boolean;
    onChange: (value: string) => void;
    value: string;
  }) => (
    <textarea
      aria-label="템플릿 설명 편집기"
      data-bounded-height={boundedHeight}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

const labels = messages.Settings.templates satisfies IssueTemplateSettingsLabels;
const label = {
  archived: false,
  color: '#EF6A70',
  id: '33199779-c605-4b21-928a-351d43cdf5ce',
  name: '버그',
};
const project = {
  id: '47bb7f1b-6594-45ee-be42-877c7f1c8483',
  name: 'Rivet',
  projectTeams: [
    {
      active: true,
      id: 'project-team-backend',
      team: { archived: false, key: 'API', name: '백엔드' },
    },
    {
      active: false,
      id: 'project-team-app',
      team: { archived: true, key: 'APP', name: '앱 프론트' },
    },
  ],
};
const activeTemplate = {
  archived: false,
  available: true,
  descriptionMarkdown: '기존 설명',
  id: '75658d3c-1163-4652-8657-64c148723c3a',
  initialProjectTeamId: 'project-team-backend',
  labelIds: [label.id],
  name: '버그 신고',
  priority: 'HIGH',
  projectId: project.id,
  unavailableReason: null,
  version: 2,
};
const archivedTemplate = {
  ...activeTemplate,
  archived: true,
  available: false,
  id: '3c8f9077-1f6f-4f01-8824-b3cd948476f7',
  name: '이전 신고',
  unavailableReason: 'ARCHIVED',
  version: 5,
};
const repairTemplate = {
  ...activeTemplate,
  available: false,
  id: '46e71162-c52a-46a2-9186-a0fd70aa4e20',
  initialProjectTeamId: 'project-team-app',
  labelIds: [label.id, 'e9124a51-f389-4e3b-a779-3d8c6cc3242d'],
  name: '대상 정리가 필요한 템플릿',
  unavailableReason: 'LABEL_UNAVAILABLE',
  version: 7,
};

type MutationCallbacks = {
  onError?: (error: unknown) => void;
  onSuccess?: () => Promise<void>;
};

let queryClient: QueryClient;

function targetOptions({
  labelItems = [label],
  labelsState = {},
  projectItems = [project],
  projectsState = {},
}: {
  labelItems?: unknown[];
  labelsState?: Record<string, unknown>;
  projectItems?: unknown[];
  projectsState?: Record<string, unknown>;
} = {}) {
  return {
    labels: {
      data: { items: labelItems, nextCursor: null },
      error: null,
      isError: false,
      isPending: false,
      refetch: vi.fn(),
      ...labelsState,
    },
    projects: {
      data: { items: projectItems, nextCursor: null },
      error: null,
      isError: false,
      isPending: false,
      refetch: vi.fn(),
      ...projectsState,
    },
  };
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="ko" messages={{ Markdown: messages.Markdown }}>
        {children}
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

function renderScreen() {
  return render(<IssueTemplateSettingsScreen labels={labels} />, { wrapper: Wrapper });
}

describe('IssueTemplateSettingsScreen', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    mocks.refetch.mockResolvedValue({ data: { items: [activeTemplate, archivedTemplate] } });
    vi.mocked(useIssueTemplatesControllerList).mockReturnValue({
      data: { items: [activeTemplate, archivedTemplate] },
      error: null,
      isError: false,
      isPending: false,
      refetch: mocks.refetch,
    } as never);
    vi.mocked(useIssueTemplateTargetOptions).mockReturnValue(targetOptions() as never);
    vi.mocked(useMembersControllerList).mockReturnValue({
      data: { items: [] },
      error: null,
      isError: false,
      isPending: false,
      refetch: vi.fn(),
    } as never);
    vi.mocked(useIssueTemplatesControllerArchive).mockReturnValue({
      error: null,
      isError: false,
      isPending: false,
      mutate: mocks.archive,
    } as never);
    vi.mocked(useIssueTemplatesControllerCreate).mockReturnValue({
      error: null,
      isError: false,
      isPending: false,
      mutate: mocks.create,
    } as never);
    vi.mocked(useIssueTemplatesControllerRestore).mockReturnValue({
      error: null,
      isError: false,
      isPending: false,
      mutate: mocks.restore,
    } as never);
    vi.mocked(useIssueTemplatesControllerUpdate).mockReturnValue({
      error: null,
      isError: false,
      isPending: false,
      mutate: mocks.update,
    } as never);
  });

  it('활성·보관 템플릿을 분리하고 보관된 템플릿에는 복구만 표시한다', async () => {
    const user = userEvent.setup();
    renderScreen();

    expect(screen.getByText(activeTemplate.name)).toBeVisible();
    expect(screen.queryByText(archivedTemplate.name)).not.toBeInTheDocument();
    expect(useIssueTemplatesControllerList).toHaveBeenCalledWith(
      { includeArchived: true },
      { query: { retry: false } },
    );

    await user.click(screen.getByRole('tab', { name: labels.archivedTab }));
    expect(screen.getByText(archivedTemplate.name)).toBeVisible();
    expect(screen.queryByText(labels.unavailable)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: `${archivedTemplate.name} ${labels.edit}` }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: `${archivedTemplate.name} ${labels.restore}` }),
    ).toBeVisible();
  });

  it('새 템플릿의 Markdown과 기본 속성을 생성 요청으로 보낸다', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole('button', { name: labels.createTemplate }));
    const dialog = screen.getByRole('dialog', { name: labels.createTitle });
    expect(dialog).toHaveClass('flex-col', 'overflow-hidden');
    expect(dialog.querySelector('[data-slot="dialog-scroll-body"]')).toHaveClass('overflow-y-auto');
    expect(within(dialog).getByLabelText('템플릿 설명 편집기')).toHaveAttribute(
      'data-bounded-height',
      'true',
    );

    await user.type(within(dialog).getByLabelText(labels.nameLabel), '회귀 테스트');
    await user.type(within(dialog).getByLabelText('템플릿 설명 편집기'), '## 확인 목록');
    await user.click(within(dialog).getByRole('checkbox', { name: label.name }));
    await user.click(within(dialog).getByRole('button', { name: labels.save }));

    expect(mocks.create).toHaveBeenCalledWith(
      {
        data: {
          descriptionMarkdown: '## 확인 목록',
          initialProjectTeamId: null,
          labelIds: [label.id],
          name: '회귀 테스트',
          priority: 'NONE',
          projectId: null,
        },
      },
      expect.any(Object),
    );
  });

  it('템플릿 우선순위 선택기에 이슈 생성과 같은 아이콘과 상태 색상을 표시한다', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole('button', { name: labels.createTemplate }));
    const dialog = screen.getByRole('dialog', { name: labels.createTitle });
    const priority = within(dialog).getByRole('combobox', { name: labels.priorityLabel });

    expect(priority.querySelector('svg')).toHaveClass('text-muted-foreground');
    await user.click(priority);
    const high = await screen.findByRole('option', { name: labels.priorities.HIGH });
    expect(high.querySelector('svg')).toHaveClass('text-warning');
    await user.click(high);

    expect(priority).toHaveTextContent(labels.priorities.HIGH);
    expect(priority.querySelector('svg')).toHaveClass('text-warning');
  });

  it('생성 폼을 우선순위, 라벨, 프로젝트, 최초 역할 순으로 읽는다', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole('button', { name: labels.createTemplate }));
    const dialog = screen.getByRole('dialog', { name: labels.createTitle });
    const fields = [
      within(dialog).getByRole('combobox', { name: labels.priorityLabel }),
      within(dialog).getByText(labels.labelsLabel),
      within(dialog).getByRole('combobox', { name: labels.projectLabel }),
      within(dialog).getByRole('combobox', { name: labels.initialTeamLabel }),
    ];

    for (const [index, field] of fields.entries()) {
      const next = fields[index + 1];
      if (!next) continue;
      expect(field.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('cursor 뒤 101번째 라벨·프로젝트·활성 팀 역할을 편집 시 보존한다', async () => {
    const user = userEvent.setup();
    const lateLabel = {
      ...label,
      id: 'e112051f-32ca-4ce6-b3d2-8ba5ee791913',
      name: '101번째 라벨',
    };
    const lateProject = {
      ...project,
      id: '16cf2514-540c-42d0-b7ae-8e2822f25ed9',
      name: '101번째 프로젝트',
      projectTeams: [
        {
          active: true,
          id: 'project-team-web-late',
          team: { archived: false, key: 'WEB', name: '웹 프론트' },
        },
      ],
    };
    const lateTemplate = {
      ...activeTemplate,
      initialProjectTeamId: 'project-team-web-late',
      labelIds: [lateLabel.id],
      projectId: lateProject.id,
    };
    vi.mocked(useIssueTemplateTargetOptions).mockReturnValue(
      targetOptions({
        labelItems: [
          ...Array.from({ length: 100 }, (_, index) => ({
            ...label,
            id: `filler-label-${index}`,
            name: `라벨 ${index}`,
          })),
          lateLabel,
        ],
        projectItems: [
          ...Array.from({ length: 100 }, (_, index) => ({
            ...project,
            id: `filler-project-${index}`,
            name: `프로젝트 ${index}`,
          })),
          lateProject,
        ],
      }) as never,
    );
    vi.mocked(useIssueTemplatesControllerList).mockReturnValue({
      data: { items: [lateTemplate] },
      error: null,
      isError: false,
      isPending: false,
      refetch: mocks.refetch,
    } as never);
    renderScreen();

    await user.click(screen.getByRole('button', { name: `${lateTemplate.name} ${labels.edit}` }));
    const dialog = screen.getByRole('dialog', { name: labels.editTitle });
    expect(within(dialog).getByRole('checkbox', { name: lateLabel.name })).toBeChecked();
    expect(within(dialog).getByLabelText(labels.projectLabel)).toHaveTextContent(lateProject.name);
    expect(within(dialog).getByLabelText(labels.initialTeamLabel)).toHaveTextContent(
      '웹 프론트 (WEB)',
    );
    await user.click(within(dialog).getByRole('button', { name: labels.save }));

    expect(mocks.update).toHaveBeenCalledWith(
      {
        data: expect.objectContaining({
          initialProjectTeamId: 'project-team-web-late',
          labelIds: [lateLabel.id],
          projectId: lateProject.id,
        }),
        issueTemplateId: lateTemplate.id,
      },
      expect.any(Object),
    );
  });

  it('수정 version 충돌 시 초안을 유지하고 명시적으로 최신본을 불러올 때만 교체한다', async () => {
    const user = userEvent.setup();
    const latest = { ...activeTemplate, name: '서버의 최신 이름', version: 3 };
    mocks.refetch.mockResolvedValue({ data: { items: [latest, archivedTemplate] } });
    renderScreen();
    await user.click(screen.getByRole('button', { name: `${activeTemplate.name} ${labels.edit}` }));
    const dialog = screen.getByRole('dialog', { name: labels.editTitle });
    const name = within(dialog).getByLabelText(labels.nameLabel);
    await user.clear(name);
    await user.type(name, '내가 작성 중인 이름');
    await user.click(within(dialog).getByRole('button', { name: labels.save }));

    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ version: activeTemplate.version }),
        issueTemplateId: activeTemplate.id,
      }),
      expect.any(Object),
    );
    await act(async () => {
      const callbacks = mocks.update.mock.calls[0]?.[1] as MutationCallbacks | undefined;
      callbacks?.onError?.({ body: { code: 'VERSION_CONFLICT' }, status: 409 });
      await Promise.resolve();
    });

    expect(await within(dialog).findByText(labels.conflictTitle)).toBeVisible();
    expect(name).toHaveValue('내가 작성 중인 이름');
    await user.click(within(dialog).getByRole('button', { name: labels.reloadLatest }));
    expect(name).toHaveValue(latest.name);
    await user.clear(name);
    await user.type(name, '최신본 위의 변경');
    await user.click(within(dialog).getByRole('button', { name: labels.save }));
    expect(mocks.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ version: latest.version }),
        issueTemplateId: activeTemplate.id,
      }),
      expect.any(Object),
    );
  });

  it('version 충돌 후 최신본 refetch가 실패해도 초안과 Dialog를 유지한다', async () => {
    const user = userEvent.setup();
    mocks.refetch.mockResolvedValue({
      data: { items: [activeTemplate] },
      error: new Error('refetch unavailable'),
      isError: true,
    });
    renderScreen();
    await user.click(screen.getByRole('button', { name: `${activeTemplate.name} ${labels.edit}` }));
    const dialog = screen.getByRole('dialog', { name: labels.editTitle });
    const name = within(dialog).getByLabelText(labels.nameLabel);
    await user.clear(name);
    await user.type(name, 'refetch 실패에도 보존할 초안');
    await user.click(within(dialog).getByRole('button', { name: labels.save }));

    await act(async () => {
      const callbacks = mocks.update.mock.calls[0]?.[1] as MutationCallbacks | undefined;
      callbacks?.onError?.({ body: { code: 'VERSION_CONFLICT' }, status: 409 });
      await Promise.resolve();
    });

    expect(await within(dialog).findByText(labels.conflictTitle)).toBeVisible();
    expect(name).toHaveValue('refetch 실패에도 보존할 초안');
    expect(within(dialog).getByRole('button', { name: labels.reloadLatest })).toBeDisabled();
    expect(dialog).toBeVisible();
  });

  it('cached target의 background refetch 오류는 form과 기존 대상을 유지한다', async () => {
    const user = userEvent.setup();
    vi.mocked(useIssueTemplateTargetOptions).mockReturnValue(
      targetOptions({
        labelsState: { error: new Error('background error'), isError: true },
      }) as never,
    );
    renderScreen();

    expect(screen.getByText(labels.optionsErrorTitle)).toBeVisible();
    await user.click(screen.getByRole('button', { name: `${activeTemplate.name} ${labels.edit}` }));
    const dialog = screen.getByRole('dialog', { name: labels.editTitle });
    expect(within(dialog).getByRole('checkbox', { name: label.name })).toBeChecked();
    expect(within(dialog).getByLabelText(labels.nameLabel)).toHaveValue(activeTemplate.name);
  });

  it('사용할 수 없어진 라벨은 제거하되 비활성 기본 팀 입력은 재선택할 수 있도록 보존한다', async () => {
    const user = userEvent.setup();
    vi.mocked(useIssueTemplatesControllerList).mockReturnValue({
      data: { items: [repairTemplate] },
      error: null,
      isError: false,
      isPending: false,
      refetch: mocks.refetch,
    } as never);
    renderScreen();

    expect(screen.getByText(labels.unavailable)).toBeVisible();
    await user.click(screen.getByRole('button', { name: `${repairTemplate.name} ${labels.edit}` }));
    const dialog = screen.getByRole('dialog', { name: labels.editTitle });
    expect(within(dialog).getByText(labels.repairDescription)).toBeVisible();
    expect(within(dialog).getByRole('checkbox', { name: label.name })).toBeChecked();
    expect(within(dialog).getByLabelText(labels.initialTeamLabel)).toHaveTextContent(
      `앱 프론트 · ${labels.unavailable}`,
    );
    await user.click(within(dialog).getByRole('button', { name: labels.save }));

    expect(mocks.update).toHaveBeenCalledWith(
      {
        data: {
          descriptionMarkdown: repairTemplate.descriptionMarkdown,
          initialProjectTeamId: 'project-team-app',
          labelIds: [label.id],
          name: repairTemplate.name,
          priority: repairTemplate.priority,
          projectId: project.id,
          version: repairTemplate.version,
        },
        issueTemplateId: repairTemplate.id,
      },
      expect.any(Object),
    );
  });

  it.each([
    { isError: false, isPending: true, state: '불러오는 중' },
    { isError: true, isPending: false, state: '불러오기 실패' },
  ])(
    '대상 선택지가 $state이면 편집·저장을 열지 않아 기존 대상을 보존한다',
    ({ isError, isPending }) => {
      vi.mocked(useIssueTemplateTargetOptions).mockReturnValue(
        targetOptions({
          labelsState: {
            data: undefined,
            error: isError ? new Error('labels unavailable') : null,
            isError,
            isPending,
          },
        }) as never,
      );

      renderScreen();

      expect(
        screen.queryByRole('button', { name: `${activeTemplate.name} ${labels.edit}` }),
      ).not.toBeInTheDocument();
      expect(mocks.update).not.toHaveBeenCalled();
      if (isPending) {
        expect(screen.getByText(labels.loading)).toBeVisible();
      } else {
        expect(screen.getByText(labels.optionsErrorTitle)).toBeVisible();
      }
    },
  );

  it('보관에 현재 version을 보내고 dirty Dialog의 Escape 취소는 초안을 보존한다', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(
      screen.getByRole('button', { name: `${activeTemplate.name} ${labels.archive}` }),
    );
    await user.click(screen.getByRole('button', { name: labels.archiveAction }));
    expect(mocks.archive).toHaveBeenCalledWith(
      {
        data: { version: activeTemplate.version },
        issueTemplateId: activeTemplate.id,
      },
      expect.any(Object),
    );
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: labels.createTemplate }));
    const name = screen.getByLabelText(labels.nameLabel);
    await user.type(name, '보존할 초안');
    await user.keyboard('{Escape}');
    const discard = await screen.findByRole('alertdialog', { name: labels.discardTitle });
    const keepEditing = within(discard).getByRole('button', { name: labels.cancel });
    keepEditing.focus();
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(
        screen.queryByRole('alertdialog', { name: labels.discardTitle }),
      ).not.toBeInTheDocument(),
    );
    expect(name).toHaveValue('보존할 초안');
  });

  it('보관된 템플릿 복구에 현재 version을 보내고 성공하면 목록을 갱신한다', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole('tab', { name: labels.archivedTab }));
    await user.click(
      screen.getByRole('button', { name: `${archivedTemplate.name} ${labels.restore}` }),
    );
    const dialog = screen.getByRole('alertdialog', { name: labels.restoreTitle });
    expect(dialog).toHaveTextContent(archivedTemplate.name);
    await user.click(within(dialog).getByRole('button', { name: labels.restoreAction }));

    expect(mocks.restore).toHaveBeenCalledWith(
      {
        data: { version: archivedTemplate.version },
        issueTemplateId: archivedTemplate.id,
      },
      expect.any(Object),
    );
    await act(async () => {
      const callbacks = mocks.restore.mock.calls[0]?.[1] as MutationCallbacks | undefined;
      await callbacks?.onSuccess?.();
    });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: expect.any(Array),
    });
    expect(
      screen.queryByRole('alertdialog', { name: labels.restoreTitle }),
    ).not.toBeInTheDocument();
  });

  it('복구 version 충돌 시 최신 목록을 확인하기 전에는 다시 복구하지 않는다', async () => {
    const user = userEvent.setup();
    mocks.refetch.mockResolvedValue({
      data: { items: [{ ...archivedTemplate, version: archivedTemplate.version + 1 }] },
      isError: false,
    });
    renderScreen();
    await user.click(screen.getByRole('tab', { name: labels.archivedTab }));
    await user.click(
      screen.getByRole('button', { name: `${archivedTemplate.name} ${labels.restore}` }),
    );
    const dialog = screen.getByRole('alertdialog', { name: labels.restoreTitle });
    await user.click(within(dialog).getByRole('button', { name: labels.restoreAction }));
    act(() => {
      const callbacks = mocks.restore.mock.calls[0]?.[1] as MutationCallbacks | undefined;
      callbacks?.onError?.({ body: { code: 'VERSION_CONFLICT' }, status: 409 });
    });

    expect(await within(dialog).findByText(labels.restoreConflictDescription)).toBeVisible();
    const reload = within(dialog).getByRole('button', { name: labels.reloadLatest });
    await waitFor(() => expect(reload).toBeEnabled());
    expect(mocks.restore).toHaveBeenCalledTimes(1);
    await user.click(reload);
    expect(
      screen.queryByRole('alertdialog', { name: labels.restoreTitle }),
    ).not.toBeInTheDocument();
  });
});
