import type { TeamWorkSummaryResponseDto } from '@rivet/api-client';

export type DeploymentView = 'PENDING' | 'DEPLOYED';
export type DeploymentScope = 'MY_TEAMS' | 'ALL';

export type DeploymentIssueGroup = {
  allWorks: TeamWorkSummaryResponseDto[];
  issue: TeamWorkSummaryResponseDto['issue'];
  visibleWorks: TeamWorkSummaryResponseDto[];
};

export type DeploymentProjectGroup = {
  issues: DeploymentIssueGroup[];
  project: TeamWorkSummaryResponseDto['issue']['project'];
  scopeWorks: TeamWorkSummaryResponseDto[];
};

export function deploymentProjectGroups(
  items: TeamWorkSummaryResponseDto[],
  memberTeamIds: string[],
  scope: DeploymentScope,
  view: DeploymentView,
): DeploymentProjectGroup[] {
  const memberTeamIdSet = new Set(memberTeamIds);
  const scopeItems =
    scope === 'MY_TEAMS'
      ? items.filter(({ projectTeam }) => memberTeamIdSet.has(projectTeam.team.id))
      : items;
  const visibleItems = scopeItems.filter((work) =>
    view === 'DEPLOYED'
      ? work.deploymentStatus === 'DEPLOYED'
      : work.deploymentStatus === 'PENDING' || work.deploymentStatus === 'REDEPLOY_REQUIRED',
  );
  const allWorksByIssue = new Map<string, TeamWorkSummaryResponseDto[]>();
  for (const work of items) {
    allWorksByIssue.set(work.issue.id, [...(allWorksByIssue.get(work.issue.id) ?? []), work]);
  }

  const groups = new Map<string, DeploymentProjectGroup>();
  for (const work of visibleItems) {
    let project = groups.get(work.issue.project.id);
    if (!project) {
      project = {
        issues: [],
        project: work.issue.project,
        scopeWorks: scopeItems.filter(({ issue }) => issue.project.id === work.issue.project.id),
      };
      groups.set(work.issue.project.id, project);
    }

    let issue = project.issues.find(({ issue }) => issue.id === work.issue.id);
    if (!issue) {
      issue = {
        allWorks: allWorksByIssue.get(work.issue.id) ?? [work],
        issue: work.issue,
        visibleWorks: [],
      };
      project.issues.push(issue);
    }
    issue.visibleWorks.push(work);
  }

  return [...groups.values()];
}

export function projectCompletableWorks(
  group: DeploymentProjectGroup,
): TeamWorkSummaryResponseDto[] {
  const candidates = group.issues.flatMap(({ visibleWorks }) =>
    visibleWorks.filter(({ stateCategory }) => stateCategory === 'COMPLETED'),
  );
  const candidateIds = new Set(candidates.map(({ id }) => id));
  const allWorks = group.issues.flatMap(({ allWorks }) => allWorks);
  const worksById = new Map(allWorks.map((work) => [work.id, work]));

  return candidates.filter((work) => {
    const predecessorsReady = work.deploymentPredecessorTeamWorkIds.every((id) => {
      const predecessor = worksById.get(id);
      return predecessor?.deploymentStatus === 'DEPLOYED' || candidateIds.has(id);
    });
    if (!predecessorsReady) return false;
    if (!work.deploymentGroupId) return true;
    return allWorks
      .filter(({ deploymentGroupId }) => deploymentGroupId === work.deploymentGroupId)
      .every(({ stateCategory }) => stateCategory === 'COMPLETED');
  });
}
