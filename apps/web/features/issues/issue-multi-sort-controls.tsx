'use client';

import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  Plus,
  RotateCcw,
  Rows3,
  Settings2,
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

  function addSort(): void {
    const field = ISSUE_SORT_FIELDS.find(
      (candidate) => !sorts.some((sort) => sort.field === candidate),
    );
    if (field) onSortsChange([...sorts, { direction: 'desc', field }]);
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Popover>
        <PopoverTrigger
          type="button"
          aria-label={`이슈 다중 정렬 ${sorts.length}개`}
          title={`정렬 ${sorts.length}개`}
          className={buttonVariants({
            className: 'relative',
            size: 'icon-sm',
            variant: sorts.length > 1 ? 'secondary' : 'ghost',
          })}
        >
          <ArrowDownUp />
          {sorts.length > 1 ? (
            <span className="bg-primary text-primary-foreground absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full text-[0.625rem] font-semibold">
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
