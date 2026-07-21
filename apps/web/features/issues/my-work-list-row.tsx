'use client';

import { useState } from 'react';

import {
  type TeamWorkSummaryResponseDto,
  useTeamsControllerListWorkflowStates,
} from '@rivet/api-client';

import { ProjectLogo } from '@/components/project-logo';
import { Button } from '@/components/ui/button';
import { workflowStateProgress } from '@/components/workflow-state-icon';
import { Link } from '@/i18n/navigation';

import { PriorityDisplay, StatusTrigger } from './issue-attribute-presentation';
import { IssueLabelChips } from './issue-label-chips';
import { myWorkHref } from './issue-work-routing';
import { TeamWorkCompletionModal } from './team-work-completion-modal';
import { TeamWorkPrimaryAction } from './team-work-primary-action';
import { useTeamWorkInlineMutation } from './use-team-work-inline-mutation';

export const MY_WORK_GRID_COLUMNS =
  'grid-cols-[6.5rem_minmax(18rem,30rem)_minmax(15rem,20rem)_8.5rem_8rem] max-xl:grid-cols-[6rem_minmax(15rem,24rem)_minmax(12rem,16rem)_7.5rem_7rem] max-md:grid-cols-1';

export function MyWorkListRow({
  work,
  density = 'comfortable',
}: {
  work: TeamWorkSummaryResponseDto;
  density?: 'compact' | 'comfortable';
}) {
  const states = useTeamsControllerListWorkflowStates(work.projectTeam.team.id, undefined, {
    query: { retry: false },
  });
  const stateMutation = useTeamWorkInlineMutation(work, 'workflowState');
  const [completionModalOpen, setCompletionModalOpen] = useState(false);
  const href = myWorkHref(work.identifier);
  const retry = () => {
    if (stateMutation.variables) stateMutation.mutate(stateMutation.variables);
  };

  return (
    <li className="group relative border-b last:border-b-0">
      <Link
        aria-label={`${work.identifier} 작업 상세 열기`}
        className="focus-visible:ring-ring absolute inset-0 rounded-sm focus-visible:ring-2"
        href={href}
        onClick={() => {
          window.sessionStorage.setItem(
            'rivet.my-work.return',
            JSON.stringify({
              href: `${window.location.pathname}${window.location.search}${window.location.hash}`,
              teamWorkIdentifier: work.identifier,
            }),
          );
        }}
      >
        <span className="sr-only">{work.issue.title}</span>
      </Link>
      <div
        className={`pointer-events-none relative z-10 grid ${density === 'compact' ? 'min-h-11 gap-2 py-1.5' : 'min-h-16 gap-3 py-2.5'} ${MY_WORK_GRID_COLUMNS} items-center px-3 text-sm max-md:gap-2 max-md:py-3`}
      >
        <div className="min-w-0">
          <PriorityDisplay priority={work.issue.priority} />
        </div>
        <div className="min-w-0">
          <p className="truncate font-medium" title={work.issue.title}>
            {work.issue.title}
          </p>
          <p className="text-muted-foreground mt-1 truncate text-xs">
            <span className="font-mono">{work.identifier}</span> ·{' '}
            <span className="font-mono">{work.issue.identifier}</span> ·{' '}
            <span className="font-mono">{work.projectTeam.team.key}</span> ·{' '}
            {work.projectTeam.team.name}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-muted-foreground flex min-w-0 items-center gap-2">
            <ProjectLogo
              logoFileId={work.issue.project.logoFileId}
              name={work.issue.project.name}
              size="xs"
            />
            <span className="truncate">{work.issue.project.name}</span>
          </p>
          <div className="mt-1 min-w-0">
            <IssueLabelChips emptyLabel="" labels={work.issue.labels} />
          </div>
        </div>
        <div
          className="pointer-events-auto min-w-0"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <StatusTrigger
            busy={stateMutation.isPending}
            disabled={stateMutation.isPending || states.isPending}
            identifier={work.identifier}
            onValueChange={(id) => {
              const state = states.data?.items.find((item) => item.id === id);
              if (state) {
                stateMutation.mutate({
                  stateProgress: workflowStateProgress(states.data?.items ?? [], state),
                  workflowState: state,
                });
              }
            }}
            states={states.data?.items ?? []}
            value={work.workflowState.id}
          />
        </div>
        <div
          className="pointer-events-auto min-h-10 min-w-0 justify-self-end max-md:justify-self-start"
          onClick={(event) => event.stopPropagation()}
        >
          <TeamWorkPrimaryAction
            busy={stateMutation.isPending}
            compact
            disabled={states.isPending}
            onOpenCompletion={() => setCompletionModalOpen(true)}
            onStart={(stateId) => {
              const state = states.data?.items.find((item) => item.id === stateId);
              if (state) {
                stateMutation.mutate({
                  stateProgress: workflowStateProgress(states.data?.items ?? [], state),
                  workflowState: state,
                });
              }
            }}
            states={states.data?.items ?? []}
            work={work}
          />
        </div>
        {stateMutation.isError ? (
          <Button
            className="pointer-events-auto col-span-full justify-self-start"
            onClick={retry}
            size="sm"
            variant="outline"
          >
            저장에 실패했습니다. 다시 시도
          </Button>
        ) : null}
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
              stateProgress: workflowStateProgress(states.data?.items ?? [], state),
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
