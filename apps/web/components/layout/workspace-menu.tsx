'use client';

import { ChevronDown } from 'lucide-react';
import type { RefObject } from 'react';

import { RivetSymbol } from '@/components/layout/brand';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';

export type WorkspaceMenuLabels = {
  open: string;
};

export function WorkspaceMenu({
  labels,
  onOpenChange,
  open,
  triggerRef,
  workspace,
}: {
  labels: WorkspaceMenuLabels;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  workspace: { name: string; slug: string };
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        ref={triggerRef}
        type="button"
        aria-label={labels.open}
        title={workspace.name}
        className="text-sidebar-foreground hover:bg-surface-2 hover:text-foreground focus-visible:ring-sidebar-ring aria-expanded:bg-surface-2 flex h-9 w-full items-center gap-2 rounded-md px-1 text-left text-sm font-medium transition-colors outline-none focus-visible:ring-2"
      >
        <RivetSymbol className="h-5 shrink-0" />
        <span className="hidden min-w-0 flex-1 truncate xl:inline">{workspace.name}</span>
        <ChevronDown aria-hidden="true" className="hidden size-3.5 shrink-0 xl:block" />
      </PopoverTrigger>
      <PopoverContent align="start" side="bottom" className="w-60 gap-1 p-1">
        <div className="px-2 py-1.5">
          <PopoverTitle className="truncate text-sm">{workspace.name}</PopoverTitle>
          <p className="text-muted-foreground truncate text-xs">{workspace.slug}</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
