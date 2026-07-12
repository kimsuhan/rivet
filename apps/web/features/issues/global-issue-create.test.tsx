import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GlobalIssueCreate, type IssueCreateSeed } from './global-issue-create';

type CreateCallbacks = {
  onError?: (error: { body: { code: string; fieldErrors: Record<string, string[]> } }) => void;
  onSuccess?: (issue: { id: string; identifier: string }) => Promise<void> | void;
};

const ids = vi.hoisted(() => ({
  apiMember: '00000000-0000-4000-8000-000000000022',
  apiState: '00000000-0000-4000-8000-000000000012',
  apiTeam: '00000000-0000-4000-8000-000000000002',
  label: '00000000-0000-4000-8000-000000000031',
  parent: '00000000-0000-4000-8000-000000000041',
  project: '00000000-0000-4000-8000-000000000051',
  webMember: '00000000-0000-4000-8000-000000000021',
  webState: '00000000-0000-4000-8000-000000000011',
  webTeam: '00000000-0000-4000-8000-000000000001',
}));

const mocks = vi.hoisted(() => ({
  mutate:
    vi.fn<(variables: { data: Record<string, unknown> }, callbacks?: CreateCallbacks) => void>(),
  mutationReset: vi.fn(),
  onOpenChange: vi.fn(),
  push: vi.fn(),
  refetch: vi.fn(),
  removeFile: vi.fn(),
  uploadFile: vi.fn(),
}));

vi.mock('@rivet/api-client', () => ({
  filesControllerDelete: mocks.removeFile,
  filesControllerUpload: mocks.uploadFile,
  getIssuesControllerGetQueryKey: (issueRef: string) => [`/api/v1/issues/${issueRef}`],
  getIssuesControllerListQueryKey: () => ['/api/v1/issues'],
  useIssuesControllerCreate: () => ({
    error: null,
    isError: false,
    isPending: false,
    mutate: mocks.mutate,
    reset: mocks.mutationReset,
  }),
  useLabelsControllerList: () => ({
    data: {
      items: [
        {
          archived: false,
          color: '#2563EB',
          id: ids.label,
          name: '버그',
          version: 1,
        },
      ],
      nextCursor: null,
    },
    isError: false,
    isPending: false,
    refetch: mocks.refetch,
  }),
  useMembersControllerList: ({ teamId }: { teamId: string }) => ({
    data: {
      items:
        teamId === ids.apiTeam
          ? [{ id: ids.apiMember, user: { displayName: 'API 담당자' } }]
          : [{ id: ids.webMember, user: { displayName: '웹 담당자' } }],
      nextCursor: null,
    },
    isError: false,
    isPending: false,
    refetch: mocks.refetch,
  }),
  useIssuesControllerList: () => ({
    data: {
      items: [
        {
          id: ids.parent,
          identifier: 'F-1',
          title: '결제 기능',
        },
      ],
      nextCursor: null,
    },
    isError: false,
    isPending: false,
    refetch: mocks.refetch,
  }),
  useProjectsControllerList: () => ({
    data: {
      items: [
        {
          archived: false,
          id: ids.project,
          name: '결제 프로젝트',
          roleTeams: [
            {
              role: 'BACKEND',
              team: { archived: false, id: ids.webTeam, key: 'WEB', name: '웹 팀' },
            },
          ],
          status: 'IN_PROGRESS',
        },
      ],
      nextCursor: null,
    },
    isError: false,
    isPending: false,
    refetch: mocks.refetch,
  }),
  useTeamsControllerList: () => ({
    data: {
      items: [
        { archived: false, id: ids.webTeam, key: 'WEB', name: '웹 팀' },
        { archived: false, id: ids.apiTeam, key: 'API', name: 'API 팀' },
      ],
      nextCursor: null,
    },
    isError: false,
    isPending: false,
    refetch: mocks.refetch,
  }),
  useTeamsControllerListWorkflowStates: (teamId: string) => ({
    data: {
      items:
        teamId === ids.apiTeam
          ? [{ id: ids.apiState, isDefault: true, name: '계획' }]
          : [{ id: ids.webState, isDefault: true, name: '할 일' }],
      nextCursor: null,
    },
    isError: false,
    isPending: false,
    refetch: mocks.refetch,
  }),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => {
    const translate = (key: string) => key;
    translate.raw = (key: string) => (key === 'characterCount' ? '{current}/{max}자' : key);
    return translate;
  },
}));

