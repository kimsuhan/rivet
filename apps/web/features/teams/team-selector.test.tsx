import { cleanup, render, screen } from '@testing-library/react';
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
  close: '팀 선택 닫기',
  description: '참여한 팀으로 이동합니다.',
  emptyDescription: '팀에 참여하면 이동할 수 있습니다.',
  emptyTitle: '참여한 팀이 없습니다',
  errorDescription: '잠시 후 다시 시도해 주세요.',
  errorTitle: '팀을 불러오지 못했습니다',
  loading: '팀을 불러오는 중입니다.',
  retry: '다시 시도',
  title: '팀',
};
const activeTeam = {
  archived: false,
  id: 'team-web',
  key: 'WEB',
  memberCount: 3,
  name: '웹',
  version: 1,
};
const archivedTeam = { ...activeTeam, archived: true, id: 'team-old', key: 'OLD', name: '이전 팀' };

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

  it('데스크톱 탐색에는 활성 팀 이름과 키만 표시하고 현재 팀을 구분한다', () => {
    render(<DesktopTeamNavigation currentTeamKey="WEB" labels={labels} teamView="issues" />);

    const link = screen.getByRole('link', { name: '웹 (WEB)' });
    expect(link).toHaveAttribute('href', '/teams/WEB/issues');
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByText('이전 팀')).not.toBeInTheDocument();
  });

  it('마지막 팀 보드 보기를 다른 팀 링크에도 유지한다', () => {
    render(<DesktopTeamNavigation currentTeamKey={null} labels={labels} teamView="board" />);

    expect(screen.getByRole('link', { name: '웹 (WEB)' })).toHaveAttribute(
      'href',
      '/teams/WEB/board',
    );
  });

  it('모바일 선택에서 팀을 고르면 마지막 팀을 기억하고 대화상자를 닫는다', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<TeamSelector labels={labels} open onOpenChange={onOpenChange} teamView="issues" />);

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
      <TeamSelector labels={labels} open onOpenChange={vi.fn()} teamView="issues" />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(labels.errorTitle);
    await user.click(screen.getByRole('button', { name: labels.retry }));
    expect(refetch).toHaveBeenCalledOnce();

    vi.mocked(useTeamsControllerList).mockReturnValue(
      queryResult({ data: { items: [], nextCursor: null } }),
    );
    view.rerender(<TeamSelector labels={labels} open onOpenChange={vi.fn()} teamView="issues" />);
    expect(screen.getByRole('heading', { name: labels.emptyTitle })).toBeVisible();

    vi.mocked(useTeamsControllerList).mockReturnValue(
      queryResult({ data: undefined, isPending: true }),
    );
    view.rerender(<TeamSelector labels={labels} open onOpenChange={vi.fn()} teamView="issues" />);
    expect(screen.getByRole('status')).toHaveTextContent(labels.loading);
  });
});
