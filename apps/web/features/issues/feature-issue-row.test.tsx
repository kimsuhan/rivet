import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { AnchorHTMLAttributes, ComponentType, ReactNode, SVGProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LabelResponseDto } from '@rivet/api-client';

import messages from '@/messages/ko.json';

import { type FeatureIssueListItem, FeatureIssueRow } from './feature-issue-row';
import { useIssueInlineMutation } from './issue-mutations';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => {
    return (
      <a
        href={href}
        {...props}
        onClick={(event) => {
          event.preventDefault();
        }}
      />
    );
  },
}));

vi.mock('./issue-filter-menu', () => ({
  IssueFilterMenu: ({ ariaLabel }: { ariaLabel: string }) => (
    <button type="button" aria-label={ariaLabel} />
  ),
}));

vi.mock('./issue-inline-select', () => ({
  IssueInlineSelect: ({
    appearance,
    ariaLabel,
    labelClassName,
    options,
    triggerClassName,
    value,
  }: {
    appearance?: string;
    ariaLabel: string;
    labelClassName?: string;
    options: Array<{
      icon?: ComponentType<SVGProps<SVGSVGElement>>;
      label: string;
      value: string;
    }>;
    triggerClassName?: string;
    value: string;
  }) => {
    const current = options.find((option) => option.value === value);
    const CurrentIcon = current?.icon;

    return (
      <button
        type="button"
        aria-label={ariaLabel}
        className={triggerClassName}
        data-appearance={appearance}
      >
        {CurrentIcon ? <CurrentIcon data-testid={`inline-current-${value}`} /> : null}
        <span className={labelClassName}>{current?.label}</span>
        <span hidden>
          {options.map((option) => {
            const Icon = option.icon;
            return Icon ? (
              <Icon
                key={option.value}
                data-testid={`inline-option-${option.value}`}
                data-option-label={option.label}
              />
            ) : null;
          })}
        </span>
      </button>
    );
  },
}));

vi.mock('./issue-mutations', () => ({
  useIssueInlineMutation: vi.fn(),
}));

const apiTeam = { archived: false, id: 'api-team-id', key: 'API', name: 'API 팀' };
const availableLabel: LabelResponseDto = {
  archived: false,
  color: '#6B7280',
  id: 'available-label-id',
  name: '사용 가능 라벨',
  version: 1,
};
const issue: FeatureIssueListItem = {
  assignee: null,
  blocked: false,
  createdAt: '2026-07-01T00:00:00.000Z',
  createdBy: {
    id: 'creator-membership-id',
    role: 'MEMBER',
    status: 'ACTIVE',
    user: { avatarFileId: null, displayName: '작성자', id: 'creator-user-id' },
  },
  id: 'feature-id',
  identifier: 'ISSUE-12',
  labels: [],
  parentIssue: null,
  priority: 'HIGH',
  progress: null,
  project: {
    archived: false,
    id: 'project-id',
    name: '결제 프로젝트',
    status: 'IN_PROGRESS',
  },
  projectRole: null,
  status: { category: 'STARTED', featureStatus: 'IN_PROGRESS', workflowState: null },
  team: null,
  title: '결제 수단 추가',
  type: 'FEATURE',
  updatedAt: '2026-07-02T00:00:00.000Z',
  version: 1,
  workflowSummary: {
    activeRoles: ['BACKEND'],
    activeRoleTeams: [{ projectRole: 'BACKEND', team: apiTeam, unassignedCount: 1 }],
    allTargetTasksCompleted: false,
    canceledCount: 0,
    completedCount: 1,
    currentUserAssignedTeamTasks: [],
    currentUserTeamRoles: [],
    teamTaskCount: 2,
    unassignedCount: 1,
    waitingOn: [],
  },
};

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="ko" messages={messages} timeZone="Asia/Seoul">
      {children}
    </NextIntlClientProvider>
  );
}

function renderRow(
  item: FeatureIssueListItem,
  onAction = vi.fn(),
  activeLabels: LabelResponseDto[] = [],
) {
  render(
    <ul>
      <FeatureIssueRow
        activeLabels={activeLabels}
        currentQueryKey={['/api/v1/issues']}
        issue={item}
        onAction={onAction}
      />
    </ul>,
    { wrapper: Wrapper },
  );
  return onAction;
}

