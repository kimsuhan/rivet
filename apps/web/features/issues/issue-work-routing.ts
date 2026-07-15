export function issueWorkHref(issueIdentifier: string, teamWorkIdentifier?: string): string {
  const base = `/issues/${encodeURIComponent(issueIdentifier)}?tab=work`;
  return teamWorkIdentifier
    ? `${base}&work=${encodeURIComponent(teamWorkIdentifier)}`
    : base;
}

export function myWorkHref(teamWorkIdentifier: string, tab = 'work'): string {
  return `/my-issues/${encodeURIComponent(teamWorkIdentifier)}?tab=${encodeURIComponent(tab)}`;
}

export function isExcludedFromMyWork(
  stateCategory: 'BACKLOG' | 'UNSTARTED' | 'STARTED' | 'COMPLETED' | 'CANCELED',
  assigneeMembershipId: string | null,
  currentMembershipId: string | null,
): boolean {
  return (
    stateCategory === 'COMPLETED' ||
    stateCategory === 'CANCELED' ||
    (currentMembershipId !== null && assigneeMembershipId !== currentMembershipId)
  );
}

export function matchesRequestedTeamWork(
  identifier: string,
  requestedIdentifier: string | null,
): boolean {
  return requestedIdentifier !== null && identifier.toUpperCase() === requestedIdentifier.toUpperCase();
}
