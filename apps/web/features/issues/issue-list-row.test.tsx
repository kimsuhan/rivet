import { render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { IssueListRow } from './issue-list-row';

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ isPending: false, mutate: vi.fn() }),
  useQueryClient: () => ({}),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('./issue-attribute-presentation', () => ({
  IssueStatusDisplay: ({ status }: { status: string }) => <span>{status}</span>,
  PriorityTrigger: () => <button type="button">우선순위</button>,
}));

vi.mock('./issue-label-chips', () => ({ IssueLabelChips: () => null }));

function issue(
  overrides: Partial<{
    status: string;
    workflowSummary: { teamWorkCount: number; unassignedCount: number };
  }>,
) {
  return {
    id: 'issue-id',
    identifier: 'API-1',
    labels: [],
    priority: 'HIGH',
    progress: { completed: 0, percentage: 0, total: 0 },
    project: { name: '프로젝트' },
    status: 'UNSORTED',
    title: '이슈 제목',
    updatedAt: new Date().toISOString(),
    version: 1,
    workflowSummary: { teamWorkCount: 0, unassignedCount: 0 },
    ...overrides,
  } as never;
}

describe('IssueListRow', () => {
  it('결정이 필요한 다음 행동(담당자 지정)은 버튼 위계로 강조한다', () => {
    render(
      <ul>
        <IssueListRow
          issue={issue({ workflowSummary: { teamWorkCount: 2, unassignedCount: 1 } })}
          queryKey={['issues']}
        />
      </ul>,
    );

    const action = screen.getByRole('link', { name: /담당자 지정/ });
    expect(action.className).toContain('border');
  });

  it('단순 이동인 업무 보기는 텍스트 링크 위계를 유지한다', () => {
    render(
      <ul>
        <IssueListRow
          issue={issue({ workflowSummary: { teamWorkCount: 2, unassignedCount: 0 } })}
          queryKey={['issues']}
        />
      </ul>,
    );

    const action = screen.getByRole('link', { name: /업무 보기/ });
    expect(action.className).not.toContain('border');
  });

  it('상세 주소를 지정하면 제목과 다음 행동이 같은 문맥 경로를 사용한다', () => {
    const detailHref = '/projects/project-1/issues/API-1?tab=work';
    const { container } = render(
      <ul>
        <IssueListRow
          detailHref={detailHref}
          issue={issue({ workflowSummary: { teamWorkCount: 2, unassignedCount: 0 } })}
          queryKey={['issues']}
        />
      </ul>,
    );

    expect(container.querySelectorAll(`a[href="${detailHref}"]`)).toHaveLength(2);
  });

  it('배포 대기 이슈의 다음 행동은 배포 현황으로 이동한다', () => {
    render(
      <ul>
        <IssueListRow
          issue={issue({
            status: 'REVIEW',
            workflowSummary: { teamWorkCount: 2, unassignedCount: 0 },
          })}
          queryKey={['issues']}
        />
      </ul>,
    );

    expect(screen.getByRole('link', { name: /배포 현황 보기/ })).toHaveAttribute(
      'href',
      '/deployments',
    );
  });

  it('compact 밀도는 comfortable보다 낮은 최소 높이와 좁은 패딩을 적용한다', () => {
    const { container: compactContainer } = render(
      <ul>
        <IssueListRow issue={issue({})} queryKey={['issues']} density="compact" />
      </ul>,
    );
    const { container: comfortableContainer } = render(
      <ul>
        <IssueListRow issue={issue({})} queryKey={['issues']} density="comfortable" />
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
