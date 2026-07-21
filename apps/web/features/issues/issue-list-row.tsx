'use client';

import {
  type InfiniteData,
  type QueryKey,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { ArrowRight, CircleAlert } from 'lucide-react';

import {
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

export const ISSUE_LIST_GRID_COLUMNS =
  'grid-cols-[minmax(18rem,32rem)_8.5rem_7.5rem_10rem_6.5rem_5rem_7rem] max-xl:grid-cols-[minmax(18rem,26rem)_8.5rem_7.5rem_9rem_6.5rem_6rem] max-lg:grid-cols-[minmax(18rem,22rem)_8.5rem_7.5rem_6rem] max-md:grid-cols-1 max-md:gap-1 max-md:px-3';

function relativeUpdatedAt(value: string) {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 1_440) return `${Math.round(minutes / 60)}시간 전`;
  return `${Math.round(minutes / 1_440)}일 전`;
}

export function IssueListRow({
  issue,
  queryKey,
  density = 'comfortable',
}: {
  issue: IssueSummaryResponseDto;
  queryKey: QueryKey;
  density?: 'compact' | 'comfortable';
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
    onSettled: () => void queryClient.invalidateQueries({ queryKey }),
  });
  const nextAction =
    issue.status === 'REVIEW'
      ? '완료 확인'
      : issue.workflowSummary.teamWorkCount === 0
        ? '팀 작업 시작'
        : issue.workflowSummary.unassignedCount
          ? '담당자 지정'
          : '업무 보기';
  const nextActionIsDecision = nextAction !== '업무 보기';

  return (
    <li className="group border-b last:border-b-0">
      <div
        className={`grid ${density === 'compact' ? 'min-h-11 gap-2 py-1.5' : 'min-h-16 gap-3 py-2.5'} ${ISSUE_LIST_GRID_COLUMNS} items-center px-3 text-sm`}
      >
        <Link
          href={`/issues/${encodeURIComponent(issue.identifier)}?tab=work`}
          className="focus-visible:ring-ring min-w-0 rounded-sm outline-none focus-visible:ring-2"
        >
          <span className="text-muted-foreground mr-2 font-mono text-xs">{issue.identifier}</span>
          <span className="font-medium">{issue.title}</span>
          <span className="text-muted-foreground mt-1 flex min-w-0 items-center gap-1.5 truncate text-xs">
            <ProjectLogo logoFileId={issue.project.logoFileId} name={issue.project.name} size="xs" />
            <span className="truncate">{issue.project.name}</span>
            <IssueLabelChips emptyLabel="" labels={issue.labels} />
          </span>
        </Link>
        <IssueStatusDisplay status={issue.status} className="w-32" />
        <PriorityTrigger
          identifier={issue.identifier}
          priority={issue.priority}
          busy={mutation.isPending}
          disabled={mutation.isPending}
          onValueChange={(priority) => mutation.mutate(priority)}
        />
        <span className="text-muted-foreground truncate max-lg:hidden">
          {issue.workflowSummary.teamWorkCount
            ? `작업 ${issue.workflowSummary.teamWorkCount}개`
            : '아직 없음'}
        </span>
        <span className="flex items-center gap-2 tabular-nums">
          <span>{issue.progress.percentage}%</span>
          <Progress className="hidden w-12 xl:block" value={issue.progress.percentage} />
        </span>
        <time className="text-muted-foreground text-xs max-xl:hidden" dateTime={issue.updatedAt}>
          {relativeUpdatedAt(issue.updatedAt)}
        </time>
        <Link
          href={`/issues/${encodeURIComponent(issue.identifier)}?tab=work`}
          className={cn(
            'max-lg:hidden',
            nextActionIsDecision
              ? cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'gap-1.5')
              : 'text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs font-medium',
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
