'use client';

import {
  type InfiniteData,
  type QueryKey,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { ArrowRight, CircleAlert } from 'lucide-react';
import type { CSSProperties } from 'react';

import {
  getIssuesControllerGroupsQueryKey,
  getIssuesControllerListQueryKey,
  getTeamWorksControllerGroupsQueryKey,
  getTeamWorksControllerListQueryKey,
  type IssueListResponseDto,
  issuesControllerUpdate,
  type IssueSummaryResponseDto,
} from '@rivet/api-client';

import { ProjectLogo } from '@/components/project-logo';
import { buttonVariants } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

import { IssueStatusDisplay, PriorityTrigger } from './issue-attribute-presentation';
import { IssueLabelChips } from './issue-label-chips';

type IssueListQueryData = IssueListResponseDto | InfiniteData<IssueListResponseDto>;

function updateIssueListData(
  current: IssueListQueryData | undefined,
  update: (item: IssueSummaryResponseDto) => IssueSummaryResponseDto,
): IssueListQueryData | undefined {
  if (!current) return current;
  if ('pages' in current) {
    return {
      ...current,
      pages: current.pages.map((page) => ({
        ...page,
        items: page.items.map(update),
      })),
    };
  }
  return { ...current, items: current.items.map(update) };
}

function relativeDate(value: string) {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 1_440) return `${Math.round(minutes / 60)}시간 전`;
  return `${Math.round(minutes / 1_440)}일 전`;
}

