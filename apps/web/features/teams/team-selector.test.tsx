import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTeamsControllerList } from '@rivet/api-client';

import { DesktopTeamNavigation, TeamSelector, type TeamSelectorLabels } from './team-selector';

vi.mock('@rivet/api-client', () => ({ useTeamsControllerList: vi.fn() }));

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    children,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const labels: TeamSelectorLabels = {
  allTeams: '모든 팀 보기',
  close: '팀 선택 닫기',
  collapseSection: '{section} 구역 접기',
  collapseTeam: '{team} 팀 메뉴 접기',
  description: '참여한 팀으로 이동합니다.',
  emptyDescription: '팀에 참여하면 이동할 수 있습니다.',
  emptyTitle: '참여한 팀이 없습니다',
  errorDescription: '잠시 후 다시 시도해 주세요.',
  errorTitle: '팀을 불러오지 못했습니다',
  expandSection: '{section} 구역 펼치기',
  expandTeam: '{team} 팀 메뉴 펼치기',
  loading: '팀을 불러오는 중입니다.',
  myTeams: '내 팀',
  myTeamsEmpty: '참여 중인 팀이 없습니다',
  otherTeams: '다른 팀',
  retry: '다시 시도',
  teamBoard: '보드',
  teamIssues: '이슈',
  title: '팀',
};

function renderDesktopNavigation(
  props: Partial<Parameters<typeof DesktopTeamNavigation>[0]> = {},
) {
  return render(
    <DesktopTeamNavigation
      currentTeamKey={null}
      currentTeamView={null}
      expanded
      labels={labels}
      memberTeamIds={[activeTeam.id]}
      onOpenAllTeams={vi.fn()}
      onToggleExpanded={vi.fn()}
      teamView="issues"
      {...props}
    />,
  );
}
const activeTeam = {
  archived: false,
  id: 'team-web',
  key: 'WEB',
  memberCount: 3,
  name: '웹',
  version: 1,
};
const archivedTeam = { ...activeTeam, archived: true, id: 'team-old', key: 'OLD', name: '이전 팀' };
const otherTeam = { ...activeTeam, id: 'team-api', key: 'API', name: 'API' };

function queryResult(value: Record<string, unknown> = {}) {
  return {
    data: { items: [activeTeam, archivedTeam], nextCursor: null },
    isError: false,
    isPending: false,
    refetch: vi.fn(),
    ...value,
  } as never;
}

describe('team selectors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.mocked(useTeamsControllerList).mockReturnValue(queryResult());
  });

  afterEach(cleanup);

  it('데스크톱 탐색에는 활성 팀 이름만 표시하고 현재 팀을 구분한다', () => {
    renderDesktopNavigation({ currentTeamKey: 'WEB', currentTeamView: 'issues' });

    const link = screen.getByRole('link', { name: '웹 (WEB)' });
    expect(link).toHaveAttribute('href', '/teams/WEB/issues');
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByText('이전 팀')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: labels.myTeams })).toBeVisible();
  });

  it('마지막 팀 보드 보기를 팀 링크에도 유지한다', () => {
    renderDesktopNavigation({ teamView: 'board' });

    expect(screen.getByRole('link', { name: '웹 (WEB)' })).toHaveAttribute(
      'href',
      '/teams/WEB/board',
    );
  });

  it('데스크톱 탐색에는 소속 팀만 두고 나머지는 모든 팀 보기로 연결한다', async () => {
    const onOpenAllTeams = vi.fn();
    vi.mocked(useTeamsControllerList).mockReturnValue(
      queryResult({ data: { items: [activeTeam, otherTeam, archivedTeam], nextCursor: null } }),
    );
    const user = userEvent.setup();
    renderDesktopNavigation({ onOpenAllTeams });

    expect(screen.getByRole('link', { name: '웹 (WEB)' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'API (API)' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: labels.allTeams }));
    expect(onOpenAllTeams).toHaveBeenCalledOnce();
  });

  it('현재 팀은 펼친 상태로 이슈와 보드 보기를 함께 제공한다', async () => {
    const user = userEvent.setup();
    renderDesktopNavigation({ currentTeamKey: 'WEB', currentTeamView: 'board' });

    const teamViews = screen.getByRole('group', { name: `웹 ${labels.title}` });
    expect(within(teamViews).getByRole('link', { name: labels.teamIssues })).toHaveAttribute(
      'href',
      '/teams/WEB/issues',
    );
    expect(within(teamViews).getByRole('link', { name: labels.teamBoard })).toHaveAttribute(
      'aria-current',
      'location',
    );

    await user.click(screen.getByRole('button', { name: '웹 팀 메뉴 접기' }));
    expect(screen.queryByRole('group', { name: `웹 ${labels.title}` })).not.toBeInTheDocument();
  });

  it('소속 팀이 없으면 안내 문구를 보여준다', () => {
    renderDesktopNavigation({ memberTeamIds: [] });

    expect(screen.getByText(labels.myTeamsEmpty)).toBeVisible();
    expect(screen.queryByRole('link', { name: '웹 (WEB)' })).not.toBeInTheDocument();
  });

  it('모바일 선택에서 팀을 고르면 마지막 팀을 기억하고 대화상자를 닫는다', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <TeamSelector
        labels={labels}
        memberTeamIds={[activeTeam.id]}
        open
        onOpenChange={onOpenChange}
        teamView="issues"
      />,
    );

    expect(screen.getByRole('region', { name: labels.myTeams })).toBeVisible();

    await user.click(screen.getByRole('link', { name: /웹/ }));

    expect(window.localStorage.getItem('rivet:last-team-key:v1')).toBe('WEB');
    expect(window.localStorage.getItem('rivet:last-team-view:v1')).toBe('issues');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('모바일 선택의 로딩·빈 상태·오류와 재시도를 제공한다', async () => {
    const refetch = vi.fn();
    vi.mocked(useTeamsControllerList).mockReturnValue(
      queryResult({ data: undefined, isError: true, refetch }),
    );
    const user = userEvent.setup();
    const view = render(
      <TeamSelector
        labels={labels}
        memberTeamIds={[]}
        open
        onOpenChange={vi.fn()}
        teamView="issues"
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(labels.errorTitle);
    await user.click(screen.getByRole('button', { name: labels.retry }));
    expect(refetch).toHaveBeenCalledOnce();

    vi.mocked(useTeamsControllerList).mockReturnValue(
      queryResult({ data: { items: [], nextCursor: null } }),
    );
    view.rerender(
      <TeamSelector
        labels={labels}
        memberTeamIds={[]}
        open
        onOpenChange={vi.fn()}
        teamView="issues"
      />,
    );
    expect(screen.getByRole('heading', { name: labels.emptyTitle })).toBeVisible();

    vi.mocked(useTeamsControllerList).mockReturnValue(
      queryResult({ data: undefined, isPending: true }),
    );
    view.rerender(
      <TeamSelector
        labels={labels}
        memberTeamIds={[]}
        open
        onOpenChange={vi.fn()}
        teamView="issues"
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(labels.loading);
  });
});
