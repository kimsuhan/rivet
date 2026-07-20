'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type WorkflowStateCategory = 'BACKLOG' | 'UNSTARTED' | 'STARTED' | 'COMPLETED' | 'CANCELED';

export const WORKFLOW_STATE_COLOR_PALETTE = {
  GRAY: '#8A8F98',
  COOL_GRAY: '#A3ADC2',
  INDIGO: '#9A8CF2',
  TEAL: '#4BC7C7',
  GREEN: '#62D783',
  YELLOW: '#E8C675',
  ORANGE: '#E58A4A',
  BROWN: '#B9936C',
  RED: '#F38A8E',
} as const;

export type WorkflowStateColorKey = keyof typeof WORKFLOW_STATE_COLOR_PALETTE;

export const WORKFLOW_STATE_PRESENTATION: Record<
  WorkflowStateCategory,
  { defaultColor: WorkflowStateColorKey; label: string }
> = {
  BACKLOG: { defaultColor: 'GRAY', label: '백로그' },
  UNSTARTED: { defaultColor: 'COOL_GRAY', label: '시작 전' },
  STARTED: { defaultColor: 'INDIGO', label: '진행 중' },
  COMPLETED: { defaultColor: 'GREEN', label: '완료' },
  CANCELED: { defaultColor: 'GRAY', label: '취소' },
};

export function isWorkflowStateColorKey(value: unknown): value is WorkflowStateColorKey {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(WORKFLOW_STATE_COLOR_PALETTE, value)
  );
}

export function workflowStateColorKey(
  category: WorkflowStateCategory,
  color?: string | null,
): WorkflowStateColorKey {
  return isWorkflowStateColorKey(color)
    ? color
    : WORKFLOW_STATE_PRESENTATION[category].defaultColor;
}

export function workflowStateProgress(
  states: Array<{ category: WorkflowStateCategory; id: string; position: number }>,
  state: { category: WorkflowStateCategory; id: string },
): number | null {
  if (state.category !== 'STARTED') return null;

  const startedStates = states
    .filter(({ category }) => category === 'STARTED')
    .sort((left, right) => left.position - right.position);
  const index = startedStates.findIndex(({ id }) => id === state.id);
  return index < 0 ? null : (index + 1) / (startedStates.length + 1);
}

function startedPie(progress: number): ReactNode {
  const normalized = Math.min(0.999, Math.max(0.001, progress));
  const angle = normalized * Math.PI * 2 - Math.PI / 2;
  const x = 8 + 5.25 * Math.cos(angle);
  const y = 8 + 5.25 * Math.sin(angle);
  const largeArc = normalized > 0.5 ? 1 : 0;

  return (
    <>
      <circle cx="8" cy="8" r="5.25" fill="none" />
      <path
        d={`M 8 8 L 8 2.75 A 5.25 5.25 0 ${largeArc} 1 ${x.toFixed(3)} ${y.toFixed(3)} Z`}
        fill="currentColor"
        stroke="none"
      />
    </>
  );
}

function workflowStateGlyph(category: WorkflowStateCategory, progress: number): ReactNode {
  switch (category) {
    case 'BACKLOG':
      return <circle cx="8" cy="8" r="5.25" fill="none" strokeDasharray="1.6 2.2" />;
    case 'UNSTARTED':
      return <circle cx="8" cy="8" r="5.25" fill="none" />;
    case 'STARTED':
      return startedPie(progress);
    case 'COMPLETED':
      return (
        <>
          <circle cx="8" cy="8" r="5.25" fill="none" />
          <path d="m5.4 8 1.65 1.65 3.55-3.55" fill="none" />
        </>
      );
    case 'CANCELED':
      return (
        <>
          <circle cx="8" cy="8" r="5.25" fill="none" />
          <path d="m6.1 6.1 3.8 3.8m0-3.8-3.8 3.8" fill="none" />
        </>
      );
  }
}

export function WorkflowStateIcon({
  category,
  className,
  color,
  progress = 0.5,
  variant = 'inline',
}: {
  category: WorkflowStateCategory;
  className?: string;
  color?: string | null;
  progress?: number | null;
  variant?: 'inline' | 'swatch';
}) {
  const paletteColor = WORKFLOW_STATE_COLOR_PALETTE[workflowStateColorKey(category, color)];
  const icon = (
    <svg
      aria-hidden="true"
      className={cn('size-4 shrink-0', variant === 'inline' && className)}
      data-workflow-state-category={category}
      data-workflow-state-color={workflowStateColorKey(category, color)}
      data-workflow-state-progress={category === 'STARTED' ? (progress ?? 0.5) : undefined}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
      style={{ color: paletteColor }}
      viewBox="0 0 16 16"
    >
      {workflowStateGlyph(category, progress ?? 0.5)}
    </svg>
  );

  return variant === 'swatch' ? (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-md',
        className,
      )}
      style={{ backgroundColor: `color-mix(in srgb, ${paletteColor} 16%, transparent)` }}
    >
      {icon}
    </span>
  ) : (
    icon
  );
}
