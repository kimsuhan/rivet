'use client';

import {
  type InfiniteData,
  useInfiniteQuery,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';
import { CircleAlert, FileSearch, Search, SearchX } from 'lucide-react';
import { type KeyboardEvent, useEffect, useState } from 'react';

import {
  type ApiError,
  type ApiErrorResponseDto,
  getSearchControllerIssuesQueryKey,
  searchControllerIssues,
  type SearchIssueListResponseDto,
  type SearchIssueResultResponseDto,
  type SearchIssueStatusResponseDto,
  type SearchIssueSummaryResponseDto,
} from '@rivet/api-client';

import { ContentError } from '@/components/states/content-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

export type GlobalSearchLabels = {
  title: string;
  description: string;
  inputLabel: string;
  placeholder: string;
  emptyTitle: string;
  emptyDescription: string;
  minimumTitle: string;
  minimumDescription: string;
  loading: string;
  noResultsTitle: string;
  noResultsDescription: string;
  errorTitle: string;
  errorDescription: string;
  retry: string;
  results: string;
  resultCount: string;
  loadMore: string;
  loadingMore: string;
  loadMoreError: string;
  exactMatch: string;
  feature: string;
  teamTask: string;
  noProject: string;
  roles: Record<Exclude<SearchIssueSummaryResponseDto['projectRole'], null>, string>;
  featureStatuses: Record<NonNullable<SearchIssueStatusResponseDto['featureStatus']>, string>;
  stateCategories: Record<SearchIssueStatusResponseDto['category'], string>;
  close: string;
};

function SearchEmptyState({
  description,
  icon: Icon,
  title,
}: {
  description: string;
  icon: typeof Search;
  title: string;
}) {
  return (
    <Empty className="min-h-64 rounded-none border-0 px-5 py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon aria-hidden="true" strokeWidth={1.75} />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function SearchLoading({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="divide-y" aria-busy="true">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} aria-hidden="true" className="flex min-h-20 items-center gap-3 px-4 py-3">
          <Skeleton className="h-5 w-16 shrink-0 motion-reduce:animate-none" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex gap-2">
              <Skeleton className="h-3.5 w-16 motion-reduce:animate-none" />
              <Skeleton className="h-3.5 max-w-72 flex-1 motion-reduce:animate-none" />
            </div>
            <Skeleton className="h-3 w-48 motion-reduce:animate-none" />
          </div>
        </div>
      ))}
    </div>
  );
}

function issueStatusLabel(
  issue: SearchIssueSummaryResponseDto,
  labels: GlobalSearchLabels,
): string {
  if (issue.status.workflowState) return issue.status.workflowState.name;
  if (issue.status.featureStatus) return labels.featureStatuses[issue.status.featureStatus];
  return labels.stateCategories[issue.status.category];
}

function SearchResultRow({
  active,
  labels,
  onActivate,
  onOpen,
  optionId,
  result,
}: {
  active: boolean;
  labels: GlobalSearchLabels;
  onActivate: () => void;
  onOpen: () => void;
  optionId: string;
  result: SearchIssueResultResponseDto;
}) {
  const { issue } = result;
  const role = issue.projectRole ? labels.roles[issue.projectRole] : null;
  const context = [issue.team?.name, role].filter(Boolean).join(' · ');
  const status = issueStatusLabel(issue, labels);

  return (
    <button
      id={optionId}
      type="button"
      role="option"
      aria-selected={active}
      tabIndex={-1}
      onClick={onOpen}
      onFocus={onActivate}
      onPointerEnter={onActivate}
      className={cn(
        'focus-visible:ring-ring flex min-h-20 w-full min-w-0 items-center gap-3 px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset lg:min-h-16',
        active ? 'bg-accent text-accent-foreground' : 'hover:bg-surface-1',
      )}
    >
      <Badge variant="outline" className="shrink-0">
        {issue.type === 'FEATURE' ? labels.feature : labels.teamTask}
      </Badge>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="font-mono text-xs font-medium whitespace-nowrap">
            {issue.identifier}
          </span>
          <span className="truncate text-sm font-medium">{issue.title}</span>
          {result.matchType === 'IDENTIFIER_EXACT' ? (
            <Badge variant="secondary" className="hidden shrink-0 sm:inline-flex">
              {labels.exactMatch}
            </Badge>
          ) : null}
        </span>
        <span className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          <span className="truncate">{issue.project?.name ?? labels.noProject}</span>
          {context ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="truncate">{context}</span>
            </>
          ) : null}
          <span aria-hidden="true">·</span>
          <span className="truncate">{status}</span>
        </span>
      </span>
    </button>
  );
}

