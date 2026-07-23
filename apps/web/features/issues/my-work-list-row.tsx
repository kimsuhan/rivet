'use client';

import type { CSSProperties } from 'react';
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

function relativeDate(value: string): string {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 1_440) return `${Math.round(minutes / 60)}시간 전`;
  return `${Math.round(minutes / 1_440)}일 전`;
}

export function MyWorkListRow({
  work,
  density = 'comfortable',
  savedViewId,
  visibleFields = ['project', 'team', 'labels', 'status', 'priority'],
}: {
  work: TeamWorkSummaryResponseDto;
  density?: 'compact' | 'comfortable';
  savedViewId?: string | null;
  visibleFields?: readonly string[];
}) {
  const states = useTeamsControllerListWorkflowStates(work.projectTeam.team.id, undefined, {
    query: { retry: false },
  });
  const stateMutation = useTeamWorkInlineMutation(work, 'workflowState');
  const [completionModalOpen, setCompletionModalOpen] = useState(false);
  const href = myWorkHref(work.identifier, 'work', savedViewId);
  const retry = () => {
    if (stateMutation.variables) stateMutation.mutate(stateMutation.variables);
  };
  const visible = new Set(visibleFields);
  const columns = [
    'minmax(0,1fr)',
    ...(visible.has('status') ? ['10rem'] : []),
    ...(visible.has('createdAt') ? ['6rem'] : []),
    ...(visible.has('updatedAt') ? ['6rem'] : []),
    '8rem',
  ].join(' ');

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
        className={`pointer-events-none relative z-10 grid grid-cols-1 lg:[grid-template-columns:var(--my-work-columns)] ${density === 'compact' ? 'min-h-11 gap-2 py-1.5' : 'min-h-16 gap-3 py-2.5'} items-center px-3 text-sm max-md:gap-2 max-md:py-3`}
        style={{ '--my-work-columns': columns } as CSSProperties}
      >
        <div className="flex min-w-0 items-center gap-2">
          {visible.has('priority') ? (
            <PriorityDisplay iconOnly priority={work.issue.priority} />
          ) : null}
          <div className="min-w-0">
            <p className="flex min-w-0 items-baseline gap-2">
              <span className="text-muted-foreground shrink-0 font-mono text-xs">
                {work.identifier}
              </span>
              <span className="truncate font-medium" title={work.issue.title}>
                {work.issue.title}
              </span>
            </p>
            {visible.has('project') || visible.has('team') || visible.has('labels') ? (
              <div
                className={`text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs ${density === 'compact' ? '' : 'mt-1'}`}
              >
                {visible.has('project') ? (
                  <>
                    <ProjectLogo
                      logoFileId={work.issue.project.logoFileId}
                      name={work.issue.project.name}
                      size="xs"
                    />
                    <span className="truncate">{work.issue.project.name}</span>
                  </>
                ) : null}
                {visible.has('project') && visible.has('team') ? (
                  <span aria-hidden="true">·</span>
                ) : null}
                {visible.has('team') ? (
                  <span className="truncate">{work.projectTeam.team.name}</span>
                ) : null}
                {visible.has('labels') ? (
                  <IssueLabelChips emptyLabel="" labels={work.issue.labels} />
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        {visible.has('status') ? (
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
        ) : null}
        {visible.has('createdAt') ? (
          <time className="text-muted-foreground text-xs" dateTime={work.createdAt}>
            {relativeDate(work.createdAt)}
          </time>
        ) : null}
        {visible.has('updatedAt') ? (
          <time className="text-muted-foreground text-xs" dateTime={work.updatedAt}>
            {relativeDate(work.updatedAt)}
          </time>
        ) : null}
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
