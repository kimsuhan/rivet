'use client';

import { CircleDot, Plus, Search, X } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { type IssuesControllerGroupsParams, useProjectsControllerList } from '@rivet/api-client';

import { ContentEmpty } from '@/components/states/content-empty';
import { ContentError } from '@/components/states/content-error';
import { ContentLoading } from '@/components/states/content-loading';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

import { GroupedIssueList } from './grouped-issue-lists';
import { IssueAssigneeFilter } from './issue-assignee-filter';
import { IssueFilterMenu } from './issue-filter-menu';
import { getIssuePagesQueryKey, useIssuePages } from './issue-list-queries';
import { IssueListRow } from './issue-list-row';
import { IssueListToolbar } from './issue-list-toolbar';
import { issueSortsFromSearchParams, serializeIssueSorts } from './issue-multi-sort';
import { IssueMultiSortControls } from './issue-multi-sort-controls';
import {
  ISSUE_GROUP_OPTIONS,
  ISSUE_VISIBLE_FIELD_OPTIONS,
  parseCsv,
  serializeCsv,
  visibleFieldsFromSearch,
} from './issue-view-configuration';
import { issueWorkHref } from './issue-work-routing';
import { SavedViewControls } from './saved-view-controls';

const STATUS_LABELS = {
  UNSORTED: '접수됨',
  TODO: '할 일',
  IN_PROGRESS: '진행 중',
  REVIEW: '배포 대기',
  DONE: '완료',
  PAUSED: '일시 중지',
  CANCELED: '취소',
} as const;

