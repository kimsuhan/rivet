'use client';

import { ArrowDownUp, Filter, ListTodo, Plus, Search, X } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import {
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

import { IssueListDisplayControls } from './issue-list-display-controls';
import { useTeamWorkPages } from './issue-list-queries';
import { MY_WORK_GRID_COLUMNS, MyWorkListRow } from './my-work-list-row';
import { SavedViewControls } from './saved-view-controls';
import { TEAM_WORK_GRID_COLUMNS, TeamWorkListRow } from './team-work-list-row';

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
  const teams = useTeamsControllerList({ includeArchived: false }, { query: { retry: false } });
  const projects = useProjectsControllerList(
    { limit: 100 },
    { query: { enabled: mode === 'my', retry: false } },
  );
  const selectedTeam = (teams.data?.items ?? []).find(
    (team) => team.key.toUpperCase() === teamKey?.toUpperCase(),
  );
  const category = searchParams.get('stateCategory') ?? (mode === 'my' ? MY_WORK_CATEGORIES : '');
  const projectId = searchParams.get('projectId') ?? '';
  const query = searchParams.get('query') ?? '';
  const sort = searchParams.get('sort') ?? (mode === 'my' ? 'executionOrder' : 'updatedAt');
  const sortDirection = searchParams.get('sortDirection') ?? 'desc';
  const density = searchParams.get('density') ?? 'comfortable';
  const defaultMyWorkConfiguration = {
    density: 'comfortable',
    sort: 'executionOrder',
    sortDirection: 'desc',
  };
  const myWorkConfiguration = {
    ...(query ? { query } : {}),
    ...(projectId ? { projectId } : {}),
    ...(category && category !== MY_WORK_CATEGORIES ? { stateCategory: category } : {}),
    sort,
    sortDirection,
    density,
  };
  const params: TeamWorksControllerListParams = {
    ...(mode === 'my'
      ? { assigneeMembershipId: 'me', stateCategory: category as never }
      : selectedTeam
        ? { teamId: selectedTeam.id }
        : {}),
    ...(projectId ? { projectId } : {}),
    ...(mode === 'team' && category ? { stateCategory: category as never } : {}),
    ...(query ? { query } : {}),
    limit: 50,
    sort: sort as 'executionOrder' | 'priority' | 'createdAt' | 'updatedAt' | 'status',
    sortDirection: sortDirection as 'asc' | 'desc',
  };
  const myWorks = useTeamWorkPages(params, mode === 'my');
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

  function reset() {
    router.push(pathname, { scroll: false });
  }

  const pending = teams.isPending || (mode === 'my' ? myWorks.isPending : teamWorks.isPending);
  const errored = teams.isError || (mode === 'my' ? myWorks.isError : teamWorks.isError);
  const selectedCategory = mode === 'my' && category === MY_WORK_CATEGORIES ? '' : category;
  const activeProjectName = projects.data?.items.find((project) => project.id === projectId)?.name;
  const activeFilterCount = Number(Boolean(projectId)) + Number(Boolean(selectedCategory));
  return (
    <section className="mx-auto max-w-[1440px] space-y-5" aria-labelledby="team-work-list-title">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-baseline gap-2">
            <h1 id="team-work-list-title" className="text-2xl font-semibold tracking-tight">
              {title}
            </h1>
            {mode === 'my' && totalCount !== undefined ? (
              <span className="text-muted-foreground text-sm">
                {totalCount.toLocaleString('ko-KR')}
              </span>
            ) : null}
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            {mode === 'my' ? '내가 맡은 미완료 작업' : '이슈에 연결된 현재 실행 단위입니다.'}
          </p>
        </div>
        <Link
          href="/issues?create=1"
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-2')}
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
          activeFilters={
            query || projectId || selectedCategory ? (
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
                {selectedCategory ? (
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => replace('stateCategory', '')}
                  >
                    상태:{' '}
                    {CATEGORY_LABELS[selectedCategory as keyof typeof CATEGORY_LABELS] ??
                      selectedCategory}
                    <X data-icon="inline-end" aria-label="상태 필터 제거" />
                  </Button>
                ) : null}
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => replaceMany({ projectId: '', query: '', stateCategory: '' })}
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
          <WorkSearchInput
            key={query}
            initialQuery={query}
            mode={mode}
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
              <PopoverTitle className="text-sm">내 작업 필터</PopoverTitle>
              <div className="flex flex-col gap-1.5">
                <span className="text-muted-foreground text-xs">상태</span>
                <Select
                  items={[
                    { label: '모든 상태', value: '' },
                    ...Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ label, value })),
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
              {activeFilterCount ? (
                <Button
                  className="w-full"
                  size="sm"
                  variant="ghost"
                  onClick={() => replaceMany({ projectId: '', stateCategory: '' })}
                >
                  필터 초기화
                </Button>
              ) : null}
            </PopoverContent>
          </Popover>
          <IssueListDisplayControls
            density={density}
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
          />
        </SavedViewControls>
      ) : (
        <div className="border-b pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <WorkSearchInput
              key={query}
              initialQuery={query}
              mode={mode}
              onSubmit={(value) => replace('query', value)}
            />
            <Select
              items={[
                { label: '모든 상태', value: '' },
                ...Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ label, value })),
              ]}
              value={category}
              onValueChange={(value) => replace('stateCategory', value ?? '')}
            >
              <SelectTrigger size="sm" aria-label="작업 상태 필터">
                <Filter data-icon="inline-start" />
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
            <Select
              items={['priority', 'createdAt', 'updatedAt', 'status'].map((value) => ({
                value,
                label:
                  {
                    priority: '우선순위',
                    createdAt: '생성일',
                    updatedAt: '최근 수정일',
                    status: '상태',
                  }[value] ?? value,
              }))}
              value={sort}
              onValueChange={(value) => replace('sort', value ?? '')}
            >
              <SelectTrigger size="sm" aria-label="정렬 기준">
                <ArrowDownUp data-icon="inline-start" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {['priority', 'createdAt', 'updatedAt', 'status'].map((value) => (
                    <SelectItem key={value} value={value}>
                      {
                        {
                          priority: '우선순위',
                          createdAt: '생성일',
                          updatedAt: '최근 수정일',
                          status: '상태',
                        }[value]
                      }
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button
              aria-label={sortDirection === 'desc' ? '내림차순 정렬' : '오름차순 정렬'}
              onClick={() => replace('sortDirection', sortDirection === 'desc' ? 'asc' : 'desc')}
              size="sm"
              variant="ghost"
            >
              {sortDirection === 'desc' ? '↓' : '↑'}
            </Button>
            {query ||
            searchParams.get('stateCategory') ||
            searchParams.get('sort') ||
            searchParams.get('sortDirection') ? (
              <Button onClick={reset} size="sm" variant="ghost">
                초기화
              </Button>
            ) : null}
          </div>
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
      {works?.length === 0 ? (
        <ContentEmpty
          icon={ListTodo}
          title={
            mode === 'my'
              ? query || projectId || searchParams.get('stateCategory')
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
            <Link href="/issues?create=1" className={buttonVariants({ size: 'sm' })}>
              이슈 만들기
            </Link>
          ) : null}
        </ContentEmpty>
      ) : null}
      {works?.length ? (
        <div>
          <div
            className={cn(
              'text-muted-foreground grid gap-3 border-b px-3 py-2 text-xs font-medium max-md:hidden',
              mode === 'my' ? MY_WORK_GRID_COLUMNS : TEAM_WORK_GRID_COLUMNS,
            )}
          >
            {mode === 'my' ? (
              <>
                <span>우선순위</span>
                <span>작업</span>
                <span>프로젝트</span>
                <span>상태</span>
                <span />
              </>
            ) : (
              <>
                <span>팀 작업</span>
                <span>상위 이슈</span>
                <span className="max-lg:hidden">프로젝트 · 역할 · 팀</span>
                <span>상태</span>
                <span>담당자</span>
                <span className="max-lg:hidden">우선순위</span>
                <span>주요 행동</span>
                <span className="max-xl:hidden">업데이트</span>
              </>
            )}
          </div>
          <ul>
            {works.map((work) =>
              mode === 'my' ? (
                <MyWorkListRow
                  key={work.id}
                  work={work}
                  density={density as 'compact' | 'comfortable'}
                />
              ) : (
                <TeamWorkListRow
                  key={work.id}
                  work={work}
                  density={density as 'compact' | 'comfortable'}
                />
              ),
            )}
          </ul>
        </div>
      ) : null}
      {mode === 'my' && myWorks.hasNextPage ? (
        <Button
          disabled={myWorks.isFetchingNextPage}
          onClick={() => void myWorks.fetchNextPage()}
          variant="outline"
        >
          {myWorks.isFetchingNextPage ? '불러오는 중' : '작업 더 불러오기'}
        </Button>
      ) : null}
    </section>
  );
}

function WorkSearchInput({
  initialQuery,
  mode,
  onSubmit,
}: {
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
        className="hover:bg-muted/50 focus-visible:bg-background h-10 border-transparent bg-transparent pl-8 shadow-none"
        placeholder={
          mode === 'my' ? '작업 코드, 이슈 또는 프로젝트 검색' : '작업 ID 또는 이슈 제목 검색'
        }
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    </form>
  );
}
