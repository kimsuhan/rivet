'use client';

import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

// 사이드바 2단계 항목(저장된 보기, 프로젝트, 팀 하위 보기)은 같은 들여쓰기와 크기를 쓴다.
export const sidebarSubGroupClassName = 'ml-4 hidden flex-col gap-0.5 border-l pl-2 xl:flex';

export const sidebarSubItemClassName =
  'focus-visible:ring-sidebar-ring flex h-7 items-center gap-1.5 rounded-md px-1.5 text-xs transition-colors outline-none focus-visible:ring-2';

export function sidebarSubItemStateClassName(active: boolean): string {
  return active
    ? 'text-sidebar-accent-foreground font-medium'
    : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground';
}

// 꺽쇄가 줄줄이 보이지 않도록 평소에는 숨기고, 접힌 상태이거나 해당 줄을 가리킬 때만 드러낸다.
export const sidebarDisclosureRowClassName = 'group/sidebar-row';

export function SidebarDisclosureButton({
  className,
  collapseLabel,
  expandLabel,
  expanded,
  onToggle,
}: {
  className?: string;
  collapseLabel: string;
  expandLabel: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const label = expanded ? collapseLabel : expandLabel;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={label}
      title={label}
      className={cn(
        'text-muted-foreground hover:bg-surface-2 hover:text-foreground focus-visible:ring-sidebar-ring hidden h-6 w-6 shrink-0 items-center justify-center rounded-md transition-opacity outline-none focus-visible:ring-2 xl:flex',
        expanded &&
          'pointer-events-none opacity-0 group-focus-within/sidebar-row:pointer-events-auto group-focus-within/sidebar-row:opacity-100 group-hover/sidebar-row:pointer-events-auto group-hover/sidebar-row:opacity-100',
        className,
      )}
    >
      <ChevronRight
        aria-hidden="true"
        className={cn('size-3 transition-transform', expanded && 'rotate-90')}
      />
    </button>
  );
}

export function SidebarSectionHeading({
  children,
  collapseLabel,
  expandLabel,
  expanded,
  id,
  onToggle,
}: {
  children: ReactNode;
  collapseLabel: string;
  expandLabel: string;
  expanded: boolean;
  id?: string;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn('hidden h-6 items-center gap-0.5 px-2 xl:flex', sidebarDisclosureRowClassName)}
    >
      <h2 id={id} className="text-muted-foreground min-w-0 flex-1 truncate text-xs font-medium">
        {children}
      </h2>
      <SidebarDisclosureButton
        collapseLabel={collapseLabel}
        expandLabel={expandLabel}
        expanded={expanded}
        onToggle={onToggle}
      />
    </div>
  );
}
