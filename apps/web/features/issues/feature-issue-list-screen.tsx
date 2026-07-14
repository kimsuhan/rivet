'use client';

import { CircleDot, Filter, Plus, Search } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { useIssuesControllerList, useProjectsControllerList } from '@rivet/api-client';

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

import { IssueListRow } from './issue-list-row';

const STATUS_LABELS = { UNSORTED: '접수됨', TODO: '할 일', IN_PROGRESS: '진행 중', REVIEW: '완료 확인', DONE: '완료', PAUSED: '일시 중지', CANCELED: '취소' } as const;

export function FeatureIssueListScreen() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const query = searchParams.get('query') ?? '';
  const projectId = searchParams.get('projectId') ?? '';
  const status = searchParams.get('status') ?? '';
  const [draft, setDraft] = useState(query);
  const issues = useIssuesControllerList({ ...(projectId ? { projectId } : {}), ...(query ? { query } : {}), ...(status ? { status: status as never } : {}), sort: 'updatedAt', sortDirection: 'desc' }, { query: { retry: false } });
  const projects = useProjectsControllerList({ includeArchived: false, sort: 'updatedAt', sortDirection: 'desc' }, { query: { retry: false } });

  function replace(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value); else next.delete(key);
    router.push(`${pathname}${next.size ? `?${next.toString()}` : ''}`, { scroll: false });
  }

  return (
    <section className="mx-auto max-w-7xl space-y-5" aria-labelledby="issues-title">
      <header className="flex flex-wrap items-end justify-between gap-4"><div><h1 id="issues-title" className="text-2xl font-semibold tracking-tight">이슈</h1><p className="text-muted-foreground mt-1 text-sm">프로젝트의 콘텐츠와 실행 현황을 함께 봅니다.</p></div><Link href={`${pathname}?create=1`} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-2')}><Plus className="size-4" />이슈 만들기</Link></header>
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
              aria-label="이슈 검색"
              className="h-8 border-transparent bg-transparent pl-8 shadow-none hover:bg-muted/50 focus-visible:bg-background"
              placeholder="표시 ID 또는 제목 검색"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </form>
          <Filter className="text-muted-foreground size-4" aria-hidden="true" />
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
            <SelectTrigger size="sm" aria-label="프로젝트 필터">
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
          <Select
            items={[
              { label: '모든 상태', value: '' },
              ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ label, value })),
            ]}
            value={status}
            onValueChange={(value) => replace('status', value ?? '')}
          >
            <SelectTrigger size="sm" aria-label="상태 필터">
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
      </div>
      {issues.isPending ? <ContentLoading label="이슈를 불러오는 중입니다" /> : null}
      {issues.isError ? <ContentError title="이슈를 불러오지 못했습니다" description="입력한 필터는 유지했습니다." retryLabel="다시 시도" onRetry={() => void issues.refetch()} /> : null}
      {issues.data?.items.length === 0 ? <ContentEmpty icon={CircleDot} title="조건에 맞는 이슈가 없습니다" description="필터를 바꾸거나 새 이슈를 만들어 보세요." /> : null}
      {issues.data?.items.length ? <div><div className="text-muted-foreground grid grid-cols-[minmax(18rem,1fr)_8.5rem_7.5rem_10rem_6.5rem_5rem_7rem] gap-3 border-b px-3 py-2 text-xs font-medium max-xl:grid-cols-[minmax(18rem,1fr)_8.5rem_7.5rem_9rem_6.5rem_6rem] max-lg:grid-cols-[minmax(18rem,1fr)_8.5rem_7.5rem_6rem] max-md:hidden"><span>이슈</span><span>상태</span><span>우선순위</span><span className="max-lg:hidden">현재 팀 작업</span><span>진행률</span><span className="max-xl:hidden">최근 수정</span><span className="max-lg:hidden">다음 행동</span></div><ul>{issues.data.items.map((issue) => <IssueListRow key={issue.id} issue={issue} queryKey={issues.queryKey} />)}</ul></div> : null}
      {issues.data ? <p className="text-muted-foreground text-right text-xs">총 {issues.data.totalCount.toLocaleString('ko-KR')}개</p> : null}
    </section>
  );
}
