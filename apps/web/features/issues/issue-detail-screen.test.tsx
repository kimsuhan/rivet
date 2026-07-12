import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PropsWithChildren, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, type IssueDetailResponseDto } from '@rivet/api-client';

import { IssueDetailScreen } from './issue-detail-screen';

const translations = vi.hoisted(() => ({
  archived: '보관됨',
  assignee: '담당자',
  backToMyIssues: '내 이슈로 이동',
  'children.progress': '1/2 완료 · 50%',
  'conflict.description':
    '최신 값을 불러왔습니다. 비교한 뒤 내 변경을 최신 버전에 다시 적용할 수 있습니다.',
  'conflict.latest': '최신 값',
  'conflict.mine': '내 변경',
  'conflict.reapply': '내 변경 다시 적용',
  'conflict.title': '다른 변경이 먼저 저장되었습니다',
  'conflict.unknown': '최신 값을 불러오지 못했습니다.',
  createdAt: '만든 날짜',
  createdBy: '만든 사람',
  errorDescription: '잠시 후 다시 시도해 주세요.',
  errorTitle: '이슈를 불러오지 못했습니다',
  feature: '기능 이슈',
  'featureStatuses.DONE': '완료',
  'featureStatuses.UNSORTED': '미분류',
  labels: '라벨',
  loading: '이슈를 불러오는 중입니다.',
  loadingOptions: '불러오는 중',
  noLabels: '라벨 없음',
  notFoundDescription: '삭제되었거나 이 워크스페이스에서 접근할 수 없는 이슈입니다.',
  notFoundTitle: '이슈를 찾을 수 없습니다',
  optionsErrorDescription: '현재 값은 그대로 유지됩니다. 다시 불러와 주세요.',
  optionsErrorTitle: '선택 항목을 불러오지 못했습니다',
  overview: '개요',
  priorities: '',
  'priorities.HIGH': '높음',
  'priorities.LOW': '낮음',
  'priorities.MEDIUM': '보통',
  'priorities.NONE': '없음',
  'priorities.URGENT': '긴급',
  priority: '우선순위',
  projectImmutableErrorDescription:
    '프로젝트 연결 변경을 취소했습니다. 기능 이슈와 하위 작업의 프로젝트 연결은 개별적으로 변경할 수 없습니다. 최신 상태를 확인해 주세요.',
  projectImmutableErrorTitle: '프로젝트 연결을 변경할 수 없습니다',
  refreshLatest: '최신 상태 다시 불러오기',
  properties: '속성',
  retry: '다시 시도',
  saveErrorDescription: '변경 전 상태로 되돌렸습니다. 입력을 확인한 뒤 다시 시도해 주세요.',
  saveErrorTitle: '변경을 저장하지 못했습니다',
  saveTitle: '제목 저장',
  saving: '저장 중',
  state: '상태',
  team: '팀',
  teamTask: '팀 작업',
  titleLabel: '이슈 제목',
  titleRequired: '제목을 입력해 주세요.',
  titleTooLong: '제목은 500자 이하여야 합니다.',
  'trash.action': '휴지통으로 이동',
  'trash.blocksDescription': '현재 작업이 차단 중인 관계를 해제한 뒤 다시 시도해 주세요.',
  'trash.blocksTitle': '다른 작업을 차단하고 있어 이동할 수 없습니다',
  'trash.childrenDescription':
    '하위 팀 작업을 다른 기능 이슈로 옮기거나 먼저 휴지통으로 이동한 뒤 다시 시도해 주세요.',
  'trash.childrenTitle': '하위 팀 작업이 있어 이동할 수 없습니다',
  'trash.confirm': '이슈를 휴지통으로 이동',
  'trash.conflictDescription':
    '최신 이슈를 다시 불러왔습니다. 변경 내용을 확인한 뒤 다시 시도해 주세요.',
  'trash.conflictTitle': '이슈가 이미 변경되었습니다',
  'trash.description':
    '일반 목록과 검색에서 즉시 사라집니다. 관련 기록과 첨부파일 참조는 유지되며, 30일 동안 관리자가 휴지통에서 복구할 수 있습니다.',
  'trash.errorDescription': '현재 이슈와 연결 상태를 확인한 뒤 다시 시도해 주세요.',
  'trash.errorTitle': '이슈를 휴지통으로 이동하지 못했습니다',
  'trash.moving': '이슈를 휴지통으로 이동하는 중입니다.',
  'trash.openChildren': '하위 팀 작업 확인',
  'trash.openRelations': '차단 관계 확인',
  'trash.title': '이슈를 휴지통으로 이동할까요?',
  'handoff.completionRequiredError':
    '입력 내용은 유지했습니다. 현재 상태를 확인하고 완료 상태를 다시 선택한 뒤 ‘전달하고 완료’를 실행해 주세요.',
  unassigned: '담당자 없음',
}));

