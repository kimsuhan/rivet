'use client';

import {
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDotDashed,
  CircleX,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';

export type WorkflowStateCategory = 'BACKLOG' | 'UNSTARTED' | 'STARTED' | 'COMPLETED' | 'CANCELED';

export const WORKFLOW_STATE_PRESENTATION: Record<
  WorkflowStateCategory,
  { icon: LucideIcon; iconClassName: string; label: string }
> = {
  BACKLOG: { icon: CircleDashed, iconClassName: 'text-muted-foreground', label: '백로그' },
  UNSTARTED: { icon: Circle, iconClassName: 'text-foreground', label: '시작 전' },
  STARTED: { icon: CircleDotDashed, iconClassName: 'text-info', label: '진행 중' },
  COMPLETED: { icon: CircleCheck, iconClassName: 'text-success', label: '완료' },
  CANCELED: { icon: CircleX, iconClassName: 'text-muted-foreground', label: '취소' },
};

export function WorkflowStateIcon({
  category,
  className,
}: {
  category: WorkflowStateCategory;
  className?: string;
}) {
  const presentation = WORKFLOW_STATE_PRESENTATION[category];
  const Icon = presentation.icon;

  return (
    <Icon
      aria-hidden="true"
      className={cn('size-4 shrink-0', presentation.iconClassName, className)}
    />
  );
}
