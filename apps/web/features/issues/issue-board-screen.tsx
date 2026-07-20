'use client';

import { LayoutGrid, Plus } from 'lucide-react';

import {
  useTeamsControllerList,
  useTeamsControllerListWorkflowStates,
  useTeamWorksControllerList,
} from '@rivet/api-client';

import { ContentEmpty } from '@/components/states/content-empty';
import { ContentError } from '@/components/states/content-error';
import { ContentLoading } from '@/components/states/content-loading';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { WorkflowStateIcon, workflowStateProgress } from '@/components/workflow-state-icon';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

import { issueWorkHref } from './issue-work-routing';

export function IssueBoardScreen({ teamKey }: { teamKey: string }) {
  const teams = useTeamsControllerList({ includeArchived: false }, { query: { retry: false } });
  const team = (teams.data?.items ?? []).find(
    (item) => item.key.toUpperCase() === teamKey.toUpperCase(),
  );
  const works = useTeamWorksControllerList(
    { ...(team ? { teamId: team.id } : {}), sort: 'updatedAt', sortDirection: 'desc' },
    { query: { enabled: Boolean(team), retry: false } },
  );
  const workflowStates = useTeamsControllerListWorkflowStates(
    team?.id ?? '',
    { includeDisabled: true },
    {
      query: { enabled: Boolean(team), retry: false },
    },
  );
  const states = [...(workflowStates.data?.items ?? [])].sort(
    (left, right) => left.position - right.position,
  );

  return (
    <section className="space-y-6" aria-labelledby="team-board-title">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-muted-foreground text-sm">팀 작업 워크플로</p>
          <h1 id="team-board-title" className="text-2xl font-semibold">
            {team?.name ?? teamKey} 보드
          </h1>
        </div>
        <Link href="/issues?create=1" className={cn(buttonVariants(), 'gap-2')}>
          <Plus className="size-4" />
          이슈 만들기
        </Link>
      </header>
      {teams.isPending || works.isPending ? (
        <ContentLoading label="보드를 불러오는 중입니다" />
      ) : null}
      {teams.isError || works.isError ? (
        <ContentError
          title="보드를 불러오지 못했습니다"
          description="잠시 후 다시 시도해 주세요."
          retryLabel="다시 시도"
          onRetry={() => {
            void teams.refetch();
            void works.refetch();
          }}
        />
      ) : null}
      {teams.data && !team ? (
        <ContentEmpty
          icon={LayoutGrid}
          title="팀을 찾을 수 없습니다"
          description="팀 주소를 확인해 주세요."
        />
      ) : null}
      {team && works.data ? (
        <div className="grid auto-cols-[minmax(17rem,1fr)] grid-flow-col gap-4 overflow-x-auto pb-4">
          {states.map((state) => {
            const items = works.data.items.filter((work) => work.workflowState.id === state.id);
            return (
              <section
                key={state.id}
                className="bg-surface-2 min-h-64 rounded-xl border p-3"
                aria-labelledby={`board-${state.id}`}
              >
                <header className="mb-3 flex items-center justify-between">
                  <h2
                    id={`board-${state.id}`}
                    className="flex items-center gap-2 text-sm font-semibold"
                  >
                    <WorkflowStateIcon
                      category={state.category}
                      color={state.color}
                      progress={workflowStateProgress(states, state)}
                      variant="swatch"
                    />
                    {state.name}
                  </h2>
                  <Badge variant="secondary">{items.length}</Badge>
                </header>
                <ul className="space-y-2">
                  {items.map((work) => (
                    <li key={work.id}>
                      <Link
                        href={issueWorkHref(work.issue.identifier, work.identifier)}
                        className="bg-background hover:border-primary/40 block rounded-lg border p-3 transition-colors"
                      >
                        <span className="text-muted-foreground font-mono text-xs">
                          {work.identifier}
                        </span>
                        <strong className="mt-1 block text-sm font-medium">
                          {work.issue.title}
                        </strong>
                        <span className="text-muted-foreground mt-2 block text-xs">
                          {work.assignee?.user.displayName ?? '담당자 없음'}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
