import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PropsWithChildren, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  getIssueCollaborationControllerTimelineQueryKey,
  getIssuesControllerGetQueryKey,
  type IssueDetailResponseDto,
  type IssueHandoffFlowResponseDto,
  type UpdateIssueResponseDto,
} from '@rivet/api-client';

import { IssueDetailScreen } from './issue-detail-screen';

const translations = vi.hoisted(() => ({
  archived: '보관됨',
  assignee: '담당자',
  backToMyIssues: '내 이슈로 이동',
  cancel: '취소',
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
  information: '정보',
  loading: '이슈를 불러오는 중입니다.',
  loadingOptions: '불러오는 중',
  noLabels: '라벨 없음',
  notFoundDescription: '삭제되었거나 이 워크스페이스에서 접근할 수 없는 이슈입니다.',
  notFoundTitle: '이슈를 찾을 수 없습니다',
  optionsErrorDescription: '현재 값은 그대로 유지됩니다. 다시 불러와 주세요.',
  optionsErrorTitle: '선택 항목을 불러오지 못했습니다',
  overview: '개요',
  parentFeature: '상위 이슈',
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
  'tabs.activity': '활동',
  'tabs.label': '상세 화면',
  'tabs.relations': '연결',
  'tabs.work': '업무',
  'timeline.activity.title': '활동',
  'timeline.comments.title': '댓글',
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
  'trash.openRelations': '작업 순서 확인',
  'trash.title': '이슈를 휴지통으로 이동할까요?',
  'handoff.completionRequiredError':
    '입력 내용은 유지했습니다. 현재 상태를 확인하고 완료 상태를 다시 선택한 뒤 ‘전달하고 완료’를 실행해 주세요.',
  'handoff.destinationDescription': '전달할 프론트 역할을 선택합니다.',
  'handoff.destinationLabel': '전달 대상',
  'handoff.destinationRequired': '전달 대상을 하나 이상 선택해 주세요.',
  'handoff.downstreamTasks': '전달받은 작업',
  'handoff.followUp': '추가 전달',
  'handoff.followUpNotice': '추가 전달 1건이 있습니다.',
  'handoff.followUpHistoryDescription': '전체 내용은 연결 탭의 전달 이력에서 확인할 수 있습니다.',
  'handoff.historyTitle': '전체 작업 전달 이력',
  'handoff.initial': '최초 전달',
  'handoff.openHistory': '전체 전달 이력 보기',
  'handoff.parentIssue': '상위 이슈',
  'handoff.receivedDescription': '이 작업에 전달된 최초 내용과 추가 전달을 확인합니다.',
  'handoff.receivedTitle': '전달받은 내용',
  'handoff.showBody': '전체 전달 내용 보기',
  'handoff.sourceTask': '전달한 백엔드 작업',
  'projectRoles.APP_FRONTEND': '앱 프론트',
  'projectRoles.BACKEND': '백엔드',
  'projectRoles.WEB_FRONTEND': '웹 프론트',
  'stateCategories.CANCELED': '취소',
  'stateCategories.COMPLETED': '완료',
  'stateCategories.UNSTARTED': '할 일',
  unassigned: '담당자 없음',
  updatedAt: '마지막 수정',
  'relations.add': '작업 순서 추가',
  'relations.after': '이 작업 다음에 시작',
  'relations.available': '작업 가능',
  'relations.before': '이 작업 전에 완료',
  'relations.blockedBy': '먼저 완료돼야 하는 작업',
  'relations.blocks': '이 작업 이후에 시작할 작업',
  'relations.contextTitle': '연결 정보',
  'relations.description': '이 작업 전후에 완료할 작업을 확인합니다.',
  'relations.direction': '관계',
  'relations.emptyDescription': '연결된 선행·후행 작업이 없습니다.',
  'relations.emptyTitle': '작업 순서',
  'relations.resolved': '완료된 선행 작업',
  'relations.remove': '작업 순서 삭제',
  'relations.target': '대상 작업',
  'relations.title': '작업 순서',
  'workflow.addTask': '팀 작업 추가',
  'workflow.available': '작업 가능',
  'workflow.canceled': '취소 단계',
  'workflow.completed': '완료 단계',
  'workflow.completedWork': '완료된 작업',
  'workflow.current': '현재 단계',
  'workflow.currentWork': '현재 작업',
  'workflow.emptyDescription': '분석이 끝났다면 작업을 시작할 팀을 선택해 주세요.',
  'workflow.emptyTitle': '아직 시작된 팀 작업이 없습니다',
  'workflow.expected': '전달 후 생성',
  'workflow.expectedWork': '예상 작업',
  'workflow.handoffs': '작업 전달',
  'workflow.moreActions': '작업 흐름 더보기',
  'workflow.progress': '1/2 완료 · 50%',
  'workflow.roleSelected': '선택됨',
  'workflow.start': '작업 시작',
  'workflow.startClose': '작업 시작 닫기',
  'workflow.startDialogDescription': '이 이슈에서 지금 함께 시작할 팀을 선택합니다.',
  'workflow.startErrorDescription': '선택한 팀과 최신 프로젝트 역할을 확인해 주세요.',
  'workflow.startRolesDescription': '하나 이상의 팀을 선택해 주세요.',
  'workflow.startRolesLabel': '처음 작업할 팀',
  'workflow.startTitle': '작업을 시작할 팀 선택',
  'workflow.title': '작업 흐름',
  'workflow.waitForPredecessors': '선행 작업 완료 대기',
  'workflow.waitForTask': '선행 작업 완료 후 시작 가능',
  'workSummary.completed': '팀 작업 2개 중 1개 완료',
  'workSummary.openOrder': '연결에서 작업 순서 보기',
  'workSummary.openRelations': '연결에서 전체 보기',
  'workSummary.title': '현재 작업 요약',
  'workSummary.waitingDescription': '선행 작업이 완료되면 이 작업을 시작할 수 있습니다.',
}));

