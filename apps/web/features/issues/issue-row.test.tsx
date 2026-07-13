import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnchorHTMLAttributes } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LabelResponseDto, MemberSummaryResponseDto } from '@rivet/api-client';

import { useIssueInlineMutation } from './issue-mutations';
import { IssueRow, type IssueRowLabels } from './issue-row';
import type { TeamTaskIssue } from './issue-types';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props} />
  ),
}));

vi.mock('./issue-mutations', () => ({
  useIssueInlineMutation: vi.fn(),
}));

const todo = {
  category: 'UNSTARTED' as const,
  id: 'state-todo',
  isDefault: true,
  name: '할 일',
  position: 0,
  version: 1,
};
const doing = {
  category: 'STARTED' as const,
  id: 'state-doing',
  isDefault: false,
  name: '진행 중',
  position: 2,
  version: 1,
};
const assignee = {
  deactivatedAt: null,
  id: 'member-assignee',
  joinedAt: '2026-07-01T00:00:00.000Z',
  role: 'MEMBER' as const,
  status: 'ACTIVE' as const,
  user: { avatarFileId: null, displayName: '김담당', id: 'user-assignee' },
} satisfies MemberSummaryResponseDto;
const issue = {
  assignee,
  blocked: false,
  createdAt: '2026-07-01T00:00:00.000Z',
  createdBy: assignee,
  id: 'issue-web-42',
  identifier: 'WEB-42',
  labels: [
    { archived: false, color: '#72A7F2', id: 'label-1', name: '퍼렁퍼렁' },
    { archived: false, color: '#9A8CF2', id: 'label-2', name: '라벤더' },
    { archived: false, color: '#45C46B', id: 'label-3', name: '완료 조건' },
  ],
  parentIssue: { id: 'feature-1', identifier: 'ISSUE-7', title: '결제 개선' },
  priority: 'HIGH',
  progress: null,
  project: { archived: false, id: 'project-1', name: '결제 프로젝트', status: 'IN_PROGRESS' },
  projectRole: 'WEB_FRONTEND',
  status: { category: 'STARTED' as const, featureStatus: null, workflowState: doing },
  team: { archived: false, id: 'team-web', key: 'WEB', name: '웹' },
  title: '결제 화면 구현',
  type: 'TEAM_TASK' as const,
  updatedAt: '2026-07-02T00:00:00.000Z',
  version: 1,
  workflowSummary: null,
} satisfies TeamTaskIssue;
const labels: IssueRowLabels = {
  assignee: '담당자',
  conflictDescription: '충돌',
  errorDescription: '오류',
  labels: '라벨',
  noLabels: '라벨 없음',
  priorities: { HIGH: '높음', LOW: '낮음', MEDIUM: '보통', NONE: '없음', URGENT: '긴급' },
  priority: '우선순위',
  projectRoles: { APP_FRONTEND: '앱', BACKEND: '백엔드', WEB_FRONTEND: '웹' },
  reapply: '다시 적용',
  retry: '다시 시도',
  state: '상태',
  unassigned: '담당자 없음',
};
const availableLabel = {
  archived: false,
  color: '#C47A45',
  id: 'label-4',
  name: '추가 라벨',
  version: 1,
} satisfies LabelResponseDto;

