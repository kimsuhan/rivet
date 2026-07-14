export function issueWorkHref(issueIdentifier: string, teamWorkIdentifier?: string): string {
  const base = `/issues/${encodeURIComponent(issueIdentifier)}?tab=work`;
  return teamWorkIdentifier
    ? `${base}&work=${encodeURIComponent(teamWorkIdentifier)}`
    : base;
}

export function matchesRequestedTeamWork(
  identifier: string,
  requestedIdentifier: string | null,
): boolean {
  return requestedIdentifier !== null && identifier.toUpperCase() === requestedIdentifier.toUpperCase();
}
