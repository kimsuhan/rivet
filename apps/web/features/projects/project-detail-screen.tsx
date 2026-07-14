'use client';

import { FolderKanban, Pencil, Plus } from 'lucide-react';

import { useIssuesControllerList, useProjectsControllerGet, useTeamWorksControllerList } from '@rivet/api-client';

import { ContentEmpty } from '@/components/states/content-empty';
import { ContentError } from '@/components/states/content-error';
import { ContentLoading } from '@/components/states/content-loading';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { IssueListRow } from '@/features/issues/issue-list-row';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

const ROLE_LABELS = { BACKEND: '백엔드', WEB_FRONTEND: '웹 프론트', APP_FRONTEND: '앱 프론트' } as const;

export function ProjectDetailScreen({ projectId }: { projectId: string }) {
  const project = useProjectsControllerGet(projectId, { query: { retry: false } });
  const issues = useIssuesControllerList({ projectId, sort: 'updatedAt', sortDirection: 'desc' }, { query: { retry: false } });
  const works = useTeamWorksControllerList({ projectId, sort: 'updatedAt', sortDirection: 'desc' }, { query: { retry: false } });

  if (project.isPending) return <ContentLoading label="프로젝트를 불러오는 중입니다" />;
  if (project.isError || !project.data) return <ContentError title="프로젝트를 불러오지 못했습니다" description="프로젝트 주소를 확인해 주세요." retryLabel="다시 시도" onRetry={() => void project.refetch()} />;
  const item = project.data;

  return (
    <section className="mx-auto max-w-6xl space-y-6" aria-labelledby="project-title">
      <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-muted-foreground text-sm">프로젝트</p><h1 id="project-title" className="text-2xl font-semibold">{item.name}</h1><p className="text-muted-foreground mt-2 max-w-2xl text-sm">{item.description ?? '설명이 없습니다.'}</p></div><div className="flex gap-2"><Link href={`/projects/${item.id}/edit`} className={cn(buttonVariants({ variant: 'outline' }), 'gap-2')}><Pencil className="size-4" />편집</Link><Link href={`/issues?create=1&projectId=${encodeURIComponent(item.id)}`} className={cn(buttonVariants(), 'gap-2')}><Plus className="size-4" />이슈 만들기</Link></div></header>
      <div className="grid gap-4 sm:grid-cols-3"><div className="bg-surface-1 rounded-xl border p-4"><span className="text-muted-foreground text-xs">이슈 진행률</span><strong className="mt-1 block text-2xl tabular-nums">{item.progress.percentage}%</strong><Progress className="mt-3" value={item.progress.percentage} /></div><div className="bg-surface-1 rounded-xl border p-4"><span className="text-muted-foreground text-xs">이슈</span><strong className="mt-1 block text-2xl tabular-nums">{issues.data?.totalCount ?? item.progress.total}</strong></div><div className="bg-surface-1 rounded-xl border p-4"><span className="text-muted-foreground text-xs">팀 작업</span><strong className="mt-1 block text-2xl tabular-nums">{works.data?.totalCount ?? 0}</strong></div></div>
      <div className="flex flex-wrap gap-2">{item.roleTeams.map(({ role, team }) => <Badge key={role} variant="secondary">{ROLE_LABELS[role]} · {team.name}</Badge>)}</div>
      {issues.isPending ? <ContentLoading label="프로젝트 이슈를 불러오는 중입니다" /> : null}
      {issues.isError ? <ContentError title="프로젝트 이슈를 불러오지 못했습니다" description="프로젝트 정보는 유지했습니다." retryLabel="다시 시도" onRetry={() => void issues.refetch()} /> : null}
      {issues.data && issues.data.items.length === 0 ? <ContentEmpty icon={FolderKanban} title="프로젝트 이슈가 없습니다" description="이 프로젝트에서 첫 이슈를 만들어 보세요."><Link href={`/issues?create=1&projectId=${encodeURIComponent(item.id)}`}><Button><Plus className="size-4" />이슈 만들기</Button></Link></ContentEmpty> : null}
      {issues.data && issues.data.items.length ? <ul className="border-y">{issues.data.items.map((issue) => <IssueListRow key={issue.id} issue={issue} queryKey={issues.queryKey} />)}</ul> : null}
    </section>
  );
}
