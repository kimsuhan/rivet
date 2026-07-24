'use client';

import { ListTodo, Plus, Search, X } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import {
  type TeamWorksControllerGroupsParams,
  type TeamWorksControllerListParams,
  useProjectsControllerList,
  useTeamsControllerList,
  useTeamWorksControllerList,
} from '@rivet/api-client';

import { ContentEmpty } from '@/components/states/content-empty';
import { ContentError } from '@/components/states/content-error';
import { ContentLoading } from '@/components/states/content-loading';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

import { GroupedMyWorkList } from './grouped-issue-lists';
import { IssueFilterMenu } from './issue-filter-menu';
import { IssueListDisplayControls } from './issue-list-display-controls';
import { useTeamWorkPages } from './issue-list-queries';
import { IssueListToolbar } from './issue-list-toolbar';
import {
  MY_WORK_GROUP_OPTIONS,
  MY_WORK_VISIBLE_FIELD_OPTIONS,
  parseCsv,
  serializeCsv,
  visibleFieldsFromSearch,
} from './issue-view-configuration';
import { MyWorkListRow } from './my-work-list-row';
import { SavedViewControls } from './saved-view-controls';
import { TeamWorkListRow } from './team-work-list-row';

const CATEGORY_LABELS = {
  BACKLOG: '백로그',
  UNSTARTED: '시작 전',
  STARTED: '진행 중',
  COMPLETED: '완료',
  CANCELED: '취소',
} as const;
const MY_WORK_CATEGORIES = ['BACKLOG', 'UNSTARTED', 'STARTED'].join(',');

export type IssueListMode = 'my' | 'team';

