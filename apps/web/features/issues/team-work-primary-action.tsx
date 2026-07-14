'use client';

import { Check, Play } from 'lucide-react';

import type { TeamWorkSummaryResponseDto, WorkflowStateResponseDto } from '@rivet/api-client';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

function firstStartedState(states: WorkflowStateResponseDto[]): WorkflowStateResponseDto | null {
  return (
    [...states]
      .filter((state) => state.category === 'STARTED')
      .sort((a, b) => a.position - b.position)[0] ?? null
  );
}

export function TeamWorkPrimaryAction({
  busy = false,
  className,
  compact = false,
  disabled = false,
  onOpenCompletion,
  onStart,
  states,
  work,
}: {
  busy?: boolean;
  className?: string;
  compact?: boolean;
  disabled?: boolean;
  onOpenCompletion: () => void;
  onStart: (stateId: string) => void;
  states: WorkflowStateResponseDto[];
  work: TeamWorkSummaryResponseDto;
}) {
  const size = compact ? 'sm' : 'default';
  if (work.stateCategory === 'BACKLOG' && work.workflowState.isDefault && !work.assignee) {
    return (
      <Button
        aria-label={`${work.identifier}: 담당자를 선택해 주세요`}
        className={cn('justify-start', className)}
        disabled
        size={size}
        variant="outline"
      >
        {compact ? '담당자 필요' : '담당자를 선택해 주세요'}
      </Button>
    );
  }
  if (work.stateCategory === 'UNSTARTED') {
    const target = firstStartedState(states);
    return (
      <Button
        aria-busy={busy}
        aria-label={`${work.identifier}: 작업 시작`}
        className={className}
        disabled={busy || disabled || !target}
        onClick={() => target && onStart(target.id)}
        size={size}
      >
        {busy ? <Spinner /> : <Play className="size-4" />}
        작업 시작
      </Button>
    );
  }
  if (work.stateCategory === 'STARTED') {
    return (
      <Button
        aria-busy={busy}
        aria-label={`${work.identifier}: 완료`}
        className={className}
        disabled={busy || disabled}
        onClick={onOpenCompletion}
        size={size}
      >
        {busy ? <Spinner /> : <Check className="size-4" />}
        완료
      </Button>
    );
  }
  if (work.stateCategory === 'COMPLETED') {
    return (
      <Button
        aria-label={`${work.identifier}: 완료됨`}
        className={className}
        disabled
        size={size}
        variant="outline"
      >
        <Check className="size-4" />
        완료됨
      </Button>
    );
  }
  return null;
}
