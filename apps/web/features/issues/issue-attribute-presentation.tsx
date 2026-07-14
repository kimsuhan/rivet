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

export const TEAM_WORK_STATUS_PRESENTATION: Record<TeamWorkSummaryResponseDto['stateCategory'], Presentation> = {
  BACKLOG: { icon: CircleDashed, iconClassName: 'text-muted-foreground', label: '백로그' },
  UNSTARTED: { icon: Circle, iconClassName: 'text-foreground', label: '시작 전' },
  STARTED: { icon: CircleDotDashed, iconClassName: 'text-info', label: '진행 중' },
  COMPLETED: { icon: CircleCheck, iconClassName: 'text-success', label: '완료' },
  CANCELED: { icon: CircleX, iconClassName: 'text-muted-foreground', label: '취소' },
};

export const PRIORITY_PRESENTATION: Record<IssueSummaryResponseDto['priority'], Presentation> = {
  NONE: { icon: Minus, iconClassName: 'text-muted-foreground', label: '없음' },
  LOW: { icon: SignalLow, iconClassName: 'text-muted-foreground', label: '낮음' },
  MEDIUM: { icon: SignalMedium, iconClassName: 'text-muted-foreground', label: '보통' },
  HIGH: { icon: SignalHigh, iconClassName: 'text-warning', label: '높음' },
  URGENT: { icon: CircleAlert, iconClassName: 'text-destructive', label: '긴급' },
};

function AttributeDisplay({ presentation, className }: { presentation: Presentation; className?: string }) {
  const Icon = presentation.icon;
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5 text-sm whitespace-nowrap', className)}>
      <Icon aria-hidden="true" className={cn('size-4 shrink-0', presentation.iconClassName)} />
      <span className="truncate">{presentation.label}</span>
    </span>
  );
}

export function IssueStatusDisplay({ status, className }: { status: IssueSummaryResponseDto['status']; className?: string }) {
  return <AttributeDisplay presentation={ISSUE_STATUS_PRESENTATION[status]} {...(className ? { className } : {})} />;
}

export function TeamWorkStatusDisplay({ category, className }: { category: TeamWorkSummaryResponseDto['stateCategory']; className?: string }) {
  return <AttributeDisplay presentation={TEAM_WORK_STATUS_PRESENTATION[category]} {...(className ? { className } : {})} />;
}

export function PriorityDisplay({ priority, className }: { priority: IssueSummaryResponseDto['priority']; className?: string }) {
  return <AttributeDisplay presentation={PRIORITY_PRESENTATION[priority]} {...(className ? { className } : {})} />;
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
      options={Object.entries(PRIORITY_PRESENTATION).map(([value, option]) => ({ ...option, value }))}
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
  states: Array<{ category: TeamWorkSummaryResponseDto['stateCategory']; id: string }>;
  value: string;
}) {
  const current = states.find((state) => state.id === value);
  const currentLabel = current ? TEAM_WORK_STATUS_PRESENTATION[current.category].label : '상태 없음';
  const options: IssueInlineSelectOption[] = states.map((state) => ({
    ...TEAM_WORK_STATUS_PRESENTATION[state.category],
    value: state.id,
  }));
  return <IssueInlineSelect appearance="comfortable" ariaLabel={`팀 작업 상태 (${identifier}): ${currentLabel}`} busy={busy} disabled={disabled} onValueChange={onValueChange} options={options} triggerClassName={cn('w-28', className)} value={value} />;
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
    ...members.map((member) => ({ icon: UserRound, iconClassName: 'text-muted-foreground', label: member.user.displayName, value: member.id })),
  ];
  return <IssueInlineSelect appearance="comfortable" ariaLabel={`팀 작업 담당자 (${identifier}): ${assignee?.user.displayName ?? '담당자 없음'}`} busy={busy} disabled={disabled} onValueChange={onValueChange} options={options} triggerClassName={cn('w-32', className)} value={assignee?.id ?? ''} />;
}