const mocks = vi.hoisted(() => ({
  createHandoffHook: vi.fn(),
  createHandoffMutate: vi.fn(),
  createHandoffReset: vi.fn(),
  issueHook: vi.fn(),
  issueRefetch: vi.fn(),
  labelsHook: vi.fn(),
  labelsRefetch: vi.fn(),
  membersHook: vi.fn(),
  membersRefetch: vi.fn(),
  mutate: vi.fn(),
  mutationHook: vi.fn(),
  push: vi.fn(),
  refreshLatest: vi.fn(),
  reapplyConflict: vi.fn(),
  resetMutation: vi.fn(),
  retryMutation: vi.fn(),
  sessionHook: vi.fn(),
  statesHook: vi.fn(),
  statesRefetch: vi.fn(),
  trashHook: vi.fn(),
  trashMutate: vi.fn(),
  trashReset: vi.fn(),
}));

let queryClient: QueryClient;

function QueryWrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

vi.mock('@rivet/api-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useIssueCollaborationControllerCreateHandoff: mocks.createHandoffHook,
  useIssuesControllerGet: mocks.issueHook,
  useAuthControllerGetSession: mocks.sessionHook,
  useLabelsControllerList: mocks.labelsHook,
  useMembersControllerList: mocks.membersHook,
  useTeamsControllerListWorkflowStates: mocks.statesHook,
  useIssuesControllerTrash: mocks.trashHook,
}));

vi.mock('next-intl', () => ({
  useTranslations: () => {
    const translate = (key: string) => translations[key as keyof typeof translations] ?? key;
    translate.raw = (key: string) => (key === 'characterCount' ? '{current}/{max}자' : key);
    return translate;
  },
}));

