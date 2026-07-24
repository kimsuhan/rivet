import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getIssuesControllerGroupsQueryKey,
  getIssueTemplatesControllerListQueryKey,
  getLabelsControllerListQueryKey,
  getProjectsControllerListQueryKey,
  useIssuesControllerCreate,
  useIssueTemplatesControllerApply,
  useIssueTemplatesControllerList,
  useMembersControllerList,
} from '@rivet/api-client';

import messages from '@/messages/ko.json';

import { GlobalIssueCreate, type IssueCreateLabels } from './global-issue-create';
import { useIssueTemplateTargetOptions } from './issue-template-target-queries';

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
  applyReset: vi.fn(),
  create: vi.fn(),
  createReset: vi.fn(),
  push: vi.fn(),
  templateRefetch: vi.fn(),
}));

vi.mock('@rivet/api-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useIssuesControllerCreate: vi.fn(),
  useIssueTemplatesControllerApply: vi.fn(),
  useIssueTemplatesControllerList: vi.fn(),
  useMembersControllerList: vi.fn(),
}));

vi.mock('./issue-template-target-queries', () => ({
  useIssueTemplateTargetOptions: vi.fn(),
}));

vi.mock('@/features/collaboration/markdown-editor', () => ({
  IssueDescriptionEditor: ({
    boundedHeight,
    disabled,
    onChange,
    value,
  }: {
    boundedHeight?: boolean;
    disabled?: boolean;
    onChange: (value: string) => void;
    value: string;
  }) => (
    <textarea
      aria-label="설명 편집기"
      data-bounded-height={boundedHeight}
      disabled={disabled}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

vi.mock('@/features/files/file-upload-queue', () => ({
  FileUploadQueue: ({
    compactTrigger,
    onFileIdsChange,
  }: {
    compactTrigger?: boolean;
    onFileIdsChange: (ids: string[]) => void;
  }) => (
    <button
      type="button"
      aria-label="파일 선택"
      data-compact-trigger={compactTrigger ? 'true' : 'false'}
      onClick={() => onFileIdsChange(['uploaded-file-id'])}
    />
  ),
}));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}));

const labels = messages.IssueCreate satisfies IssueCreateLabels;
const project = {
  id: 'c07fe75e-aa1a-4a77-840e-25ec034381c0',
  name: 'Rivet',
  projectTeams: [
    {
      active: true,
      deactivatedAt: null,
      id: 'project-team-backend',
      team: { archived: false, id: 'team-backend', key: 'API', name: '백엔드' },
    },
    {
      active: false,
      deactivatedAt: '2026-07-01T00:00:00.000Z',
      id: 'project-team-app',
      team: { archived: true, id: 'team-app', key: 'APP', name: '앱 프론트' },
    },
  ],
};
const seedProjectId = '59a3ac63-ed97-4b08-91d1-463499ab3d8d';
const label = {
  archived: false,
  color: '#EF6A70',
  id: 'ec626ba8-5396-492f-86f0-6a595b51d060',
  name: '버그',
};
const template = {
  archived: false,
  available: true,
  descriptionMarkdown: '## 재현 절차\n',
  id: '64ba55b0-c7a0-47d3-bce5-5b6937653ae9',
  initialProjectTeamId: 'project-team-backend',
  labelIds: [label.id],
  name: '버그 신고',
  priority: 'HIGH',
  projectId: project.id,
  unavailableReason: null,
  version: 4,
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
      <NextIntlClientProvider
        locale="ko"
        messages={{ Files: messages.Files, Markdown: messages.Markdown }}
      >
        {children}
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

function renderCreate({
  onOpenChange = vi.fn(),
  seed = null,
}: {
  onOpenChange?: (open: boolean) => void;
  seed?: { projectId?: string } | null;
} = {}) {
  return render(
    <GlobalIssueCreate
      currentTeamKey={null}
      labels={labels}
      onOpenChange={onOpenChange}
      open
      seed={seed}
    />,
    { wrapper: Wrapper },
  );
}

async function chooseTemplate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(getToolbarButton(labels.templateTrigger));
  await user.click(await screen.findByRole('option', { name: template.name }));
}

function getToolbarButton(label: string) {
  return screen.getByRole('button', {
    name: (accessibleName) => accessibleName === label || accessibleName.startsWith(`${label}:`),
  });
}

async function openLabels(user: ReturnType<typeof userEvent.setup>) {
  await user.click(getToolbarButton(labels.labelsLabel));
}

async function openTeams(user: ReturnType<typeof userEvent.setup>) {
  await user.click(getToolbarButton(labels.initialTeamsToolbarLabel));
}

describe('GlobalIssueCreate issue template', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    vi.mocked(useIssueTemplateTargetOptions).mockReturnValue(targetOptions() as never);
    vi.mocked(useMembersControllerList).mockReturnValue({ data: { items: [] } } as never);
    vi.mocked(useIssueTemplatesControllerList).mockReturnValue({
      data: { items: [template] },
      error: null,
      isError: false,
      isPending: false,
      refetch: mocks.templateRefetch,
    } as never);
    mocks.apply.mockResolvedValue(template);
    vi.mocked(useIssueTemplatesControllerApply).mockReturnValue({
      error: null,
      isError: false,
      isPending: false,
      mutateAsync: mocks.apply,
      reset: mocks.applyReset,
    } as never);
    mocks.create.mockResolvedValue({
      createdTeamWorks: [{ identifier: 'WEB-1' }],
      issue: { id: 'issue-id', identifier: 'RIV-1' },
    });
    vi.mocked(useIssuesControllerCreate).mockReturnValue({
      error: null,
      isError: false,
      isPending: false,
      mutateAsync: mocks.create,
      reset: mocks.createReset,
    } as never);
  });

  it('템플릿 선택기를 제목보다 먼저 읽는다', () => {
    renderCreate();

    const templateTrigger = getToolbarButton(labels.templateTrigger);
    const titleInput = screen.getByLabelText(labels.titleLabel);

    expect(
      templateTrigger.compareDocumentPosition(titleInput) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('최신 version을 검증한 스냅샷을 적용하고 이후 수정값과 출처만 이슈 생성에 보낸다', async () => {
    const user = userEvent.setup();
    renderCreate();

    const dialog = screen.getByRole('dialog', { name: labels.title });
    expect(dialog).toHaveClass('flex-col', 'overflow-hidden');
    expect(dialog.querySelector('[data-slot="dialog-scroll-body"]')).toHaveClass('overflow-y-auto');

    await chooseTemplate(user);
    await waitFor(() =>
      expect(mocks.apply).toHaveBeenCalledWith({
        data: { version: template.version },
        issueTemplateId: template.id,
      }),
    );
    expect(screen.getByLabelText('설명 편집기')).toHaveValue(template.descriptionMarkdown);
    expect(screen.getByLabelText('설명 편집기')).toHaveAttribute('data-bounded-height', 'true');
    await openLabels(user);
    expect(screen.getByRole('checkbox', { name: label.name })).toBeChecked();
    await openTeams(user);
    expect(screen.getByRole('checkbox', { name: /API.*백엔드/ })).toBeChecked();

    await user.clear(screen.getByLabelText('설명 편집기'));
    await user.type(screen.getByLabelText('설명 편집기'), '사용자가 바꾼 설명');
    await user.type(screen.getByLabelText(labels.titleLabel), '로그인 오류');
    await user.click(screen.getByRole('button', { name: labels.submit }));

    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        appliedTemplate: { id: template.id, version: template.version },
        descriptionMarkdown: '사용자가 바꾼 설명',
        projectId: project.id,
        title: '로그인 오류',
      }),
    });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: getIssuesControllerGroupsQueryKey(),
    });
  });

  it('cursor 뒤 101번째 라벨·프로젝트·활성 팀 역할도 템플릿에서 적용한다', async () => {
    const user = userEvent.setup();
    const lateLabel = {
      ...label,
      id: '48723d88-5a75-43f2-933c-542760a2e91e',
      name: '101번째 라벨',
    };
    const lateProject = {
      ...project,
      id: '138c73e3-043f-49fe-9725-6c16731bf118',
      name: '101번째 프로젝트',
      projectTeams: [
        {
          active: true,
          deactivatedAt: null,
          id: 'project-team-web-late',
          team: { archived: false, id: 'team-web', key: 'WEB', name: '웹 프론트' },
        },
      ],
    };
    const lateTemplate = {
      ...template,
      initialProjectTeamId: 'project-team-web-late',
      labelIds: [lateLabel.id],
      projectId: lateProject.id,
    };
    const fillerLabels = Array.from({ length: 100 }, (_, index) => ({
      ...label,
      id: `filler-label-${index}`,
      name: `라벨 ${index}`,
    }));
    const fillerProjects = Array.from({ length: 100 }, (_, index) => ({
      ...project,
      id: `filler-project-${index}`,
      name: `프로젝트 ${index}`,
    }));
    vi.mocked(useIssueTemplateTargetOptions).mockReturnValue(
      targetOptions({
        labelItems: [...fillerLabels, lateLabel],
        projectItems: [...fillerProjects, lateProject],
      }) as never,
    );
    vi.mocked(useIssueTemplatesControllerList).mockReturnValue({
      data: { items: [lateTemplate] },
      error: null,
      isError: false,
      isPending: false,
      refetch: mocks.templateRefetch,
    } as never);
    mocks.apply.mockResolvedValue(lateTemplate);
    renderCreate();

    await chooseTemplate(user);
    await openLabels(user);
    expect(await screen.findByRole('checkbox', { name: lateLabel.name })).toBeChecked();
    await openTeams(user);
    expect(screen.getByRole('checkbox', { name: /WEB.*웹 프론트/ })).toBeChecked();
    await user.type(screen.getByLabelText(labels.titleLabel), '101번째 대상 적용');
    await user.click(screen.getByRole('button', { name: labels.submit }));

    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        initialTeams: [{ projectTeamId: 'project-team-web-late' }],
        labelIds: [lateLabel.id],
        projectId: lateProject.id,
      }),
    });
  });

  it('직접 입력한 대상의 정확한 덮어쓰기 범위를 확인하고 Escape 취소 시 모든 값을 유지한다', async () => {
    const user = userEvent.setup();
    renderCreate();
    const editor = screen.getByLabelText('설명 편집기');
    await user.type(editor, '내 설명');
    await user.click(getToolbarButton(labels.priorityLabel));
    await user.click(await screen.findByRole('option', { name: labels.priorities.LOW }));

    await chooseTemplate(user);
    const alert = screen.getByRole('alertdialog', { name: labels.overwriteTitle });
    expect(
      within(alert).getByText(labels.overwriteFields.description, { exact: false }),
    ).toBeVisible();
    expect(
      within(alert).getByText(labels.overwriteFields.priority, { exact: false }),
    ).toBeVisible();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(editor).toHaveValue('내 설명');
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(getToolbarButton(labels.templateTrigger)).toHaveFocus();
  });

  it('적용 응답 대기 중 overwrite 취소와 대상 편집을 막고 완료 뒤 스냅샷을 복사한다', async () => {
    const user = userEvent.setup();
    let resolveApply!: (value: typeof template) => void;
    mocks.apply.mockReturnValue(
      new Promise((resolve) => {
        resolveApply = resolve;
      }),
    );
    renderCreate();
    const editor = screen.getByLabelText('설명 편집기');
    await user.type(editor, '먼저 입력한 설명');
    await chooseTemplate(user);
    const alert = screen.getByRole('alertdialog', { name: labels.overwriteTitle });
    await user.click(within(alert).getByRole('button', { name: labels.overwriteConfirm }));

    await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(1));
    expect(within(alert).getByRole('button', { name: labels.overwriteCancel })).toBeDisabled();
    expect(within(alert).getByRole('button', { name: labels.overwriteConfirm })).toBeDisabled();
    expect(editor).toBeDisabled();
    expect(document.getElementById('issue-create-project')).toBeDisabled();
    expect(document.getElementById('issue-create-priority')).toBeDisabled();
    expect(document.getElementById('issue-create-labels')).toBeDisabled();
    expect(document.getElementById('issue-create-initial-teams')).toBeDisabled();
    expect(document.getElementById('issue-create-title')).toBeEnabled();

    await user.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog', { name: labels.overwriteTitle })).toBeVisible();
    expect(mocks.apply).toHaveBeenCalledTimes(1);

    await act(async () => resolveApply(template));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(editor).toHaveValue(template.descriptionMarkdown);
    expect(editor).toBeEnabled();
    await openLabels(user);
    expect(screen.getByRole('checkbox', { name: label.name })).toBeChecked();
  });

  it('일반 적용 실패는 입력을 보존하고 overwrite를 닫아 오류와 재시도를 제공한다', async () => {
    const user = userEvent.setup();
    let rejectApply!: (reason: unknown) => void;
    mocks.apply.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectApply = reject;
      }),
    );
    renderCreate();
    const editor = screen.getByLabelText('설명 편집기');
    await user.type(editor, '실패해도 보존할 설명');
    await chooseTemplate(user);
    await user.click(
      within(screen.getByRole('alertdialog', { name: labels.overwriteTitle })).getByRole('button', {
        name: labels.overwriteConfirm,
      }),
    );

    await act(async () => rejectApply(new Error('network unavailable')));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(editor).toHaveValue('실패해도 보존할 설명');
    expect(screen.getByText(labels.errorTitle)).toBeVisible();
    expect(screen.getByRole('dialog', { name: labels.title })).toBeVisible();

    mocks.apply.mockResolvedValueOnce(template);
    await chooseTemplate(user);
    await user.click(
      within(screen.getByRole('alertdialog', { name: labels.overwriteTitle })).getByRole('button', {
        name: labels.overwriteConfirm,
      }),
    );
    await waitFor(() => expect(editor).toHaveValue(template.descriptionMarkdown));
    expect(mocks.apply).toHaveBeenCalledTimes(2);
  });

  it('seed 프로젝트는 확인하되 적용값이 같은 템플릿 재선택은 덮어쓰기 확인 없이 적용한다', async () => {
    const user = userEvent.setup();
    render(
      <GlobalIssueCreate
        currentTeamKey={null}
        labels={labels}
        onOpenChange={vi.fn()}
        open
        seed={{ projectId: seedProjectId }}
      />,
      { wrapper: Wrapper },
    );

    await chooseTemplate(user);
    const seedAlert = screen.getByRole('alertdialog', { name: labels.overwriteTitle });
    expect(
      within(seedAlert).getByText(labels.overwriteFields.project, { exact: false }),
    ).toBeVisible();
    await user.click(within(seedAlert).getByRole('button', { name: labels.overwriteConfirm }));
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await user.click(getToolbarButton(labels.templateTrigger));
    await user.click(await screen.findByRole('option', { name: labels.templateNone }));
    await chooseTemplate(user);

    await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByRole('alertdialog', { name: labels.overwriteTitle }),
    ).not.toBeInTheDocument();
  });

  it('사용자 수정값이나 복사값이 다음 템플릿과 같으면 실제로 바뀌는 필드만 확인한다', async () => {
    const user = userEvent.setup();
    const nextTemplate = {
      ...template,
      id: '4eac3a89-b3f3-454e-8fc4-bc3d50c520dd',
      name: '우선순위만 다른 신고',
      priority: 'URGENT',
      version: 1,
    };
    vi.mocked(useIssueTemplatesControllerList).mockReturnValue({
      data: { items: [template, nextTemplate] },
      error: null,
      isError: false,
      isPending: false,
      refetch: mocks.templateRefetch,
    } as never);
    mocks.apply.mockImplementation(async ({ issueTemplateId }) =>
      issueTemplateId === nextTemplate.id ? nextTemplate : template,
    );
    renderCreate();

    await chooseTemplate(user);
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(1));
    const editor = screen.getByLabelText('설명 편집기');
    await user.clear(editor);
    await user.type(editor, template.descriptionMarkdown);
    await user.click(getToolbarButton(labels.templateTrigger));
    await user.click(await screen.findByRole('option', { name: nextTemplate.name }));

    const alert = screen.getByRole('alertdialog', { name: labels.overwriteTitle });
    expect(
      within(alert).getByText(labels.overwriteFields.priority, { exact: false }),
    ).toBeVisible();
    expect(
      within(alert).queryByText(labels.overwriteFields.description, { exact: false }),
    ).not.toBeInTheDocument();
    expect(
      within(alert).queryByText(labels.overwriteFields.labels, { exact: false }),
    ).not.toBeInTheDocument();
  });

  it('적용 뒤 조회에서 누락된 라벨을 현재 사용 불가로 표시하고 제거할 수 있다', async () => {
    const user = userEvent.setup();
    const unavailableLabelId = 'f76f44ba-2af7-473f-a064-d6329e50932b';
    mocks.apply.mockResolvedValue({ ...template, labelIds: [label.id, unavailableLabelId] });
    renderCreate();

    await chooseTemplate(user);
    await openLabels(user);
    const unavailableLabel = await screen.findByRole('checkbox', {
      name: `${labels.templateUnavailable} · ${unavailableLabelId}`,
    });
    expect(unavailableLabel).toBeChecked();
    await user.click(unavailableLabel);
    await user.type(screen.getByLabelText(labels.titleLabel), '누락 라벨 제거');
    await user.click(screen.getByRole('button', { name: labels.submit }));

    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ labelIds: [label.id] }),
    });
  });

  it('적용 뒤 사용할 수 없어진 프로젝트 참여 팀 식별자를 보존해 표시하고 제거할 수 있다', async () => {
    const user = userEvent.setup();
    const activeTeamProject = {
      ...project,
      projectTeams: [
        ...project.projectTeams,
        {
          active: true,
          deactivatedAt: null,
          id: 'project-team-web',
          team: { archived: false, id: 'team-web', key: 'WEB', name: '웹 프론트' },
        },
      ],
    };
    const teamTemplate = { ...template, initialProjectTeamId: 'project-team-web' };
    vi.mocked(useIssueTemplateTargetOptions).mockReturnValue(
      targetOptions({ projectItems: [activeTeamProject] }) as never,
    );
    vi.mocked(useIssueTemplatesControllerList).mockReturnValue({
      data: { items: [teamTemplate] },
      error: null,
      isError: false,
      isPending: false,
      refetch: mocks.templateRefetch,
    } as never);
    mocks.apply.mockResolvedValue(teamTemplate);
    const view = renderCreate();

    await chooseTemplate(user);
    await openTeams(user);
    await waitFor(() =>
      expect(
        screen.getByRole('checkbox', { name: /WEB.*웹 프론트/ }),
      ).toBeChecked(),
    );

    vi.mocked(useIssueTemplateTargetOptions).mockReturnValue(targetOptions() as never);
    view.rerender(
      <GlobalIssueCreate
        currentTeamKey={null}
        labels={labels}
        onOpenChange={vi.fn()}
        open
        seed={null}
      />,
    );
    const unavailableTeam = screen.getByRole('checkbox', {
      name: `project-team-web · ${labels.templateUnavailable}`,
    });
    expect(unavailableTeam).toBeChecked();
    await user.click(unavailableTeam);
    await user.type(screen.getByLabelText(labels.titleLabel), '누락 참여 팀 제거');
    await user.click(screen.getByRole('button', { name: labels.submit }));

    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ initialTeams: [] }),
    });
  });

  it('보관·권한·version 오류에서 템플릿과 라벨, 프로젝트를 함께 새로 고친다', async () => {
    const user = userEvent.setup();
    mocks.apply.mockRejectedValue({
      body: { code: 'ISSUE_TEMPLATE_TARGET_UNAVAILABLE' },
      status: 409,
    });
    renderCreate();

    await chooseTemplate(user);
    await waitFor(() => expect(screen.getByText(labels.templateNoticeTitle)).toBeVisible());
    for (const queryKey of [
      getIssueTemplatesControllerListQueryKey(),
      getLabelsControllerListQueryKey(),
      getProjectsControllerListQueryKey(),
    ]) {
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey });
    }
    await openTeams(user);
    expect(screen.queryByRole('checkbox', { name: /APP.*앱 프론트/ })).toBeNull();
  });

  it('보관·권한·version 오류가 나면 현재 입력을 보존하고 템플릿 출처를 지운 뒤 재선택을 안내한다', async () => {
    const user = userEvent.setup();
    mocks.apply.mockRejectedValue({ body: { code: 'VERSION_CONFLICT' }, status: 409 });
    renderCreate();
    const editor = screen.getByLabelText('설명 편집기');
    await user.type(editor, '보존할 설명');

    await chooseTemplate(user);
    await user.click(screen.getByRole('button', { name: labels.overwriteConfirm }));

    expect(await screen.findByText(labels.templateNoticeTitle)).toBeVisible();
    expect(editor).toHaveValue('보존할 설명');
    expect(getToolbarButton(labels.templateTrigger)).toHaveAccessibleName(labels.templateTrigger);
  });

  it('최종 생성에서 템플릿이 stale이면 명시적인 선택 전 재제출을 막는다', async () => {
    const user = userEvent.setup();
    mocks.create.mockRejectedValueOnce({ body: { code: 'VERSION_CONFLICT' }, status: 409 });
    renderCreate();

    await chooseTemplate(user);
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(1));
    await user.type(screen.getByLabelText(labels.titleLabel), 'stale 재제출 차단');
    const submit = screen.getByRole('button', { name: labels.submit });
    await user.click(submit);

    expect(await screen.findByText(labels.templateNoticeTitle)).toBeVisible();
    expect(submit).toBeDisabled();
    await user.click(submit);
    expect(mocks.create).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: labels.templateNone }));
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create.mock.calls[1]?.[0]).toEqual({
      data: expect.not.objectContaining({ appliedTemplate: expect.anything() }),
    });
  });

  it('템플릿이 없으면 관련 UI를 숨기고 첨부는 compact 트리거로 렌더링한다', () => {
    vi.mocked(useIssueTemplatesControllerList).mockReturnValue({
      data: { items: [] },
      error: null,
      isError: false,
      isPending: false,
      refetch: mocks.templateRefetch,
    } as never);

    renderCreate();

    expect(screen.queryByRole('button', { name: labels.templateTrigger })).not.toBeInTheDocument();
    expect(screen.queryByText(labels.templateEmpty)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '파일 선택' })).toHaveAttribute(
      'data-compact-trigger',
      'true',
    );
  });

  it('작성한 내용이 있으면 닫기 전에 확인하고 취소 시 입력을 유지하며 확인 시 버린다', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderCreate({ onOpenChange });

    const title = screen.getByLabelText(labels.titleLabel);
    await user.type(title, '닫기 전에 확인할 이슈');
    await user.click(screen.getByRole('button', { name: labels.cancel }));

    const confirmation = screen.getByRole('alertdialog', { name: labels.discardTitle });
    expect(onOpenChange).not.toHaveBeenCalled();
    await user.click(within(confirmation).getByRole('button', { name: labels.cancel }));
    expect(title).toHaveValue('닫기 전에 확인할 이슈');

    await user.keyboard('{Escape}');
    const escapeConfirmation = screen.getByRole('alertdialog', { name: labels.discardTitle });
    await user.click(within(escapeConfirmation).getByRole('button', { name: labels.cancel }));
    expect(title).toHaveValue('닫기 전에 확인할 이슈');

    await user.click(screen.getByRole('button', { name: labels.close }));
    await user.click(
      within(screen.getByRole('alertdialog', { name: labels.discardTitle })).getByRole('button', {
        name: labels.discardChanges,
      }),
    );

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(title).toHaveValue('');
  });

  it('첨부파일도 작성 중 변경으로 취급하고 입력이 없으면 바로 닫는다', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const view = renderCreate({ onOpenChange });

    await user.click(screen.getByRole('button', { name: '파일 선택' }));
    await user.click(screen.getByRole('button', { name: labels.cancel }));
    expect(screen.getByRole('alertdialog', { name: labels.discardTitle })).toBeVisible();

    view.unmount();
    renderCreate({ onOpenChange });
    await user.click(screen.getByRole('button', { name: labels.cancel }));
    expect(
      screen.queryByRole('alertdialog', { name: labels.discardTitle }),
    ).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('템플릿 조회 중에는 결과가 확인될 때까지 트리거를 표시하지 않는다', () => {
    vi.mocked(useIssueTemplatesControllerList).mockReturnValue({
      data: undefined,
      error: null,
      isError: false,
      isPending: true,
      refetch: mocks.templateRefetch,
    } as never);

    renderCreate();

    expect(screen.queryByRole('button', { name: labels.templateTrigger })).not.toBeInTheDocument();
  });

  it('재조회 뒤 선택할 템플릿이 없으면 전용 안내를 표시하고 제목으로 포커스를 옮긴다', async () => {
    const user = userEvent.setup();
    mocks.apply.mockRejectedValue({ body: { code: 'ISSUE_TEMPLATE_UNAVAILABLE' }, status: 409 });
    const view = renderCreate();
    const title = screen.getByLabelText(labels.titleLabel);
    await user.type(title, '보존할 제목');

    await chooseTemplate(user);
    await waitFor(() => expect(screen.getByText(labels.templateNoticeTitle)).toBeVisible());
    vi.mocked(useIssueTemplatesControllerList).mockReturnValue({
      data: { items: [] },
      error: null,
      isError: false,
      isPending: false,
      refetch: mocks.templateRefetch,
    } as never);
    view.rerender(
      <GlobalIssueCreate
        currentTeamKey={null}
        labels={labels}
        onOpenChange={vi.fn()}
        open
        seed={null}
      />,
    );

    expect(await screen.findByText(labels.templateUnavailableNoticeTitle)).toBeVisible();
    expect(screen.getByText(labels.templateUnavailableNoticeDescription)).toBeVisible();
    expect(screen.queryByRole('button', { name: labels.templateTrigger })).not.toBeInTheDocument();
    expect(title).toHaveValue('보존할 제목');
    await waitFor(() => expect(title).toHaveFocus());
  });

  it('사용할 수 없는 템플릿은 사유와 함께 비활성화한다', async () => {
    const user = userEvent.setup();
    vi.mocked(useIssueTemplatesControllerList).mockReturnValue({
      data: { items: [{ ...template, available: false }] },
      error: null,
      isError: false,
      isPending: false,
      refetch: mocks.templateRefetch,
    } as never);
    renderCreate();

    await user.click(getToolbarButton(labels.templateTrigger));
    const unavailable = screen.getByRole('option', {
      name: (accessibleName) =>
        accessibleName.includes(template.name) &&
        accessibleName.includes(labels.templateUnavailable),
    });
    expect(unavailable).toBeDisabled();
  });

  it('라벨과 역할을 여러 개 선택하면 pill에 선택 개수를 요약한다', async () => {
    const user = userEvent.setup();
    const secondLabel = {
      ...label,
      id: 'c51bb965-cf82-41b2-80f8-1ce682832f45',
      name: '회귀',
    };
    const multiTeamProject = {
      ...project,
      projectTeams: [
        project.projectTeams[0],
        {
          active: true,
          deactivatedAt: null,
          id: 'project-team-web',
          team: { archived: false, id: 'team-web', key: 'WEB', name: '웹 프론트' },
        },
      ],
    };
    vi.mocked(useIssueTemplateTargetOptions).mockReturnValue(
      targetOptions({
        labelItems: [label, secondLabel],
        projectItems: [multiTeamProject],
      }) as never,
    );
    renderCreate();

    await user.click(getToolbarButton(labels.projectLabel));
    await user.click(screen.getByRole('option', { name: project.name }));
    await openLabels(user);
    await user.click(screen.getByRole('checkbox', { name: label.name }));
    await user.click(screen.getByRole('checkbox', { name: secondLabel.name }));
    expect(getToolbarButton(labels.labelsLabel)).toHaveAccessibleName(`${labels.labelsLabel}: 2`);

    await openTeams(user);
    await user.click(screen.getByRole('checkbox', { name: /API.*백엔드/ }));
    await user.click(screen.getByRole('checkbox', { name: /WEB.*웹 프론트/ }));
    expect(getToolbarButton(labels.initialTeamsToolbarLabel)).toHaveAccessibleName(
      `${labels.initialTeamsToolbarLabel}: 2`,
    );
  });

  it('프로젝트 없이 제출하면 project pill에 기존 필수 오류 계약을 연결한다', async () => {
    const user = userEvent.setup();
    renderCreate();
    await user.type(screen.getByLabelText(labels.titleLabel), '프로젝트 없는 이슈');

    await user.click(screen.getByRole('button', { name: labels.submit }));

    const projectTrigger = getToolbarButton(labels.projectLabel);
    expect(projectTrigger).toHaveAttribute('aria-invalid', 'true');
    expect(projectTrigger).toHaveAttribute('aria-describedby', 'issue-create-project-error');
    const projectField = projectTrigger.parentElement;
    expect(projectField).not.toBeNull();
    const projectError = within(projectField as HTMLElement).getByText(labels.projectRequired);
    expect(projectError).toBeVisible();
    expect(projectError).toHaveClass('sm:absolute', 'sm:top-full');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('단일 선택 popup에서 Home과 End 키로 옵션 포커스를 이동한다', async () => {
    const user = userEvent.setup();
    renderCreate();
    await user.click(getToolbarButton(labels.priorityLabel));
    const low = screen.getByRole('option', { name: labels.priorities.LOW });
    low.focus();

    await user.keyboard('{End}');
    expect(screen.getByRole('option', { name: labels.priorities.URGENT })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('option', { name: labels.priorities.NONE })).toHaveFocus();
  });
});