export function IssueListRow({
  detailHref,
  issue,
  preserveListReturn = false,
  queryKey,
  density = 'comfortable',
  visibleFields = [
    'project',
    'labels',
    'status',
    'priority',
    'teamWorkCount',
    'progress',
    'updatedAt',
  ],
}: {
  detailHref?: string;
  issue: IssueSummaryResponseDto;
  preserveListReturn?: boolean;
  queryKey: QueryKey;
  density?: 'compact' | 'comfortable';
  visibleFields?: readonly string[];
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey: ['issue-priority', issue.id],
    mutationFn: (priority: IssueSummaryResponseDto['priority']) =>
      issuesControllerUpdate(issue.id, { priority, version: issue.version }),
    onMutate: async (priority) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<IssueListQueryData>(queryKey);
      queryClient.setQueryData<IssueListQueryData>(queryKey, (current) =>
        updateIssueListData(current, (item) =>
          item.id === issue.id ? { ...item, priority } : item,
        ),
      );
      return { previous };
    },
    onError: (_error, _priority, context) => queryClient.setQueryData(queryKey, context?.previous),
    onSuccess: (updated) =>
      queryClient.setQueryData<IssueListQueryData>(queryKey, (current) =>
        updateIssueListData(current, (item) => (item.id === issue.id ? updated : item)),
      ),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: getIssuesControllerListQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getIssuesControllerGroupsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getTeamWorksControllerListQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getTeamWorksControllerGroupsQueryKey() }),
      ]),
  });
  const nextAction =
    issue.status === 'REVIEW'
      ? '배포 현황 보기'
      : issue.workflowSummary.teamWorkCount === 0
        ? '팀 작업 시작'
        : issue.workflowSummary.unassignedCount
          ? '담당자 지정'
          : '업무 보기';
  const nextActionIsDecision = nextAction !== '업무 보기';
  const href = detailHref ?? `/issues/${encodeURIComponent(issue.identifier)}?tab=work`;
  const nextActionHref = issue.status === 'REVIEW' ? '/deployments' : href;
  const preserveReturnContext = () => {
    if (!preserveListReturn) return;
    window.sessionStorage.setItem(
      'rivet.issue.return',
      JSON.stringify({
        href: `${window.location.pathname}${window.location.search}${window.location.hash}`,
        issueIdentifier: issue.identifier,
      }),
    );
  };
  const visible = new Set(visibleFields);
  const columns = [
    'minmax(18rem,1fr)',
    ...(visible.has('status') ? ['8.5rem'] : []),
    ...(visible.has('priority') ? ['7.5rem'] : []),
    ...(visible.has('teamWorkCount') ? ['9rem'] : []),
    ...(visible.has('progress') ? ['6.5rem'] : []),
    ...(visible.has('createdBy') ? ['8rem'] : []),
    ...(visible.has('createdAt') ? ['6rem'] : []),
    ...(visible.has('updatedAt') ? ['6rem'] : []),
    '7rem',
  ].join(' ');

  return (
    <li className="group border-b last:border-b-0">
      <div
        className={`grid grid-cols-1 lg:[grid-template-columns:var(--issue-list-columns)] ${density === 'compact' ? 'min-h-11 gap-2 py-0 text-[13px]' : 'min-h-16 gap-3 py-2.5 text-sm'} items-center px-3`}
        style={{ '--issue-list-columns': columns } as CSSProperties}
      >
        <Link
          href={href}
          onClick={preserveReturnContext}
          className={cn(
            'focus-visible:ring-ring min-w-0 rounded-sm outline-none focus-visible:ring-2',
            density === 'compact' && 'flex items-center gap-2 overflow-hidden',
          )}
        >
          <span
            className={cn(
              'text-muted-foreground shrink-0 font-mono text-xs tabular-nums',
              density === 'comfortable' && 'mr-2',
            )}
          >
            {issue.identifier}
          </span>
          <span className="min-w-0 truncate font-medium">{issue.title}</span>
          {visible.has('project') || visible.has('labels') ? (
            <span
              className={cn(
                'text-muted-foreground flex min-w-0 items-center gap-1.5 truncate text-xs',
                density === 'compact' ? 'shrink' : 'mt-1',
              )}
            >
              {visible.has('project') ? (
                <>
                  <ProjectLogo
                    logoFileId={issue.project.logoFileId}
                    name={issue.project.name}
                    size="xs"
                  />
                  <span className="truncate">{issue.project.name}</span>
                </>
              ) : null}
              {visible.has('labels') ? (
                <IssueLabelChips emptyLabel="" labels={issue.labels} />
              ) : null}
            </span>
          ) : null}
        </Link>
        {visible.has('status') ? (
          <IssueStatusDisplay status={issue.status} className="w-32" />
        ) : null}
        {visible.has('priority') ? (
          <PriorityTrigger
            identifier={issue.identifier}
            priority={issue.priority}
            busy={mutation.isPending}
            disabled={mutation.isPending}
            iconOnly={density === 'compact'}
            onValueChange={(priority) => mutation.mutate(priority)}
          />
        ) : null}
        {visible.has('teamWorkCount') ? (
          <span className="text-muted-foreground truncate">
            {issue.workflowSummary.teamWorkCount
              ? `작업 ${issue.workflowSummary.teamWorkCount}개`
              : '아직 없음'}
          </span>
        ) : null}
        {visible.has('progress') ? (
          <span className="flex items-center gap-2 tabular-nums">
            <span>{issue.progress.percentage}%</span>
            <Progress className="hidden w-12 xl:block" value={issue.progress.percentage} />
          </span>
        ) : null}
        {visible.has('createdBy') ? (
          <span className="text-muted-foreground truncate text-xs">
            {issue.createdBy.user.displayName}
          </span>
        ) : null}
        {visible.has('createdAt') ? (
          <time className="text-muted-foreground text-xs" dateTime={issue.createdAt}>
            {relativeDate(issue.createdAt)}
          </time>
        ) : null}
        {visible.has('updatedAt') ? (
          <time className="text-muted-foreground text-xs" dateTime={issue.updatedAt}>
            {relativeDate(issue.updatedAt)}
          </time>
        ) : null}
        <Link
          href={nextActionHref}
          onClick={nextActionHref === href ? preserveReturnContext : undefined}
          className={cn(
            'w-fit',
            nextActionIsDecision && density === 'comfortable'
              ? cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'gap-1.5')
              : cn(
                  'hover:text-foreground inline-flex items-center gap-1 text-xs font-medium',
                  nextActionIsDecision ? 'text-foreground' : 'text-muted-foreground',
                ),
          )}
        >
          {issue.workflowSummary.unassignedCount ? (
            <CircleAlert className="text-warning size-3.5" />
          ) : (
            <ArrowRight className="size-3.5" />
          )}
          {nextAction}
        </Link>
      </div>
    </li>
  );
}