vi.mock('@/features/collaboration/markdown-editor', () => ({
  MarkdownEditor: ({
    error,
    onCanSubmitChange,
    onChange,
    value,
  }: {
    error?: string | null;
    onCanSubmitChange: (ready: boolean) => void;
    onChange: (value: string) => void;
    value: string;
  }) => (
    <>
      <textarea
        aria-label="editorLabel"
        value={value}
        onChange={(event) => {
          onChange(event.currentTarget.value);
          onCanSubmitChange(true);
        }}
      />
      {error ? <p>{error}</p> : null}
    </>
  ),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock('./issue-mutations', () => ({
  useIssueInlineMutation: mocks.mutationHook,
}));

const workflowState = {
  category: 'UNSTARTED',
  id: '93331a10-3dc7-44cd-820c-33b74c63dc2f',
  isDefault: true,
  name: '할 일',
  position: 0,
  version: 1,
} as const;
const completedState = {
  category: 'COMPLETED',
  id: '1bcb95ca-6b78-42c9-97c3-c3e6fab25703',
  isDefault: false,
  name: '완료',
  position: 1,
  version: 1,
} as const;
const activeMember = {
  id: 'member-active',
  role: 'MEMBER',
  status: 'ACTIVE',
  user: { avatarFileId: null, displayName: '활성 담당자', id: 'user-active' },
} as const;
const selectedArchivedLabel = {
  archived: true,
  color: '#8A8F98',
  id: 'label-legacy',
  name: '레거시',
  version: 2,
} as const;
const selectedActiveLabel = {
  archived: false,
  color: '#72A7F2',
  id: 'label-bug',
  name: '버그',
  version: 1,
} as const;
const unselectedArchivedLabel = {
  archived: true,
  color: '#8A8F98',
  id: 'label-old',
  name: '옛 라벨',
  version: 3,
} as const;
const attachableLabel = {
  archived: false,
  color: '#45C46B',
  id: 'label-improvement',
  name: '개선',
  version: 1,
} as const;

const issue = {
  assignee: null,
  attachments: [],
  blocked: false,
  blockers: [],
  blocking: [],
  createdAt: '2026-07-01T00:00:00.000Z',
  createdBy: {
    id: 'membership-creator',
    role: 'MEMBER',
    status: 'ACTIVE',
    user: { avatarFileId: null, displayName: '작성자 김', id: 'user-creator' },
  },
  descriptionMarkdown: null,
  handoffSummary: null,
  id: '7c8fc5da-cccb-4478-b9b0-78ec539e9271',
  identifier: 'API-1',
  labels: [selectedArchivedLabel, selectedActiveLabel],
  parentIssue: null,
  priority: 'NONE',
  progress: null,
  project: null,
  projectRole: null,
  status: {
    category: 'UNSTARTED',
    featureStatus: null,
    workflowState,
  },
  team: {
    archived: false,
    id: '6f83906f-6883-4434-b7e2-4156fca910a1',
    key: 'API',
    name: 'API 팀',
  },
  title: '첫 이슈',
  type: 'TEAM_TASK',
  updatedAt: '2026-07-01T00:00:00.000Z',
  version: 1,
} satisfies IssueDetailResponseDto;

function issueQuery(data: IssueDetailResponseDto = issue) {
  return {
    data,
    error: null,
    isError: false,
    isPending: false,
    refetch: mocks.issueRefetch,
  };
}

function mutationResult(overrides: Record<string, unknown> = {}) {
  return {
    conflict: null,
    error: null,
    isError: false,
    isPending: false,
    latestRecoveryFailed: false,
    mutate: mocks.mutate,
    refreshLatest: mocks.refreshLatest,
    reapplyConflict: mocks.reapplyConflict,
    reset: mocks.resetMutation,
    retry: mocks.retryMutation,
    variables: undefined,
    ...overrides,
  };
}

type TrashCallbacks = {
  onError?: (error: ApiError<{ code: string }>) => void;
  onSuccess?: () => void;
};

describe('IssueDetailScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mocks.issueHook.mockReturnValue(issueQuery());
    mocks.sessionHook.mockReturnValue({
      data: { authenticated: true, membership: { id: activeMember.id } },
      isError: false,
      isPending: false,
    });
    mocks.statesHook.mockReturnValue({
      data: { items: [workflowState], nextCursor: null },
      isError: false,
      isPending: false,
      refetch: mocks.statesRefetch,
    });
    mocks.membersHook.mockReturnValue({
      data: { items: [activeMember], nextCursor: null },
      isError: false,
      isPending: false,
      refetch: mocks.membersRefetch,
    });
    mocks.labelsHook.mockReturnValue({
      data: {
        items: [
          selectedArchivedLabel,
          selectedActiveLabel,
          unselectedArchivedLabel,
          attachableLabel,
        ],
        nextCursor: null,
      },
      isError: false,
      isPending: false,
      refetch: mocks.labelsRefetch,
    });
    mocks.createHandoffHook.mockReturnValue({
      error: null,
      isError: false,
      isPending: false,
      mutate: mocks.createHandoffMutate,
      reset: mocks.createHandoffReset,
    });
    mocks.mutationHook.mockReturnValue(mutationResult());
    mocks.trashHook.mockReturnValue({
      error: null,
      isError: false,
      isPending: false,
      mutate: mocks.trashMutate,
      reset: mocks.trashReset,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('상세 조회 중에는 최종 레이아웃 로딩 상태를 표시한다', () => {
    mocks.issueHook.mockReturnValue({
      data: undefined,
      error: null,
      isError: false,
      isPending: true,
      refetch: mocks.issueRefetch,
    });

    render(<IssueDetailScreen issueRef="API-1" />, { wrapper: QueryWrapper });

    expect(screen.getByRole('status')).toHaveTextContent(translations.loading);
    expect(screen.getByLabelText(translations.loading)).toHaveAttribute('aria-busy', 'true');
  });

  it('일반 조회 오류는 입력 재시도 동작을 제공한다', async () => {
    const user = userEvent.setup();
    mocks.issueHook.mockReturnValue({
      data: undefined,
      error: new ApiError(
        500,
        {
          code: 'INTERNAL_ERROR',
          fieldErrors: {},
          message: '실패',
          requestId: 'request-id',
        },
        'request-id',
      ),
      isError: true,
      isPending: false,
      refetch: mocks.issueRefetch,
    });

    render(<IssueDetailScreen issueRef="API-1" />, { wrapper: QueryWrapper });

    expect(screen.getByRole('heading', { level: 1, name: translations.errorTitle })).toBeVisible();
    await user.click(screen.getByRole('button', { name: translations.retry }));
    expect(mocks.issueRefetch).toHaveBeenCalledOnce();
  });

  it('404는 찾을 수 없음과 안전한 내 이슈 이동을 표시한다', () => {
    mocks.issueHook.mockReturnValue({
      data: undefined,
      error: new ApiError(
        404,
        {
          code: 'RESOURCE_NOT_FOUND',
          fieldErrors: {},
          message: '없음',
          requestId: 'request-id',
        },
        'request-id',
      ),
      isError: true,
      isPending: false,
      refetch: mocks.issueRefetch,
    });

    render(<IssueDetailScreen issueRef="API-404" />, { wrapper: QueryWrapper });

    expect(
      screen.getByRole('heading', { level: 1, name: translations.notFoundTitle }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: translations.backToMyIssues })).toHaveAttribute(
      'href',
      '/my-issues',
    );
  });

  it('이슈 본문과 현재 팀 작업 속성을 접근 가능한 이름으로 표시한다', () => {
    render(<IssueDetailScreen issueRef="API-1" />, { wrapper: QueryWrapper });

    expect(screen.getByRole('heading', { level: 1, name: 'API-1: 첫 이슈' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: translations.titleLabel })).toHaveValue('첫 이슈');
    expect(screen.getByText('작성자 김')).toBeVisible();
    expect(screen.getByText('API 팀 (API)')).toBeVisible();
    expect(screen.getByRole('combobox', { name: translations.state })).toHaveTextContent('할 일');
    expect(screen.getByRole('combobox', { name: translations.assignee })).toHaveTextContent(
      translations.unassigned,
    );
    expect(screen.getByRole('combobox', { name: translations.priority })).toHaveTextContent(
      translations['priorities.NONE'],
    );
    expect(screen.getByLabelText(translations.labels)).toHaveTextContent('레거시, 버그');
    expect(mocks.issueHook).toHaveBeenCalledWith('API-1', { query: { retry: false } });
  });

  it('휴지통 확인에서 즉시 목록 제거와 30일 복구 가능성을 설명하고 성공 후 안전한 목록으로 이동한다', async () => {
    const user = userEvent.setup();
    const invalidateQueries = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue(undefined);
    render(<IssueDetailScreen issueRef="API-1" />, { wrapper: QueryWrapper });

    await user.click(screen.getByRole('button', { name: translations['trash.action'] }));
    const dialog = screen.getByRole('alertdialog', { name: translations['trash.title'] });
    expect(within(dialog).getByText(translations['trash.description'])).toBeVisible();
    expect(within(dialog).getByText(/API-1 · 첫 이슈/)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: translations['trash.confirm'] }));

    expect(mocks.trashMutate).toHaveBeenCalledWith(
      { data: { version: issue.version }, issueId: issue.id },
      expect.any(Object),
    );
    act(() => {
      const callbacks = mocks.trashMutate.mock.calls[0]?.[1] as TrashCallbacks | undefined;
      callbacks?.onSuccess?.();
    });

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/my-issues'));
    expect(invalidateQueries).toHaveBeenCalled();
  });

  it.each([
    ['ISSUE_HAS_CHILDREN', 'trash.childrenTitle', 'trash.openChildren', '#feature-progress-title'],
    ['ISSUE_BLOCKS_OTHERS', 'trash.blocksTitle', 'trash.openRelations', '#issue-relations-title'],
  ] as const)(
    '%s 제한은 현재 상세의 해결 영역으로 안내한다',
    async (code, titleKey, actionKey, href) => {
      const user = userEvent.setup();
      render(<IssueDetailScreen issueRef="API-1" />, { wrapper: QueryWrapper });

      await user.click(screen.getByRole('button', { name: translations['trash.action'] }));
      await user.click(screen.getByRole('button', { name: translations['trash.confirm'] }));
      act(() => {
        const callbacks = mocks.trashMutate.mock.calls[0]?.[1] as TrashCallbacks | undefined;
        callbacks?.onError?.(new ApiError(409, { code }, 'request-id'));
      });

      expect(screen.getByText(translations[titleKey])).toBeVisible();
      expect(screen.getByRole('link', { name: translations[actionKey] })).toHaveAttribute(
        'href',
        href,
      );
    },
  );

  it('휴지통 version 충돌은 최신 상세를 다시 조회하고 이동하지 않는다', async () => {
    const user = userEvent.setup();
    render(<IssueDetailScreen issueRef="API-1" />, { wrapper: QueryWrapper });

    await user.click(screen.getByRole('button', { name: translations['trash.action'] }));
    await user.click(screen.getByRole('button', { name: translations['trash.confirm'] }));
    act(() => {
      const callbacks = mocks.trashMutate.mock.calls[0]?.[1] as TrashCallbacks | undefined;
      callbacks?.onError?.(new ApiError(409, { code: 'VERSION_CONFLICT' }, 'request-id'));
    });

    expect(screen.getByText(translations['trash.conflictDescription'])).toBeVisible();
    expect(mocks.issueRefetch).toHaveBeenCalledOnce();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('제목과 속성 변경을 현재 버전 이슈의 낙관적 mutation에 연결한다', async () => {
    const user = userEvent.setup();
    render(<IssueDetailScreen issueRef="API-1" />, { wrapper: QueryWrapper });

    const title = screen.getByRole('textbox', { name: translations.titleLabel });
    await user.clear(title);
    await user.type(title, '  새 제목  ');
    await user.click(screen.getByRole('button', { name: translations.saveTitle }));

    expect(mocks.mutate).toHaveBeenCalledWith(
      { change: { kind: 'title', value: '새 제목' }, issue },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );

    await user.click(screen.getByRole('combobox', { name: translations.priority }));
    await user.click(await screen.findByRole('option', { name: translations['priorities.HIGH'] }));
    expect(mocks.mutate).toHaveBeenLastCalledWith({
      change: { kind: 'priority', value: 'HIGH' },
      issue,
    });
  });

  it('VERSION_CONFLICT에서 최신값과 내 변경을 비교하고 재적용 성공 뒤 서버 제목을 따른다', async () => {
    const user = userEvent.setup();
    const view = render(<IssueDetailScreen issueRef="API-1" />, { wrapper: QueryWrapper });
    const attemptedChange = { kind: 'title' as const, value: '내 제목' };

    await user.clear(screen.getByRole('textbox', { name: translations.titleLabel }));
    await user.type(screen.getByRole('textbox', { name: translations.titleLabel }), '내 제목');
    await user.click(screen.getByRole('button', { name: translations.saveTitle }));

    const latest = { ...issue, title: '다른 사람이 바꾼 제목', version: 4 };
    mocks.issueHook.mockReturnValue(issueQuery(latest));
    mocks.mutationHook.mockReturnValue(
      mutationResult({
        conflict: { attemptedChange, issueRef: issue.identifier, latest },
        isError: true,
        variables: { change: attemptedChange, issue },
      }),
    );
    view.rerender(<IssueDetailScreen issueRef="API-1" />);

    expect(screen.getByText(translations['conflict.title'])).toBeVisible();
    expect(screen.getByText('다른 사람이 바꾼 제목')).toBeVisible();
    expect(screen.getByText('내 제목')).toBeVisible();
    expect(screen.getByRole('textbox', { name: translations.titleLabel })).toHaveValue('내 제목');

    await user.click(screen.getByRole('button', { name: translations['conflict.reapply'] }));
    expect(mocks.reapplyConflict).toHaveBeenCalledOnce();

    mocks.mutationHook.mockReturnValue(
      mutationResult({ variables: { change: attemptedChange, issue: latest } }),
    );
    mocks.issueHook.mockReturnValue(issueQuery({ ...latest, title: '내 제목', version: 5 }));
    view.rerender(<IssueDetailScreen issueRef="API-1" />);
    expect(screen.getByRole('textbox', { name: translations.titleLabel })).toHaveValue('내 제목');

    mocks.issueHook.mockReturnValue(issueQuery({ ...latest, title: '후속 서버 제목', version: 6 }));
    view.rerender(<IssueDetailScreen issueRef="API-1" />);
    expect(screen.getByRole('textbox', { name: translations.titleLabel })).toHaveValue(
      '후속 서버 제목',
    );
  });

  it('프로젝트 불변 오류의 최신 조회 실패는 같은 변경 대신 최신값 재조회만 제공한다', async () => {
    const user = userEvent.setup();
    const attemptedChange = { kind: 'priority' as const, value: 'HIGH' as const };
    mocks.mutationHook.mockReturnValue(
      mutationResult({
        error: new ApiError(
          409,
          {
            code: 'ISSUE_PROJECT_IMMUTABLE',
            fieldErrors: {},
            message: '프로젝트를 변경할 수 없습니다.',
            requestId: 'request-id',
          },
          'request-id',
        ),
        isError: true,
        latestRecoveryFailed: true,
        variables: { change: attemptedChange, issue },
      }),
    );

    render(<IssueDetailScreen issueRef="API-1" />, { wrapper: QueryWrapper });

    expect(screen.getByText(translations.projectImmutableErrorTitle)).toBeVisible();
    expect(screen.getByText(translations.projectImmutableErrorDescription)).toBeVisible();
    expect(screen.queryByRole('button', { name: translations.retry })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: translations.refreshLatest }));
    expect(mocks.refreshLatest).toHaveBeenCalledOnce();
  });

  it('설명 버전 충돌은 서버 최신 설명과 작성한 설명을 함께 보여 준다', async () => {
    const attemptedChange = { kind: 'description' as const, value: '내 설명' };
    const latest = { ...issue, descriptionMarkdown: '서버 최신 설명', version: 3 };
    mocks.issueHook.mockReturnValue(issueQuery(latest));
    mocks.mutationHook.mockReturnValue(
      mutationResult({
        conflict: { attemptedChange, issueRef: issue.identifier, latest },
        isError: true,
        variables: { change: attemptedChange, issue },
      }),
    );

    render(<IssueDetailScreen issueRef="API-1" />, { wrapper: QueryWrapper });

    expect(screen.getAllByText('서버 최신 설명').length).toBeGreaterThan(0);
    expect(screen.getByText('내 설명')).toBeVisible();
    expect(screen.getByRole('button', { name: translations['conflict.reapply'] })).toBeVisible();
  });

  it('기존 보관 라벨은 해제할 수 있지만 보관 라벨을 새로 연결할 수는 없다', async () => {
    const user = userEvent.setup();
    render(<IssueDetailScreen issueRef="API-1" />, { wrapper: QueryWrapper });

    await user.click(screen.getByLabelText(translations.labels));
    const selectedArchived = screen.getByRole('checkbox', { name: /레거시/ });
    const unselectedArchived = screen.getByRole('checkbox', { name: /옛 라벨/ });
    const attachable = screen.getByRole('checkbox', { name: '개선' });

    expect(selectedArchived).toBeChecked();
    expect(selectedArchived).toBeEnabled();
    expect(unselectedArchived).not.toBeChecked();
    expect(unselectedArchived).toHaveAttribute('aria-disabled', 'true');

    await user.click(selectedArchived);
    expect(mocks.mutate).toHaveBeenLastCalledWith({
      change: { kind: 'labels', value: [selectedActiveLabel] },
      issue,
    });

    await user.click(attachable);
    expect(mocks.mutate).toHaveBeenLastCalledWith({
      change: {
        kind: 'labels',
        value: [selectedArchivedLabel, selectedActiveLabel, attachableLabel],
      },
      issue,
    });
  });

  it('기능 이슈는 팀 속성 없이 고정 상태와 하위 작업 진행률을 표시하고 상태를 변경한다', async () => {
    const user = userEvent.setup();
    const featureIssue = {
      ...issue,
      identifier: 'FEAT-1',
      progress: { completed: 1, percentage: 50, total: 2 },
      project: {
        archived: false,
        id: 'project-id',
        name: '모바일 리뉴얼',
        status: 'IN_PROGRESS',
      },
      status: { category: 'BACKLOG', featureStatus: 'UNSORTED', workflowState: null },
      team: null,
      type: 'FEATURE',
    } satisfies IssueDetailResponseDto;
    mocks.issueHook.mockReturnValue(issueQuery(featureIssue));

    render(<IssueDetailScreen issueRef="FEAT-1" />, { wrapper: QueryWrapper });

    expect(screen.getByText(translations.feature)).toBeVisible();
    expect(screen.getByText('모바일 리뉴얼')).toBeVisible();
    expect(screen.queryByRole('combobox', { name: translations.assignee })).not.toBeInTheDocument();
    expect(screen.getByText(translations['children.progress'])).toBeVisible();

    await user.click(screen.getByRole('combobox', { name: translations.state }));
    await user.click(
      await screen.findByRole('option', { name: translations['featureStatuses.DONE'] }),
    );
    expect(mocks.mutate).toHaveBeenLastCalledWith({
      change: { kind: 'featureStatus', value: 'DONE' },
      issue: featureIssue,
    });
  });

  it('미완료 프론트 작업을 막는 백엔드 작업 완료 시 일곱 섹션 전달을 같은 변경에 포함한다', async () => {
    const user = userEvent.setup();
    const backendIssue = {
      ...issue,
      blocking: [
        {
          createdAt: '2026-07-02T00:00:00.000Z',
          id: 'relation-id',
          issue: {
            category: 'UNSTARTED',
            featureStatus: null,
            id: 'web-issue-id',
            identifier: 'WEB-2',
            projectRole: 'WEB_FRONTEND',
            title: '웹 연결',
          },
          resolved: false,
        },
      ],
      projectRole: 'BACKEND',
    } satisfies IssueDetailResponseDto;
    mocks.issueHook.mockReturnValue(issueQuery(backendIssue));
    mocks.statesHook.mockReturnValue({
      data: { items: [workflowState, completedState], nextCursor: null },
      isError: false,
      isPending: false,
      refetch: mocks.statesRefetch,
    });

    render(<IssueDetailScreen issueRef="API-1" />, { wrapper: QueryWrapper });

    await user.click(screen.getByRole('combobox', { name: translations.state }));
    await user.click(await screen.findByRole('option', { name: completedState.name }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeVisible();
    expect(within(dialog).getByRole('textbox', { name: 'editorLabel' })).toHaveTextContent(
      '프론트 주의사항',
    );

    await user.click(screen.getByRole('button', { name: 'handoff.submitAndComplete' }));
    expect(mocks.mutate).toHaveBeenLastCalledWith(
      {
        change: {
          handoff: { bodyMarkdown: expect.stringContaining('## API 명세 링크') },
          kind: 'workflowState',
          value: completedState,
        },
        issue: backendIssue,
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('완료 전이가 아닌 작업 전달 오류는 본문을 유지하고 완료 상태 재선택을 안내한다', async () => {
    const user = userEvent.setup();
    const backendIssue = {
      ...issue,
      blocking: [
        {
          createdAt: '2026-07-02T00:00:00.000Z',
          id: 'relation-id',
          issue: {
            category: 'UNSTARTED',
            featureStatus: null,
            id: 'web-issue-id',
            identifier: 'WEB-2',
            projectRole: 'WEB_FRONTEND',
            title: '웹 연결',
          },
          resolved: false,
        },
      ],
      projectRole: 'BACKEND',
    } satisfies IssueDetailResponseDto;
    mocks.issueHook.mockReturnValue(issueQuery(backendIssue));
    mocks.statesHook.mockReturnValue({
      data: { items: [workflowState, completedState], nextCursor: null },
      isError: false,
      isPending: false,
      refetch: mocks.statesRefetch,
    });
    const view = render(<IssueDetailScreen issueRef="API-1" />, { wrapper: QueryWrapper });

    await user.click(screen.getByRole('combobox', { name: translations.state }));
    await user.click(await screen.findByRole('option', { name: completedState.name }));
    const editor = within(screen.getByRole('dialog')).getByRole('textbox', {
      name: 'editorLabel',
    });
    await user.type(editor, '\n\n사용자가 남긴 고유 전달 내용');
    expect((editor as HTMLTextAreaElement).value).toContain('사용자가 남긴 고유 전달 내용');
    await user.click(screen.getByRole('button', { name: 'handoff.submitAndComplete' }));

    const error = new ApiError(
      422,
      {
        code: 'HANDOFF_REQUIRES_COMPLETION',
        fieldErrors: {},
        message: '완료 전이가 필요합니다.',
        requestId: 'request-id',
      },
      'request-id',
    );
    act(() => {
      mocks.mutate.mock.calls.at(-1)?.[1]?.onError?.(error);
    });
    await waitFor(() => expect(mocks.statesRefetch).toHaveBeenCalledOnce());

    mocks.mutationHook.mockReturnValue(
      mutationResult({
        error,
        isError: true,
        variables: {
          change: {
            handoff: { bodyMarkdown: (editor as HTMLTextAreaElement).value },
            kind: 'workflowState',
            value: completedState,
          },
          issue: backendIssue,
        },
      }),
    );
    view.rerender(<IssueDetailScreen issueRef="API-1" />);

    expect(screen.getByText(translations['handoff.completionRequiredError'])).toBeVisible();
    expect(
      (
        within(screen.getByRole('dialog')).getByRole('textbox', {
          name: 'editorLabel',
        }) as HTMLTextAreaElement
      ).value,
    ).toContain('사용자가 남긴 고유 전달 내용');
    expect(screen.queryByRole('button', { name: translations.retry })).not.toBeInTheDocument();
  });

  it('최초 전달이 있으면 추가 전달 UI가 FOLLOW_UP kind를 전송한다', async () => {
    const user = userEvent.setup();
    const backendIssue = {
      ...issue,
      handoffSummary: {
        count: 1,
        hasInitial: true,
        latestCreatedAt: '2026-07-02T00:00:00.000Z',
      },
      projectRole: 'BACKEND',
    } satisfies IssueDetailResponseDto;
    mocks.issueHook.mockReturnValue(issueQuery(backendIssue));

    render(<IssueDetailScreen issueRef="API-1" />, { wrapper: QueryWrapper });

    await user.click(screen.getByRole('button', { name: 'handoff.addFollowUp' }));
    const dialog = screen.getByRole('dialog', { name: 'handoff.followUpTitle' });
    await user.click(within(dialog).getByRole('button', { name: 'handoff.submit' }));

    expect(mocks.createHandoffMutate).toHaveBeenCalledWith(
      {
        data: {
          bodyMarkdown: expect.stringContaining('## API 명세 링크'),
          kind: 'FOLLOW_UP',
        },
        issueId: backendIssue.id,
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});