export function GlobalSearch({
  open,
  onOpenChange,
  labels,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labels: GlobalSearchLabels;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const normalizedQuery = query.trim();
  const isDebouncing = normalizedQuery !== debouncedQuery;
  const canSearch = normalizedQuery.length >= 2 && !isDebouncing;
  const params = { limit: 20, query: debouncedQuery };
  const queryKey = [...getSearchControllerIssuesQueryKey(params), 'infinite'] as const;
  const search: UseInfiniteQueryResult<
    InfiniteData<SearchIssueListResponseDto>,
    ApiError<ApiErrorResponseDto>
  > = useInfiniteQuery<
    SearchIssueListResponseDto,
    ApiError<ApiErrorResponseDto>,
    InfiniteData<SearchIssueListResponseDto>,
    typeof queryKey,
    string | undefined
  >({
    enabled: open && canSearch,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined,
    queryFn: ({ pageParam, signal }) =>
      searchControllerIssues(
        { ...params, ...(pageParam ? { cursor: pageParam } : {}) },
        { signal },
      ),
    queryKey,
    retry: false,
  });
  const results = search.data?.pages.flatMap((page) => page.items) ?? [];
  const selectedIndex = Math.min(activeIndex, Math.max(results.length - 1, 0));
  const activeResult = results[selectedIndex];
  const activeOptionId = activeResult ? `global-search-result-${activeResult.issue.id}` : undefined;

  useEffect(() => {
    if (!open) return;

    const timeout = window.setTimeout(() => setDebouncedQuery(normalizedQuery), 250);
    return () => window.clearTimeout(timeout);
  }, [normalizedQuery, open]);

  useEffect(() => {
    if (!activeOptionId) return;
    document.getElementById(activeOptionId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeOptionId]);

  function openResult(result: SearchIssueResultResponseDto) {
    onOpenChange(false);
    router.push(`/issues/${encodeURIComponent(result.issue.identifier)}`);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onOpenChange(false);
      return;
    }

    if (results.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? results.length - 1 : index - 1));
      return;
    }

    if (event.key === 'Enter' && activeResult) {
      event.preventDefault();
      openResult(activeResult);
    }
  }

  const isLoading = normalizedQuery.length >= 2 && (isDebouncing || search.isPending);
  const showInitialError = !isLoading && search.isError && results.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={labels.close}
        scaleAnimation={false}
        className="lg:data-open:zoom-in-95 lg:data-closed:zoom-out-95 inset-0 grid h-dvh max-h-dvh max-w-none translate-x-0 translate-y-0 grid-rows-[auto_auto_1fr] gap-0 overflow-hidden rounded-none border-0 p-0 lg:inset-auto lg:top-[12vh] lg:left-1/2 lg:h-auto lg:max-h-[80vh] lg:max-w-2xl lg:-translate-x-1/2 lg:rounded-xl lg:border"
      >
        <DialogHeader className="border-b px-4 pt-4 pr-12 pb-3">
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>
        <div className="relative border-b p-3">
          <Search
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-6 size-4 -translate-y-1/2"
            strokeWidth={1.75}
          />
          <label htmlFor="global-search" className="sr-only">
            {labels.inputLabel}
          </label>
          <Input
            id="global-search"
            type="search"
            role="combobox"
            autoComplete="off"
            autoFocus
            value={query}
            placeholder={labels.placeholder}
            aria-autocomplete="list"
            aria-activedescendant={activeOptionId}
            aria-controls={results.length > 0 ? 'global-search-results' : undefined}
            aria-expanded={results.length > 0}
            aria-busy={isLoading}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleInputKeyDown}
            className="pl-9"
          />
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain">
          {normalizedQuery.length === 0 ? (
            <SearchEmptyState
              icon={FileSearch}
              title={labels.emptyTitle}
              description={labels.emptyDescription}
            />
          ) : normalizedQuery.length < 2 ? (
            <SearchEmptyState
              icon={Search}
              title={labels.minimumTitle}
              description={labels.minimumDescription}
            />
          ) : isLoading ? (
            <SearchLoading label={labels.loading} />
          ) : showInitialError ? (
            <div className="p-5">
              <ContentError
                title={labels.errorTitle}
                description={labels.errorDescription}
                retryLabel={labels.retry}
                onRetry={() => void search.refetch()}
                headingLevel={3}
              />
            </div>
          ) : results.length === 0 ? (
            <SearchEmptyState
              icon={SearchX}
              title={labels.noResultsTitle}
              description={labels.noResultsDescription}
            />
          ) : (
            <>
              <p role="status" className="sr-only">
                {labels.resultCount.replace(
                  '{count}',
                  new Intl.NumberFormat('ko-KR').format(results.length),
                )}
              </p>
              <div
                id="global-search-results"
                role="listbox"
                aria-label={labels.results}
                className="divide-y"
              >
                {results.map((result, index) => (
                  <SearchResultRow
                    key={result.issue.id}
                    optionId={`global-search-result-${result.issue.id}`}
                    result={result}
                    labels={labels}
                    active={index === selectedIndex}
                    onActivate={() => setActiveIndex(index)}
                    onOpen={() => openResult(result)}
                  />
                ))}
              </div>
              {search.isFetchNextPageError || search.hasNextPage ? (
                <div className="flex min-h-14 items-center justify-center border-t p-3">
                  {search.isFetchNextPageError ? (
                    <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
                      <CircleAlert aria-hidden="true" className="text-destructive size-4" />
                      <span className="text-muted-foreground">{labels.loadMoreError}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void search.fetchNextPage()}
                      >
                        {labels.retry}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={search.isFetchingNextPage}
                      aria-busy={search.isFetchingNextPage}
                      aria-label={search.isFetchingNextPage ? labels.loadingMore : labels.loadMore}
                      onClick={() => void search.fetchNextPage()}
                    >
                      {search.isFetchingNextPage ? (
                        <Spinner data-icon="inline-start" aria-label={labels.loadingMore} />
                      ) : null}
                      {labels.loadMore}
                    </Button>
                  )}
                </div>
              ) : null}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