vi.mock('@/features/collaboration/markdown-editor', () => ({
  MarkdownEditor: ({
    onCanSubmitChange,
    onChange,
    value,
  }: {
    onCanSubmitChange: (ready: boolean) => void;
    onChange: (value: string) => void;
    value: string;
  }) => (
    <textarea
      aria-label="editorLabel"
      value={value}
      onChange={(event) => {
        onChange(event.currentTarget.value);
        onCanSubmitChange(true);
      }}
    />
  ),
}));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}));

const labels = {
  assigneeLabel: '담당자',
  assigneePlaceholder: '담당자 선택',
  cancel: '취소',
  close: '이슈 만들기 닫기',
  description: '핵심 속성만 입력합니다.',
  discardChanges: '입력 내용 버리기',
  discardDescription: '입력한 내용이 저장되지 않습니다.',
  discardTitle: '작성 중인 이슈를 닫을까요?',
  errorDescription: '입력값을 유지했습니다.',
  errorTitle: '이슈를 만들지 못했습니다',
  featureStatuses: {
    CANCELED: '취소',
    DONE: '완료',
    IN_PROGRESS: '진행 중',
    PAUSED: '일시 중지',
    REVIEW: '검토',
    TODO: '할 일',
    UNSORTED: '분류 안 됨',
  },
  featureType: '기능 이슈',
  keepEditing: '계속 작성',
  labelsLabel: '라벨',
  labelsUnavailable: '라벨 오류',
  mobileDescription: '넓은 화면에서 만들어 주세요.',
  mobileTitle: '데스크톱에서 사용할 수 있습니다',
  noLabels: '라벨 없음',
  noParent: '상위 이슈 없음',
  noProject: '프로젝트 없음',
  optionsErrorDescription: '항목을 다시 불러와 주세요.',
  optionsErrorTitle: '항목 오류',
  optionsLoading: '불러오는 중',
  parentLabel: '상위 기능 이슈',
  parentPlaceholder: '상위 기능 이슈 선택',
  priorities: {
    HIGH: '높음',
    LOW: '낮음',
    MEDIUM: '보통',
    NONE: '없음',
    URGENT: '긴급',
  },
  priorityLabel: '우선순위',
  projectLabel: '프로젝트',
  projectPlaceholder: '프로젝트 선택',
  projectRequired: '프로젝트를 선택해 주세요.',
  projectRoleLabel: '프로젝트 역할',
  projectRolePlaceholder: '역할 선택',
  projectRoleRequired: '프로젝트 역할을 선택해 주세요.',
  projectRoles: {
    APP_FRONTEND: '앱 프론트',
    BACKEND: '백엔드',
    WEB_FRONTEND: '웹 프론트',
  },
  retry: '다시 시도',
  shortcutHint: '⌘/Ctrl + Enter로 만들기',
  stateLabel: '상태',
  statePlaceholder: '상태 선택',
  stateRequired: '상태를 선택해 주세요.',
  submit: '이슈 만들기',
  submitting: '이슈를 만드는 중입니다.',
  teamLabel: '팀',
  teamLockedByRole: '역할의 담당 팀으로 고정됩니다.',
  teamPlaceholder: '팀 선택',
  teamRequired: '팀을 선택해 주세요.',
  teamTaskType: '팀 작업',
  title: '이슈 만들기',
  titleLabel: '제목',
  titlePlaceholder: '할 일 입력',
  titleRequired: '제목을 입력해 주세요.',
  titleTooLong: '제목이 너무 깁니다.',
  typeLabel: '이슈 유형',
  unassigned: '담당자 없음',
};

let queryClient: QueryClient;

function renderCreate({
  currentTeamKey = null,
  seed = null,
}: { currentTeamKey?: string | null; seed?: IssueCreateSeed | null } = {}) {
  return render(
    <QueryClientProvider client={queryClient}>
      <GlobalIssueCreate
        currentTeamKey={currentTeamKey}
        labels={labels}
        onOpenChange={mocks.onOpenChange}
        open
        seed={seed}
      />
    </QueryClientProvider>,
  );
}

