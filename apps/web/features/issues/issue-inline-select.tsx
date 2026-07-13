'use client';

import type { LucideIcon } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

export type IssueInlineSelectOption = {
  icon?: LucideIcon;
  iconClassName?: string;
  label: string;
  value: string;
};

export function IssueInlineSelect({
  appearance = 'default',
  ariaLabel,
  busy = false,
  disabled,
  labelClassName,
  onValueChange,
  options,
  triggerClassName,
  value,
}: {
  appearance?: 'comfortable' | 'compact' | 'default';
  ariaLabel: string;
  busy?: boolean;
  disabled: boolean;
  labelClassName?: string;
  onValueChange: (value: string) => void;
  options: IssueInlineSelectOption[];
  triggerClassName?: string;
  value: string;
}) {
  const selectedOption = options.find((option) => option.value === value);
  const SelectedIcon = selectedOption?.icon;

  return (
    <Select
      items={options}
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue && nextValue !== value) onValueChange(nextValue);
      }}
    >
      <SelectTrigger
        size="sm"
        variant={
          appearance === 'compact'
            ? 'inline'
            : appearance === 'comfortable'
              ? 'property'
              : 'default'
        }
        aria-label={ariaLabel}
        aria-busy={busy || undefined}
        aria-disabled={disabled || undefined}
        title={selectedOption?.label}
        className={cn(
          'hover:border-input max-w-full min-w-0 border-transparent bg-transparent px-1.5',
          appearance !== 'default' && 'hover:border-transparent',
          busy && '[&>svg:last-child]:hidden',
          triggerClassName,
        )}
        disabled={disabled && !busy}
        onPointerDownCapture={(event) => {
          if (busy) event.preventDefault();
        }}
        onKeyDownCapture={(event) => {
          if (busy && [' ', 'ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
            event.preventDefault();
          }
        }}
      >
        {appearance !== 'default' && selectedOption ? (
          <span className="flex min-w-0 items-center gap-1.5">
            {SelectedIcon ? (
              <SelectedIcon
                aria-hidden="true"
                data-slot="inline-select-icon"
                className={cn('size-4 shrink-0', selectedOption.iconClassName)}
              />
            ) : null}
            <span
              data-slot="inline-select-label"
              className={cn('text-secondary-foreground min-w-0 truncate', labelClassName)}
            >
              {selectedOption.label}
            </span>
            {busy ? <Spinner aria-hidden="true" data-slot="inline-select-spinner" /> : null}
          </span>
        ) : (
          <SelectValue />
        )}
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} className="max-w-90 min-w-60">
        <SelectGroup>
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              className="data-selected:bg-accent/60 min-h-11 lg:min-h-9"
            >
              {option.icon ? (
                <option.icon
                  aria-hidden="true"
                  data-slot="inline-select-item-icon"
                  className={cn('size-4 shrink-0', option.iconClassName)}
                />
              ) : null}
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
