import { render } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { TeamWorkListRow } from './team-work-list-row';

vi.mock('@rivet/api-client', () => ({
  useMembersControllerList: () => ({ data: { items: [] }, isPending: false }),
  useTeamsControllerListWorkflowStates: () => ({ data: { items: [] }, isPending: false }),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('./issue-attribute-presentation', () => ({
  CompactAssigneeTrigger: () => <button type="button">담당자</button>,
  PriorityDisplay: () => <span>우선순위</span>,
  PROJECT_ROLE_LABELS: { BACKEND: '백엔드' },
  StatusTrigger: () => <button type="button">상태</button>,
}));

vi.mock('./team-work-completion-modal', () => ({ TeamWorkCompletionModal: () => null }));
vi.mock('./team-work-primary-action', () => ({ TeamWorkPrimaryAction: () => null }));
vi.mock('./use-team-work-inline-mutation', () => ({
  useTeamWorkInlineMutation: () => ({ isPending: false, isError: false, mutate: vi.fn() }),
}));

describe('TeamWorkListRow', () => {
  it('compact 밀도는 comfortable보다 낮은 최소 높이와 좁은 패딩을 적용한다', () => {
    const work = {
      id: 'team-work-id',
      identifier: 'WEB-12',
      issue: {
        identifier: 'ISSUE-9',
        title: '팀 작업 상세',
      },
      projectRole: 'BACKEND',
      team: { id: 'team-id', name: '백엔드 팀' },
      updatedAt: new Date().toISOString(),
      version: 1,
      workflowState: { id: 'state-id' },
    } as never;

    const { container: compactContainer } = render(
      <ul>
        <TeamWorkListRow work={work} density="compact" />
      </ul>,
    );
    const { container: comfortableContainer } = render(
      <ul>
        <TeamWorkListRow work={work} density="comfortable" />
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
