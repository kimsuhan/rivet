'use client';

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
import { useTeamWorkInlineMutation } from './use-team-work-inline-mutation';

const ROLE_LABELS = {
  BACKEND: '백엔드',
  WEB_FRONTEND: '웹 프론트',
  APP_FRONTEND: '앱 프론트',
} as const;

function relativeUpdatedAt(value: string) {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000);
  return minutes < 60
    ? `${Math.max(1, minutes)}분 전`
    : minutes < 1_440
      ? `${Math.round(minutes / 60)}시간 전`
      : `${Math.round(minutes / 1_440)}일 전`;
}

export function TeamWorkListRow({ work }: { work: TeamWorkSummaryResponseDto }) {
  const states = useTeamsControllerListWorkflowStates(work.team.id, { query: { retry: false } });
  const members = useMembersControllerList(
    { limit: 100, status: 'ACTIVE', teamId: work.team.id },
    { query: { retry: false } },
  );
  const stateMutation = useTeamWorkInlineMutation(work, 'workflowState');
  const assigneeMutation = useTeamWorkInlineMutation(work, 'assignee');
  return (
    <li className="group border-b last:border-b-0">
      <div className="grid min-h-16 grid-cols-[7.5rem_minmax(16rem,1fr)_11rem_8.5rem_9.5rem_7.5rem_9rem_5rem] items-center gap-3 px-3 py-2.5 text-sm max-xl:grid-cols-[7.5rem_minmax(16rem,1fr)_11rem_8.5rem_9.5rem_7.5rem_6rem] max-lg:grid-cols-[7.5rem_minmax(16rem,1fr)_8.5rem_9.5rem_7.5rem] max-md:grid-cols-1 max-md:gap-1">
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
            {work.issue.identifier} · {ROLE_LABELS[work.projectRole]} · {work.team.name}
          </span>
        </Link>
        <span className="text-muted-foreground truncate max-lg:hidden">
          {work.team.name} · {ROLE_LABELS[work.projectRole]}
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
        <span className="text-muted-foreground text-xs">
          {work.readinessStatus === 'API_HANDOFF_PENDING' ? 'API 전달 대기' : '작업 가능'}
        </span>
        <time className="text-muted-foreground text-xs max-xl:hidden" dateTime={work.updatedAt}>
          {relativeUpdatedAt(work.updatedAt)}
        </time>
      </div>
    </li>
  );
}
