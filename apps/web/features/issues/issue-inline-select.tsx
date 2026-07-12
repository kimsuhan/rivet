'use client';

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export function IssueInlineSelect({
  ariaLabel,
  disabled,
  onValueChange,
  options,
  triggerClassName,
  value,
}: {
  ariaLabel: string;
  disabled: boolean;
  onValueChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  triggerClassName?: string;
  value: string;
}) {
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
        aria-label={ariaLabel}
        className={cn(
          'hover:border-input max-w-full min-w-0 border-transparent bg-transparent px-1.5',
          triggerClassName,
        )}
        disabled={disabled}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