describe('FeatureIssueRow', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('현재 역할·팀·담당 필요·진행률과 하나의 주요 행동을 표시한다', async () => {
    const user = userEvent.setup();
    vi.mocked(useIssueInlineMutation).mockReturnValue({
      conflict: null,
      isError: false,
      isPending: false,
      mutate: vi.fn(),
    } as never);
    const onAction = renderRow(issue);

    expect(screen.getByText('백엔드 담당 필요')).toBeInTheDocument();
    const unassigned = screen.getByText('담당 필요 1개', { selector: 'span' });
    const activeTeam = screen.getByText('백엔드 · API', { selector: 'span' });
    expect(unassigned).toBeInTheDocument();
    expect(screen.getByText('1/2 · 50%')).toBeInTheDocument();
    expect(activeTeam).toBeInTheDocument();
    expect(
      unassigned.compareDocumentPosition(activeTeam) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(activeTeam.closest('p')?.getAttribute('title')).toContain('담당 필요 1개');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    const actionButton = screen.getByRole('button', { name: '담당자 지정' });
    await user.click(actionButton);
    expect(onAction).toHaveBeenCalledWith('ASSIGN_TEAM_TASKS', issue);
  });

  it('과거 작업만 남아 활성 역할이 없으면 진행 중으로 표시하지 않는다', () => {
    vi.mocked(useIssueInlineMutation).mockReturnValue({
      conflict: null,
      isError: false,
      isPending: false,
      mutate: vi.fn(),
    } as never);
    renderRow({
      ...issue,
      workflowSummary: {
        ...issue.workflowSummary,
        activeRoles: [],
        activeRoleTeams: [],
        unassignedCount: 0,
      },
    });

    expect(screen.getByText('진행할 팀 작업 없음')).toBeInTheDocument();
    expect(screen.queryByText('팀 작업 진행 중')).not.toBeInTheDocument();
  });

  it('대기 중인 선행 작업이 여러 건이면 첫 작업과 추가 건수를 함께 요약한다', () => {
    vi.mocked(useIssueInlineMutation).mockReturnValue({
      conflict: null,
      isError: false,
      isPending: false,
      mutate: vi.fn(),
    } as never);
    renderRow({
      ...issue,
      workflowSummary: {
        ...issue.workflowSummary,
        waitingOn: [
          { identifier: 'API-12', issueId: 'blocking-issue-1', title: 'API 계약 확정' },
          { identifier: 'DESIGN-4', issueId: 'blocking-issue-2', title: '디자인 검수' },
        ],
      },
    });

    expect(screen.getByText('API-12 외 1개 완료 대기')).toBeInTheDocument();
  });

  it('프로젝트와 라벨을 이슈 맥락으로 묶고 라벨은 두 개 뒤부터 요약한다', () => {
    vi.mocked(useIssueInlineMutation).mockReturnValue({
      conflict: null,
      isError: false,
      isPending: false,
      mutate: vi.fn(),
    } as never);
    renderRow({
      ...issue,
      labels: [
        { archived: false, color: '#6B7280', id: 'label-1', name: '결제' },
        { archived: false, color: '#6B7280', id: 'label-2', name: '고객 요청' },
        { archived: false, color: '#6B7280', id: 'label-3', name: '모바일' },
      ],
    });

    expect(screen.getByText('결제 프로젝트')).toBeInTheDocument();
    expect(screen.getByText('결제')).toBeInTheDocument();
    expect(screen.getByText('고객 요청')).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.queryByText('모바일')).not.toBeInTheDocument();
    expect(screen.queryByText('작성자')).not.toBeInTheDocument();
  });

  it('라벨과 후보가 모두 없으면 빈 라벨 선택기를 렌더링하지 않는다', () => {
    vi.mocked(useIssueInlineMutation).mockReturnValue({
      conflict: null,
      isError: false,
      isPending: false,
      mutate: vi.fn(),
    } as never);
    renderRow(issue);

    expect(screen.queryByText(/^라벨$/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^ISSUE-12 라벨:/ })).not.toBeInTheDocument();
  });

  it('행 상세 링크를 제목으로 제공하고 내부 편집과 행동을 독립된 조작으로 유지한다', async () => {
    const user = userEvent.setup();
    vi.mocked(useIssueInlineMutation).mockReturnValue({
      conflict: null,
      isError: false,
      isPending: false,
      mutate: vi.fn(),
    } as never);
    const onAction = renderRow(issue, vi.fn(), [availableLabel]);
    const detailLink = screen.getByRole('link', { name: '결제 수단 추가' });

    expect(detailLink).toHaveAttribute('href', '/issues/ISSUE-12');
    await user.tab();
    expect(detailLink).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: /^ISSUE-12 라벨:/ })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'ISSUE-12 상태: 진행 중' }));
    await user.click(screen.getByRole('button', { name: 'ISSUE-12 우선순위: 높음' }));
    await user.click(screen.getByRole('button', { name: /^ISSUE-12 라벨:/ }));
    expect(onAction).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '담당자 지정' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith('ASSIGN_TEAM_TASKS', issue);
  });

  it('우리 팀에서 시작할 수 있는 역할이 하나면 역할을 행동 문구에 표시한다', () => {
    vi.mocked(useIssueInlineMutation).mockReturnValue({
      conflict: null,
      isError: false,
      isPending: false,
      mutate: vi.fn(),
    } as never);
    renderRow({
      ...issue,
      workflowSummary: {
        ...issue.workflowSummary,
        activeRoles: [],
        activeRoleTeams: [],
        completedCount: 0,
        currentUserTeamRoles: ['WEB_FRONTEND'],
        unassignedCount: 0,
      },
    });

    expect(screen.getByRole('button', { name: '웹 프론트 작업 시작' })).toBeInTheDocument();
    expect(screen.getByText('작업 시작')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '우리 팀에서 시작' })).not.toBeInTheDocument();
  });

  it('시작 가능한 역할이 여러 개면 역할 선택을 위해 일반 문구를 유지한다', () => {
    vi.mocked(useIssueInlineMutation).mockReturnValue({
      conflict: null,
      isError: false,
      isPending: false,
      mutate: vi.fn(),
    } as never);
    renderRow({
      ...issue,
      workflowSummary: {
        ...issue.workflowSummary,
        activeRoles: [],
        activeRoleTeams: [],
        completedCount: 0,
        currentUserTeamRoles: ['BACKEND', 'WEB_FRONTEND'],
        unassignedCount: 0,
      },
    });

    expect(screen.getByRole('button', { name: '우리 팀에서 시작' })).toBeInTheDocument();
  });

  it('단순 상세 보기는 별도 버튼 대신 행 링크로 제공한다', () => {
    vi.mocked(useIssueInlineMutation).mockReturnValue({
      conflict: null,
      isError: false,
      isPending: false,
      mutate: vi.fn(),
    } as never);
    renderRow({
      ...issue,
      workflowSummary: {
        ...issue.workflowSummary,
        activeRoleTeams: [{ projectRole: 'BACKEND', team: apiTeam, unassignedCount: 0 }],
        currentUserTeamRoles: [],
        unassignedCount: 0,
      },
    });

    expect(screen.getByRole('link', { name: '결제 수단 추가' })).toBeInTheDocument();
    expect(screen.queryByText('상세 보기')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '상세 보기' })).not.toBeInTheDocument();
  });

  it('모바일 카드의 핵심 정보를 제목부터 다음 행동까지 읽기 순서대로 배치한다', () => {
    vi.mocked(useIssueInlineMutation).mockReturnValue({
      conflict: null,
      isError: false,
      isPending: false,
      mutate: vi.fn(),
    } as never);
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1_000).toISOString();
    renderRow({ ...issue, updatedAt: fourHoursAgo });

    const nodes = [
      screen.getByText('결제 수단 추가'),
      screen.getByText('결제 프로젝트'),
      screen.getByText('진행 중'),
      screen.getByText('백엔드 담당 필요'),
      screen.getByText('1/2 · 50%'),
      screen.getByText('4시간 전'),
      screen.getByRole('button', { name: '담당자 지정' }),
    ];

    for (const [index, node] of nodes.entries()) {
      const next = nodes[index + 1];
      if (next) {
        expect(node.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
    }
  });

  it('상태와 우선순위를 같은 compact 수평 그룹에 두고 지정 아이콘을 일관되게 전달한다', () => {
    vi.mocked(useIssueInlineMutation).mockReturnValue({
      conflict: null,
      isError: false,
      isPending: false,
      mutate: vi.fn(),
    } as never);
    renderRow(issue);

    expect(screen.getByTestId('feature-issue-status-priority')).toHaveClass(
      'grid',
      'grid-cols-[6.75rem_5rem]',
      'items-center',
    );
    expect(screen.getByRole('button', { name: 'ISSUE-12 상태: 진행 중' })).toHaveAttribute(
      'data-appearance',
      'compact',
    );
    expect(screen.getByRole('button', { name: 'ISSUE-12 우선순위: 높음' })).toHaveAttribute(
      'data-appearance',
      'compact',
    );

    const mappings = {
      CANCELED: { iconClass: 'lucide-circle-x', label: '취소' },
      DONE: { iconClass: 'lucide-circle-check', label: '완료' },
      HIGH: { iconClass: 'lucide-signal-high', label: '높음' },
      IN_PROGRESS: { iconClass: 'lucide-circle-dot-dashed', label: '진행 중' },
      LOW: { iconClass: 'lucide-signal-low', label: '낮음' },
      MEDIUM: { iconClass: 'lucide-signal-medium', label: '보통' },
      NONE: { iconClass: 'lucide-minus', label: '없음' },
      PAUSED: { iconClass: 'lucide-circle-pause', label: '일시 중지' },
      REVIEW: { iconClass: 'lucide-circle-dot', label: '검토' },
      TODO: { iconClass: 'lucide-circle', label: '할 일' },
      UNSORTED: { iconClass: 'lucide-circle-dashed', label: '미분류' },
      URGENT: { iconClass: 'lucide-circle-alert', label: '긴급' },
    } as const;

    for (const [value, { iconClass, label }] of Object.entries(mappings)) {
      expect(screen.getByTestId(`inline-option-${value}`)).toHaveClass(iconClass);
      expect(screen.getByTestId(`inline-option-${value}`)).toHaveAttribute(
        'data-option-label',
        label,
      );
    }
  });

  it('주요 행동은 32px 시각 표면과 40px 이상 조작 영역을 분리하고 더보기 이름을 구체화한다', () => {
    vi.mocked(useIssueInlineMutation).mockReturnValue({
      conflict: null,
      isError: false,
      isPending: false,
      mutate: vi.fn(),
    } as never);
    renderRow({
      ...issue,
      workflowSummary: {
        ...issue.workflowSummary,
        currentUserTeamRoles: ['BACKEND'],
      },
    });

    const action = screen.getByRole('button', { name: '담당자 지정' });
    expect(action).toHaveClass('min-h-11', 'lg:min-h-10', 'bg-transparent');
    expect(action.querySelector('[data-slot="issue-action-visual"]')).toHaveClass('h-8');
    expect(screen.getByRole('combobox', { name: 'ISSUE-12 이슈 작업 더보기' })).toHaveClass(
      'border-transparent',
      'bg-transparent',
    );
  });

  it('병렬 역할이 세 개면 현재 작업을 첫 역할과 추가 개수로 두 줄 안에 요약한다', () => {
    vi.mocked(useIssueInlineMutation).mockReturnValue({
      conflict: null,
      isError: false,
      isPending: false,
      mutate: vi.fn(),
    } as never);
    renderRow({
      ...issue,
      workflowSummary: {
        ...issue.workflowSummary,
        activeRoleTeams: [
          { projectRole: 'BACKEND', team: apiTeam, unassignedCount: 0 },
          {
            projectRole: 'WEB_FRONTEND',
            team: { archived: false, id: 'web-team-id', key: 'WEB', name: '웹 팀' },
            unassignedCount: 0,
          },
          {
            projectRole: 'APP_FRONTEND',
            team: { archived: false, id: 'app-team-id', key: 'APP', name: '앱 팀' },
            unassignedCount: 0,
          },
        ],
        activeRoles: ['BACKEND', 'WEB_FRONTEND', 'APP_FRONTEND'],
        unassignedCount: 0,
      },
    });

    expect(screen.getByText('백엔드 외 2개 병렬 진행')).toBeInTheDocument();
    expect(screen.getByText('백엔드 · API 외 2개')).toBeInTheDocument();
  });
});
