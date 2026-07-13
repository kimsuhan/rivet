'use client';

import { ChevronDown, type LucideIcon, SlidersHorizontal, Tag } from 'lucide-react';
import type { KeyboardEvent } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

export type IssueFilterOption = {
  disabled?: boolean;
  icon?: LucideIcon;
  iconClassName?: string;
  id: string;
  label: string;
  suffix?: string;
  swatch?: string;
};

export function IssueFilterMenu({
  ariaLabel,
  busy = false,
  disabled = false,
  emptyLabel,
  label,
  onChange,
  options,
  presentation = 'details',
  selected,
  triggerClassName,
  variant = 'default',
}: {
  ariaLabel?: string;
  busy?: boolean;
  disabled?: boolean;
  emptyLabel: string;
  label: string;
  onChange: (selected: string[]) => void;
  options: IssueFilterOption[];
  presentation?: 'details' | 'popover';
  selected: string[];
  triggerClassName?: string;
  variant?: 'compact' | 'default';
}) {
  const selectedSet = new Set(selected);

  function handleOptionsKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const current = (event.target as HTMLElement).closest<HTMLElement>('[data-slot="checkbox"]');
    if (!current) return;

    if (event.key === 'Enter') {
      event.preventDefault();
      current.click();
      return;
    }

    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;

    const enabledOptions = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[data-slot="checkbox"]'),
    ).filter(
      (option) =>
        !option.hasAttribute('disabled') && option.getAttribute('aria-disabled') !== 'true',
    );
    if (enabledOptions.length === 0) return;

    event.preventDefault();
    const currentIndex = enabledOptions.indexOf(current);
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? enabledOptions.length - 1
          : event.key === 'ArrowDown'
            ? (currentIndex + 1) % enabledOptions.length
            : (currentIndex - 1 + enabledOptions.length) % enabledOptions.length;
    enabledOptions[nextIndex]?.focus();
  }

  const optionsContent =
    options.length === 0 ? (
      <p className="text-muted-foreground px-2 py-2 text-sm">{emptyLabel}</p>
    ) : (
      <ul className="max-h-64 overflow-y-auto" onKeyDown={handleOptionsKeyDown}>
        {options.map((option) => {
          const checked = selectedSet.has(option.id);
          return (
            <li key={option.id}>
              <label
                className={cn(
                  'hover:bg-accent flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm lg:min-h-9',
                  checked && 'bg-accent/60',
                  option.disabled && 'text-muted-foreground cursor-not-allowed opacity-60',
                )}
              >
                <Checkbox
                  checked={checked}
                  disabled={disabled || option.disabled}
                  aria-disabled={disabled || option.disabled}
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
                {option.icon ? (
                  <option.icon
                    aria-hidden="true"
                    className={cn('size-4 shrink-0', option.iconClassName)}
                  />
                ) : null}
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.suffix ? (
                  <span className="text-muted-foreground shrink-0 text-xs">{option.suffix}</span>
                ) : null}
              </label>
            </li>
          );
        })}
      </ul>
    );

  if (presentation === 'popover') {
    return (
      <Popover>
        <PopoverTrigger
          type="button"
          aria-label={ariaLabel ?? label}
          aria-busy={busy || undefined}
          aria-disabled={disabled || undefined}
          title={ariaLabel ?? label}
          disabled={disabled && !busy}
          onPointerDownCapture={(event) => {
            if (busy) event.preventDefault();
          }}
          onClickCapture={(event) => {
            if (!busy) return;
            event.preventDefault();
            event.stopPropagation();
          }}
          onKeyDownCapture={(event) => {
            if (busy && [' ', 'ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
              event.preventDefault();
            }
          }}
          className={cn(
            'hover:before:bg-muted/60 data-popup-open:before:bg-muted focus-visible:ring-ring focus-visible:ring-offset-background relative isolate flex min-h-11 min-w-11 items-center justify-center rounded-md border border-transparent bg-transparent text-sm transition-colors outline-none before:absolute before:top-1/2 before:left-1/2 before:-z-10 before:size-8 before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-md before:bg-transparent before:transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 lg:min-h-10 lg:min-w-10',
            triggerClassName,
          )}
        >
          <Tag aria-hidden="true" className="text-muted-foreground size-3.5" />
          <span>{label}</span>
          {selected.length > 0 ? <span>{selected.length}</span> : null}
          {busy ? <Spinner aria-hidden="true" className="size-3" /> : null}
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          aria-label={ariaLabel ?? label}
          className="w-56 gap-0 p-1"
          data-testid="issue-filter-menu-popup"
        >
          <PopoverTitle className="sr-only">{ariaLabel ?? label}</PopoverTitle>
          {optionsContent}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Popover>
      <PopoverTrigger
        type="button"
        aria-label={ariaLabel ?? label}
        aria-busy={busy || undefined}
        aria-disabled={disabled || undefined}
        title={ariaLabel ?? label}
        disabled={disabled && !busy}
        onPointerDownCapture={(event) => {
          if (busy) event.preventDefault();
        }}
        onClickCapture={(event) => {
          if (!busy) return;
          event.preventDefault();
          event.stopPropagation();
        }}
        onKeyDownCapture={(event) => {
          if (busy && [' ', 'ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
            event.preventDefault();
          }
        }}
        className={cn(
          'group/filter focus-visible:border-ring focus-visible:ring-ring focus-visible:ring-offset-background flex cursor-pointer items-center gap-1.5 rounded-md border bg-transparent outline-none select-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
          variant === 'default' && 'border-input hover:bg-muted h-8 px-2.5 text-sm',
          variant === 'compact' &&
            'hover:before:bg-muted/60 data-popup-open:before:bg-muted relative isolate min-h-11 border-transparent px-2 text-[13px] before:absolute before:inset-x-0 before:top-1/2 before:-z-10 before:h-8 before:-translate-y-1/2 before:rounded-md before:bg-transparent before:transition-colors focus-visible:border-transparent lg:min-h-10',
          triggerClassName,
        )}
      >
        <SlidersHorizontal aria-hidden="true" className="text-muted-foreground size-3.5" />
        <span>{label}</span>
        {selected.length > 0 ? (
          <span className="bg-secondary text-secondary-foreground min-w-5 rounded-full px-1.5 text-center text-xs font-medium">
            {selected.length}
          </span>
        ) : null}
        {busy ? <Spinner aria-hidden="true" className="size-3" /> : null}
        <ChevronDown
          aria-hidden="true"
          className="text-muted-foreground size-3.5 transition-transform group-data-[popup-open]/filter:rotate-180"
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        aria-label={ariaLabel ?? label}
        className="w-56 gap-0 p-1"
        data-testid="issue-filter-menu-popup"
      >
        <PopoverTitle className="sr-only">{ariaLabel ?? label}</PopoverTitle>
        {optionsContent}
      </PopoverContent>
    </Popover>
  );
}
