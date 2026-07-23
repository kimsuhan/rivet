'use client';

import {
  type IssueMemberSummaryResponseDto,
  type TeamWorkSummaryResponseDto,
  useMembersControllerList,
  useTeamsControllerListWorkflowStates,
} from '@rivet/api-client';

import { ProjectLogo } from '@/components/project-logo';
import { workflowStateProgress } from '@/components/workflow-state-icon';
import { Link } from '@/i18n/navigation';

import {
  CompactAssigneeTrigger,
  PriorityDisplay,
  StatusTrigger,
} from './issue-attribute-presentation';
import { issueWorkHref } from './issue-work-routing';
import { useTeamWorkInlineMutation } from './use-team-work-inline-mutation';

export const TEAM_WORK_GRID_COLUMNS =
  'grid-cols-[minmax(0,1fr)_9rem_10rem_5rem] max-xl:grid-cols-[minmax(0,1fr)_9rem_10rem] max-md:grid-cols-1 max-md:gap-2';

function relativeUpdatedAt(value: string) {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000);
  return minutes < 60
    ? `${Math.max(1, minutes)}분 전`
    : minutes < 1_440
      ? `${Math.round(minutes / 60)}시간 전`
      : `${Math.round(minutes / 1_440)}일 전`;
}

export function TeamWorkListRow({
  work,
  density = 'comfortable',
}: {
  work: TeamWorkSummaryResponseDto;
  density?: 'compact' | 'comfortable';
}) {
  const states = useTeamsControllerListWorkflowStates(work.projectTeam.team.id, undefined, {
    query: { retry: false },
  });
  const members = useMembersControllerList(
    { limit: 100, status: 'ACTIVE', teamId: work.projectTeam.team.id },
    { query: { retry: false } },
  );
  const stateMutation = useTeamWorkInlineMutation(work, 'workflowState');
  const assigneeMutation = useTeamWorkInlineMutation(work, 'assignee');
  return (
    <li className="group border-b last:border-b-0">
      <div
        className={`grid ${density === 'compact' ? 'min-h-11 gap-2 py-1.5' : 'min-h-16 gap-3 py-2.5'} ${TEAM_WORK_GRID_COLUMNS} items-center px-3 text-sm`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <PriorityDisplay iconOnly priority={work.issue.priority} />
          <Link
            href={issueWorkHref(work.issue.identifier, work.identifier)}
            className="focus-visible:ring-ring min-w-0 flex-1 rounded-sm outline-none focus-visible:ring-2"
          >
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="text-muted-foreground shrink-0 font-mono text-xs">
                {work.identifier}
              </span>
              <span className="truncate font-medium" title={work.issue.title}>
                {work.issue.title}
              </span>
            </span>
            <span
              className={`text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs ${density === 'compact' ? '' : 'mt-1'}`}
            >
              <ProjectLogo
                logoFileId={work.issue.project.logoFileId}
                name={work.issue.project.name}
                size="xs"
              />
              <span className="truncate">{work.issue.project.name}</span>
              <span aria-hidden="true">·</span>
              <span className="shrink-0 font-mono">{work.issue.identifier}</span>
            </span>
          </Link>
        </div>
        <StatusTrigger
          identifier={work.identifier}
          value={work.workflowState.id}
          states={states.data?.items ?? []}
          busy={stateMutation.isPending}
          disabled={stateMutation.isPending || states.isPending}
          onValueChange={(id) => {
            const state = states.data?.items.find((item) => item.id === id);
            if (state) {
              stateMutation.mutate({
                stateProgress: workflowStateProgress(states.data?.items ?? [], state),
                workflowState: state,
              });
            }
          }}
        />
        <CompactAssigneeTrigger
          identifier={work.identifier}
          assignee={work.assignee}
          members={(members.data?.items ?? []) as IssueMemberSummaryResponseDto[]}
          busy={assigneeMutation.isPending}
          disabled={assigneeMutation.isPending || members.isPending}
          onValueChange={(id) => {
            const member = members.data?.items.find((item) => item.id === id);
            assigneeMutation.mutate({ assignee: member ?? null, assigneeMembershipId: id || null });
          }}
        />
        <time className="text-muted-foreground text-xs max-xl:hidden" dateTime={work.updatedAt}>
          {relativeUpdatedAt(work.updatedAt)}
        </time>
      </div>
    </li>
  );
}