const mocks = vi.hoisted(() => ({
  createHandoffHook: vi.fn(),
  createHandoffMutate: vi.fn(),
  createHandoffReset: vi.fn(),
  createRelationHook: vi.fn(),
  createRelationMutate: vi.fn(),
  issueGet: vi.fn(),
  issuesListHook: vi.fn(),
  issuesListRefetch: vi.fn(),
  issueHook: vi.fn(),
  issueRefetch: vi.fn(),
  labelsHook: vi.fn(),
  labelsRefetch: vi.fn(),
  membersHook: vi.fn(),
  membersRefetch: vi.fn(),
  mutate: vi.fn(),
  mutationHook: vi.fn(),
  projectHook: vi.fn(),
  projectRefetch: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  refreshLatest: vi.fn(),
  reapplyConflict: vi.fn(),
  removeRelationHook: vi.fn(),
  removeRelationMutate: vi.fn(),
  resetMutation: vi.fn(),
  retryMutation: vi.fn(),
  sessionHook: vi.fn(),
  statesHook: vi.fn(),
  statesRefetch: vi.fn(),
  startHook: vi.fn(),
  startMutate: vi.fn(),
  startReset: vi.fn(),
  trashHook: vi.fn(),
  trashMutate: vi.fn(),
  trashReset: vi.fn(),
  timeline: vi.fn(),
}));

let queryClient: QueryClient;

function QueryWrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

