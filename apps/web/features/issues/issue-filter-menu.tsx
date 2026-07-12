'use client';

import { ChevronDown, SlidersHorizontal } from 'lucide-react';

import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

export type IssueFilterOption = {
  id: string;
  label: string;
  swatch?: string;
};

export function IssueFilterMenu({
  ariaLabel,
  disabled = false,
  emptyLabel,
  label,
  onChange,
  options,
  selected,
  triggerClassName,
}: {
  ariaLabel?: string;
  disabled?: boolean;
  emptyLabel: string;
  label: string;
  onChange: (selected: string[]) => void;
  options: IssueFilterOption[];
  selected: string[];
  triggerClassName?: string;
}) {
  const selectedSet = new Set(selected);

  return (
    <details className="group/filter relative">
      <summary
        aria-label={ariaLabel}
        aria-disabled={disabled}
        className={cn(
          'border-input hover:bg-muted focus-visible:border-ring focus-visible:ring-ring/50 flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md border bg-transparent px-2.5 text-sm outline-none select-none focus-visible:ring-2 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&::-webkit-details-marker]:hidden',
          triggerClassName,
        )}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
      >
        <SlidersHorizontal aria-hidden="true" className="text-muted-foreground size-3.5" />
        <span>{label}</span>
        {selected.length > 0 ? (
          <span className="bg-secondary text-secondary-foreground min-w-5 rounded-full px-1.5 text-center text-xs font-medium">
            {selected.length}
          </span>
        ) : null}
        <ChevronDown
          aria-hidden="true"
          className="text-muted-foreground size-3.5 transition-transform group-open/filter:rotate-180"
        />
      </summary>
      <div className="app-floating-layer bg-popover text-popover-foreground ring-foreground/10 absolute top-full left-0 mt-1 min-w-48 rounded-lg p-1 shadow-md ring-1">
        {options.length === 0 ? (
          <p className="text-muted-foreground px-2 py-2 text-sm">{emptyLabel}</p>
        ) : (
          <ul className="max-h-64 overflow-y-auto">
            {options.map((option) => {
              const checked = selectedSet.has(option.id);
              return (
                <li key={option.id}>
                  <label
                    className={cn(
                      'hover:bg-accent flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm',
                      checked && 'bg-accent/60',
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={disabled}
                      onCheckedChange={(nextChecked) =>
                        onChange(
                          nextChecked
                            ? [...selected, option.id]
                            : selected.filter((value) => value !== option.id),
                        )
                      }
                    />
                    {option.swatch ? (
                      <span
                        aria-hidden="true"
                        className="size-2.5 rounded-full border"
                        style={{ backgroundColor: option.swatch }}
                      />
                    ) : null}
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </details>
  );
}
