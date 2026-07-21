'use client';

import {
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleDotDashed,
  CirclePause,
  CircleX,
  type LucideIcon,
  Minus,
  SignalHigh,
  SignalLow,
  SignalMedium,
  UserRound,
} from 'lucide-react';

import type {
  IssueMemberSummaryResponseDto,
  IssueSummaryResponseDto,
  TeamWorkSummaryResponseDto,
} from '@rivet/api-client';

import { UserAvatar } from '@/components/user-avatar';
import {
  WORKFLOW_STATE_PRESENTATION,
  type WorkflowStateCategory,
  WorkflowStateIcon,
  workflowStateProgress,
} from '@/components/workflow-state-icon';
import { cn } from '@/lib/utils';

import { IssueInlineSelect, type IssueInlineSelectOption } from './issue-inline-select';

type Presentation = { icon: LucideIcon; iconClassName: string; label: string };

export const ISSUE_STATUS_PRESENTATION: Record<IssueSummaryResponseDto['status'], Presentation> = {
  UNSORTED: { icon: CircleDashed, iconClassName: 'text-muted-foreground', label: '접수됨' },
  TODO: { icon: Circle, iconClassName: 'text-foreground', label: '할 일' },
  IN_PROGRESS: { icon: CircleDotDashed, iconClassName: 'text-info', label: '진행 중' },
  REVIEW: { icon: CircleDot, iconClassName: 'text-info', label: '완료 확인' },
  DONE: { icon: CircleCheck, iconClassName: 'text-success', label: '완료' },
  PAUSED: { icon: CirclePause, iconClassName: 'text-warning', label: '일시 중지' },
  CANCELED: { icon: CircleX, iconClassName: 'text-muted-foreground', label: '취소' },
};

const ISSUE_STATUS_WORKFLOW_ICON: Partial<
  Record<IssueSummaryResponseDto['status'], { category: WorkflowStateCategory; progress?: number }>
> = {
  UNSORTED: { category: 'BACKLOG' },
  TODO: { category: 'UNSTARTED' },
  IN_PROGRESS: { category: 'STARTED', progress: 1 / 3 },
  REVIEW: { category: 'STARTED', progress: 2 / 3 },
  DONE: { category: 'COMPLETED' },
  CANCELED: { category: 'CANCELED' },
};

export const TEAM_WORK_STATUS_PRESENTATION = WORKFLOW_STATE_PRESENTATION;

export const PRIORITY_PRESENTATION: Record<IssueSummaryResponseDto['priority'], Presentation> = {
  NONE: { icon: Minus, iconClassName: 'text-muted-foreground', label: '없음' },
  LOW: { icon: SignalLow, iconClassName: 'text-muted-foreground', label: '낮음' },
  MEDIUM: { icon: SignalMedium, iconClassName: 'text-muted-foreground', label: '보통' },
  HIGH: { icon: SignalHigh, iconClassName: 'text-warning', label: '높음' },
  URGENT: { icon: CircleAlert, iconClassName: 'text-destructive', label: '긴급' },
};

function AttributeDisplay({
  presentation,
  className,
}: {
  presentation: Presentation;
  className?: string;
}) {
  const Icon = presentation.icon;
  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center gap-1.5 text-sm whitespace-nowrap',
        className,
      )}
    >
      <Icon aria-hidden="true" className={cn('size-4 shrink-0', presentation.iconClassName)} />
      <span className="truncate">{presentation.label}</span>
    </span>
  );
}

export function IssueStatusDisplay({
  status,
  className,
}: {
  status: IssueSummaryResponseDto['status'];
  className?: string;
}) {
  const presentation = ISSUE_STATUS_PRESENTATION[status];
  const workflowIcon = ISSUE_STATUS_WORKFLOW_ICON[status];

  if (workflowIcon) {
    return (
      <span
        className={cn(
          'inline-flex min-w-0 items-center gap-1.5 text-sm whitespace-nowrap',
          className,
        )}
      >
        <WorkflowStateIcon
          category={workflowIcon.category}
          {...(workflowIcon.progress !== undefined ? { progress: workflowIcon.progress } : {})}
        />
        <span className="truncate">{presentation.label}</span>
      </span>
    );
  }

  return <AttributeDisplay presentation={presentation} {...(className ? { className } : {})} />;
}