export function FeatureIssueListScreen() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  const query = searchParams.get('query') ?? '';
  const savedViewId = searchParams.get('view');
  const projectId = searchParams.get('projectId') ?? '';
  const projectIds = parseCsv(projectId);
  const status = searchParams.get('status') ?? '';
  const statuses = parseCsv(status);
  const assigneeMembershipId = searchParams.get('assigneeMembershipId') ?? '';
  const assigneeMembershipIds = parseCsv(assigneeMembershipId);
  const unassigned = searchParams.get('unassigned') === 'true';
  const sorts = issueSortsFromSearchParams(searchParams);
  const serializedSorts = serializeIssueSorts(sorts);
  const density = searchParams.get('density') ?? 'comfortable';
  const visibleFieldsParam = searchParams.get('visibleFields');
  const visibleFields = visibleFieldsFromSearch(visibleFieldsParam, 'ISSUES');
  const groupBy = searchParams.get('groupBy') ?? '';
  const subGroupBy = searchParams.get('subGroupBy') ?? '';
  const defaultConfiguration = {
    density: 'comfortable',
    sorts: [{ direction: 'desc', field: 'updatedAt' }],
  };
  const viewConfiguration = {
    ...(query ? { query } : {}),
    ...(projectId ? { projectId } : {}),
    ...(status ? { status } : {}),
    ...(assigneeMembershipId ? { assigneeMembershipId } : {}),
    ...(unassigned ? { unassigned: 'true' } : {}),
    sorts,
    density,
    ...(visibleFieldsParam !== null ? { visibleFields } : {}),
    ...(groupBy ? { groupBy } : {}),
    ...(subGroupBy ? { subGroupBy } : {}),
  };
  const issueParams = {
    ...(projectId ? { projectId } : {}),
    ...(query ? { query } : {}),
    ...(status ? { status: status as never } : {}),
    ...(assigneeMembershipId ? { assigneeMembershipId } : {}),
    ...(unassigned ? { unassigned: 'true' as const } : {}),
    sorts: serializedSorts,
  };
  const issues = useIssuePages(issueParams, !groupBy);
  const issueQueryKey = getIssuePagesQueryKey(issueParams);
  const issueItems = issues.data?.pages.flatMap((page) => page.items) ?? [];
  const totalCount = issues.data?.pages[0]?.totalCount;
  const projects = useProjectsControllerList(
    { includeArchived: false, sort: 'updatedAt', sortDirection: 'desc' },
    { query: { retry: false } },
  );
  const projectNames = new Map(
    (projects.data?.items ?? []).map((project) => [project.id, project.name]),
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

  const activeFilterCount =
    Number(projectIds.length > 0) +
    Number(statuses.length > 0) +
    Number(assigneeMembershipIds.length > 0 || unassigned);

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
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-2 md:hidden')}
        >
          <Plus className="size-4" />
          이슈 만들기
        </Link>
      </header>
      <SavedViewControls
        resourceType="ISSUES"
        configuration={viewConfiguration}
        defaultConfiguration={defaultConfiguration}
        toolbar={
          <IssueListToolbar
            activeFilterCount={activeFilterCount}
            filterTitle="이슈 필터"
            query={query}
            searchOpen={searchOpen}
            onSearchOpenChange={setSearchOpen}
            filterContent={
              <>
                <IssueFilterMenu
                  emptyLabel="선택할 프로젝트가 없습니다."
                  label="프로젝트"
                  onChange={(values) => replace('projectId', serializeCsv(values))}
                  options={(projects.data?.items ?? []).map((project) => ({
                    id: project.id,
                    label: project.name,
                  }))}
                  selected={projectIds}
                  variant="compact"
                />
                <IssueFilterMenu
                  emptyLabel="선택할 상태가 없습니다."
                  label="상태"
                  onChange={(values) => replace('status', serializeCsv(values))}
                  options={Object.entries(STATUS_LABELS).map(([id, label]) => ({ id, label }))}
                  selected={statuses}
                  variant="compact"
                />
                <IssueAssigneeFilter
                  selected={{ membershipIds: assigneeMembershipIds, unassigned }}
                  onChange={(selection) =>
                    replaceMany({
                      assigneeMembershipId: serializeCsv(selection.membershipIds),
                      unassigned: selection.unassigned ? 'true' : '',
                    })
                  }
                />
                {activeFilterCount ? (
                  <Button
                    className="w-full"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      replaceMany({
                        assigneeMembershipId: '',
                        projectId: '',
                        status: '',
                        unassigned: '',
                      })
                    }
                  >
                    필터 초기화
                  </Button>
                ) : null}
              </>
            }
            sortAndViewControls={
              <IssueMultiSortControls
                density={density}
                fieldOptions={ISSUE_VISIBLE_FIELD_OPTIONS}
                groupBy={groupBy}
                groupOptions={ISSUE_GROUP_OPTIONS}
                sorts={sorts}
                onSortsChange={(value) =>
                  replaceMany({
                    sort: '',
                    sortDirection: '',
                    sorts: serializeIssueSorts(value),
                  })
                }
                onDensityChange={(value) => replace('density', value)}
                onGroupByChange={(value) => replace('groupBy', value)}
                onSubGroupByChange={(value) => replace('subGroupBy', value)}
                onVisibleFieldsChange={(value) =>
                  replace('visibleFields', serializeCsv(value) || 'none')
                }
                subGroupBy={subGroupBy}
                visibleFields={visibleFields}
              />
            }
          />
        }
        activeFilters={
          query || projectId || status || assigneeMembershipId || unassigned ? (
            <>
              {query ? (
                <Button size="xs" variant="secondary" onClick={() => replace('query', '')}>
                  검색: {query}
                  <X data-icon="inline-end" aria-label="검색어 제거" />
                </Button>
              ) : null}
              {projectId ? (
                <Button size="xs" variant="secondary" onClick={() => replace('projectId', '')}>
                  프로젝트:{' '}
                  {projectIds.length === 1
                    ? (projectNames.get(projectIds[0]!) ?? '접근할 수 없음')
                    : `${projectIds.length}개`}
                  <X data-icon="inline-end" aria-label="프로젝트 필터 제거" />
                </Button>
              ) : null}
              {status ? (
                <Button size="xs" variant="secondary" onClick={() => replace('status', '')}>
                  상태:{' '}
                  {statuses.length === 1
                    ? (STATUS_LABELS[statuses[0] as keyof typeof STATUS_LABELS] ?? statuses[0])
                    : `${statuses.length}개`}
                  <X data-icon="inline-end" aria-label="상태 필터 제거" />
                </Button>
              ) : null}
              {assigneeMembershipId || unassigned ? (
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => replaceMany({ assigneeMembershipId: '', unassigned: '' })}
                >
                  담당자: {assigneeMembershipIds.length + Number(unassigned)}개 조건
                  <X data-icon="inline-end" aria-label="담당자 필터 제거" />
                </Button>
              ) : null}
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  replaceMany({
                    assigneeMembershipId: '',
                    projectId: '',
                    query: '',
                    status: '',
                    unassigned: '',
                  })
                }
              >
                모두 지우기
              </Button>
            </>
          ) : undefined
        }
        {...(projectIds.length && projects.data && projectIds.some((id) => !projectNames.has(id))
          ? {
              staleValueMessage:
                '저장된 보기의 프로젝트 일부가 보관되었거나 접근 권한이 없습니다. 필터를 수정한 뒤 보기를 다시 저장하세요.',
            }
          : {})}
      >
        {searchOpen ? (
          <IssueSearchInput
            key={query}
            initialQuery={query}
            onSubmit={(value) => {
              replace('query', value);
              setSearchOpen(false);
            }}
          />
        ) : null}
      </SavedViewControls>
      {groupBy ? (
        <GroupedIssueList
          baseParams={issueParams}
          density={density as 'compact' | 'comfortable'}
          groupBy={groupBy as IssuesControllerGroupsParams['groupBy']}
          savedViewId={savedViewId}
          {...(subGroupBy
            ? { subGroupBy: subGroupBy as IssuesControllerGroupsParams['subGroupBy'] }
            : {})}
          visibleFields={visibleFields}
        />
      ) : null}
      {!groupBy && issues.isPending ? <ContentLoading label="이슈를 불러오는 중입니다" /> : null}
      {!groupBy && issues.isError && !issues.data ? (
        <ContentError
          title="이슈를 불러오지 못했습니다"
          description="입력한 필터는 유지했습니다."
          retryLabel="다시 시도"
          onRetry={() => void issues.refetch()}
        />
      ) : null}
      {!groupBy && issues.data && issueItems.length === 0 ? (
        <ContentEmpty
          align="center"
          icon={CircleDot}
          title="조건에 맞는 이슈가 없습니다"
          description="필터를 바꾸거나 새 이슈를 만들어 보세요."
        />
      ) : null}
      {!groupBy && issueItems.length ? (
        <ul className="!-mt-3">
          {issueItems.map((issue) => (
            <IssueListRow
              key={issue.id}
              detailHref={issueWorkHref(issue.identifier, undefined, savedViewId)}
              issue={issue}
              queryKey={issueQueryKey}
              density={density as 'compact' | 'comfortable'}
              visibleFields={visibleFields}
            />
          ))}
        </ul>
      ) : null}
      {!groupBy && issues.isFetchNextPageError ? (
        <ContentError
          title="다음 이슈를 불러오지 못했습니다"
          description="이미 불러온 이슈는 유지했습니다."
          retryLabel="다시 시도"
          onRetry={() => void issues.fetchNextPage()}
        />
      ) : null}
      {!groupBy && issues.hasNextPage ? (
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
      {!groupBy && totalCount !== undefined ? (
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
        autoFocus
        className="hover:bg-muted/50 focus-visible:bg-background h-8 border-transparent bg-transparent pl-8 shadow-none"
        placeholder="표시 ID 또는 제목 검색"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    </form>
  );
}
