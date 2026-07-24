'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  getTeamWorksControllerGroupsQueryKey,
  type IssueDetailResponseDto,
  type IssueMemberSummaryResponseDto,
  type TeamWorkDetailResponseDto,
  type TeamWorkListResponseDto,
  teamWorksControllerUpdate,
  type TeamWorkSummaryResponseDto,
} from '@rivet/api-client';

type Change = {
  assignee?: IssueMemberSummaryResponseDto | null;
  assigneeMembershipId?: string | null;
  completionMode?: 'COMPLETE_ONLY' | 'HANDOFF_AND_COMPLETE';
  handoff?: { bodyMarkdown: string; destinationProjectTeamIds?: string[] };
  workNoteMarkdown?: string | null;
  stateProgress?: number | null;
  workflowState?: TeamWorkSummaryResponseDto['workflowState'];
};

function applyPatch(work: TeamWorkSummaryResponseDto, change: Change): TeamWorkSummaryResponseDto {
  return {
    ...work,
    ...(change.assignee !== undefined ? { assignee: change.assignee } : {}),
    ...(change.workNoteMarkdown !== undefined ? { workNoteMarkdown: change.workNoteMarkdown } : {}),
    ...(change.workflowState
      ? {
          stateCategory: change.workflowState.category,
          stateProgress:
            change.stateProgress !== undefined ? change.stateProgress : work.stateProgress,
          workflowState: change.workflowState,
        }
      : {}),
  };
}

export function useTeamWorkInlineMutation(
  work: TeamWorkSummaryResponseDto,
  field: 'assignee' | 'workNoteMarkdown' | 'workflowState',
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['team-work-cell', work.id, field],
    mutationFn: (change: Change) =>
      teamWorksControllerUpdate(work.id, {
        version: work.version,
        ...(change.assigneeMembershipId !== undefined
          ? { assigneeMembershipId: change.assigneeMembershipId }
          : {}),
        ...(change.completionMode ? { completionMode: change.completionMode } : {}),
        ...(change.handoff ? { handoff: change.handoff } : {}),
        ...(change.workNoteMarkdown !== undefined
          ? { workNoteMarkdown: change.workNoteMarkdown }
          : {}),
        ...(change.workflowState ? { workflowStateId: change.workflowState.id } : {}),
      }),
    onMutate: async (change) => {
      await queryClient.cancelQueries({ queryKey: ['/api/v1/team-works'] });
      await queryClient.cancelQueries({ queryKey: ['/api/v1/issues'] });
      const teamWorkEntries = queryClient.getQueriesData({ queryKey: ['/api/v1/team-works'] });
      const issueEntries = queryClient.getQueriesData({ queryKey: ['/api/v1/issues'] });
      const patch = (current: TeamWorkSummaryResponseDto) => applyPatch(current, change);

      queryClient.setQueriesData<TeamWorkListResponseDto>(
        { queryKey: ['/api/v1/team-works'] },
        (current) =>
          current && 'items' in current
            ? {
                ...current,
                items: current.items.map((item) => (item.id === work.id ? patch(item) : item)),
              }
            : current,
      );
      queryClient.setQueriesData<TeamWorkDetailResponseDto>(
        { queryKey: ['/api/v1/team-works'] },
        (current) =>
          current && 'id' in current && current.id === work.id
            ? { ...current, ...patch(current) }
            : current,
      );
      queryClient.setQueriesData<IssueDetailResponseDto>(
        { queryKey: ['/api/v1/issues'] },
        (current) =>
          current && 'teamWorks' in current
            ? {
                ...current,
                teamWorks: current.teamWorks.map((item) =>
                  item.id === work.id ? patch(item) : item,
                ),
              }
            : current,
      );
      return { issueEntries, teamWorkEntries };
    },
    onError: (_error, _change, context) => {
      context?.teamWorkEntries.forEach(([queryKey, value]) =>
        queryClient.setQueryData(queryKey, value),
      );
      context?.issueEntries.forEach(([queryKey, value]) =>
        queryClient.setQueryData(queryKey, value),
      );
    },
    onSuccess: (result) => {
      queryClient.setQueriesData<TeamWorkListResponseDto>(
        { queryKey: ['/api/v1/team-works'] },
        (current) =>
          current && 'items' in current
            ? {
                ...current,
                items: current.items.map((item) => (item.id === work.id ? result.teamWork : item)),
              }
            : current,
      );
      queryClient.setQueriesData<TeamWorkDetailResponseDto>(
        { queryKey: ['/api/v1/team-works'] },
        (current) =>
          current && 'id' in current && current.id === work.id
            ? { ...current, ...result.teamWork }
            : current,
      );
      queryClient.setQueriesData<IssueDetailResponseDto>(
        { queryKey: ['/api/v1/issues'] },
        (current) =>
          current && 'teamWorks' in current
            ? {
                ...current,
                ...result.issue,
                teamWorks: current.teamWorks.map((item) =>
                  item.id === work.id ? result.teamWork : item,
                ),
              }
            : current,
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['/api/v1/team-works'] });
      void queryClient.invalidateQueries({
        queryKey: getTeamWorksControllerGroupsQueryKey(),
      });
      void queryClient.invalidateQueries({ queryKey: ['/api/v1/issues'] });
    },
  });
}