describe('IssueRow', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('목록 맥락과 공통 Compact 속성 표현을 연결한다', () => {
    vi.mocked(useIssueInlineMutation).mockReturnValue({
      conflict: null,
      isError: false,
      isPending: false,
      mutate: vi.fn(),
    } as never);

    render(
      <ul>
        <IssueRow
          activeLabels={[availableLabel]}
          currentMembershipId={assignee.id}
          currentQueryKey={['issues']}
          issue={issue}
          labels={labels}
          members={[assignee]}
          mode="my"
          workflowStates={[doing, todo]}
        />
      </ul>,
    );

    const stateTriggers = screen.getAllByRole('combobox', { name: 'WEB-42 상태: 진행 중' });
    const assigneeTriggers = screen.getAllByRole('combobox', {
      name: 'WEB-42 담당자: 김담당',
    });
    const priorityTriggers = screen.getAllByRole('combobox', {
      name: 'WEB-42 우선순위: 높음',
    });
    for (const trigger of [...stateTriggers, ...assigneeTriggers, ...priorityTriggers]) {
      expect(trigger).toHaveAttribute('data-variant', 'inline');
      expect(trigger.closest('a')).toBeNull();
    }
    expect(stateTriggers[0]?.querySelector('[data-slot="inline-select-icon"]')).toHaveClass(
      'lucide-circle-dot-dashed',
    );
    expect(priorityTriggers[0]?.querySelector('[data-slot="inline-select-icon"]')).toHaveClass(
      'lucide-signal-high',
    );
    expect(screen.getByRole('link', { name: '결제 화면 구현' })).toHaveAttribute(
      'href',
      '/issues/WEB-42',
    );
    expect(screen.getAllByText('결제 프로젝트').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ISSUE-7').length).toBeGreaterThan(0);
    expect(screen.getAllByText('퍼렁퍼렁').length).toBeGreaterThan(0);
    expect(screen.getAllByText('라벤더').length).toBeGreaterThan(0);
    expect(screen.getAllByText('+1').length).toBeGreaterThan(0);
  });

  it('메뉴는 워크플로 위치 순서를 유지하고 내부 선택만 mutation으로 전달한다', async () => {
    const user = userEvent.setup();
    const mutate = vi.fn();
    vi.mocked(useIssueInlineMutation).mockReturnValue({
      conflict: null,
      isError: false,
      isPending: false,
      mutate,
    } as never);

    render(
      <ul>
        <IssueRow
          activeLabels={[]}
          currentMembershipId={assignee.id}
          currentQueryKey={['issues']}
          issue={issue}
          labels={labels}
          members={[assignee]}
          mode="team"
          workflowStates={[doing, todo]}
        />
      </ul>,
    );

    await user.click(screen.getAllByRole('combobox', { name: 'WEB-42 상태: 진행 중' })[0]!);
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['할 일', '진행 중']);
    await user.click(screen.getByRole('option', { name: '할 일' }));
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith({
        change: { kind: 'workflowState', value: todo },
        issue,
      }),
    );
  });

  it('라벨이 없는 행은 모바일 카드에 추가 편집기를 상시 노출하지 않는다', () => {
    vi.mocked(useIssueInlineMutation).mockReturnValue({
      conflict: null,
      isError: false,
      isPending: false,
      mutate: vi.fn(),
    } as never);

    render(
      <ul>
        <IssueRow
          activeLabels={[availableLabel]}
          currentMembershipId={assignee.id}
          currentQueryKey={['issues']}
          issue={{ ...issue, labels: [] }}
          labels={labels}
          members={[assignee]}
          mode="my"
          workflowStates={[doing, todo]}
        />
      </ul>,
    );

    const editors = screen.getAllByRole('button', { name: 'WEB-42 라벨: 라벨 없음' });
    expect(editors).toHaveLength(2);
    for (const editor of editors) {
      expect(editor).toHaveClass('pointer-events-none', 'opacity-0');
    }
  });

  it('우선순위 저장 중에는 해당 셀만 busy로 두고 상태 편집은 유지한다', () => {
    vi.mocked(useIssueInlineMutation).mockReturnValue({
      conflict: null,
      isError: false,
      isPending: true,
      isPendingFor: (_issueId: string, kind?: string) => kind === 'priority',
      mutate: vi.fn(),
      variables: { change: { kind: 'priority', value: 'HIGH' }, issue },
    } as never);

    const { container } = render(
      <ul>
        <IssueRow
          activeLabels={[]}
          currentMembershipId={assignee.id}
          currentQueryKey={['issues']}
          issue={issue}
          labels={labels}
          members={[assignee]}
          mode="team"
          workflowStates={[doing, todo]}
        />
      </ul>,
    );

    for (const trigger of screen.getAllByRole('combobox', { name: 'WEB-42 우선순위: 높음' })) {
      expect(trigger).toHaveAttribute('aria-busy', 'true');
      expect(trigger).toHaveAttribute('aria-disabled', 'true');
    }
    for (const trigger of screen.getAllByRole('combobox', { name: 'WEB-42 상태: 진행 중' })) {
      expect(trigger).not.toHaveAttribute('aria-busy');
      expect(trigger).not.toHaveAttribute('aria-disabled');
    }
    expect(container.querySelector('li')).not.toHaveAttribute('aria-busy');
  });

  it('우선순위 저장 실패는 행 높이를 늘리지 않고 해당 선택기 가까이에 재시도를 둔다', async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    vi.mocked(useIssueInlineMutation).mockReturnValue({
      conflict: null,
      isError: true,
      isPending: false,
      mutate: vi.fn(),
      retry,
      variables: { change: { kind: 'priority', value: 'HIGH' }, issue },
    } as never);

    const { container } = render(
      <ul>
        <IssueRow
          activeLabels={[]}
          currentMembershipId={assignee.id}
          currentQueryKey={['issues']}
          issue={issue}
          labels={labels}
          members={[assignee]}
          mode="team"
          workflowStates={[doing, todo]}
        />
      </ul>,
    );

    expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect(container.querySelector('li > [role="alert"]')).toBeNull();
    await user.click(screen.getAllByRole('button', { name: '다시 시도' })[0]!);
    expect(retry).toHaveBeenCalledOnce();
  });
});
