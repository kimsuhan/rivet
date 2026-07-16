export function issueWorkHref(issueIdentifier: string, teamWorkIdentifier?: string): string {
  const base = `/issues/${encodeURIComponent(issueIdentifier)}?tab=work`;
  return teamWorkIdentifier ? `${base}&work=${encodeURIComponent(teamWorkIdentifier)}` : base;
}

export function issueNotificationHref(
  issueIdentifier: string,
  anchors: {
    commentId: string | null;
    handoffId: string | null;
    teamWorkIdentifier: string | undefined;
  },
): string {
  const issueHref = issueWorkHref(issueIdentifier, anchors.teamWorkIdentifier);
  if (anchors.commentId) return `${issueHref}#comment-${anchors.commentId}`;
  if (anchors.handoffId) {
    return `${issueHref}&handoff=${encodeURIComponent(anchors.handoffId)}#handoff-${anchors.handoffId}`;
  }
  return issueHref;
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
  return (
    requestedIdentifier !== null && identifier.toUpperCase() === requestedIdentifier.toUpperCase()
  );
}