describe('GlobalIssueCreate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mocks.uploadFile.mockResolvedValue({
      createdAt: '2026-07-01T00:00:00.000Z',
      detectedMimeType: 'text/plain',
      id: '00000000-0000-4000-8000-000000000099',
      inlineDisplayable: false,
      linked: false,
      originalName: 'contract.txt',
      scope: 'WORKSPACE',
      sizeBytes: 8,
    });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('현재 팀 경로를 마지막 팀보다 우선하고 기본 상태로 단축키 제출한다', async () => {
    window.localStorage.setItem('rivet:last-team-key:v1', 'WEB');
    const user = userEvent.setup();
    renderCreate({ currentTeamKey: 'API' });

    const title = screen.getByRole('textbox', { name: labels.titleLabel });
    await waitFor(() =>
      expect(screen.getByLabelText(labels.teamLabel)).toHaveTextContent('API 팀'),
    );
    await waitFor(() => expect(screen.getByLabelText(labels.stateLabel)).toHaveTextContent('계획'));
    await user.type(title, 'API 응답 계약 확인');
    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(mocks.mutate).toHaveBeenCalledWith(
      {
        data: {
          assigneeMembershipId: null,
          attachmentFileIds: [],
          descriptionMarkdown: null,
          labelIds: [],
          priority: 'NONE',
          teamId: ids.apiTeam,
          title: 'API 응답 계약 확인',
          type: 'TEAM_TASK',
          workflowStateId: ids.apiState,
        },
      },
      expect.any(Object),
    );
  });

  it('경로 팀이 유효하지 않으면 마지막 팀을 기본값으로 사용한다', async () => {
    window.localStorage.setItem('rivet:last-team-key:v1', 'WEB');
    renderCreate({ currentTeamKey: 'UNKNOWN' });

    await waitFor(() => expect(screen.getByLabelText(labels.teamLabel)).toHaveTextContent('웹 팀'));
    expect(screen.getByLabelText(labels.stateLabel)).toHaveTextContent('할 일');
  });

  it('팀을 바꾸면 기본 상태와 팀 담당자만 초기화하고 라벨은 유지한다', async () => {
    const user = userEvent.setup();
    renderCreate({ currentTeamKey: 'WEB' });
    await waitFor(() =>
      expect(screen.getByLabelText(labels.stateLabel)).toHaveTextContent('할 일'),
    );

    screen.getByLabelText(labels.assigneeLabel).focus();
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(screen.getByLabelText(labels.assigneeLabel)).toHaveTextContent('웹 담당자');
    await user.click(screen.getByRole('checkbox', { name: '버그' }));
    screen.getByLabelText(labels.teamLabel).focus();
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    await waitFor(() => expect(screen.getByLabelText(labels.stateLabel)).toHaveTextContent('계획'));
    expect(screen.getByLabelText(labels.assigneeLabel)).toHaveTextContent(labels.unassigned);
    expect(screen.getByRole('checkbox', { name: '버그' })).toBeChecked();
    expect(window.localStorage.getItem('rivet:last-team-key:v1')).toBe('API');
  });

  it('서버 필드 오류를 순서대로 연결하고 입력한 제목을 유지한다', async () => {
    const user = userEvent.setup();
    renderCreate({ currentTeamKey: 'WEB' });
    const title = screen.getByRole('textbox', { name: labels.titleLabel });
    await waitFor(() =>
      expect(screen.getByLabelText(labels.stateLabel)).toHaveTextContent('할 일'),
    );
    await user.type(title, '입력 유지');
    await user.click(screen.getByRole('button', { name: labels.submit }));

    act(() => {
      mocks.mutate.mock.calls[0]?.[1]?.onError?.({
        body: {
          code: 'VALIDATION_ERROR',
          fieldErrors: {
            teamId: ['팀을 다시 선택해 주세요.'],
            title: ['제목을 확인해 주세요.'],
          },
        },
      });
    });

    expect(await screen.findByText('제목을 확인해 주세요.')).toBeVisible();
    expect(screen.getByText('팀을 다시 선택해 주세요.')).toBeVisible();
    expect(title).toHaveValue('입력 유지');
    expect(title).toHaveFocus();
  });

  it('상위 기능 이슈의 프로젝트가 다르면 부모 입력을 유지하고 같은 프로젝트 후보를 다시 선택하게 한다', async () => {
    const user = userEvent.setup();
    renderCreate({
      seed: {
        parentIssueId: ids.parent,
        projectId: ids.project,
        projectRole: 'BACKEND',
        type: 'TEAM_TASK',
      },
    });
    const title = screen.getByRole('textbox', { name: labels.titleLabel });
    await waitFor(() =>
      expect(screen.getByLabelText(labels.parentLabel)).toHaveTextContent('F-1 · 결제 기능'),
    );
    await user.type(title, '부모 연결 유지');
    await user.click(screen.getByRole('button', { name: labels.submit }));

    act(() => {
      mocks.mutate.mock.calls[0]?.[1]?.onError?.({
        body: {
          code: 'PARENT_ISSUE_PROJECT_MISMATCH',
          fieldErrors: {},
        },
      });
    });

    expect(await screen.findByText('parentProjectMismatch')).toBeVisible();
    expect(screen.getByLabelText(labels.parentLabel)).toHaveFocus();
    expect(screen.getByLabelText(labels.parentLabel)).toHaveTextContent('F-1 · 결제 기능');
    expect(title).toHaveValue('부모 연결 유지');
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it('설명과 성공한 일반 첨부 ID를 생성 요청에 함께 보낸다', async () => {
    const user = userEvent.setup();
    renderCreate({ currentTeamKey: 'WEB' });
    await waitFor(() =>
      expect(screen.getByLabelText(labels.stateLabel)).toHaveTextContent('할 일'),
    );

    await user.type(screen.getByRole('textbox', { name: labels.titleLabel }), '협업 요청');
    await user.type(
      screen.getByRole('textbox', { name: 'editorLabel' }),
      '요청 계약을 확인합니다.',
    );
    await user.upload(
      screen.getByLabelText('chooseFiles'),
      new File(['contract'], 'contract.txt', { type: 'text/plain' }),
    );
    await screen.findByText('succeeded');
    await user.click(screen.getByRole('button', { name: labels.submit }));

    expect(mocks.mutate).toHaveBeenCalledWith(
      {
        data: expect.objectContaining({
          attachmentFileIds: ['00000000-0000-4000-8000-000000000099'],
          descriptionMarkdown: expect.stringContaining('요청 계약을 확인합니다.'),
        }),
      },
      expect.any(Object),
    );
  });

  it('일반 첨부 업로드가 끝나기 전에는 이슈 생성을 막는다', async () => {
    let finishUpload: ((value: Record<string, unknown>) => void) | undefined;
    mocks.uploadFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishUpload = resolve;
        }),
    );
    const user = userEvent.setup();
    renderCreate({ currentTeamKey: 'WEB' });
    await waitFor(() =>
      expect(screen.getByLabelText(labels.stateLabel)).toHaveTextContent('할 일'),
    );
    await user.type(screen.getByRole('textbox', { name: labels.titleLabel }), '업로드 대기');
    await user.upload(
      screen.getByLabelText('chooseFiles'),
      new File(['pending'], 'pending.txt', { type: 'text/plain' }),
    );

    expect(screen.getByRole('button', { name: labels.submit })).toBeDisabled();
    await act(async () => {
      finishUpload?.({
        createdAt: '2026-07-01T00:00:00.000Z',
        detectedMimeType: 'text/plain',
        id: '00000000-0000-4000-8000-000000000098',
        inlineDisplayable: false,
        linked: false,
        originalName: 'pending.txt',
        scope: 'WORKSPACE',
        sizeBytes: 7,
      });
    });
    await waitFor(() => expect(screen.getByRole('button', { name: labels.submit })).toBeEnabled());
  });

  it('dirty 상태에서 닫기를 요청하면 확인 후에만 입력을 버린다', async () => {
    const user = userEvent.setup();
    renderCreate();
    const title = screen.getByRole('textbox', { name: labels.titleLabel });
    await user.type(title, '작성 중');

    await user.click(screen.getByRole('button', { name: labels.close }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(labels.discardTitle);
    expect(mocks.onOpenChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: labels.keepEditing }));
    expect(title).toHaveValue('작성 중');

    await user.click(screen.getByRole('button', { name: labels.close }));
    await user.click(screen.getByRole('button', { name: labels.discardChanges }));
    expect(mocks.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('성공하면 이슈 목록을 무효화하고 표시 ID 상세로 이동한다', async () => {
    const user = userEvent.setup();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    renderCreate({ currentTeamKey: 'WEB' });
    await waitFor(() =>
      expect(screen.getByLabelText(labels.stateLabel)).toHaveTextContent('할 일'),
    );
    await user.type(screen.getByRole('textbox', { name: labels.titleLabel }), '완료 이동');
    await user.click(screen.getByRole('button', { name: labels.submit }));

    await act(async () => {
      await mocks.mutate.mock.calls[0]?.[1]?.onSuccess?.({ id: 'issue-id', identifier: 'WEB-42' });
    });

    const predicate = invalidate.mock.calls[0]?.[0]?.predicate;
    expect(predicate).toBeTypeOf('function');
    expect(predicate?.({ queryKey: ['/api/v1/issues?teamId=team-id'] } as never)).toBe(true);
    expect(predicate?.({ queryKey: ['/api/v1/teams'] } as never)).toBe(false);
    expect(mocks.onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.push).toHaveBeenCalledWith('/issues/WEB-42');
  });
});
