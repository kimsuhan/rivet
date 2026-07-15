import { render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { MyWorkListRow } from './my-work-list-row';

vi.mock('@rivet/api-client', () => ({
  useTeamsControllerListWorkflowStates: () => ({ data: { items: [] }, isPending: false }),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('./issue-attribute-presentation', () => ({
  PriorityDisplay: () => <span>우선순위</span>,
  PROJECT_ROLE_LABELS: { BACKEND: '백엔드' },
  StatusTrigger: () => <button type="button">상태</button>,
}));

vi.mock('./issue-label-chips', () => ({ IssueLabelChips: () => null }));
vi.mock('./team-work-completion-modal', () => ({ TeamWorkCompletionModal: () => null }));
vi.mock('./team-work-primary-action', () => ({ TeamWorkPrimaryAction: () => null }));
vi.mock('./use-team-work-inline-mutation', () => ({
  useTeamWorkInlineMutation: () => ({ isPending: false, isError: false, mutate: vi.fn() }),
}));

describe('MyWorkListRow', () => {
  it('행을 내 작업 상세 팀 작업 경로로 연결한다', () => {
    render(
      <ul>
        <MyWorkListRow
          work={{
            id: 'team-work-id',
            identifier: 'WEB-12',
            issue: {
              identifier: 'ISSUE-9',
              labels: [],
              priority: 'HIGH',
              project: { name: 'Rivet' },
              title: '내 작업 상세 진입',
            },
            projectRole: 'BACKEND',
            team: { id: 'team-id' },
            version: 1,
            workflowState: { id: 'state-id' },
          } as never}
        />
      </ul>,
    );

    expect(screen.getByRole('link', { name: 'WEB-12 작업 상세 열기' })).toHaveAttribute(
      'href',
      '/my-issues/WEB-12?tab=work',
    );
  });
});
