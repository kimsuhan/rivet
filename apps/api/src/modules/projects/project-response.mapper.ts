import { Prisma } from '@rivet/database';

import type { ProjectProgressResponseDto, ProjectResponseDto } from './dto/project-response.dto';
import { projectDateValue } from './project-list.cursor';

export const PROJECT_SELECT = {
  archivedAt: true,
  createdAt: true,
  description: true,
  id: true,
  leadMembership: {
    select: {
      id: true,
      role: true,
      status: true,
      user: { select: { avatarFileId: true, displayName: true, id: true } },
    },
  },
  logoFileId: true,
  name: true,
  projectTeams: {
    orderBy: [{ isActive: 'desc' }, { team: { name: 'asc' } }, { id: 'asc' }],
    select: {
      deactivatedAt: true,
      id: true,
      isActive: true,
      team: { select: { archivedAt: true, id: true, key: true, name: true } },
    },
  },
  startDate: true,
  status: true,
  targetDate: true,
  updatedAt: true,
  version: true,
} satisfies Prisma.ProjectSelect;

export type ProjectRow = Prisma.ProjectGetPayload<{ select: typeof PROJECT_SELECT }>;

export function projectProgress(completed: number, total: number): ProjectProgressResponseDto {
  return {
    completed,
    percentage: total === 0 ? 0 : Math.round((completed / total) * 100),
    total,
  };
}

export function toProjectResponse(
  row: ProjectRow,
  progress: ProjectProgressResponseDto,
): ProjectResponseDto {
  return {
    archived: row.archivedAt !== null,
    createdAt: row.createdAt.toISOString(),
    description: row.description,
    id: row.id,
    lead: row.leadMembership
      ? {
          id: row.leadMembership.id,
          role: row.leadMembership.role,
          status: row.leadMembership.status,
          user: {
            avatarFileId: row.leadMembership.user.avatarFileId,
            displayName: row.leadMembership.user.displayName,
            id: row.leadMembership.user.id,
          },
        }
      : null,
    logoFileId: row.logoFileId,
    name: row.name,
    progress,
    projectTeams: row.projectTeams.map(({ deactivatedAt, id, isActive, team }) => ({
        active: isActive,
        deactivatedAt: deactivatedAt?.toISOString() ?? null,
        id,
        team: {
          archived: team.archivedAt !== null,
          id: team.id,
          key: team.key,
          name: team.name,
        },
      })),
    startDate: projectDateValue(row.startDate),
    status: row.status,
    targetDate: projectDateValue(row.targetDate),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}
