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
            projectTeam: {
              active: true,
              id: 'project-team-id',
              team: { id: 'team-id', key: 'PLAN', name: '기획' },
            },
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

  it('compact 밀도는 comfortable보다 낮은 최소 높이와 좁은 패딩을 적용한다', () => {
    const work = {
      id: 'team-work-id',
      identifier: 'WEB-12',
      issue: {
        identifier: 'ISSUE-9',
        labels: [],
        priority: 'HIGH',
        project: { name: 'Rivet' },
        title: '내 작업 상세 진입',
      },
      projectTeam: {
        active: true,
        id: 'project-team-id',
        team: { id: 'team-id', key: 'PLAN', name: '기획' },
      },
      version: 1,
      workflowState: { id: 'state-id' },
    } as never;

    const { container: compactContainer } = render(
      <ul>
        <MyWorkListRow work={work} density="compact" />
      </ul>,
    );
    const { container: comfortableContainer } = render(
      <ul>
        <MyWorkListRow work={work} density="comfortable" />
      </ul>,
    );

    const compactRow = compactContainer.querySelector('li > div');
    const comfortableRow = comfortableContainer.querySelector('li > div');

    expect(compactRow?.className).toContain('min-h-11');
    expect(compactRow?.className).toContain('py-1.5');
    expect(comfortableRow?.className).toContain('min-h-16');
    expect(comfortableRow?.className).toContain('py-2.5');
    expect(compactRow?.className).not.toEqual(comfortableRow?.className);
  });
});
