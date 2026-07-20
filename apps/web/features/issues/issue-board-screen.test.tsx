import { cleanup, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useTeamsControllerList,
  useTeamsControllerListWorkflowStates,
  useTeamWorksControllerList,
} from '@rivet/api-client';

import { IssueBoardScreen } from './issue-board-screen';

vi.mock('@rivet/api-client', () => ({
  useTeamsControllerList: vi.fn(),
  useTeamsControllerListWorkflowStates: vi.fn(),
  useTeamWorksControllerList: vi.fn(),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}));

describe('IssueBoardScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useTeamsControllerList).mockReturnValue({
      data: {
        items: [
          {
            archived: false,
            canManage: false,
            description: null,
            id: 'team-web',
            key: 'WEB',
            leaderCount: 1,
            memberCount: 3,
            name: '웹',
            version: 1,
          },
        ],
        nextCursor: null,
      },
      isError: false,
      isPending: false,
      refetch: vi.fn(),
    } as never);
    vi.mocked(useTeamsControllerListWorkflowStates).mockReturnValue({
      data: {
        items: [
          {
            category: 'STARTED',
            color: 'INDIGO',
            disabledAt: '2026-07-20T00:00:00.000Z',
            id: 'state-disabled',
            isDefault: false,
            name: '검토 중',
            position: 1,
            version: 2,
          },
        ],
        nextCursor: null,
      },
      isError: false,
      isPending: false,
      refetch: vi.fn(),
    } as never);
    vi.mocked(useTeamWorksControllerList).mockReturnValue({
      data: {
        items: [
          {
            assignee: null,
            createdAt: '2026-07-19T00:00:00.000Z',
            id: 'work-1',
            identifier: 'WEB-12',
            issue: {
              id: 'issue-1',
              identifier: 'RVT-12',
              labels: [],
              priority: 'MEDIUM',
              project: {
                archived: false,
                id: 'project-1',
                name: 'Rivet',
                status: 'IN_PROGRESS',
              },
              status: 'IN_PROGRESS',
              title: '숨겨지면 안 되는 작업',
            },
            projectTeam: {
              active: true,
              id: 'project-team-1',
              team: { archived: false, id: 'team-web', key: 'WEB', name: '웹' },
            },
            stateCategory: 'STARTED',
            stateProgress: 0.5,
            updatedAt: '2026-07-20T00:00:00.000Z',
            version: 1,
            workflowState: {
              category: 'STARTED',
              color: 'INDIGO',
              id: 'state-disabled',
              isDefault: false,
              name: '검토 중',
              position: 1,
              version: 2,
            },
            workNoteMarkdown: null,
          },
        ],
        nextCursor: null,
        totalCount: 1,
      },
      isError: false,
      isPending: false,
      refetch: vi.fn(),
    } as never);
  });

  afterEach(cleanup);

  it('사용 중지된 상태와 그 상태에 남은 작업을 보드에 표시한다', () => {
    render(<IssueBoardScreen teamKey="WEB" />);

    expect(useTeamsControllerListWorkflowStates).toHaveBeenCalledWith(
      'team-web',
      { includeDisabled: true },
      { query: { enabled: true, retry: false } },
    );
    expect(screen.getByRole('heading', { name: '검토 중' })).toBeVisible();
    expect(screen.getByRole('link', { name: /WEB-12.*숨겨지면 안 되는 작업/ })).toHaveAttribute(
      'href',
      '/issues/RVT-12?tab=work&work=WEB-12',
    );
  });
});
