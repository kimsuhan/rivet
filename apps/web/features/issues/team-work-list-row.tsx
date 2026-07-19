'use client';

import { useState } from 'react';

import {
  type IssueMemberSummaryResponseDto,
  type TeamWorkSummaryResponseDto,
  useMembersControllerList,
  useTeamsControllerListWorkflowStates,
} from '@rivet/api-client';

import { Link } from '@/i18n/navigation';

import {
  CompactAssigneeTrigger,
  PriorityDisplay,
  StatusTrigger,
} from './issue-attribute-presentation';
import { issueWorkHref } from './issue-work-routing';
import { TeamWorkCompletionModal } from './team-work-completion-modal';
import { TeamWorkPrimaryAction } from './team-work-primary-action';
import { useTeamWorkInlineMutation } from './use-team-work-inline-mutation';

export const TEAM_WORK_GRID_COLUMNS =
  'grid-cols-[7.5rem_minmax(16rem,26rem)_11rem_8.5rem_9.5rem_7.5rem_9rem_5rem] max-xl:grid-cols-[7.5rem_minmax(16rem,22rem)_11rem_8.5rem_9.5rem_7.5rem_6rem] max-lg:grid-cols-[7.5rem_minmax(16rem,20rem)_8.5rem_9.5rem_7.5rem] max-md:grid-cols-1 max-md:gap-1';

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
  const states = useTeamsControllerListWorkflowStates(work.projectTeam.team.id, {
    query: { retry: false },
  });
  const members = useMembersControllerList(
    { limit: 100, status: 'ACTIVE', teamId: work.projectTeam.team.id },
    { query: { retry: false } },
  );
  const stateMutation = useTeamWorkInlineMutation(work, 'workflowState');
  const assigneeMutation = useTeamWorkInlineMutation(work, 'assignee');
  const [completionModalOpen, setCompletionModalOpen] = useState(false);
  return (
    <li className="group border-b last:border-b-0">
      <div
        className={`grid ${density === 'compact' ? 'min-h-11 gap-2 py-1.5' : 'min-h-16 gap-3 py-2.5'} ${TEAM_WORK_GRID_COLUMNS} items-center px-3 text-sm`}
      >
        <Link
          href={issueWorkHref(work.issue.identifier, work.identifier)}
          className="text-muted-foreground hover:text-foreground font-mono text-xs"
        >
          {work.identifier}
        </Link>
        <Link
          href={issueWorkHref(work.issue.identifier, work.identifier)}
          className="focus-visible:ring-ring min-w-0 rounded-sm outline-none focus-visible:ring-2"
        >
          <span className="font-medium">{work.issue.title}</span>
          <span className="text-muted-foreground mt-1 block truncate text-xs">
            {work.issue.identifier} · {work.projectTeam.team.name}
          </span>
        </Link>
        <span className="text-muted-foreground truncate max-lg:hidden">
          <span className="font-mono text-xs">{work.projectTeam.team.key}</span> ·{' '}
          {work.projectTeam.team.name}
        </span>
        <StatusTrigger
          identifier={work.identifier}
          value={work.workflowState.id}
          states={states.data?.items ?? []}
          busy={stateMutation.isPending}
          disabled={stateMutation.isPending || states.isPending}
          onValueChange={(id) => {
            const state = states.data?.items.find((item) => item.id === id);
            if (state) stateMutation.mutate({ workflowState: state });
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
        <PriorityDisplay priority={work.issue.priority} className="w-24 max-lg:hidden" />
        <TeamWorkPrimaryAction
          busy={stateMutation.isPending}
          compact
          disabled={states.isPending}
          onOpenCompletion={() => setCompletionModalOpen(true)}
          onStart={(stateId) => {
            const state = states.data?.items.find((item) => item.id === stateId);
            if (state) stateMutation.mutate({ workflowState: state });
          }}
          states={states.data?.items ?? []}
          work={work}
        />
        <time className="text-muted-foreground text-xs max-xl:hidden" dateTime={work.updatedAt}>
          {relativeUpdatedAt(work.updatedAt)}
        </time>
      </div>
      <TeamWorkCompletionModal
        error={stateMutation.error}
        onOpenChange={setCompletionModalOpen}
        onSubmit={(payload) => {
          const state = states.data?.items.find((item) => item.id === payload.workflowStateId);
          if (!state) return;
          stateMutation.mutate(
            {
              ...(payload.handoff ? { handoff: payload.handoff } : {}),
              completionMode: payload.completionMode,
              workflowState: state,
            },
            { onSuccess: () => setCompletionModalOpen(false) },
          );
        }}
        open={completionModalOpen}
        submitting={stateMutation.isPending}
        work={work}
      />
    </li>
  );
}
