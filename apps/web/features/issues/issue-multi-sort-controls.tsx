'use client';

import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Plus,
  RotateCcw,
  Rows3,
  Trash2,
} from 'lucide-react';

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
import { Separator } from '@/components/ui/separator';

import {
  DEFAULT_ISSUE_SORTS,
  ISSUE_SORT_FIELDS,
  type IssueSortClause,
  type IssueSortField,
  MAX_ISSUE_SORTS,
} from './issue-multi-sort';

const SORT_OPTIONS: Array<{ label: string; value: IssueSortField }> = [
  { label: '우선순위', value: 'priority' },
  { label: '상태', value: 'status' },
  { label: '최근 수정일', value: 'updatedAt' },
  { label: '생성일', value: 'createdAt' },
  { label: '진행률', value: 'progress' },
];

function replaceAt(
  sorts: readonly IssueSortClause[],
  index: number,
  clause: IssueSortClause,
): IssueSortClause[] {
  return sorts.map((item, itemIndex) => (itemIndex === index ? clause : item));
}

function move(sorts: readonly IssueSortClause[], from: number, to: number): IssueSortClause[] {
  const next = [...sorts];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

export function IssueMultiSortControls({
  density,
  onDensityChange,
  onSortsChange,
  sorts,
}: {
  density: string;
  onDensityChange: (value: 'comfortable' | 'compact') => void;
  onSortsChange: (value: IssueSortClause[]) => void;
  sorts: readonly IssueSortClause[];
}) {
  const compact = density === 'compact';
  const nextDensityLabel = compact ? '여유 보기' : '촘촘히 보기';
  const summary = SORT_OPTIONS.find((option) => option.value === sorts[0]?.field)?.label;

  function addSort(): void {
    const field = ISSUE_SORT_FIELDS.find(
      (candidate) => !sorts.some((sort) => sort.field === candidate),
    );
    if (field) onSortsChange([...sorts, { direction: 'desc', field }]);
  }

  return (
    <div className="bg-background flex shrink-0 items-center rounded-lg border p-0.5">
      <Popover>
        <PopoverTrigger
          type="button"
          aria-label={`이슈 다중 정렬 ${sorts.length}개`}
          className={buttonVariants({ size: 'sm', variant: 'ghost' })}
        >
          <ArrowDownUp data-icon="inline-start" />
          <span className="max-w-28 truncate">{summary ?? '정렬'}</span>
          {sorts.length > 1 ? (
            <span className="bg-secondary text-secondary-foreground min-w-5 rounded-full px-1.5 text-center text-xs">
              {sorts.length}
            </span>
          ) : null}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[min(28rem,calc(100vw-2rem))] gap-3 p-3">
          <div>
            <PopoverTitle className="text-sm">다중 정렬</PopoverTitle>
            <p className="text-muted-foreground mt-0.5 text-xs">
              위 조건부터 차례로 적용합니다. 최대 {MAX_ISSUE_SORTS}개까지 설정할 수 있습니다.
            </p>
          </div>
          <div className="space-y-2">
            {sorts.map((sort, index) => {
              const descending = sort.direction === 'desc';
              return (
                <div
                  key={sort.field}
                  className="bg-muted/40 flex items-center gap-1 rounded-lg p-1"
                >
                  <span
                    className="text-muted-foreground w-6 shrink-0 text-center text-xs tabular-nums"
                    aria-label={`${index + 1}번째 정렬`}
                  >
                    {index + 1}
                  </span>
                  <Select
                    items={SORT_OPTIONS}
                    value={sort.field}
                    onValueChange={(value) => {
                      if (value) {
                        onSortsChange(
                          replaceAt(sorts, index, { ...sort, field: value as IssueSortField }),
                        );
                      }
                    }}
                  >
                    <SelectTrigger
                      size="sm"
                      className="bg-background min-w-0 flex-1"
                      aria-label={`${index + 1}번째 정렬 필드`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger={false}>
                      <SelectGroup>
                        {SORT_OPTIONS.map((option) => (
                          <SelectItem
                            key={option.value}
                            value={option.value}
                            disabled={sorts.some(
                              (item, itemIndex) =>
                                itemIndex !== index && item.field === option.value,
                            )}
                          >
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="w-24 justify-start"
                    aria-label={`${index + 1}번째 정렬 ${descending ? '내림차순' : '오름차순'}. ${descending ? '오름차순' : '내림차순'}으로 변경`}
                    onClick={() =>
                      onSortsChange(
                        replaceAt(sorts, index, {
                          ...sort,
                          direction: descending ? 'asc' : 'desc',
                        }),
                      )
                    }
                  >
                    {descending ? (
                      <ArrowDown data-icon="inline-start" />
                    ) : (
                      <ArrowUp data-icon="inline-start" />
                    )}
                    {descending ? '내림차순' : '오름차순'}
                  </Button>
                  <div className="flex shrink-0 items-center">
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      disabled={index === 0}
                      aria-label={`${index + 1}번째 정렬을 위로 이동`}
                      onClick={() => onSortsChange(move(sorts, index, index - 1))}
                    >
                      <ChevronUp />
                    </Button>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      disabled={index === sorts.length - 1}
                      aria-label={`${index + 1}번째 정렬을 아래로 이동`}
                      onClick={() => onSortsChange(move(sorts, index, index + 1))}
                    >
                      <ChevronDown />
                    </Button>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      disabled={sorts.length === 1}
                      aria-label={`${index + 1}번째 정렬 제거`}
                      onClick={() =>
                        onSortsChange(sorts.filter((_, itemIndex) => itemIndex !== index))
                      }
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={sorts.length >= MAX_ISSUE_SORTS}
              onClick={addSort}
            >
              <Plus data-icon="inline-start" /> 정렬 추가
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onSortsChange([...DEFAULT_ISSUE_SORTS])}
            >
              <RotateCcw data-icon="inline-start" /> 기본값
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <Separator orientation="vertical" className="mx-0.5 -my-0.5" />
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