vi.mock('@rivet/api-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  issueCollaborationControllerTimeline: mocks.timeline,
  issuesControllerGet: mocks.issueGet,
  useIssueCollaborationControllerCreateHandoff: mocks.createHandoffHook,
  useIssueBlockRelationsControllerCreate: mocks.createRelationHook,
  useIssueBlockRelationsControllerRemove: mocks.removeRelationHook,
  useIssuesControllerGet: mocks.issueHook,
  useIssuesControllerList: mocks.issuesListHook,
  useIssuesControllerStart: mocks.startHook,
  useAuthControllerGetSession: mocks.sessionHook,
  useLabelsControllerList: mocks.labelsHook,
  useMembersControllerList: mocks.membersHook,
  useProjectsControllerGet: mocks.projectHook,
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

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
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
  usePathname: () => window.location.pathname,
  useRouter: () => ({
    push: mocks.push,
    replace: (href: string, options?: { scroll?: boolean }) => {
      mocks.replace(href, options);
      window.history.replaceState(window.history.state, '', href);
    },
  }),
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
    window.history.replaceState({}, '', '/issues/API-1');
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mocks.issueHook.mockReturnValue(issueQuery());
    mocks.timeline.mockResolvedValue({ items: [], nextCursor: null });
    mocks.issueRefetch.mockResolvedValue({ data: issue });
    mocks.issuesListHook.mockReturnValue({
      data: { items: [], nextCursor: null },
      isError: false,
      isPending: false,
      refetch: mocks.issuesListRefetch,
    });
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
    mocks.createRelationHook.mockReturnValue({
      error: null,
      isPending: false,
      mutate: mocks.createRelationMutate,
      reset: vi.fn(),
    });
    mocks.removeRelationHook.mockReturnValue({
      error: null,
      isPending: false,
      mutate: mocks.removeRelationMutate,
    });
    mocks.issueGet.mockResolvedValue(issue);
    mocks.mutationHook.mockReturnValue(mutationResult());
    mocks.projectHook.mockReturnValue({
      data: { roleTeams: [] },
      isError: false,
      isPending: false,
      refetch: mocks.projectRefetch,
    });
    mocks.projectRefetch.mockResolvedValue({ data: { roleTeams: [] } });
    mocks.startHook.mockReturnValue({
      error: null,
      isError: false,
      isPending: false,
      mutate: mocks.startMutate,
      reset: mocks.startReset,
    });
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
    vi.unstubAllEnvs();
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

    const workTab = screen.getByRole('tab', { name: translations['tabs.work'] });
    const workPanel = document.getElementById(workTab.getAttribute('aria-controls') ?? '');
    expect(workTab).toHaveAttribute('aria-selected', 'true');
    expect(workPanel).toBeVisible();
    expect(workPanel).toHaveAttribute('role', 'tabpanel');
    expect(workPanel).toHaveAttribute('aria-labelledby', workTab.id);
    expect(screen.getByRole('heading', { level: 1, name: 'API-1: 첫 이슈' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: translations.titleLabel })).toHaveValue('첫 이슈');
    expect(screen.queryByRole('heading', { name: translations.overview })).not.toBeInTheDocument();
    const properties = screen.getByRole('complementary', { name: translations.properties });
    const informationHeading = within(properties).getByRole('heading', {
      name: translations.information,
    });
    expect(informationHeading).toBeVisible();
    const information = informationHeading.closest('section');
    if (!information) throw new Error('information section missing');
    expect(within(information).getByText(translations.createdAt)).toBeVisible();
    expect(within(information).getByText(translations.updatedAt)).toBeVisible();
    expect(information.querySelectorAll('time')).toHaveLength(2);
    expect(within(properties).getByText('작성자 김')).toBeVisible();
    expect(screen.getAllByText('작성자 김')).toHaveLength(1);
    expect(screen.getAllByText(translations.createdAt)).toHaveLength(1);
    expect(screen.getAllByText(translations.updatedAt)).toHaveLength(1);
    expect(within(properties).getByText('API 팀 (API)')).toBeVisible();
    expect(
      within(properties).getByRole('combobox', { name: translations.state }),
    ).toHaveTextContent('할 일');
    expect(
      within(properties).getByRole('combobox', { name: translations.assignee }),
    ).toHaveTextContent(translations.unassigned);
    expect(
      within(properties).getByRole('combobox', { name: translations.priority }),
    ).toHaveTextContent(translations['priorities.NONE']);
    expect(within(properties).getByLabelText(translations.labels)).toHaveTextContent(
      '레거시, 버그',
    );
    expect(mocks.issueHook).toHaveBeenCalledWith('API-1', { query: { retry: false } });
  });

  it.each([
    ['relations', '연결', '작업 순서'],
    ['activity', '활동', '활동'],
  ] as const)('URL의 %s 탭으로 바로 진입한다', (tab, tabLabel, panelHeading) => {
    window.history.replaceState({}, '', `/issues/API-1?tab=${tab}`);

    render(<IssueDetailScreen issueRef="API-1" />, { wrapper: QueryWrapper });

    const selectedTab = screen.getByRole('tab', { name: tabLabel });
    const panel = document.getElementById(selectedTab.getAttribute('aria-controls') ?? '');
    expect(selectedTab).toHaveAttribute('aria-selected', 'true');
    expect(panel).toBeVisible();
    expect(screen.getByRole('heading', { name: panelHeading })).toBeVisible();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('탭 전환은 타임라인 요청을 중복하지 않고 갱신 후에도 현재 탭을 유지한다', async () => {
    const user = userEvent.setup();
    render(<IssueDetailScreen issueRef="API-1" />, { wrapper: QueryWrapper });

    await waitFor(() => expect(mocks.timeline).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('tab', { name: translations['tabs.activity'] }));
    await user.click(screen.getByRole('tab', { name: translations['tabs.relations'] }));
    await user.click(screen.getByRole('tab', { name: translations['tabs.activity'] }));
    expect(mocks.timeline).toHaveBeenCalledTimes(1);

    await queryClient.invalidateQueries({
      queryKey: getIssueCollaborationControllerTimelineQueryKey(issue.id),
    });

    await waitFor(() => expect(mocks.timeline).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('tab', { name: translations['tabs.activity'] })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it.each([
    {
      data: {
        ...issue,
        identifier: 'FEAT-ANCHOR',
        project: {
          archived: false,
          id: 'project-id',
          name: '앵커 프로젝트',
          status: 'IN_PROGRESS',
        },
        status: { category: 'BACKLOG', featureStatus: 'UNSORTED', workflowState: null },
        team: null,
        type: 'FEATURE',
      } satisfies IssueDetailResponseDto,
      expectedTab: '연결',
      expectedUrl: '/issues/FEAT-ANCHOR?tab=relations#handoff-handoff-id',
    },
    {
      data: {
        ...issue,
        identifier: 'WEB-ANCHOR',
        parentIssue: { id: 'feature-id', identifier: 'FEAT-1', title: '상위 이슈' },
        projectRole: 'WEB_FRONTEND',
      } satisfies IssueDetailResponseDto,
      expectedTab: '업무',
      expectedUrl: '/issues/WEB-ANCHOR?tab=work#handoff-handoff-id',
    },
  ])('전달 앵커를 $expectedTab 탭으로 교정한다', async ({ data, expectedTab, expectedUrl }) => {
    mocks.issueHook.mockReturnValue(issueQuery(data));
    window.history.replaceState({}, '', `/issues/${data.identifier}#handoff-handoff-id`);

    render(<IssueDetailScreen issueRef={data.identifier} />, { wrapper: QueryWrapper });

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: expectedTab })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
    expect(mocks.replace).toHaveBeenCalledWith(expectedUrl, { scroll: false });
  });

  it('잘못된 탭 값은 업무 탭과 정규 URL로 복구한다', async () => {
    window.history.replaceState({}, '', '/issues/API-1?tab=unknown');

    render(<IssueDetailScreen issueRef="API-1" />, { wrapper: QueryWrapper });

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: translations['tabs.work'] })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
    expect(mocks.replace).toHaveBeenCalledWith('/issues/API-1?tab=work', { scroll: false });
    expect(window.location.search).toBe('?tab=work');
  });

  it('화살표로 탭을 이동해도 속성 패널 상태를 유지한다', async () => {
    const user = userEvent.setup();
    const view = render(<IssueDetailScreen issueRef="API-1" />, { wrapper: QueryWrapper });

    const properties = screen.getByRole('complementary', { name: translations.properties });
    await user.click(within(properties).getByRole('combobox', { name: translations.priority }));
    await user.click(await screen.findByRole('option', { name: translations['priorities.HIGH'] }));
    expect(mocks.mutate).toHaveBeenCalledWith({
      change: { kind: 'priority', value: 'HIGH' },
      issue,
    });
    mocks.issueHook.mockReturnValue(issueQuery({ ...issue, priority: 'HIGH' }));
    view.rerender(<IssueDetailScreen issueRef="API-1" />);

    const labels = within(properties).getByLabelText(translations.labels);
    await user.click(labels);
    const labelsDetails = labels.closest('details');
    expect(labelsDetails).toHaveAttribute('open');

    const workTab = screen.getByRole('tab', { name: translations['tabs.work'] });
    const relationsTab = screen.getByRole('tab', { name: translations['tabs.relations'] });
    workTab.focus();
    await user.keyboard('{ArrowRight}');

    expect(relationsTab).toHaveFocus();
    expect(relationsTab).toHaveAttribute('aria-selected', 'true');
    const relationsPanel = document.getElementById(
      relationsTab.getAttribute('aria-controls') ?? '',
    );
    expect(relationsPanel).toBeVisible();
    expect(relationsPanel).toHaveAttribute('aria-labelledby', relationsTab.id);
    expect(mocks.replace).toHaveBeenCalledWith('/issues/API-1?tab=relations', {
      scroll: false,
    });
    expect(labelsDetails).toHaveAttribute('open');
    expect(
      within(properties).getByRole('combobox', { name: translations.priority }),
    ).toHaveTextContent(translations['priorities.HIGH']);
  });

  it('작업 순서가 없으면 하나의 빈 상태만 표시하고 이해 가능한 추가 입력을 연다', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/issues/API-1?tab=relations');
    render(<IssueDetailScreen issueRef="API-1" />, { wrapper: QueryWrapper });

    expect(
      screen.getAllByRole('heading', { level: 2, name: translations['relations.title'] }),
    ).toHaveLength(1);
    expect(screen.getByText(translations['relations.emptyDescription'])).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: translations['relations.contextTitle'] }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('차단됨')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: translations['relations.add'] }));
    expect(screen.getByLabelText(translations['relations.direction'])).toHaveTextContent(
      translations['relations.before'],
    );
    expect(screen.getByLabelText(translations['relations.target'])).toBeVisible();
  });

  it('작업 순서가 있으면 선행·후행·완료된 선행 작업만 분류해 표시한다', () => {
    const relationIssue = (id: string, identifier: string, title: string) => ({
      category: 'UNSTARTED' as const,
      featureStatus: null,
      id,
      identifier,
      projectRole: 'BACKEND' as const,
      title,
    });
    const orderedIssue = {
      ...issue,
      blockers: [
        {
          createdAt: '2026-07-02T00:00:00.000Z',
          id: 'active-order',
          issue: relationIssue('api-before', 'API-0', '먼저 할 작업'),
          resolved: false,
        },
        {
          createdAt: '2026-07-02T01:00:00.000Z',
          id: 'resolved-order',
          issue: relationIssue('api-done', 'API-DONE', '완료된 선행 작업'),
          resolved: true,
        },
      ],
      blocking: [
        {
          createdAt: '2026-07-02T02:00:00.000Z',
          id: 'next-order',
          issue: relationIssue('web-next', 'WEB-2', '다음 작업'),
          resolved: false,
        },
      ],
    } satisfies IssueDetailResponseDto;
    mocks.issueHook.mockReturnValue(issueQuery(orderedIssue));
    window.history.replaceState({}, '', '/issues/API-1?tab=relations');

    render(<IssueDetailScreen issueRef="API-1" />, { wrapper: QueryWrapper });

    expect(screen.getByText(translations['relations.blockedBy'])).toBeVisible();
    expect(screen.getByText(translations['relations.blocks'])).toBeVisible();
    expect(screen.getByText(translations['relations.resolved'])).toBeVisible();
    expect(screen.queryByText('차단 관계')).not.toBeInTheDocument();
  });

  it('연결 탭에서 작업 순서를 추가하고 성공 후 상세·목록을 갱신한다', async () => {
    const user = userEvent.setup();
    const target = {
      ...issue,
      id: 'target-issue-id',
      identifier: 'WEB-2',
      title: '다음 작업',
      version: 4,
    } satisfies IssueDetailResponseDto;
    mocks.issuesListHook.mockReturnValue({
      data: { items: [target], nextCursor: null },
      isError: false,
      isPending: false,
      refetch: mocks.issuesListRefetch,
    });
    window.history.replaceState({}, '', '/issues/API-1?tab=relations');
    const invalidateQueries = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue(undefined);

    render(<IssueDetailScreen issueRef="API-1" />, { wrapper: QueryWrapper });
    const relations = screen
      .getByRole('heading', { name: translations['relations.title'] })
      .closest('section');
    if (!relations) throw new Error('relations section missing');
    await user.click(
      within(relations).getByRole('button', { name: translations['relations.add'] }),
    );
    await user.click(within(relations).getByLabelText(translations['relations.target']));
    await user.click(await screen.findByRole('option', { name: 'WEB-2 · 다음 작업' }));
    await user.click(
      within(relations).getByRole('button', { name: translations['relations.add'] }),
    );

    expect(mocks.createRelationMutate).toHaveBeenCalledWith(
      {
        data: {
          blockedIssueId: issue.id,
          blockedIssueVersion: issue.version,
          blockingIssueId: target.id,
          blockingIssueVersion: target.version,
        },
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    act(() => {
      mocks.createRelationMutate.mock.calls[0]?.[1]?.onSuccess?.();
    });
    await waitFor(() => expect(invalidateQueries).toHaveBeenCalled());
  });

  it('연결 탭에서 작업 순서를 삭제할 때 양쪽 최신 버전을 전송하고 갱신한다', async () => {
    const user = userEvent.setup();
    const targetDetail = {
      ...issue,
      id: 'target-issue-id',
      identifier: 'WEB-2',
      title: '다음 작업',
      version: 7,
    } satisfies IssueDetailResponseDto;
    const relation = {
      createdAt: '2026-07-02T00:00:00.000Z',
      id: 'relation-id',
      issue: {
        category: 'UNSTARTED' as const,
        featureStatus: null,
        id: targetDetail.id,
        identifier: targetDetail.identifier,
        projectRole: 'WEB_FRONTEND' as const,
        title: targetDetail.title,
      },
      resolved: false,
    };
    mocks.issueHook.mockReturnValue(issueQuery({ ...issue, blocking: [relation] }));
    mocks.issueGet.mockResolvedValue(targetDetail);
    window.history.replaceState({}, '', '/issues/API-1?tab=relations');
    const invalidateQueries = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue(undefined);

    render(<IssueDetailScreen issueRef="API-1" />, { wrapper: QueryWrapper });
    await user.click(
      screen.getByRole('button', {
        name: `${targetDetail.identifier} ${translations['relations.remove']}`,
      }),
    );

    await waitFor(() => expect(mocks.issueGet).toHaveBeenCalledWith(targetDetail.id));
    expect(mocks.removeRelationMutate).toHaveBeenCalledWith(
      {
        data: {
          blockedIssueVersion: targetDetail.version,
          blockingIssueVersion: issue.version,
        },
        relationId: relation.id,
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    act(() => {
      mocks.removeRelationMutate.mock.calls[0]?.[1]?.onSuccess?.();
    });
    await waitFor(() => expect(invalidateQueries).toHaveBeenCalled());
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
    [
      'ISSUE_HAS_CHILDREN',
      'trash.childrenTitle',
      'trash.openChildren',
      '/issues/API-1?tab=relations#feature-progress-title',
    ],
    [
      'ISSUE_BLOCKS_OTHERS',
      'trash.blocksTitle',
      'trash.openRelations',
      '/issues/API-1?tab=relations#issue-relations-title',
    ],
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

  it('기능 이슈는 업무에 현재 요약을, 연결에 전체 작업 흐름을 표시한다', async () => {
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
    mocks.issuesListHook.mockReturnValue({
      data: {
        items: [
          {
            ...issue,
            id: 'completed-task-id',
            identifier: 'API-0',
            projectRole: 'BACKEND',
            status: { category: 'COMPLETED', featureStatus: null, workflowState: completedState },
            title: '완료된 백엔드 작업',
          },
          {
            ...issue,
            id: 'current-task-id',
            identifier: 'API-2',
            projectRole: 'BACKEND',
            title: '현재 백엔드 작업',
          },
        ],
        nextCursor: null,
      },
      isError: false,
      isPending: false,
      refetch: mocks.issuesListRefetch,
    });
    mocks.projectHook.mockReturnValue({
      data: {
        roleTeams: [
          { role: 'BACKEND', team: issue.team },
          { role: 'WEB_FRONTEND', team: { ...issue.team, id: 'web-team-id', key: 'WEB' } },
          { role: 'APP_FRONTEND', team: { ...issue.team, id: 'app-team-id', key: 'APP' } },
        ],
      },
      isError: false,
      isPending: false,
      refetch: mocks.projectRefetch,
    });

    render(<IssueDetailScreen issueRef="FEAT-1" />, { wrapper: QueryWrapper });

    expect(screen.queryByText(translations.feature)).not.toBeInTheDocument();
    expect(screen.getByText('모바일 리뉴얼')).toBeVisible();
    expect(screen.queryByRole('combobox', { name: translations.assignee })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: translations['workSummary.title'] })).toBeVisible();
    expect(screen.getByRole('link', { name: /API-2/ })).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: translations['workflow.title'] }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveValue(50);
    expect(screen.queryByText(/0\/0 완료/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: translations['tabs.relations'] }));
    const relationsPanel = screen.getByRole('tabpanel', {
      name: translations['tabs.relations'],
    });
    expect(
      within(relationsPanel).getByRole('heading', { name: translations['workflow.title'] }),
    ).toBeVisible();
    expect(within(relationsPanel).getByText(translations['workflow.completed'])).toBeVisible();
    expect(within(relationsPanel).getByText(translations['workflow.current'])).toBeVisible();
    expect(within(relationsPanel).getAllByText(translations['workflow.expected'])).toHaveLength(2);
    expect(within(relationsPanel).getByRole('progressbar')).toHaveValue(50);

    await user.click(screen.getByRole('combobox', { name: translations['workflow.moreActions'] }));
    await user.click(await screen.findByRole('option', { name: translations['workflow.addTask'] }));
    expect(mocks.push).toHaveBeenCalledWith(
      '/issues/FEAT-1?tab=relations&create=1&type=TEAM_TASK&projectId=project-id&parentIssueId=7c8fc5da-cccb-4478-b9b0-78ec539e9271#feature-progress-title',
    );

    await user.click(screen.getByRole('combobox', { name: translations.state }));
    await user.click(
      await screen.findByRole('option', { name: translations['featureStatuses.DONE'] }),
    );
    expect(mocks.mutate).toHaveBeenLastCalledWith({
      change: { kind: 'featureStatus', value: 'DONE' },
      issue: featureIssue,
    });
  });

  it('팀 작업이 없는 이슈에서 시작 역할을 키보드로 복수 선택해 작업을 시작한다', async () => {
    const user = userEvent.setup();
    const featureIssue = {
      ...issue,
      identifier: 'FEAT-EMPTY',
      progress: { completed: 0, percentage: 0, total: 0 },
      project: {
        archived: false,
        id: 'project-id',
        name: '신규 프로젝트',
        status: 'IN_PROGRESS',
      },
      status: { category: 'BACKLOG', featureStatus: 'UNSORTED', workflowState: null },
      team: null,
      type: 'FEATURE',
    } satisfies IssueDetailResponseDto;
    mocks.issueHook.mockReturnValue(issueQuery(featureIssue));
    mocks.projectHook.mockReturnValue({
      data: {
        roleTeams: [
          { role: 'BACKEND', team: issue.team },
          { role: 'WEB_FRONTEND', team: { ...issue.team, id: 'web-team-id', key: 'WEB' } },
        ],
      },
      isError: false,
      isPending: false,
      refetch: mocks.projectRefetch,
    });

    const view = render(<IssueDetailScreen issueRef="FEAT-EMPTY" />, { wrapper: QueryWrapper });

    const workPanel = screen.getByRole('tabpanel', { name: translations['tabs.work'] });
    expect(within(workPanel).getByText(translations['workflow.emptyDescription'])).toBeVisible();
    expect(screen.queryByText(/0\/0 완료/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: translations['workflow.start'] }));

    const dialog = screen.getByRole('dialog', { name: translations['workflow.startTitle'] });
    const backend = within(dialog).getByRole('checkbox', { name: /백엔드/ });
    const web = within(dialog).getByRole('checkbox', { name: /웹 프론트/ });
    backend.focus();
    await user.keyboard(' ');
    await user.click(web);

    expect(backend).toBeChecked();
    expect(web).toBeChecked();
    expect(within(dialog).getAllByText(translations['workflow.roleSelected'])).toHaveLength(2);
    await user.click(within(dialog).getByRole('button', { name: translations['workflow.start'] }));

    expect(mocks.startMutate).toHaveBeenCalledWith(
      {
        data: { initialRoles: ['BACKEND', 'WEB_FRONTEND'] },
        issueId: featureIssue.id,
      },
      expect.any(Object),
    );

    const roleError = new ApiError(
      422,
      {
        code: 'INITIAL_ROLE_NOT_AVAILABLE',
        fieldErrors: {},
        message: '프로젝트 역할이 변경되었습니다.',
        requestId: 'request-id',
      },
      'request-id',
    );
    mocks.startHook.mockReturnValue({
      error: roleError,
      isError: true,
      isPending: false,
      mutate: mocks.startMutate,
      reset: mocks.startReset,
    });
    view.rerender(<IssueDetailScreen issueRef="FEAT-EMPTY" />);
    act(() => {
      mocks.startMutate.mock.calls[0]?.[1]?.onError?.(roleError);
    });

    expect(screen.getByText(translations['workflow.startErrorDescription'])).toBeVisible();
    expect(screen.getByRole('checkbox', { name: /백엔드/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /웹 프론트/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /백엔드/ })).toHaveFocus();
    expect(mocks.projectRefetch).toHaveBeenCalledOnce();
  });

  it('병렬 작업에는 연결선을 표시하지 않고 실제 작업 순서에만 대기 이유를 표시한다', () => {
    const backendTask = {
      ...issue,
      id: 'backend-task-id',
      identifier: 'API-10',
      projectRole: 'BACKEND',
      title: '백엔드 병렬 작업',
    };
    const frontendTask = {
      ...issue,
      blocked: true,
      id: 'app-task-id',
      identifier: 'APP-10',
      projectRole: 'APP_FRONTEND',
      title: '앱 병렬 작업',
    };
    const featureIssue = {
      ...issue,
      identifier: 'FEAT-PARALLEL',
      progress: { completed: 0, percentage: 0, total: 2 },
      project: {
        archived: false,
        id: 'project-id',
        name: '병렬 프로젝트',
        status: 'IN_PROGRESS',
      },
      status: { category: 'BACKLOG', featureStatus: 'UNSORTED', workflowState: null },
      team: null,
      type: 'FEATURE',
      workflowRelations: [],
    } satisfies IssueDetailResponseDto;
    mocks.issueHook.mockReturnValue(issueQuery(featureIssue));
    mocks.issuesListHook.mockReturnValue({
      data: { items: [backendTask, { ...frontendTask, blocked: false }], nextCursor: null },
      isError: false,
      isPending: false,
      refetch: mocks.issuesListRefetch,
    });
    mocks.projectHook.mockReturnValue({
      data: {
        roleTeams: [
          { role: 'BACKEND', team: issue.team },
          { role: 'WEB_FRONTEND', team: { ...issue.team, id: 'web-team-id', key: 'WEB' } },
          { role: 'APP_FRONTEND', team: { ...issue.team, id: 'app-team-id', key: 'APP' } },
        ],
      },
      isError: false,
      isPending: false,
      refetch: mocks.projectRefetch,
    });
    window.history.replaceState({}, '', '/issues/FEAT-PARALLEL?tab=relations');

    const view = render(<IssueDetailScreen issueRef="FEAT-PARALLEL" />, {
      wrapper: QueryWrapper,
    });
    const relationsPanel = screen.getByRole('tabpanel', {
      name: translations['tabs.relations'],
    });

    expect(
      within(relationsPanel)
        .getByRole('link', { name: /API-10/ })
        .closest('li'),
    ).not.toHaveClass('border-l');
    expect(
      within(relationsPanel)
        .getByRole('link', { name: /APP-10/ })
        .closest('li'),
    ).not.toHaveClass('border-l');
    expect(
      within(relationsPanel).queryByText(translations['workflow.expected']),
    ).not.toBeInTheDocument();

    const orderedFeature = {
      ...featureIssue,
      workflowRelations: [
        {
          blockedIssueId: frontendTask.id,
          blockingIssueId: backendTask.id,
          createdAt: '2026-07-03T00:00:00.000Z',
          id: 'order-id',
          resolved: false,
        },
      ],
    } satisfies IssueDetailResponseDto;
    mocks.issueHook.mockReturnValue(issueQuery(orderedFeature));
    mocks.issuesListHook.mockReturnValue({
      data: { items: [frontendTask, backendTask], nextCursor: null },
      isError: false,
      isPending: false,
      refetch: mocks.issuesListRefetch,
    });
    view.rerender(<IssueDetailScreen issueRef="FEAT-PARALLEL" />);

    expect(within(relationsPanel).getByText(translations['workflow.waitForTask'])).toBeVisible();
    expect(
      within(relationsPanel)
        .getByRole('link', { name: /API-10/ })
        .closest('li'),
    ).not.toHaveClass('border-l');
    expect(
      within(relationsPanel)
        .getByRole('link', { name: /APP-10/ })
        .closest('li'),
    ).toHaveClass('border-l');
    expect(
      within(
        within(relationsPanel).getByRole('region', {
          name: translations['workflow.currentWork'],
        }),
      )
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['API-10 · 백엔드 병렬 작업', 'APP-10 · 앱 병렬 작업']);
  });

  it('최초·추가 전달을 상위 이슈와 전달받은 프론트 작업에서 같은 내용으로 표시한다', async () => {
    const user = userEvent.setup();
    vi.stubEnv('TZ', 'America/Los_Angeles');
    const sourceIssue = {
      category: 'COMPLETED',
      featureStatus: null,
      id: 'backend-task-id',
      identifier: 'API-20',
      projectRole: 'BACKEND',
      title: '이메일 API 구현',
    } as const;
    const downstreamIssue = {
      category: 'UNSTARTED',
      featureStatus: null,
      id: 'web-task-id',
      identifier: 'WEB-20',
      projectRole: 'WEB_FRONTEND',
      title: '이메일 화면 연결',
    } as const;
    const handoffFlow: IssueHandoffFlowResponseDto = {
      downstreamIssues: [downstreamIssue],
      handoffs: [
        {
          author: activeMember,
          bodyMarkdown: '## 변경 요약\n\n이메일 중복 확인 API를 추가했습니다.',
          changeSummary: '이메일 중복 확인 API를 추가했습니다.',
          createdAt: '2026-07-03T00:00:00.000Z',
          id: 'handoff-initial',
          kind: 'INITIAL',
          sequenceNumber: 1,
        },
        {
          author: activeMember,
          bodyMarkdown: '## 변경 요약\n\n응답 예시를 보완했습니다.',
          changeSummary: '응답 예시를 보완했습니다.',
          createdAt: '2026-07-03T01:00:00.000Z',
          id: 'handoff-follow-up',
          kind: 'FOLLOW_UP',
          sequenceNumber: 2,
        },
      ],
      sourceIssue,
    };
    const featureIssue = {
      ...issue,
      handoffFlows: [handoffFlow],
      identifier: 'FEAT-HANDOFF',
      progress: { completed: 1, percentage: 50, total: 2 },
      project: {
        archived: false,
        id: 'project-id',
        name: '전달 프로젝트',
        status: 'IN_PROGRESS',
      },
      status: { category: 'BACKLOG', featureStatus: 'UNSORTED', workflowState: null },
      team: null,
      type: 'FEATURE',
      workflowRelations: [],
    } satisfies IssueDetailResponseDto;
    mocks.issueHook.mockReturnValue(issueQuery(featureIssue));
    mocks.issuesListHook.mockReturnValue({
      data: {
        items: [
          {
            ...issue,
            id: sourceIssue.id,
            identifier: sourceIssue.identifier,
            projectRole: sourceIssue.projectRole,
            status: {
              category: 'COMPLETED',
              featureStatus: null,
              workflowState: completedState,
            },
            title: sourceIssue.title,
          },
          {
            ...issue,
            id: downstreamIssue.id,
            identifier: downstreamIssue.identifier,
            projectRole: downstreamIssue.projectRole,
            title: downstreamIssue.title,
          },
        ],
        nextCursor: null,
      },
      isError: false,
      isPending: false,
      refetch: mocks.issuesListRefetch,
    });
    window.history.replaceState({}, '', '/issues/FEAT-HANDOFF?tab=relations');

    const view = render(<IssueDetailScreen issueRef="FEAT-HANDOFF" />, {
      wrapper: QueryWrapper,
    });

    const featureRelationsPanel = screen.getByRole('tabpanel', {
      name: translations['tabs.relations'],
    });
    const initialHeading = within(featureRelationsPanel).getByRole('heading', {
      level: 4,
      name: translations['handoff.initial'],
    });
    const initialCard = initialHeading.closest('article');
    expect(initialCard).not.toBeNull();
    expect(initialCard?.querySelector('time')).toHaveTextContent('2026. 7. 3.');
    expect(
      within(initialCard!).getAllByText('이메일 중복 확인 API를 추가했습니다.')[0],
    ).toBeVisible();
    expect(within(initialCard!).getByRole('link', { name: /API-20/ })).toHaveAttribute(
      'href',
      '/issues/API-20',
    );
    expect(within(initialCard!).getByRole('link', { name: /WEB-20/ })).toHaveAttribute(
      'href',
      '/issues/WEB-20',
    );

    const frontendIssue = {
      ...issue,
      blocked: true,
      blockers: [
        {
          createdAt: '2026-07-03T00:00:00.000Z',
          id: 'backend-order-id',
          issue: sourceIssue,
          resolved: false,
        },
      ],
      handoffFlows: [handoffFlow],
      id: downstreamIssue.id,
      identifier: downstreamIssue.identifier,
      parentIssue: { id: featureIssue.id, identifier: featureIssue.identifier, title: '상위 이슈' },
      project: featureIssue.project,
      projectRole: 'WEB_FRONTEND',
      title: downstreamIssue.title,
    } satisfies IssueDetailResponseDto;
    mocks.issueHook.mockReturnValue(issueQuery(frontendIssue));
    window.history.replaceState({}, '', '/issues/WEB-20?tab=work');
    view.rerender(<IssueDetailScreen issueRef="WEB-20" />);

    const parentBreadcrumb = screen.getByRole('navigation', {
      name: translations.parentFeature,
    });
    expect(within(parentBreadcrumb).getByRole('link', { name: /FEAT-HANDOFF/ })).toHaveAttribute(
      'href',
      '/issues/FEAT-HANDOFF?tab=relations',
    );
    const workPanel = screen.getByRole('tabpanel', { name: translations['tabs.work'] });
    expect(
      within(workPanel).getByRole('heading', { name: translations['handoff.receivedTitle'] }),
    ).toBeVisible();
    expect(within(workPanel).getByText(translations['workflow.waitForTask'])).toBeVisible();
    expect(
      within(workPanel).getAllByText('이메일 중복 확인 API를 추가했습니다.').length,
    ).toBeGreaterThan(0);
    expect(within(workPanel).getByText(translations['handoff.followUpNotice'])).toBeVisible();
    expect(
      within(workPanel).getByText(translations['handoff.followUpHistoryDescription']),
    ).toBeVisible();
    expect(within(workPanel).queryByText('응답 예시를 보완했습니다.')).not.toBeInTheDocument();
    const receivedInitial = within(workPanel)
      .getAllByRole('heading', { level: 3, name: translations['handoff.initial'] })
      .at(-1)
      ?.closest('article');
    expect(receivedInitial).not.toBeNull();
    await user.click(within(receivedInitial!).getByText(translations['handoff.showBody']));
    expect(
      within(receivedInitial!).getAllByText(/이메일 중복 확인 API를 추가했습니다/)[0],
    ).toBeVisible();
  });

  it('같은 화면의 전달 링크를 선택하면 대상 탭과 전달 본문을 함께 연다', async () => {
    const user = userEvent.setup();
    const frontendIssue = {
      ...issue,
      handoffFlows: [
        {
          downstreamIssues: [],
          handoffs: [
            {
              author: activeMember,
              bodyMarkdown: '## 변경 요약\n\n전달 본문',
              changeSummary: '전달 요약',
              createdAt: '2026-07-03T00:00:00.000Z',
              id: 'same-screen-handoff',
              kind: 'INITIAL',
              sequenceNumber: 1,
            },
          ],
          sourceIssue: {
            category: 'COMPLETED',
            featureStatus: null,
            id: 'backend-task-id',
            identifier: 'API-20',
            projectRole: 'BACKEND',
            title: '백엔드 작업',
          },
        },
      ],
      identifier: 'WEB-20',
      projectRole: 'WEB_FRONTEND',
    } satisfies IssueDetailResponseDto;
    mocks.issueHook.mockReturnValue(issueQuery(frontendIssue));
    window.history.replaceState({}, '', '/issues/WEB-20?tab=activity');

    render(<IssueDetailScreen issueRef="WEB-20" />, { wrapper: QueryWrapper });
    const activityPanel = screen.getByRole('tabpanel', {
      name: translations['tabs.activity'],
    });
    const link = document.createElement('a');
    link.href = '/issues/WEB-20?tab=work#handoff-same-screen-handoff';
    link.textContent = '전달 내용 보기';
    link.addEventListener('click', (event) => event.preventDefault());
    activityPanel.append(link);

    await user.click(link);

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: translations['tabs.work'] })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
    const handoff = document.getElementById('handoff-same-screen-handoff');
    expect(handoff).not.toBeNull();
    await waitFor(() => expect(handoff?.querySelector('details')).toHaveAttribute('open'));
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
      project: {
        archived: false,
        id: 'project-id',
        name: '모바일 리뉴얼',
        status: 'IN_PROGRESS',
      },
      parentIssue: { id: 'feature-id', identifier: 'FEAT-1', title: '상위 이슈' },
      projectRole: 'BACKEND',
    } satisfies IssueDetailResponseDto;
    mocks.issueHook.mockReturnValue(issueQuery(backendIssue));
    mocks.projectHook.mockReturnValue({
      data: {
        roleTeams: [
          { role: 'BACKEND', team: issue.team },
          { role: 'WEB_FRONTEND', team: { ...issue.team, id: 'web-team-id', key: 'WEB' } },
          { role: 'APP_FRONTEND', team: { ...issue.team, id: 'app-team-id', key: 'APP' } },
        ],
      },
      isError: false,
      isPending: false,
      refetch: mocks.projectRefetch,
    });
    mocks.statesHook.mockReturnValue({
      data: { items: [workflowState, completedState], nextCursor: null },
      isError: false,
      isPending: false,
      refetch: mocks.statesRefetch,
    });

    const view = render(<IssueDetailScreen issueRef="API-1" />, { wrapper: QueryWrapper });

    expect(screen.getByRole('button', { name: 'handoff.submitAndComplete' })).toBeEnabled();
    await user.click(screen.getByRole('combobox', { name: translations.state }));
    await user.click(await screen.findByRole('option', { name: completedState.name }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeVisible();
    expect(within(dialog).getByRole('textbox', { name: 'editorLabel' })).toHaveTextContent(
      '프론트 주의사항',
    );
    expect(within(dialog).getByRole('checkbox', { name: '웹 프론트' })).toBeChecked();
    const appDestination = within(dialog).getByRole('checkbox', { name: '앱 프론트' });
    expect(appDestination).toBeChecked();
    await user.click(appDestination);

    await user.click(screen.getByRole('button', { name: 'handoff.submitAndComplete' }));
    expect(mocks.mutate).toHaveBeenLastCalledWith(
      {
        change: {
          handoff: {
            bodyMarkdown: expect.stringContaining('## API 명세 링크'),
            destinationRoles: ['WEB_FRONTEND'],
          },
          kind: 'workflowState',
          value: completedState,
        },
        issue: backendIssue,
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );

    const scopeError = new ApiError(
      409,
      {
        code: 'DOWNSTREAM_TASK_SCOPE_CONFLICT',
        details: {
          issues: [
            { id: 'web-issue-id', identifier: 'WEB-2', title: '웹 연결' },
            { identifier: null, title: '잘못된 항목' },
          ],
        },
        fieldErrors: {},
        message: '후행 작업 범위가 다릅니다.',
        requestId: 'request-id',
      },
      'request-id',
    );
    act(() => {
      mocks.mutate.mock.calls.at(-1)?.[1]?.onError?.(scopeError);
    });
    mocks.mutationHook.mockReturnValue(mutationResult({ error: scopeError, isError: true }));
    view.rerender(<IssueDetailScreen issueRef="API-1" />);

    const errorDialog = screen.getByRole('dialog');
    expect(within(errorDialog).getByRole('link', { name: 'WEB-2 · 웹 연결' })).toHaveAttribute(
      'href',
      '/issues/WEB-2',
    );
    expect(within(errorDialog).queryByText('잘못된 항목')).not.toBeInTheDocument();

    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const completedResponse = {
      ...backendIssue,
      handoffSummary: {
        count: 1,
        hasInitial: true,
        latestCreatedAt: '2026-07-02T00:00:00.000Z',
      },
      status: { category: 'COMPLETED', featureStatus: null, workflowState: completedState },
      updatedParentIssue: {
        ...backendIssue,
        id: 'feature-id',
        identifier: 'FEAT-1',
        parentIssue: null,
        progress: { completed: 1, percentage: 50, total: 2 },
        projectRole: null,
        status: { category: 'STARTED', featureStatus: 'IN_PROGRESS', workflowState: null },
        team: null,
        title: '상위 이슈',
        type: 'FEATURE',
      },
      downstreamTeamTasks: [
        {
          ...backendIssue,
          id: 'web-issue-id',
          identifier: 'WEB-2',
          parentIssue: { id: 'feature-id', identifier: 'FEAT-1', title: '상위 이슈' },
          projectRole: 'WEB_FRONTEND',
          title: '웹 연결',
        },
      ],
      version: 2,
    } satisfies UpdateIssueResponseDto;
    act(() => {
      mocks.mutate.mock.calls.at(-1)?.[1]?.onSuccess?.(completedResponse);
    });

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: getIssuesControllerGetQueryKey('feature-id'),
      });
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: getIssuesControllerGetQueryKey('FEAT-1'),
      });
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: getIssuesControllerGetQueryKey('web-issue-id'),
      });
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: getIssuesControllerGetQueryKey('WEB-2'),
      });
    });
    expect(mocks.push).toHaveBeenCalledWith('/issues/FEAT-1?tab=relations#feature-progress-title');
  });

  it('기존 단독 백엔드 작업은 완료를 먼저 시도하고 서버 요구 시에만 전달을 연다', async () => {
    const user = userEvent.setup();
    const standaloneBackend = {
      ...issue,
      project: {
        archived: false,
        id: 'project-id',
        name: '모바일 리뉴얼',
        status: 'IN_PROGRESS',
      },
      projectRole: 'BACKEND',
    } satisfies IssueDetailResponseDto;
    mocks.issueHook.mockReturnValue(issueQuery(standaloneBackend));
    mocks.projectHook.mockReturnValue({
      data: {
        roleTeams: [
          { role: 'BACKEND', team: issue.team },
          { role: 'WEB_FRONTEND', team: { ...issue.team, id: 'web-team-id', key: 'WEB' } },
        ],
      },
      isError: false,
      isPending: false,
      refetch: mocks.projectRefetch,
    });
    mocks.statesHook.mockReturnValue({
      data: { items: [workflowState, completedState], nextCursor: null },
      isError: false,
      isPending: false,
      refetch: mocks.statesRefetch,
    });

    render(<IssueDetailScreen issueRef="API-1" />, { wrapper: QueryWrapper });

    await user.click(screen.getByRole('combobox', { name: translations.state }));
    await user.click(await screen.findByRole('option', { name: completedState.name }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.mutate).toHaveBeenLastCalledWith(
      {
        change: { kind: 'workflowState', value: completedState },
        issue: standaloneBackend,
      },
      expect.objectContaining({ onError: expect.any(Function) }),
    );

    act(() => {
      mocks.mutate.mock.calls
        .at(-1)?.[1]
        ?.onError?.(new ApiError(409, { code: 'HANDOFF_REQUIRED' }, 'request-id'));
    });
    expect(screen.getByRole('dialog')).toBeVisible();
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
      project: {
        archived: false,
        id: 'project-id',
        name: '모바일 리뉴얼',
        status: 'IN_PROGRESS',
      },
      parentIssue: { id: 'feature-id', identifier: 'FEAT-1', title: '상위 이슈' },
      projectRole: 'BACKEND',
    } satisfies IssueDetailResponseDto;
    mocks.issueHook.mockReturnValue(issueQuery(backendIssue));
    const roleTeams = [
      { role: 'BACKEND' as const, team: issue.team },
      {
        role: 'WEB_FRONTEND' as const,
        team: { ...issue.team, id: 'web-team-id', key: 'WEB' },
      },
    ];
    mocks.projectHook.mockReturnValue({
      data: { roleTeams },
      isError: false,
      isPending: false,
      refetch: mocks.projectRefetch,
    });
    mocks.projectRefetch.mockResolvedValue({ data: { roleTeams } });
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
            handoff: {
              bodyMarkdown: (editor as HTMLTextAreaElement).value,
              destinationRoles: ['WEB_FRONTEND'],
            },
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

    mocks.issueRefetch.mockResolvedValueOnce({
      data: {
        ...backendIssue,
        handoffSummary: {
          count: 1,
          hasInitial: true,
          latestCreatedAt: '2026-07-02T00:00:00.000Z',
        },
        status: { category: 'COMPLETED', featureStatus: null, workflowState: completedState },
        version: 2,
      },
    });
    act(() => {
      mocks.mutate.mock.calls
        .at(-1)?.[1]
        ?.onError?.(new ApiError(409, { code: 'ISSUE_VERSION_CONFLICT' }, 'request-id'));
    });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.push).toHaveBeenCalledWith('/issues/FEAT-1?tab=relations#feature-progress-title');
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
