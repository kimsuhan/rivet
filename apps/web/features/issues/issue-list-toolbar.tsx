'use client';

import { Filter, Search } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button, buttonVariants } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';

export function IssueListToolbar({
  activeFilterCount,
  filterContent,
  filterTitle,
  onSearchOpenChange,
  query,
  searchOpen,
  sortAndViewControls,
}: {
  activeFilterCount: number;
  filterContent: ReactNode;
  filterTitle: string;
  onSearchOpenChange: (open: boolean) => void;
  query: string;
  searchOpen: boolean;
  sortAndViewControls: ReactNode;
}) {
  return (
    <>
      <Button
        type="button"
        size="icon-sm"
        variant={searchOpen || query ? 'secondary' : 'ghost'}
        aria-label={searchOpen ? '검색 닫기' : query ? `검색: ${query}` : '검색'}
        title={searchOpen ? '검색 닫기' : '검색'}
        onClick={() => onSearchOpenChange(!searchOpen)}
      >
        <Search />
      </Button>
      <Popover>
        <PopoverTrigger
          type="button"
          aria-label={activeFilterCount ? `필터 ${activeFilterCount}개` : '필터'}
          title={activeFilterCount ? `필터 ${activeFilterCount}개` : '필터'}
          className={buttonVariants({
            className: 'relative',
            size: 'icon-sm',
            variant: activeFilterCount ? 'secondary' : 'ghost',
          })}
        >
          <Filter />
          {activeFilterCount ? (
            <span className="bg-primary text-primary-foreground absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full text-[0.625rem] font-semibold">
              {activeFilterCount}
            </span>
          ) : null}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 gap-2.5 p-3">
          <PopoverTitle className="text-sm">{filterTitle}</PopoverTitle>
          {filterContent}
        </PopoverContent>
      </Popover>
      {sortAndViewControls}
    </>
  );
}
