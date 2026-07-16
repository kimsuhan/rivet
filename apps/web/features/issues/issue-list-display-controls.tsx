'use client';

import { ArrowDown, ArrowDownUp, ArrowUp, Rows3 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';

export function IssueListDisplayControls({
  density,
  onDensityChange,
  onSortChange,
  onSortDirectionChange,
  sort,
  sortDirection,
  sortLabel,
  sortOptions,
}: {
  density: string;
  onDensityChange: (value: 'comfortable' | 'compact') => void;
  onSortChange: (value: string) => void;
  onSortDirectionChange: (value: 'asc' | 'desc') => void;
  sort: string;
  sortDirection: string;
  sortLabel: string;
  sortOptions: Array<{ label: string; value: string }>;
}) {
  const descending = sortDirection === 'desc';
  const compact = density === 'compact';
  const directionLabel = descending ? '내림차순' : '오름차순';
  const nextDensityLabel = compact ? '여유 보기' : '촘촘히 보기';

  return (
    <div className="bg-background flex shrink-0 items-center rounded-lg border p-0.5">
      <Select items={sortOptions} value={sort} onValueChange={(value) => onSortChange(value ?? '')}>
        <SelectTrigger
          size="sm"
          aria-label={sortLabel}
          className="max-w-40 border-transparent bg-transparent"
        >
          <ArrowDownUp data-icon="inline-start" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {sortOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={`${directionLabel} 정렬. ${descending ? '오름차순' : '내림차순'}으로 변경`}
        title={`${directionLabel} 정렬`}
        onClick={() => onSortDirectionChange(descending ? 'asc' : 'desc')}
      >
        {descending ? <ArrowDown /> : <ArrowUp />}
      </Button>
      <Separator orientation="vertical" className="mx-0.5 h-4! self-center" />
      <Button
        type="button"
        size="icon-sm"
        variant={compact ? 'secondary' : 'ghost'}
        aria-label={`${compact ? '촘촘히 보기' : '여유 보기'}. ${nextDensityLabel}로 변경`}
        title={`${compact ? '촘촘히 보기' : '여유 보기'} · 클릭하여 ${nextDensityLabel}로 변경`}
        onClick={() => onDensityChange(compact ? 'comfortable' : 'compact')}
      >
        <Rows3 />
      </Button>
    </div>
  );
}
