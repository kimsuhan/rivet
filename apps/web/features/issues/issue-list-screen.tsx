'use client';

import { Filter, ListTodo, Plus, Search } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { useTeamsControllerList, useTeamWorksControllerList } from '@rivet/api-client';

import { ContentEmpty } from '@/components/states/content-empty';
import { ContentError } from '@/components/states/content-error';
import { ContentLoading } from '@/components/states/content-loading';
import { buttonVariants } from '@/components/ui/button';
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

import { TeamWorkListRow } from './team-work-list-row';

const CATEGORY_LABELS = {
  BACKLOG: '백로그',
  UNSTARTED: '시작 전',
  STARTED: '진행 중',
  COMPLETED: '완료',
  CANCELED: '취소',
} as const;

export type IssueListMode = 'my' | 'team';

export function IssueListScreen({ mode, teamKey }: { mode: IssueListMode; teamKey?: string }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const teams = useTeamsControllerList({ includeArchived: false }, { query: { retry: false } });
  const selectedTeam = (teams.data?.items ?? []).find(
    (team) => team.key.toUpperCase() === teamKey?.toUpperCase(),
  );
  const category = searchParams.get('stateCategory') ?? '';
  const query = searchParams.get('query') ?? '';
  const [draft, setDraft] = useState(query);
  const works = useTeamWorksControllerList(
    {
      ...(mode === 'my'
        ? { assigneeMembershipId: 'me' }
        : selectedTeam
          ? { teamId: selectedTeam.id }
          : {}),
      ...(category ? { stateCategory: category as never } : {}),
      ...(query ? { query } : {}),
      sort: 'updatedAt',
      sortDirection: 'desc',
    },
    { query: { enabled: mode === 'my' || Boolean(selectedTeam), retry: false } },
  );
  const title = mode === 'my' ? '내 작업' : (selectedTeam?.name ?? teamKey ?? '팀 작업');

  function replace(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`${pathname}${next.size ? `?${next.toString()}` : ''}`, { scroll: false });
  }

  return (
    <section className="mx-auto max-w-7xl space-y-5" aria-labelledby="team-work-list-title">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 id="team-work-list-title" className="text-2xl font-semibold tracking-tight">
            {title}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">이슈에 연결된 현재 실행 단위입니다.</p>
        </div>
        <Link
          href="/issues?create=1"
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-2')}
        >
          <Plus className="size-4" />
          이슈 만들기
        </Link>
      </header>
      <div className="border-b pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <form
            className="relative min-w-56 flex-1 sm:max-w-sm"
            onSubmit={(event) => {
              event.preventDefault();
              replace('query', draft.trim());
            }}
          >
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              aria-label="팀 작업 검색"
              className="hover:bg-muted/50 focus-visible:bg-background h-8 border-transparent bg-transparent pl-8 shadow-none"
              placeholder="작업 ID 또는 이슈 제목 검색"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </form>
          <Filter className="text-muted-foreground size-4" aria-hidden="true" />
          <Select
            items={[
              { label: '모든 상태', value: '' },
              ...Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ label, value })),
            ]}
            value={category}
            onValueChange={(value) => replace('stateCategory', value ?? '')}
          >
            <SelectTrigger size="sm" aria-label="작업 상태 필터">
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
      </div>
      {teams.isPending || works.isPending ? (
        <ContentLoading label="팀 작업을 불러오는 중입니다" />
      ) : null}
      {teams.isError || works.isError ? (
        <ContentError
          title="팀 작업을 불러오지 못했습니다"
          description="잠시 후 다시 시도해 주세요."
          retryLabel="다시 시도"
          onRetry={() => {
            void teams.refetch();
            void works.refetch();
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
      {works.data?.items.length === 0 ? (
        <ContentEmpty
          icon={ListTodo}
          title="표시할 팀 작업이 없습니다"
          description={
            mode === 'my'
              ? '담당자로 지정된 팀 작업이 없습니다.'
              : '이슈에서 이 팀의 작업을 시작하면 여기에 표시됩니다.'
          }
        />
      ) : null}
      {works.data?.items.length ? (
        <div>
          <div className="text-muted-foreground grid grid-cols-[7.5rem_minmax(16rem,1fr)_11rem_8.5rem_9.5rem_7.5rem_9rem_5rem] gap-3 border-b px-3 py-2 text-xs font-medium max-xl:grid-cols-[7.5rem_minmax(16rem,1fr)_11rem_8.5rem_9.5rem_7.5rem_6rem] max-lg:grid-cols-[7.5rem_minmax(16rem,1fr)_8.5rem_9.5rem_7.5rem] max-md:hidden">
            <span>팀 작업</span>
            <span>상위 이슈</span>
            <span className="max-lg:hidden">프로젝트 · 역할 · 팀</span>
            <span>상태</span>
            <span>담당자</span>
            <span className="max-lg:hidden">우선순위</span>
            <span>주요 행동</span>
            <span className="max-xl:hidden">최근 수정</span>
          </div>
          <ul>
            {works.data.items.map((work) => (
              <TeamWorkListRow key={work.id} work={work} />
            ))}
          </ul>
        </div>
      ) : null}
      {works.data ? (
        <p className="text-muted-foreground text-right text-xs">
          총 {works.data.totalCount.toLocaleString('ko-KR')}개
        </p>
      ) : null}
    </section>
  );
}
