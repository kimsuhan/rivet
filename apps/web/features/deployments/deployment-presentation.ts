import type { TeamWorkSummaryResponseDto } from '@rivet/api-client';

export type DeploymentConditionPresentation =
  | { kind: 'INDEPENDENT' }
  | { kind: 'TOGETHER' }
  | { kind: 'AFTER'; predecessorTeamNames: string[] };

export type DeploymentReadinessPresentation =
  | { kind: 'DEPLOYED' }
  | { kind: 'WAITING_FOR_WORK'; workflowStateName: string }
  | { kind: 'WAITING_FOR_PREDECESSOR'; predecessorTeamNames: string[] }
  | { completedCount: number; kind: 'WAITING_FOR_TOGETHER'; totalCount: number }
  | { kind: 'READY' };

export function deploymentCondition(
  work: TeamWorkSummaryResponseDto,
  issueWorks: TeamWorkSummaryResponseDto[],
): DeploymentConditionPresentation {
  if (work.deploymentGroupId) return { kind: 'TOGETHER' };
  if (work.deploymentPredecessorTeamWorkIds.length === 0) return { kind: 'INDEPENDENT' };

  const worksById = new Map(issueWorks.map((item) => [item.id, item]));
  return {
    kind: 'AFTER',
    predecessorTeamNames: work.deploymentPredecessorTeamWorkIds.map(
      (id) => worksById.get(id)?.projectTeam.team.name ?? '선행 팀',
    ),
  };
}

export function deploymentReadiness(
  work: TeamWorkSummaryResponseDto,
  issueWorks: TeamWorkSummaryResponseDto[],
): DeploymentReadinessPresentation {
  if (work.deploymentStatus === 'DEPLOYED') return { kind: 'DEPLOYED' };
  if (work.stateCategory !== 'COMPLETED') {
    return { kind: 'WAITING_FOR_WORK', workflowStateName: work.workflowState.name };
  }

  const worksById = new Map(issueWorks.map((item) => [item.id, item]));
  const pendingPredecessorTeamNames = work.deploymentPredecessorTeamWorkIds.flatMap((id) => {
    const predecessor = worksById.get(id);
    return predecessor && predecessor.deploymentStatus !== 'DEPLOYED'
      ? [predecessor.projectTeam.team.name]
      : [];
  });
  if (pendingPredecessorTeamNames.length > 0) {
    return {
      kind: 'WAITING_FOR_PREDECESSOR',
      predecessorTeamNames: pendingPredecessorTeamNames,
    };
  }

  if (work.deploymentGroupId) {
    const groupWorks = issueWorks.filter(
      ({ deploymentGroupId }) => deploymentGroupId === work.deploymentGroupId,
    );
    const completedCount = groupWorks.filter(
      ({ stateCategory }) => stateCategory === 'COMPLETED',
    ).length;
    if (completedCount < groupWorks.length) {
      return {
        completedCount,
        kind: 'WAITING_FOR_TOGETHER',
        totalCount: groupWorks.length,
      };
    }
  }

  return { kind: 'READY' };
}

export function deploymentProgress(works: TeamWorkSummaryResponseDto[]): {
  completed: number;
  total: number;
} {
  return {
    completed: works.filter(({ deploymentStatus }) => deploymentStatus === 'DEPLOYED').length,
    total: works.length,
  };
}
