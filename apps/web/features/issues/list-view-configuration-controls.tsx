'use client';

import { Check, Rows3, Settings2 } from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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

export function ListViewConfigurationControls({
  density,
  fieldOptions,
  groupBy,
  groupOptions,
  onDensityChange,
  onGroupingChange,
  onVisibleFieldsChange,
  subGroupBy,
  visibleFields,
}: {
  density: string;
  fieldOptions: ReadonlyArray<{ label: string; value: string }>;
  groupBy: string;
  groupOptions: ReadonlyArray<{ label: string; value: string }>;
  onDensityChange: (value: 'comfortable' | 'compact') => void;
  onGroupingChange: (groupBy: string, subGroupBy: string) => void;
  onVisibleFieldsChange: (value: string[]) => void;
  subGroupBy: string;
  visibleFields: readonly string[];
}) {
  const compact = density === 'compact';
  const visibleSet = new Set(visibleFields);
  const configured = compact || visibleFields.length !== fieldOptions.length || Boolean(groupBy);
  const subGroupOptions = groupOptions.filter((option) => option.value !== groupBy);

  return (
    <Popover>
      <PopoverTrigger
        type="button"
        aria-label={`보기 설정: ${compact ? '촘촘히 보기' : '여유 보기'}${groupBy ? ', 그룹화됨' : ''}`}
        title="보기 설정"
        className={buttonVariants({
          size: 'icon-sm',
          variant: configured ? 'secondary' : 'ghost',
        })}
      >
        <Settings2 />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] gap-3 p-3">
        <PopoverTitle className="text-sm">보기 설정</PopoverTitle>
        <section aria-labelledby="list-density-title">
          <h3 id="list-density-title" className="text-muted-foreground mb-1 text-xs font-medium">
            목록 밀도
          </h3>
          <div className="grid grid-cols-2 gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="justify-start"
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
              className="justify-start"
              onClick={() => onDensityChange('compact')}
            >
              <Rows3 data-icon="inline-start" className="scale-y-75" />
              촘촘히 보기
              {compact ? <Check className="ml-auto" aria-label="선택됨" /> : null}
            </Button>
          </div>
        </section>
        <Separator />
        <section aria-labelledby="visible-fields-title">
          <h3 id="visible-fields-title" className="text-muted-foreground mb-1 text-xs font-medium">
            표시 필드
          </h3>
          <ul className="grid grid-cols-2 gap-0.5">
            {fieldOptions.map((option) => (
              <li key={option.value}>
                <label className="hover:bg-muted flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-sm">
                  <Checkbox
                    checked={visibleSet.has(option.value)}
                    onCheckedChange={(checked) =>
                      onVisibleFieldsChange(
                        checked
                          ? [...visibleFields, option.value]
                          : visibleFields.filter((field) => field !== option.value),
                      )
                    }
                  />
                  <span>{option.label}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
        <Separator />
        <section className="space-y-2" aria-labelledby="group-settings-title">
          <div>
            <h3 id="group-settings-title" className="text-muted-foreground text-xs font-medium">
              그룹
            </h3>
            <p className="text-muted-foreground mt-0.5 text-xs">
              메인 그룹 안에서 서브 그룹을 한 번 더 나눕니다.
            </p>
          </div>
          <Select
            items={[{ label: '그룹 없음', value: '__none__' }, ...groupOptions]}
            value={groupBy || '__none__'}
            onValueChange={(value) => {
              const next = value === '__none__' ? '' : (value ?? '');
              onGroupingChange(next, !next || next === subGroupBy ? '' : subGroupBy);
            }}
          >
            <SelectTrigger className="w-full" size="sm" aria-label="메인 그룹">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="__none__">그룹 없음</SelectItem>
                {groupOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select
            disabled={!groupBy}
            items={[{ label: '서브 그룹 없음', value: '__none__' }, ...subGroupOptions]}
            value={subGroupBy || '__none__'}
            onValueChange={(value) =>
              onGroupingChange(groupBy, value === '__none__' ? '' : (value ?? ''))
            }
          >
            <SelectTrigger className="w-full" size="sm" aria-label="서브 그룹">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="__none__">서브 그룹 없음</SelectItem>
                {subGroupOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </section>
      </PopoverContent>
    </Popover>
  );
}