export function TeamWorkStatusDisplay({
  category,
  className,
  color,
  name,
  progress,
}: {
  category: TeamWorkSummaryResponseDto['stateCategory'];
  className?: string;
  color?: string | null;
  name: string;
  progress?: number | null;
}) {
  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center gap-1.5 text-sm whitespace-nowrap',
        className,
      )}
    >
      <WorkflowStateIcon
        category={category}
        {...(color !== undefined ? { color } : {})}
        {...(progress !== undefined ? { progress } : {})}
      />
      <span className="truncate">{name}</span>
    </span>
  );
}

export function PriorityDisplay({
  priority,
  className,
}: {
  priority: IssueSummaryResponseDto['priority'];
  className?: string;
}) {
  return (
    <AttributeDisplay
      presentation={PRIORITY_PRESENTATION[priority]}
      {...(className ? { className } : {})}
    />
  );
}

export function PriorityTrigger({
  busy = false,
  disabled = false,
  error,
  identifier,
  onValueChange,
  priority,
  className,
}: {
  busy?: boolean;
  className?: string;
  disabled?: boolean;
  error?: Parameters<typeof IssueInlineSelect>[0]['error'];
  identifier: string;
  onValueChange: (value: IssueSummaryResponseDto['priority']) => void;
  priority: IssueSummaryResponseDto['priority'];
}) {
  return (
    <IssueInlineSelect
      appearance="compact"
      ariaLabel={`${identifier} 우선순위: ${PRIORITY_PRESENTATION[priority].label}`}
      busy={busy}
      disabled={disabled}
      error={error}
      labelClassName="text-sm"
      onValueChange={(value) => onValueChange(value as IssueSummaryResponseDto['priority'])}
      options={Object.entries(PRIORITY_PRESENTATION).map(([value, option]) => ({
        ...option,
        value,
      }))}
      triggerClassName={cn('w-24', className)}
      value={priority}
    />
  );
}

export function StatusTrigger({
  busy = false,
  disabled = false,
  identifier,
  onValueChange,
  states,
  value,
  className,
}: {
  busy?: boolean;
  className?: string;
  disabled?: boolean;
  identifier: string;
  onValueChange: (value: string) => void;
  states: Array<{
    category: TeamWorkSummaryResponseDto['stateCategory'];
    color: string | null;
    id: string;
    name: string;
    position: number;
  }>;
  value: string;
}) {
  const current = states.find((state) => state.id === value);
  const currentLabel = current ? current.name : '상태 없음';
  const options: IssueInlineSelectOption[] = states.map((state) => ({
    iconElement: (
      <WorkflowStateIcon
        category={state.category}
        color={state.color}
        progress={workflowStateProgress(states, state)}
      />
    ),
    label: state.name,
    value: state.id,
  }));
  return (
    <IssueInlineSelect
      appearance="comfortable"
      ariaLabel={`팀 작업 상태 변경 (${identifier}): 현재 ${currentLabel}`}
      busy={busy}
      disabled={disabled}
      onValueChange={onValueChange}
      options={options}
      triggerClassName={cn('w-28', className)}
      value={value}
    />
  );
}

export function CompactAssigneeTrigger({
  assignee,
  busy = false,
  disabled = false,
  identifier,
  members,
  onValueChange,
  className,
}: {
  assignee: IssueMemberSummaryResponseDto | null;
  busy?: boolean;
  className?: string;
  disabled?: boolean;
  identifier: string;
  members: IssueMemberSummaryResponseDto[];
  onValueChange: (value: string) => void;
}) {
  const options: IssueInlineSelectOption[] = [
    { icon: UserRound, iconClassName: 'text-muted-foreground', label: '담당자 없음', value: '' },
    ...members.map((member) => ({
      iconElement: (
        <UserAvatar
          avatarFileId={member.user.avatarFileId}
          className="data-[size=sm]:size-4 [&_[data-slot=avatar-fallback]]:text-[9px]"
          displayName={member.user.displayName}
          size="sm"
        />
      ),
      label: member.user.displayName,
      value: member.id,
    })),
  ];
  return (
    <IssueInlineSelect
      appearance="comfortable"
      ariaLabel={`팀 작업 담당자 (${identifier}): ${assignee?.user.displayName ?? '담당자 없음'}`}
      busy={busy}
      disabled={disabled}
      onValueChange={onValueChange}
      options={options}
      triggerClassName={cn('w-32', className)}
      value={assignee?.id ?? ''}
    />
  );
}
