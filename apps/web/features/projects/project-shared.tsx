import type { ProjectResponseDto, ProjectRoleTeamResponseDto } from '@rivet/api-client';

import { Badge } from '@/components/ui/badge';

export type ProjectLabels = {
  noWork: string;
  progress: string;
  roles: Record<'APP_FRONTEND' | 'BACKEND' | 'WEB_FRONTEND', string>;
  statuses: Record<'CANCELED' | 'COMPLETED' | 'IN_PROGRESS' | 'PLANNED', string>;
};

export function ProjectProgress({
  labels,
  progress,
}: {
  labels: Pick<ProjectLabels, 'noWork' | 'progress'>;
  progress: ProjectResponseDto['progress'];
}) {
  const description =
    progress.total === 0
      ? labels.noWork
      : labels.progress
          .replace('{completed}', String(progress.completed))
          .replace('{total}', String(progress.total))
          .replace('{percentage}', String(progress.percentage));

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-muted-foreground text-xs tabular-nums">{description}</span>
      <progress
        aria-label={description}
        className="accent-primary h-1.5 w-full overflow-hidden rounded-full"
        max={100}
        value={progress.percentage}
      />
    </div>
  );
}

export function ProjectStatusBadge({
  labels,
  status,
}: {
  labels: ProjectLabels['statuses'];
  status: ProjectResponseDto['status'];
}) {
  return <Badge variant="secondary">{labels[status]}</Badge>;
}

export function ProjectRoleBadges({
  labels,
  roleTeams,
}: {
  labels: ProjectLabels['roles'];
  roleTeams: ProjectRoleTeamResponseDto[];
}) {
  return (
    <div className="flex min-w-0 flex-wrap gap-2">
      {roleTeams.map(({ role, team }) => (
        <Badge key={role} variant="outline" className="max-w-full">
          <span>{labels[role]}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate">{team.name}</span>
        </Badge>
      ))}
    </div>
  );
}
