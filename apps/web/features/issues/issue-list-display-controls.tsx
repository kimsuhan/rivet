'use client';

import { ArrowDown, ArrowDownUp, ArrowUp, Check, Rows3, Settings2 } from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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
  const sortOption = sortOptions.find((option) => option.value === sort);

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Popover>
        <PopoverTrigger
          type="button"
          aria-label={`${sortLabel}: ${sortOption?.label ?? sort}, ${directionLabel}`}
          title={`${sortOption?.label ?? sort} · ${directionLabel}`}
          className={buttonVariants({ size: 'icon-sm', variant: 'ghost' })}
        >
          <ArrowDownUp />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 gap-3 p-3">
          <PopoverTitle className="text-sm">정렬</PopoverTitle>
          <Select
            items={sortOptions}
            value={sort}
            onValueChange={(value) => onSortChange(value ?? '')}
          >
            <SelectTrigger size="sm" aria-label={sortLabel} className="w-full">
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
          <div className="space-y-1" aria-label="정렬 방향">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="w-full justify-start"
              onClick={() => onSortDirectionChange('desc')}
            >
              <ArrowDown data-icon="inline-start" />
              내림차순
              {descending ? <Check className="ml-auto" aria-label="선택됨" /> : null}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="w-full justify-start"
              onClick={() => onSortDirectionChange('asc')}
            >
              <ArrowUp data-icon="inline-start" />
              오름차순
              {!descending ? <Check className="ml-auto" aria-label="선택됨" /> : null}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger
          type="button"
          aria-label={`보기 설정: ${compact ? '촘촘히 보기' : '여유 보기'}`}
          title="보기 설정"
          className={buttonVariants({
            size: 'icon-sm',
            variant: compact ? 'secondary' : 'ghost',
          })}
        >
          <Settings2 />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56 gap-2 p-3">
          <PopoverTitle className="text-sm">보기 설정</PopoverTitle>
          <div className="space-y-1" aria-label="목록 밀도">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="w-full justify-start"
              onClick={() => onDensityChange('comfortable')}
            >
              <Rows3 data-icon="inline-start" />
              여유 보기
              {!compact ? <Check className="ml-auto" aria-label="선택됨" /> : null}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="w-full justify-start"
              onClick={() => onDensityChange('compact')}
            >
              <Rows3 data-icon="inline-start" className="scale-y-75" />
              촘촘히 보기
              {compact ? <Check className="ml-auto" aria-label="선택됨" /> : null}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
