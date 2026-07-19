'use client';

import { CircleDot, Filter, Plus, Search, X } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { useProjectsControllerList } from '@rivet/api-client';

import { ContentEmpty } from '@/components/states/content-empty';
import { ContentError } from '@/components/states/content-error';
import { ContentLoading } from '@/components/states/content-loading';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

import { getIssuePagesQueryKey, useIssuePages } from './issue-list-queries';
import { ISSUE_LIST_GRID_COLUMNS, IssueListRow } from './issue-list-row';
import { issueSortsFromSearchParams, serializeIssueSorts } from './issue-multi-sort';
import { IssueMultiSortControls } from './issue-multi-sort-controls';
import { SavedViewControls } from './saved-view-controls';

const STATUS_LABELS = {
  UNSORTED: '접수됨',
  TODO: '할 일',
  IN_PROGRESS: '진행 중',
  REVIEW: '완료 확인',
  DONE: '완료',
  PAUSED: '일시 중지',
  CANCELED: '취소',
} as const;

export function FeatureIssueListScreen() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const query = searchParams.get('query') ?? '';
  const projectId = searchParams.get('projectId') ?? '';
  const status = searchParams.get('status') ?? '';
  const sorts = issueSortsFromSearchParams(searchParams);
  const serializedSorts = serializeIssueSorts(sorts);
  const density = searchParams.get('density') ?? 'comfortable';
  const defaultConfiguration = {
    density: 'comfortable',
    sorts: [{ direction: 'desc', field: 'updatedAt' }],
  };
  const viewConfiguration = {
    ...(query ? { query } : {}),
    ...(projectId ? { projectId } : {}),
    ...(status ? { status } : {}),
    sorts,
    density,
  };
  const issueParams = {
    ...(projectId ? { projectId } : {}),
    ...(query ? { query } : {}),
    ...(status ? { status: status as never } : {}),
    sorts: serializedSorts,
  };
  const issues = useIssuePages(issueParams);
  const issueQueryKey = getIssuePagesQueryKey(issueParams);
  const issueItems = issues.data?.pages.flatMap((page) => page.items) ?? [];
  const totalCount = issues.data?.pages[0]?.totalCount;
  const projects = useProjectsControllerList(
    { includeArchived: false, sort: 'updatedAt', sortDirection: 'desc' },
    { query: { retry: false } },
  );

  function replace(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`${pathname}${next.size ? `?${next.toString()}` : ''}`, { scroll: false });
  }

  function replaceMany(values: Record<string, string>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    router.push(`${pathname}${next.size ? `?${next.toString()}` : ''}`, { scroll: false });
  }

  const activeProjectName = projects.data?.items.find((project) => project.id === projectId)?.name;
  const activeFilterCount = Number(Boolean(projectId)) + Number(Boolean(status));

  return (
    <section className="mx-auto max-w-[1440px] space-y-5" aria-labelledby="issues-title">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 id="issues-title" className="text-2xl font-semibold tracking-tight">
            이슈
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            프로젝트의 콘텐츠와 실행 현황을 함께 봅니다.
          </p>
        </div>
        <Link
          href={`${pathname}?create=1`}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-2')}
        >
          <Plus className="size-4" />
          이슈 만들기
        </Link>
      </header>
      <SavedViewControls
        resourceType="ISSUES"
        configuration={viewConfiguration}
        defaultConfiguration={defaultConfiguration}
        activeFilters={
          query || projectId || status ? (
            <>
              {query ? (
                <Button size="xs" variant="secondary" onClick={() => replace('query', '')}>
                  검색: {query}
                  <X data-icon="inline-end" aria-label="검색어 제거" />
                </Button>
              ) : null}
              {projectId ? (
                <Button size="xs" variant="secondary" onClick={() => replace('projectId', '')}>
                  프로젝트: {activeProjectName ?? '접근할 수 없음'}
                  <X data-icon="inline-end" aria-label="프로젝트 필터 제거" />
                </Button>
              ) : null}
              {status ? (
                <Button size="xs" variant="secondary" onClick={() => replace('status', '')}>
                  상태: {STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status}
                  <X data-icon="inline-end" aria-label="상태 필터 제거" />
                </Button>
              ) : null}
              <Button
                size="xs"
                variant="ghost"
                onClick={() => replaceMany({ projectId: '', query: '', status: '' })}
              >
                필터 초기화
              </Button>
            </>
          ) : undefined
        }
        {...(projectId && projects.data && !activeProjectName
          ? {
              staleValueMessage:
                '저장된 보기의 프로젝트가 보관되었거나 접근 권한이 없습니다. 필터를 수정한 뒤 보기를 다시 저장하세요.',
            }
          : {})}
      >
        <IssueSearchInput
          key={query}
          initialQuery={query}
          onSubmit={(value) => replace('query', value)}
        />
        <Popover>
          <PopoverTrigger
            type="button"
            aria-label={activeFilterCount ? `필터 ${activeFilterCount}개` : '필터'}
            className={buttonVariants({ size: 'sm', variant: 'ghost' })}
          >
            <Filter data-icon="inline-start" />
            필터
            {activeFilterCount ? (
              <span className="bg-secondary text-secondary-foreground min-w-5 rounded-full px-1.5 text-center text-xs">
                {activeFilterCount}
              </span>
            ) : null}
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 gap-2.5 p-3">
            <PopoverTitle className="text-sm">이슈 필터</PopoverTitle>
            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground text-xs">프로젝트</span>
              <Select
                items={[
                  { label: '모든 프로젝트', value: '' },
                  ...(projects.data?.items ?? []).map((project) => ({
                    label: project.name,
                    value: project.id,
                  })),
                ]}
                value={projectId}
                onValueChange={(value) => replace('projectId', value ?? '')}
              >
                <SelectTrigger className="w-full" size="sm" aria-label="프로젝트 필터">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="">모든 프로젝트</SelectItem>
                    {(projects.data?.items ?? []).map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground text-xs">상태</span>
              <Select
                items={[
                  { label: '모든 상태', value: '' },
                  ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ label, value })),
                ]}
                value={status}
                onValueChange={(value) => replace('status', value ?? '')}
              >
                <SelectTrigger className="w-full" size="sm" aria-label="상태 필터">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="">모든 상태</SelectItem>
                    {Object.entries(STATUS_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            {activeFilterCount ? (
              <Button
                className="w-full"
                size="sm"
                variant="ghost"
                onClick={() => replaceMany({ projectId: '', status: '' })}
              >
                필터 초기화
              </Button>
            ) : null}
          </PopoverContent>
        </Popover>
        <IssueMultiSortControls
          density={density}
          sorts={sorts}
          onSortsChange={(value) =>
            replaceMany({
              sort: '',
              sortDirection: '',
              sorts: serializeIssueSorts(value),
            })
          }
          onDensityChange={(value) => replace('density', value)}
        />
      </SavedViewControls>
      {issues.isPending ? <ContentLoading label="이슈를 불러오는 중입니다" /> : null}
      {issues.isError && !issues.data ? (
        <ContentError
          title="이슈를 불러오지 못했습니다"
          description="입력한 필터는 유지했습니다."
          retryLabel="다시 시도"
          onRetry={() => void issues.refetch()}
        />
      ) : null}
      {issues.data && issueItems.length === 0 ? (
        <ContentEmpty
          align="center"
          icon={CircleDot}
          title="조건에 맞는 이슈가 없습니다"
          description="필터를 바꾸거나 새 이슈를 만들어 보세요."
        />
      ) : null}
      {issueItems.length ? (
        <div>
          <div
            className={cn(
              'text-muted-foreground grid gap-3 border-b px-3 py-2 text-xs font-medium max-md:hidden',
              ISSUE_LIST_GRID_COLUMNS,
            )}
          >
            <span>이슈</span>
            <span>상태</span>
            <span>우선순위</span>
            <span className="max-lg:hidden">현재 팀 작업</span>
            <span>진행률</span>
            <span className="max-xl:hidden">최근 수정</span>
            <span className="max-lg:hidden">다음 행동</span>
          </div>
          <ul>
            {issueItems.map((issue) => (
              <IssueListRow
                key={issue.id}
                issue={issue}
                queryKey={issueQueryKey}
                density={density as 'compact' | 'comfortable'}
              />
            ))}
          </ul>
        </div>
      ) : null}
      {issues.isFetchNextPageError ? (
        <ContentError
          title="다음 이슈를 불러오지 못했습니다"
          description="이미 불러온 이슈는 유지했습니다."
          retryLabel="다시 시도"
          onRetry={() => void issues.fetchNextPage()}
        />
      ) : null}
      {issues.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            disabled={issues.isFetchingNextPage}
            onClick={() => void issues.fetchNextPage()}
          >
            {issues.isFetchingNextPage ? '불러오는 중…' : '이슈 더 보기'}
          </Button>
        </div>
      ) : null}
      {totalCount !== undefined ? (
        <p className="text-muted-foreground text-right text-xs">
          총 {totalCount.toLocaleString('ko-KR')}개
        </p>
      ) : null}
    </section>
  );
}

function IssueSearchInput({
  initialQuery,
  onSubmit,
}: {
  initialQuery: string;
  onSubmit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(initialQuery);

  return (
    <form
      className="relative w-full min-w-56 sm:w-80 sm:flex-none"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(draft.trim());
      }}
    >
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
      <Input
        aria-label="이슈 검색"
        className="hover:bg-muted/50 focus-visible:bg-background h-8 border-transparent bg-transparent pl-8 shadow-none"
        placeholder="표시 ID 또는 제목 검색"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    </form>
  );
}
