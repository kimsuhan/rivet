import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnchorHTMLAttributes } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppShell } from './app-shell';

let pathname = '/my-issues';

vi.mock('@rivet/api-client', () => ({
  useAuthControllerGetSession: () => ({
    data: {
      authenticated: true,
      membership: { role: 'ADMIN', status: 'ACTIVE' },
      user: {
        avatarFileId: null,
        displayName: '김리벳',
        email: 'kim@example.com',
        id: 'user-1',
      },
    },
  }),
  useNotificationsControllerUnreadCount: () => ({ data: { count: 7 } }),
}));

vi.mock('@/features/search/global-search', () => ({
  GlobalSearch: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="검색 모달" /> : null,
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
      parentIssueId?: string;
      projectId?: string;
      projectRole?: string;
      type?: string;
    } | null;
  }) =>
    open ? (
      <div
        role="dialog"
        aria-label="이슈 만들기 모달"
        data-current-team-key={currentTeamKey ?? ''}
        data-parent-issue-id={seed?.parentIssueId ?? ''}
        data-project-id={seed?.projectId ?? ''}
        data-project-role={seed?.projectRole ?? ''}
        data-type={seed?.type ?? ''}
      >
        <button type="button" onClick={() => onOpenChange(false)}>
          모달 닫기
        </button>
      </div>
    ) : null,
}));

vi.mock('@/features/teams/team-selector', () => ({
  DesktopTeamNavigation: () => null,
  TeamSelector: () => null,
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
  openProfile: '프로필 설정 열기',
  navigation: {
    inbox: '알림함',
    myIssues: '내 이슈',
    projects: '프로젝트',
    search: '검색',
    settings: '설정',
    teams: '팀',
  },
  openSearch: '검색 열기',
  openTeamSelector: '팀 선택 열기',
  profile: {
    choose: '사진 선택',
    close: '프로필 닫기',
    description: '프로필 설명',
    discard: '선택 제거',
    emptyFile: '빈 파일',
    fileLimit: '파일 제한',
    invalidType: '잘못된 형식',
    optimizing: '최적화 중',
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
  issueCreate: {
    assigneeLabel: '담당자',
    assigneePlaceholder: '담당자 선택',
    cancel: '취소',
    close: '이슈 만들기 닫기',
    description: '설명',
    discardChanges: '버리기',
    discardDescription: '버리기 설명',
    discardTitle: '버릴까요?',
    errorDescription: '오류 설명',
    errorTitle: '오류',
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
    initialRoleSelected: '선택됨',
    initialRolesDescription: '선택하지 않아도 됩니다.',
    initialRolesLabel: '처음 작업할 팀 (선택)',
    labelsLabel: '라벨',
    labelsUnavailable: '라벨 오류',
    keepEditing: '계속 작성',
    mobileDescription: '데스크톱에서 만들어 주세요.',
    mobileTitle: '데스크톱 전용',
    noLabels: '라벨 없음',
    noParent: '상위 이슈 없음',
    noProject: '프로젝트 없음',
    optionsErrorDescription: '항목 오류 설명',
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
    projectRequired: '프로젝트 필요',
    projectRoleLabel: '프로젝트 역할',
    projectRolePlaceholder: '역할 선택',
    projectRoleRequired: '역할 필요',
    projectRoles: {
      APP_FRONTEND: '앱 프론트',
      BACKEND: '백엔드',
      WEB_FRONTEND: '웹 프론트',
    },
    retry: '다시 시도',
    shortcutHint: '단축키',
    stateLabel: '상태',
    statePlaceholder: '상태 선택',
    stateRequired: '상태 필요',
    submit: '이슈 만들기',
    submitting: '만드는 중',
    teamLabel: '팀',
    teamLockedByRole: '역할의 담당 팀으로 고정됩니다.',
    teamPlaceholder: '팀 선택',
    teamRequired: '팀 필요',
    teamTaskClose: '팀 작업 만들기 닫기',
    teamTaskDescription: '팀 작업 설명',
    teamTaskSubmit: '팀 작업 만들기',
    teamTaskSubmitting: '팀 작업 만드는 중',
    teamTaskTitle: '팀 작업 만들기',
    teamTaskType: '팀 작업',
    title: '이슈 만들기',
    titleLabel: '제목',
    titlePlaceholder: '제목 입력',
    titleRequired: '제목 필요',
    titleTooLong: '제목이 너무 김',
    typeLabel: '이슈 유형',
    unassigned: '담당자 없음',
  },
  search: {
    close: '검색 닫기',
    description: '검색 설명',
    emptyDescription: '검색 결과 설명',
    emptyTitle: '검색 결과 없음',
    errorDescription: '검색 오류 설명',
    errorTitle: '검색 오류',
    exactMatch: 'ID 일치',
    feature: '기능 이슈',
    featureStatuses: {
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
    teamTask: '팀 작업',
    title: '검색',
  },
  skipToContent: '본문으로 건너뛰기',
  teamSelector: {
    close: '팀 선택 닫기',
    description: '팀 선택 설명',
    emptyDescription: '팀 없음 설명',
    emptyTitle: '팀 없음',
    errorDescription: '팀 오류 설명',
    errorTitle: '팀 오류',
    loading: '팀 로딩',
    retry: '다시 시도',
    title: '팀',
  },
};

describe('AppShell', () => {
  beforeEach(() => {
    pathname = '/my-issues';
    window.history.replaceState({}, '', '/ko/my-issues');
    window.localStorage.clear();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
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

    await user.click(screen.getAllByRole('button', { name: labels.openProfile })[0]!);
    expect(screen.getByRole('dialog', { name: '프로필 모달' })).toBeVisible();

    fireEvent.keyDown(window, { code: 'Slash', key: '/' });
    fireEvent.keyDown(window, { code: 'KeyC', key: 'c' });
    expect(screen.queryByRole('dialog', { name: '검색 모달' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '이슈 만들기 모달' })).not.toBeInTheDocument();
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

  it('프로젝트 하위 작업 create 요청을 seed로 전달하고 전용 query만 소비한다', async () => {
    pathname = '/projects/project-1';
    window.history.replaceState(
      {},
      '',
      '/ko/projects/project-1?create=1&type=TEAM_TASK&projectId=project-1&projectRole=BACKEND&parentIssueId=feature-1&role=WEB_FRONTEND#tree',
    );

    render(
      <AppShell labels={labels}>
        <p>업무 내용</p>
      </AppShell>,
    );

    const dialog = await screen.findByRole('dialog', { name: '이슈 만들기 모달' });
    expect(dialog).toHaveAttribute('data-type', 'TEAM_TASK');
    expect(dialog).toHaveAttribute('data-project-id', 'project-1');
    expect(dialog).toHaveAttribute('data-project-role', 'BACKEND');
    expect(dialog).toHaveAttribute('data-parent-issue-id', 'feature-1');
    expect(window.location.pathname).toBe('/ko/projects/project-1');
    expect(window.location.search).toBe('?role=WEB_FRONTEND');
    expect(window.location.hash).toBe('#tree');
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