export function IssueListScreen({ mode, teamKey }: { mode: IssueListMode; teamKey?: string }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  const teams = useTeamsControllerList({ includeArchived: false }, { query: { retry: false } });
  const projects = useProjectsControllerList(
    { limit: 100 },
    { query: { enabled: mode === 'my', retry: false } },
  );
  const selectedTeam = (teams.data?.items ?? []).find(
    (team) => team.key.toUpperCase() === teamKey?.toUpperCase(),
  );
  const category = searchParams.get('stateCategory') ?? (mode === 'my' ? MY_WORK_CATEGORIES : '');
  const categories = parseCsv(category);
  const projectId = searchParams.get('projectId') ?? '';
  const projectIds = parseCsv(projectId);
  const priority = mode === 'my' ? (searchParams.get('priority') ?? '') : '';
  const priorities = parseCsv(priority);
  const teamId = mode === 'my' ? (searchParams.get('teamId') ?? '') : '';
  const teamIds = parseCsv(teamId);
  const workflowStateId = mode === 'my' ? (searchParams.get('workflowStateId') ?? '') : '';
  const workflowStateIds = parseCsv(workflowStateId);
  const query = searchParams.get('query') ?? '';
  const savedViewId = searchParams.get('view');
  const sort = searchParams.get('sort') ?? (mode === 'my' ? 'executionOrder' : 'updatedAt');
  const sortDirection = searchParams.get('sortDirection') ?? 'desc';
  const density = searchParams.get('density') ?? 'comfortable';
  const visibleFieldsParam = searchParams.get('visibleFields');
  const visibleFields = visibleFieldsFromSearch(visibleFieldsParam, 'MY_WORK');
  const groupBy = mode === 'my' ? (searchParams.get('groupBy') ?? '') : '';
  const subGroupBy = mode === 'my' ? (searchParams.get('subGroupBy') ?? '') : '';
  const defaultMyWorkConfiguration = {
    density: 'comfortable',
    sort: 'executionOrder',
    sortDirection: 'desc',
  };
  const myWorkConfiguration = {
    ...(query ? { query } : {}),
    ...(projectId ? { projectId } : {}),
    ...(category && category !== MY_WORK_CATEGORIES ? { stateCategory: category } : {}),
    ...(priority ? { priority } : {}),
    ...(teamId ? { teamId } : {}),
    ...(workflowStateId ? { workflowStateId } : {}),
    sort,
    sortDirection,
    density,
    ...(visibleFieldsParam !== null ? { visibleFields } : {}),
    ...(groupBy ? { groupBy } : {}),
    ...(subGroupBy ? { subGroupBy } : {}),
  };
  const params: TeamWorksControllerListParams = {
    ...(mode === 'my'
      ? { assigneeMembershipId: 'me', stateCategory: category as never }
      : selectedTeam
        ? { teamId: selectedTeam.id }
        : {}),
    ...(projectId ? { projectId } : {}),
    ...(mode === 'team' && category ? { stateCategory: category as never } : {}),
    ...(mode === 'my' && priority ? { priority: priority as never } : {}),
    ...(mode === 'my' && teamId ? { teamId } : {}),
    ...(mode === 'my' && workflowStateId ? { workflowStateId } : {}),
    ...(query ? { query } : {}),
    limit: 50,
    sort: sort as 'executionOrder' | 'priority' | 'createdAt' | 'updatedAt' | 'status',
    sortDirection: sortDirection as 'asc' | 'desc',
  };
  const myWorks = useTeamWorkPages(params, mode === 'my' && !groupBy);
  const teamWorks = useTeamWorksControllerList(params, {
    query: { enabled: mode === 'team' && Boolean(selectedTeam), retry: false },
  });
  const works =
    mode === 'my' ? myWorks.data?.pages.flatMap((page) => page.items) : teamWorks.data?.items;
  const totalCount =
    mode === 'my' ? myWorks.data?.pages[0]?.totalCount : teamWorks.data?.totalCount;
  const title = mode === 'my' ? '내 작업' : (selectedTeam?.name ?? teamKey ?? '팀 작업');

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

  const pending =
    teams.isPending || (mode === 'my' ? !groupBy && myWorks.isPending : teamWorks.isPending);
  const errored =
    teams.isError || (mode === 'my' ? !groupBy && myWorks.isError : teamWorks.isError);
  const selectedCategory = mode === 'my' && category === MY_WORK_CATEGORIES ? '' : category;
  const projectNames = new Map(
    (projects.data?.items ?? []).map((project) => [project.id, project.name]),
  );
  const activeFilterCount =
    mode === 'my'
      ? Number(projectIds.length > 0) +
        Number(Boolean(selectedCategory)) +
        Number(priorities.length > 0) +
        Number(teamIds.length > 0) +
        Number(workflowStateIds.length > 0)
      : Number(Boolean(selectedCategory));
  return (
    <section className="mx-auto max-w-[1440px] space-y-5" aria-labelledby="team-work-list-title">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-baseline gap-2">
            <h1 id="team-work-list-title" className="text-2xl font-semibold tracking-tight">
              {title}
            </h1>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            {mode === 'my' ? '내가 맡은 미완료 작업' : '이슈에 연결된 현재 실행 단위입니다.'}
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
      {mode === 'my' ? (
        <SavedViewControls
          resourceType="MY_WORK"
          configuration={myWorkConfiguration}
          defaultConfiguration={defaultMyWorkConfiguration}
          toolbar={
            <IssueListToolbar
              activeFilterCount={activeFilterCount}
              filterTitle="내 작업 필터"
              query={query}
              searchOpen={searchOpen}
              onSearchOpenChange={setSearchOpen}
              filterContent={
                <>
                  <IssueFilterMenu
                    emptyLabel="선택할 상태가 없습니다."
                    label="상태"
                    onChange={(values) => {
                      const serialized = serializeCsv(values);
                      replace(
                        'stateCategory',
                        serialized === serializeCsv(parseCsv(MY_WORK_CATEGORIES)) ? '' : serialized,
                      );
                    }}
                    options={Object.entries(CATEGORY_LABELS).map(([id, label]) => ({ id, label }))}
                    selected={categories}
                    variant="compact"
                  />
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
                  {activeFilterCount ? (
                    <Button
                      className="w-full"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        replaceMany({
                          priority: '',
                          projectId: '',
                          stateCategory: '',
                          teamId: '',
                          workflowStateId: '',
                        })
                      }
                    >
                      필터 초기화
                    </Button>
                  ) : null}
                </>
              }
              sortAndViewControls={
                <IssueListDisplayControls
                  density={density}
                  fieldOptions={MY_WORK_VISIBLE_FIELD_OPTIONS}
                  groupBy={groupBy}
                  groupOptions={MY_WORK_GROUP_OPTIONS}
                  sort={sort}
                  sortDirection={sortDirection}
                  sortLabel="내 작업 정렬 기준"
                  sortOptions={[
                    { label: '실행 순서', value: 'executionOrder' },
                    { label: '우선순위', value: 'priority' },
                    { label: '생성일', value: 'createdAt' },
                    { label: '최근 수정일', value: 'updatedAt' },
                  ]}
                  onSortChange={(value) => replace('sort', value)}
                  onSortDirectionChange={(value) => replace('sortDirection', value)}
                  onDensityChange={(value) => replace('density', value)}
                  onGroupingChange={(groupBy, subGroupBy) => replaceMany({ groupBy, subGroupBy })}
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
            query || projectId || selectedCategory || priority || teamId || workflowStateId ? (
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
                {selectedCategory ? (
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => replace('stateCategory', '')}
                  >
                    상태:{' '}
                    {categories.length === 1
                      ? (CATEGORY_LABELS[categories[0] as keyof typeof CATEGORY_LABELS] ??
                        categories[0])
                      : `${categories.length}개`}
                    <X data-icon="inline-end" aria-label="상태 필터 제거" />
                  </Button>
                ) : null}
                {priority ? (
                  <Button size="xs" variant="secondary" onClick={() => replace('priority', '')}>
                    우선순위: {priorities.length}개 조건
                    <X data-icon="inline-end" aria-label="우선순위 필터 제거" />
                  </Button>
                ) : null}
                {teamId ? (
                  <Button size="xs" variant="secondary" onClick={() => replace('teamId', '')}>
                    팀: {teamIds.length}개 조건
                    <X data-icon="inline-end" aria-label="팀 필터 제거" />
                  </Button>
                ) : null}
                {workflowStateId ? (
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => replace('workflowStateId', '')}
                  >
                    워크플로 상태: {workflowStateIds.length}개 조건
                    <X data-icon="inline-end" aria-label="워크플로 상태 필터 제거" />
                  </Button>
                ) : null}
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    replaceMany({
                      priority: '',
                      projectId: '',
                      query: '',
                      stateCategory: '',
                      teamId: '',
                      workflowStateId: '',
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
                  '저장된 보기의 프로젝트가 보관되었거나 접근 권한이 없습니다. 필터를 수정한 뒤 보기를 다시 저장하세요.',
              }
            : {})}
        >
          {searchOpen ? (
            <WorkSearchInput
              key={query}
              autoFocus
              initialQuery={query}
              mode={mode}
              onSubmit={(value) => {
                replace('query', value);
                setSearchOpen(false);
              }}
            />
          ) : null}
        </SavedViewControls>
      ) : (
        <div className="flex flex-col gap-3 border-b pb-3">
          <div className="flex min-h-8 min-w-0 items-center justify-end gap-1">
            {searchOpen ? (
              <div className="mr-auto min-w-0">
                <WorkSearchInput
                  key={query}
                  autoFocus
                  initialQuery={query}
                  mode={mode}
                  onSubmit={(value) => {
                    replace('query', value);
                    setSearchOpen(false);
                  }}
                />
              </div>
            ) : null}
            <IssueListToolbar
              activeFilterCount={activeFilterCount}
              filterTitle="팀 작업 필터"
              query={query}
              searchOpen={searchOpen}
              onSearchOpenChange={setSearchOpen}
              filterContent={
                <>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-muted-foreground text-xs">상태</span>
                    <Select
                      items={[
                        { label: '모든 상태', value: '' },
                        ...Object.entries(CATEGORY_LABELS).map(([value, label]) => ({
                          label,
                          value,
                        })),
                      ]}
                      value={selectedCategory}
                      onValueChange={(value) => replace('stateCategory', value ?? '')}
                    >
                      <SelectTrigger className="w-full" size="sm" aria-label="작업 상태 필터">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="">모든 상태</SelectItem>
                          {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>
                  {selectedCategory ? (
                    <Button
                      className="w-full"
                      size="sm"
                      variant="ghost"
                      onClick={() => replace('stateCategory', '')}
                    >
                      필터 초기화
                    </Button>
                  ) : null}
                </>
              }
              sortAndViewControls={
                <IssueListDisplayControls
                  density={density}
                  sort={sort}
                  sortDirection={sortDirection}
                  sortLabel="팀 작업 정렬 기준"
                  sortOptions={[
                    { label: '우선순위', value: 'priority' },
                    { label: '생성일', value: 'createdAt' },
                    { label: '최근 수정일', value: 'updatedAt' },
                    { label: '상태', value: 'status' },
                  ]}
                  onSortChange={(value) => replace('sort', value)}
                  onSortDirectionChange={(value) => replace('sortDirection', value)}
                  onDensityChange={(value) => replace('density', value)}
                />
              }
            />
          </div>
          {query || selectedCategory ? (
            <div className="flex flex-wrap items-center gap-2">
              {query ? (
                <Button size="xs" variant="secondary" onClick={() => replace('query', '')}>
                  검색: {query}
                  <X data-icon="inline-end" aria-label="검색어 제거" />
                </Button>
              ) : null}
              {selectedCategory ? (
                <Button size="xs" variant="secondary" onClick={() => replace('stateCategory', '')}>
                  상태:{' '}
                  {CATEGORY_LABELS[selectedCategory as keyof typeof CATEGORY_LABELS] ??
                    selectedCategory}
                  <X data-icon="inline-end" aria-label="상태 필터 제거" />
                </Button>
              ) : null}
              <Button
                size="xs"
                variant="ghost"
                onClick={() => replaceMany({ query: '', stateCategory: '' })}
              >
                모두 지우기
              </Button>
            </div>
          ) : null}
        </div>
      )}
      {pending ? <ContentLoading label="팀 작업을 불러오는 중입니다" /> : null}
      {errored ? (
        <ContentError
          title="팀 작업을 불러오지 못했습니다"
          description="잠시 후 다시 시도해 주세요."
          retryLabel="다시 시도"
          onRetry={() => {
            void teams.refetch();
            void (mode === 'my' ? myWorks.refetch() : teamWorks.refetch());
          }}
        />
      ) : null}
      {mode === 'team' && teams.data && !selectedTeam ? (
        <ContentEmpty
          icon={ListTodo}
          title="팀을 찾을 수 없습니다"
          description="팀 주소를 확인해 주세요."
        />
      ) : null}
      {mode === 'my' && groupBy ? (
        <GroupedMyWorkList
          baseParams={params}
          density={density as 'compact' | 'comfortable'}
          groupBy={groupBy as TeamWorksControllerGroupsParams['groupBy']}
          savedViewId={savedViewId}
          {...(subGroupBy
            ? { subGroupBy: subGroupBy as TeamWorksControllerGroupsParams['subGroupBy'] }
            : {})}
          visibleFields={visibleFields}
        />
      ) : null}
      {!groupBy && works?.length === 0 ? (
        <ContentEmpty
          icon={ListTodo}
          title={
            mode === 'my'
              ? query ||
                projectId ||
                priority ||
                teamId ||
                workflowStateId ||
                searchParams.get('stateCategory')
                ? '조건에 맞는 작업이 없습니다'
                : '현재 할당된 작업이 없습니다'
              : '표시할 팀 작업이 없습니다'
          }
          description={
            mode === 'my'
              ? '담당자로 지정된 미완료 작업이 없습니다.'
              : '이슈에서 이 팀의 작업을 시작하면 여기에 표시됩니다.'
          }
        >
          {mode === 'my' ? (
            <Link href={`${pathname}?create=1`} className={buttonVariants({ size: 'sm' })}>
              이슈 만들기
            </Link>
          ) : null}
        </ContentEmpty>
      ) : null}
      {!groupBy && works?.length ? (
        mode === 'my' ? (
          <ul className="!-mt-3">
            {works.map((work) => (
              <MyWorkListRow
                key={work.id}
                work={work}
                density={density as 'compact' | 'comfortable'}
                savedViewId={savedViewId}
                visibleFields={visibleFields}
              />
            ))}
          </ul>
        ) : (
          <ul className="!-mt-3">
            {works.map((work) => (
              <TeamWorkListRow
                key={work.id}
                work={work}
                density={density as 'compact' | 'comfortable'}
              />
            ))}
          </ul>
        )
      ) : null}
      {mode === 'my' && !groupBy && myWorks.hasNextPage ? (
        <Button
          disabled={myWorks.isFetchingNextPage}
          onClick={() => void myWorks.fetchNextPage()}
          variant="outline"
        >
          {myWorks.isFetchingNextPage ? '불러오는 중' : '작업 더 불러오기'}
        </Button>
      ) : null}
      {!groupBy && totalCount !== undefined ? (
        <p className="text-muted-foreground text-right text-xs">
          총 {totalCount.toLocaleString('ko-KR')}개
        </p>
      ) : null}
    </section>
  );
}

function WorkSearchInput({
  autoFocus = false,
  initialQuery,
  mode,
  onSubmit,
}: {
  autoFocus?: boolean;
  initialQuery: string;
  mode: IssueListMode;
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
        aria-label={mode === 'my' ? '내 작업 검색' : '팀 작업 검색'}
        autoFocus={autoFocus}
        className="hover:bg-muted/50 focus-visible:bg-background h-8 border-transparent bg-transparent pl-8 shadow-none"
        placeholder={
          mode === 'my' ? '작업 코드, 이슈 또는 프로젝트 검색' : '작업 ID 또는 이슈 제목 검색'
        }
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    </form>
  );
}
