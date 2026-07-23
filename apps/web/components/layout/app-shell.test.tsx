import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnchorHTMLAttributes, ReactNode, RefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppShell } from './app-shell';

let pathname = '/my-issues';

vi.mock('@rivet/api-client', () => ({
  useAuthControllerGetSession: () => ({
    data: {
      authenticated: true,
      membership: {
        id: 'membership-1',
        ledTeamIds: [],
        role: 'ADMIN',
        status: 'ACTIVE',
        teamIds: ['team-web'],
      },
      user: {
        avatarFileId: null,
        displayName: '김리벳',
        email: 'kim@example.com',
        id: 'user-1',
      },
      workspace: { id: 'workspace-1', name: '리벳 워크스페이스', slug: 'rivet', version: 1 },
    },
  }),
  useNotificationsControllerUnreadCount: () => ({ data: { count: 7 } }),
  useProjectsControllerList: () => ({
    data: {
      items: [
        {
          id: 'project-1',
          name: '리벳 웹',
          projectTeams: [
            {
              active: true,
              team: { id: 'team-web' },
            },
          ],
        },
        {
          id: 'project-2',
          name: '리벳 API',
          projectTeams: [
            {
              active: true,
              team: { id: 'team-api' },
            },
          ],
        },
        {
          id: 'project-3',
          name: '종료된 웹 프로젝트',
          projectTeams: [
            {
              active: false,
              team: { id: 'team-web' },
            },
          ],
        },
      ],
      nextCursor: null,
    },
  }),
  useSavedViewsControllerList: ({ resourceType }: { resourceType: 'ISSUES' | 'MY_WORK' }) => ({
    data: {
      items:
        resourceType === 'ISSUES'
          ? [
              {
                configuration: { query: '긴급', sort: 'priority', sortDirection: 'desc' },
                createdAt: '2026-07-16T00:00:00.000Z',
                id: 'saved-issues',
                isDefault: true,
                name: '긴급 이슈',
                resourceType: 'ISSUES',
                updatedAt: '2026-07-16T00:00:00.000Z',
                version: 1,
              },
            ]
          : [
              {
                configuration: { sort: 'executionOrder', sortDirection: 'desc' },
                createdAt: '2026-07-16T00:00:00.000Z',
                id: 'saved-my-work',
                isDefault: false,
                name: '오늘 할 일',
                resourceType: 'MY_WORK',
                updatedAt: '2026-07-16T00:00:00.000Z',
                version: 1,
              },
            ],
      nextCursor: null,
    },
  }),
}));

vi.mock('@/features/search/global-search', () => ({
  GlobalSearch: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="검색 모달" /> : null,
}));

vi.mock('@/features/auth/user-menu', () => ({
  UserMenu: ({
    children,
    labels,
    onOpenFeedback,
    onOpenChange,
    onOpenProfile,
    open,
    triggerRef,
  }: {
    children: ReactNode;
    labels: { feedback: string; open: string; profile: string };
    onOpenFeedback: () => void;
    onOpenChange: (open: boolean) => void;
    onOpenProfile: () => void;
    open: boolean;
    triggerRef?: RefObject<HTMLButtonElement | null>;
  }) => (
    <div>
      <button
        ref={triggerRef}
        type="button"
        aria-label={labels.open}
        onClick={() => onOpenChange(!open)}
      >
        {children}
      </button>
      {open ? (
        <>
          <button type="button" onClick={onOpenProfile}>
            {labels.profile}
          </button>
          <button type="button" onClick={onOpenFeedback}>
            {labels.feedback}
          </button>
        </>
      ) : null}
    </div>
  ),
}));

vi.mock('@/features/profile/profile-dialog', () => ({
  ProfileDialog: ({
    onOpenChange,
    open,
  }: {
    onOpenChange: (open: boolean) => void;
    open: boolean;
  }) =>
    open ? (
      <div role="dialog" aria-label="프로필 모달">
        <button type="button" onClick={() => onOpenChange(false)}>
          프로필 닫기
        </button>
      </div>
    ) : null,
}));

vi.mock('@/features/issues/global-issue-create', () => ({
  GlobalIssueCreate: ({
    currentTeamKey,
    open,
    onOpenChange,
    seed,
  }: {
    currentTeamKey: string | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    seed: {
      projectId?: string;
    } | null;
  }) =>
    open ? (
      <div
        role="dialog"
        aria-label="이슈 만들기 모달"
        data-current-team-key={currentTeamKey ?? ''}
        data-project-id={seed?.projectId ?? ''}
      >
        <button type="button" onClick={() => onOpenChange(false)}>
          모달 닫기
        </button>
      </div>
    ) : null,
}));

vi.mock('@/features/teams/team-selector', () => ({
  DesktopTeamNavigation: ({ memberTeamIds }: { memberTeamIds: string[] | null }) => (
    <div data-testid="desktop-team-navigation-memberships">{memberTeamIds?.join(',')}</div>
  ),
  TeamSelector: ({ memberTeamIds }: { memberTeamIds: string[] | null }) => (
    <div data-testid="team-selector-memberships">{memberTeamIds?.join(',')}</div>
  ),
}));

vi.mock('@/features/feedback/feedback-dialog', () => ({
  FeedbackDialog: ({
    onOpenChange,
    open,
  }: {
    onOpenChange: (open: boolean) => void;
    open: boolean;
  }) =>
    open ? (
      <div role="dialog" aria-label="피드백 모달">
        <button type="button" onClick={() => onOpenChange(false)}>
          피드백 닫기
        </button>
      </div>
    ) : null,
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
  usePathname: () => pathname,
  useRouter: () => ({
    replace: (href: string) => {
      const localePrefix = window.location.pathname.startsWith('/ko/') ? '/ko' : '';
      window.history.replaceState(window.history.state, '', `${localePrefix}${href}`);
    },
  }),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const labels = {
  brandLabel: 'Rivet 홈',
  desktopNavigation: '주 탐색',
  inboxUnread: '알림함, 읽지 않은 알림 {count}개',
  mobileNavigation: '모바일 주 탐색',
  openIssueCreate: '이슈 만들기 열기',
  navigation: {
    inbox: '알림함',
    issues: '이슈',
    myIssues: '내 작업',
    projects: '프로젝트',
    search: '검색',
    settings: '설정',
    teams: '팀',
    workspace: '워크스페이스',
  },
  openSearch: '검색 열기',
  openTeamSelector: '팀 선택 열기',
  openWorkspaceMenu: '워크스페이스 메뉴 열기',
  expandSection: '{section} 하위 목록 펼치기',
  collapseSection: '{section} 하위 목록 접기',
  profile: {
    cancel: '취소',
    choose: '사진 선택',
    close: '프로필 닫기',
    description: '프로필 설명',
    discard: '선택 제거',
    emailDescription: '이메일 변경 불가',
    emailLabel: '이메일',
    emptyFile: '빈 파일',
    fileLimit: '파일 제한',
    invalidType: '잘못된 형식',
    nameDescription: '이름 설명',
    nameLabel: '이름',
    nameRequired: '이름 필수',
    nameTooLong: '이름 길이 초과',
    optimizing: '최적화 중',
    photoDescription: '사진 설명',
    photoLabel: '프로필 사진',
    previewAlt: '사진 미리보기',
    remove: '사진 삭제',
    removing: '삭제 중',
    retry: '다시 시도',
    save: '사진 저장',
    saving: '저장 중',
    title: '프로필 설정',
    unexpectedError: '사진 오류',
    uploading: '업로드 중',
  },
  userMenu: {
    feedback: '피드백 보내기',
    loggingOut: '로그아웃 중',
    logout: '로그아웃',
    logoutError: '로그아웃 실패',
    open: '사용자 메뉴 열기',
    profile: '프로필 설정',
  },
  issueCreate: {
    cancel: '취소',
    close: '이슈 만들기 닫기',
    description: '설명',
    descriptionLabel: '설명',
    discardChanges: '변경 버리기',
    discardDescription: '저장하지 않은 입력은 복구할 수 없음',
    discardTitle: '작성 중인 변경 버리기',
    errorDescription: '오류 설명',
    errorTitle: '오류',
    initialTeamsDescription: '선택하지 않아도 됩니다.',
    initialTeamsEmpty: '선택할 수 있는 팀이 없음',
    initialTeamsLabel: '처음 작업할 팀 (선택)',
    initialTeamsNoProject: '프로젝트를 먼저 선택',
    initialTeamsToolbarLabel: '팀',
    labelsLabel: '라벨',
    noLabels: '라벨 없음',
    optionsErrorDescription: '항목 오류 설명',
    optionsErrorTitle: '항목 오류',
    optionsLoading: '불러오는 중',
    overwriteCancel: '현재 값 유지',
    overwriteConfirm: '템플릿 적용',
    overwriteDescription: '덮어쓸 항목: {fields}',
    overwriteFields: {
      description: '설명',
      initialTeams: '처음 작업할 팀',
      labels: '라벨',
      priority: '우선순위',
      project: '프로젝트',
    },
    overwriteTitle: '덮어쓰기 확인',
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
    projectRequired: '프로젝트 필요',
    submit: '이슈 만들기',
    submitting: '만드는 중',
    templateApplying: '적용 중',
    templateEmpty: '템플릿 없음',
    templateLabel: '템플릿',
    templateNone: '템플릿 사용 안 함',
    templateNoticeDescription: '최신 템플릿을 다시 선택',
    templateNoticeTitle: '템플릿 재선택',
    templateUnavailableNoticeDescription: '현재 값으로 계속 작성',
    templateUnavailableNoticeTitle: '템플릿 사용 불가',
    templatePlaceholder: '템플릿 선택',
    templateTrigger: '템플릿',
    templateUnavailable: '사용 불가',
    title: '이슈 만들기',
    titleLabel: '제목',
    titlePlaceholder: '제목 입력',
    titleRequired: '제목 필요',
  },
  search: {
    close: '검색 닫기',
    description: '검색 설명',
    emptyDescription: '검색 결과 설명',
    emptyTitle: '검색 결과 없음',
    errorDescription: '검색 오류 설명',
    errorTitle: '검색 오류',
    exactMatch: 'ID 일치',
    issue: '이슈',
    issueStatuses: {
      CANCELED: '취소',
      DONE: '완료',
      IN_PROGRESS: '진행 중',
      PAUSED: '보류',
      REVIEW: '검토',
      TODO: '할 일',
      UNSORTED: '미분류',
    },
    inputLabel: '검색어',
    loadMore: '결과 더 보기',
    loadMoreError: '더 보기 오류',
    loading: '검색 중',
    loadingMore: '더 불러오는 중',
    minimumDescription: '두 글자부터 검색',
    minimumTitle: '두 글자 이상 입력',
    noProject: '프로젝트 없음',
    noResultsDescription: '결과 없음 설명',
    noResultsTitle: '결과 없음',
    placeholder: '검색어 입력',
    resultCount: '검색 결과 {count}개',
    results: '검색 결과',
    retry: '다시 시도',
    roles: {
      APP_FRONTEND: '앱 프론트',
      BACKEND: '백엔드',
      WEB_FRONTEND: '웹 프론트',
    },
    stateCategories: {
      BACKLOG: '백로그',
      CANCELED: '취소',
      COMPLETED: '완료',
      STARTED: '진행 중',
      UNSTARTED: '할 일',
    },
    teamWork: '팀 작업',
    title: '검색',
  },
  skipToContent: '본문으로 건너뛰기',
  teamSelector: {
    allTeams: '모든 팀 보기',
    close: '팀 선택 닫기',
    collapseSection: '{section} 구역 접기',
    collapseTeam: '{team} 팀 메뉴 접기',
    expandSection: '{section} 구역 펼치기',
    expandTeam: '{team} 팀 메뉴 펼치기',
    myTeamsEmpty: '참여 중인 팀이 없습니다',
    teamBoard: '보드',
    teamIssues: '이슈',
    description: '팀 선택 설명',
    emptyDescription: '팀 없음 설명',
    emptyTitle: '팀 없음',
    errorDescription: '팀 오류 설명',
    errorTitle: '팀 오류',
    loading: '팀 로딩',
    myTeams: '내 팀',
    otherTeams: '다른 팀',
    retry: '다시 시도',
    title: '팀',
  },
};

describe('AppShell', () => {
  beforeEach(() => {
    pathname = '/my-issues';
    window.history.replaceState({}, '', '/ko/my-issues');
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('현재 멤버십의 소속 팀을 데스크톱과 모바일 팀 탐색에 전달한다', () => {
    render(<AppShell labels={labels}>본문</AppShell>);

    expect(screen.getByTestId('desktop-team-navigation-memberships')).toHaveTextContent('team-web');
    expect(screen.getByTestId('team-selector-memberships')).toHaveTextContent('team-web');
  });

  it('반복 탐색을 건너뛸 수 있는 본문 링크와 포커스 대상을 제공한다', () => {
    render(
      <AppShell labels={labels}>
        <p>업무 내용</p>
      </AppShell>,
    );

    expect(screen.getByRole('link', { name: labels.skipToContent })).toHaveAttribute(
      'href',
      '#workspace-main-content',
    );
    expect(screen.getByRole('main')).toHaveAttribute('id', 'workspace-main-content');
    expect(screen.getByRole('main')).toHaveAttribute('tabindex', '-1');
  });

  it('데스크톱은 개인·워크스페이스 구역으로 나누고 모바일은 기존 탭 순서를 유지한다', () => {
    render(
      <AppShell labels={labels}>
        <p>업무 내용</p>
      </AppShell>,
    );

    const desktopNavigation = screen.getByRole('navigation', { name: labels.desktopNavigation });
    const desktopLinks = within(desktopNavigation).getAllByRole('link');
    expect(desktopLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/inbox',
      '/my-issues',
      '/my-issues?view=saved-my-work&sort=executionOrder&sortDirection=desc',
      '/issues',
      '/issues?view=saved-issues&query=%EA%B8%B4%EA%B8%89&sort=priority&sortDirection=desc',
      '/projects',
      '/projects/project-1',
    ]);
    expect(
      within(desktopNavigation).getByRole('heading', { name: labels.navigation.workspace }),
    ).toBeVisible();

    const mobileNavigation = screen.getByRole('navigation', { name: labels.mobileNavigation });
    expect(
      within(mobileNavigation)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/my-issues', '/inbox', '/issues', '/projects']);
    expect(
      Array.from(mobileNavigation.children).map(
        (item) => item.getAttribute('href') ?? item.getAttribute('aria-label'),
      ),
    ).toEqual(['/my-issues', '/inbox', '/issues', '/projects', labels.openTeamSelector]);
    expect(
      within(mobileNavigation).getByRole('button', { name: labels.openTeamSelector }),
    ).toBeVisible();
    expect(screen.getAllByRole('button', { name: labels.openSearch })).toHaveLength(2);
  });

  it('현재 워크스페이스 정보와 바로 보이는 설정 진입점을 제공한다', async () => {
    const user = userEvent.setup();
    render(
      <AppShell labels={labels}>
        <p>업무 내용</p>
      </AppShell>,
    );

    expect(screen.getByRole('link', { name: labels.navigation.settings })).toHaveAttribute(
      'href',
      '/settings/members',
    );

    await user.click(screen.getByRole('button', { name: labels.openWorkspaceMenu }));

    expect(screen.getAllByText('리벳 워크스페이스').length).toBeGreaterThan(0);
  });

  it('설정 화면에서는 사이드바 설정 진입점을 현재 위치로 표시한다', () => {
    pathname = '/settings/members';
    window.history.replaceState({}, '', '/ko/settings/members');
    render(
      <AppShell labels={labels}>
        <p>설정 내용</p>
      </AppShell>,
    );

    expect(screen.getByRole('link', { name: labels.navigation.settings })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('워크스페이스 구역 접기 상태를 브라우저 저장소에 기억한다', async () => {
    const user = userEvent.setup();
    const view = render(
      <AppShell labels={labels}>
        <p>업무 내용</p>
      </AppShell>,
    );

    const collapse = screen.getByRole('button', {
      name: labels.collapseSection.replace('{section}', labels.navigation.workspace),
    });
    await user.click(collapse);

    await waitFor(() =>
      expect(window.localStorage.getItem('rivet:sidebar-collapsed-sections:v1')).toBe(
        '["group:workspace"]',
      ),
    );

    view.unmount();
    render(
      <AppShell labels={labels}>
        <p>업무 내용</p>
      </AppShell>,
    );

    await waitFor(() =>
      expect(
        screen.getByRole('button', {
          name: labels.expandSection.replace('{section}', labels.navigation.workspace),
        }),
      ).toHaveAttribute('aria-expanded', 'false'),
    );
  });

  it('다른 목록을 거쳐도 membership별 이슈 저장된 보기 URL을 복원한다', async () => {
    pathname = '/issues';
    window.history.replaceState(
      {},
      '',
      '/ko/issues?view=issue-view&query=%EA%B8%B4%EA%B8%89&sort=priority',
    );
    const view = render(
      <AppShell labels={labels}>
        <p>업무 내용</p>
      </AppShell>,
    );

    await waitFor(() => {
      expect(
        window.sessionStorage.getItem('rivet:saved-view-navigation:v1:membership-1:/issues'),
      ).toBe('view=issue-view&query=%EA%B8%B4%EA%B8%89&sort=priority');
    });

    pathname = '/my-issues';
    window.history.replaceState({}, '', '/ko/my-issues');
    view.rerender(
      <AppShell labels={labels}>
        <p>업무 내용</p>
      </AppShell>,
    );

    expect(
      within(screen.getByRole('navigation', { name: labels.desktopNavigation })).getByRole('link', {
        name: labels.navigation.issues,
      }),
    ).toHaveAttribute('href', '/issues?view=issue-view&query=%EA%B8%B4%EA%B8%89&sort=priority');
    expect(
      within(screen.getByRole('navigation', { name: labels.mobileNavigation })).getByRole('link', {
        name: labels.navigation.issues,
      }),
    ).toHaveAttribute('href', '/issues?view=issue-view&query=%EA%B8%B4%EA%B8%89&sort=priority');
  });

  it('데스크톱 사이드바에서 개인 보기를 상위 목록 메뉴 아래에서 바로 연다', () => {
    pathname = '/issues';
    window.history.replaceState({}, '', '/ko/issues?view=saved-issues');
    render(
      <AppShell labels={labels}>
        <p>업무 내용</p>
      </AppShell>,
    );

    const desktopNavigation = screen.getByRole('navigation', { name: labels.desktopNavigation });
    const issueViewGroup = within(desktopNavigation).getByRole('group', {
      name: '이슈 저장된 보기',
    });
    const myWorkViewGroup = within(desktopNavigation).getByRole('group', {
      name: '내 작업 저장된 보기',
    });
    const issueParent = within(desktopNavigation).getByRole('link', {
      name: labels.navigation.issues,
    });
    const issueView = within(issueViewGroup).getByRole('link', { name: /긴급 이슈/u });

    expect(issueParent).toHaveAttribute('aria-current', 'page');
    expect(issueView).toHaveAttribute('aria-current', 'location');
    expect(issueView).not.toHaveClass('bg-sidebar-accent');
    expect(issueView).toHaveAttribute(
      'href',
      '/issues?view=saved-issues&query=%EA%B8%B4%EA%B8%89&sort=priority&sortDirection=desc',
    );
    expect(within(myWorkViewGroup).getByRole('link', { name: '오늘 할 일' })).toHaveAttribute(
      'href',
      '/my-issues?view=saved-my-work&sort=executionOrder&sortDirection=desc',
    );
  });

  it('저장된 보기에서 연 이슈 상세에서도 해당 보기를 활성 상태로 유지한다', () => {
    pathname = '/issues/F-1';
    window.history.replaceState({}, '', '/ko/issues/F-1?tab=work&view=saved-issues');
    render(
      <AppShell labels={labels}>
        <p>업무 내용</p>
      </AppShell>,
    );

    const desktopNavigation = screen.getByRole('navigation', { name: labels.desktopNavigation });
    const issueView = within(
      within(desktopNavigation).getByRole('group', { name: '이슈 저장된 보기' }),
    ).getByRole('link', { name: /긴급 이슈/u });

    expect(issueView).toHaveAttribute('aria-current', 'location');
  });

  it('저장된 보기에서 연 내 작업 상세에서도 해당 보기를 활성 상태로 유지한다', () => {
    pathname = '/my-issues/WEB-12';
    window.history.replaceState({}, '', '/ko/my-issues/WEB-12?tab=work&view=saved-my-work');
    render(
      <AppShell labels={labels}>
        <p>업무 내용</p>
      </AppShell>,
    );

    const desktopNavigation = screen.getByRole('navigation', { name: labels.desktopNavigation });
    const myWorkView = within(
      within(desktopNavigation).getByRole('group', { name: '내 작업 저장된 보기' }),
    ).getByRole('link', { name: '오늘 할 일' });

    expect(myWorkView).toHaveAttribute('aria-current', 'location');
  });

  it('데스크톱 사이드바에서 내 팀이 참여하는 프로젝트만 표시하고 해당 이슈 화면으로 연결한다', () => {
    pathname = '/projects/project-1';
    window.history.replaceState({}, '', '/ko/projects/project-1');

    render(
      <AppShell labels={labels}>
        <p>업무 내용</p>
      </AppShell>,
    );

    const desktopNavigation = screen.getByRole('navigation', { name: labels.desktopNavigation });
    const projectGroup = within(desktopNavigation).getByRole('group', {
      name: '프로젝트 목록',
    });
    const projectParent = within(desktopNavigation).getByRole('link', {
      name: labels.navigation.projects,
    });
    const projectLink = within(projectGroup).getByRole('link', { name: '리벳 웹' });

    expect(projectParent).toHaveAttribute('aria-current', 'page');
    expect(projectLink).toHaveAttribute('aria-current', 'location');
    expect(projectLink).toHaveAttribute('href', '/projects/project-1');
    expect(projectLink).toHaveAttribute('title', '리벳 웹 프로젝트 이슈 보기');
    expect(within(projectGroup).queryByRole('link', { name: '리벳 API' })).not.toBeInTheDocument();
    expect(
      within(projectGroup).queryByRole('link', { name: '종료된 웹 프로젝트' }),
    ).not.toBeInTheDocument();
  });

  it('내 작업 상세 경로에서는 내 작업 탐색을 활성화한다', () => {
    pathname = '/my-issues/WEB-12';
    window.history.replaceState({}, '', '/ko/my-issues/WEB-12?tab=work');

    render(
      <AppShell labels={labels}>
        <p>업무 내용</p>
      </AppShell>,
    );

    expect(
      within(screen.getByRole('navigation', { name: labels.desktopNavigation })).getByRole('link', {
        name: labels.navigation.myIssues,
      }),
    ).toHaveAttribute('aria-current', 'page');
  });

  it('데스크톱과 모바일 알림함에 같은 읽지 않은 개수와 접근 가능한 이름을 표시한다', () => {
    render(
      <AppShell labels={labels}>
        <p>업무 내용</p>
      </AppShell>,
    );

    expect(screen.getAllByRole('link', { name: '알림함, 읽지 않은 알림 7개' })).toHaveLength(2);
    expect(screen.getAllByText('7')).toHaveLength(3);
  });

  it('데스크톱 만들기 버튼으로 모달을 열고 닫은 뒤 트리거 포커스를 복원한다', async () => {
    const user = userEvent.setup();
    render(
      <AppShell labels={labels}>
        <p>업무 내용</p>
      </AppShell>,
    );

    const trigger = screen.getByRole('button', { name: labels.openIssueCreate });
    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: '이슈 만들기 모달' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: '모달 닫기' }));
    expect(trigger).toHaveFocus();
  });

  it('C 단축키로 만들기를 열되 입력 중에는 열지 않는다', async () => {
    render(
      <AppShell labels={labels}>
        <input aria-label="편집 입력" />
        <textarea aria-label="편집 영역" />
        <div aria-label="편집 가능한 내용" contentEditable role="textbox" tabIndex={0} />
      </AppShell>,
    );

    for (const name of ['편집 입력', '편집 영역', '편집 가능한 내용']) {
      const editor = screen.getByRole('textbox', { name });
      editor.focus();
      fireEvent.keyDown(editor, { code: 'KeyC', key: 'c' });
      expect(screen.queryByRole('dialog', { name: '이슈 만들기 모달' })).not.toBeInTheDocument();
    }

    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(window, { code: 'KeyC', key: 'c' });
    expect(screen.getByRole('dialog', { name: '이슈 만들기 모달' })).toBeVisible();
  });

  it('/ 단축키로 검색을 열되 입력 중에는 열지 않는다', () => {
    render(
      <AppShell labels={labels}>
        <input aria-label="편집 입력" />
      </AppShell>,
    );

    const editor = screen.getByRole('textbox', { name: '편집 입력' });
    editor.focus();
    fireEvent.keyDown(editor, { code: 'Slash', key: '/' });
    expect(screen.queryByRole('dialog', { name: '검색 모달' })).not.toBeInTheDocument();

    editor.blur();
    fireEvent.keyDown(window, { code: 'Slash', key: '/' });
    expect(screen.getByRole('dialog', { name: '검색 모달' })).toBeVisible();
  });

  it('프로필 설정이 열려 있으면 전역 검색과 만들기 단축키를 실행하지 않는다', async () => {
    const user = userEvent.setup();
    render(
      <AppShell labels={labels}>
        <p>업무 내용</p>
      </AppShell>,
    );

    await user.click(screen.getAllByRole('button', { name: labels.userMenu.open })[0]!);
    await user.click(screen.getByRole('button', { name: labels.userMenu.profile }));
    expect(screen.getByRole('dialog', { name: '프로필 모달' })).toBeVisible();

    fireEvent.keyDown(window, { code: 'Slash', key: '/' });
    fireEvent.keyDown(window, { code: 'KeyC', key: 'c' });
    expect(screen.queryByRole('dialog', { name: '검색 모달' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '이슈 만들기 모달' })).not.toBeInTheDocument();
  });

  it('피드백 모달을 닫으면 열었던 사용자 메뉴 트리거로 포커스를 복원한다', async () => {
    const user = userEvent.setup();
    render(
      <AppShell labels={labels}>
        <p>업무 내용</p>
      </AppShell>,
    );

    const trigger = screen.getAllByRole('button', { name: labels.userMenu.open })[0]!;
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: labels.userMenu.feedback }));
    expect(screen.getByRole('dialog', { name: '피드백 모달' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: '피드백 닫기' }));
    expect(trigger).toHaveFocus();
  });

  it('내 이슈 create 플래그를 소비해 만들기를 열고 다른 URL 상태는 유지한다', async () => {
    window.history.replaceState({}, '', '/ko/my-issues?create=1&view=all#top');

    render(
      <AppShell labels={labels}>
        <p>업무 내용</p>
      </AppShell>,
    );

    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: '이슈 만들기 모달' })).toBeVisible(),
    );
    expect(window.location.pathname).toBe('/ko/my-issues');
    expect(window.location.search).toBe('?view=all');
    expect(window.location.hash).toBe('#top');
    const desktopNavigation = screen.getByRole('navigation', { name: labels.desktopNavigation });
    expect(
      within(desktopNavigation).getByRole('link', { name: labels.navigation.myIssues }),
    ).toHaveAttribute('aria-current', 'page');
    expect(
      within(desktopNavigation).getByRole('link', { name: labels.navigation.issues }),
    ).not.toHaveAttribute('aria-current');
  });

  it('팀 화면 create 플래그를 소비하고 현재 팀을 만들기 기본값으로 전달한다', async () => {
    pathname = '/teams/WEB/issues';
    window.history.replaceState({}, '', '/ko/teams/WEB/issues?create=1&tab=backlog');

    render(
      <AppShell labels={labels}>
        <p>업무 내용</p>
      </AppShell>,
    );

    const dialog = await screen.findByRole('dialog', { name: '이슈 만들기 모달' });
    expect(dialog).toHaveAttribute('data-current-team-key', 'WEB');
    expect(window.location.pathname).toBe('/ko/teams/WEB/issues');
    expect(window.location.search).toBe('?tab=backlog');
  });

  it('프로젝트 create 요청은 프로젝트만 seed로 전달하고 전용 query만 소비한다', async () => {
    pathname = '/projects/project-1';
    window.history.replaceState(
      {},
      '',
      '/ko/projects/project-1?create=1&projectId=project-1&view=active#tree',
    );

    render(
      <AppShell labels={labels}>
        <p>업무 내용</p>
      </AppShell>,
    );

    const dialog = await screen.findByRole('dialog', { name: '이슈 만들기 모달' });
    expect(dialog).toHaveAttribute('data-project-id', 'project-1');
    expect(window.location.pathname).toBe('/ko/projects/project-1');
    expect(window.location.search).toBe('?view=active');
    expect(window.location.hash).toBe('#tree');
    const desktopNavigation = screen.getByRole('navigation', { name: labels.desktopNavigation });
    expect(
      within(desktopNavigation).getByRole('link', { name: labels.navigation.projects }),
    ).toHaveAttribute('aria-current', 'page');
    expect(
      within(desktopNavigation).getByRole('link', { name: labels.navigation.issues }),
    ).not.toHaveAttribute('aria-current');
  });

  it('직접 연 팀 보드를 마지막 팀과 보기로 기억한다', async () => {
    pathname = '/teams/WEB/board';
    window.history.replaceState({}, '', '/ko/teams/WEB/board');

    render(
      <AppShell labels={labels}>
        <p>업무 내용</p>
      </AppShell>,
    );

    await waitFor(() => {
      expect(window.localStorage.getItem('rivet:last-team-key:v1')).toBe('WEB');
      expect(window.localStorage.getItem('rivet:last-team-view:v1')).toBe('board');
    });
  });
});
