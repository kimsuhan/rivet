import { MembershipStatus, Prisma } from '@rivet/database';

import type {
  TeamListResponseDto,
  TeamResponseDto,
  WorkflowStateListResponseDto,
} from './dto/team-response.dto';

export const WORKFLOW_STATE_SELECT = {
  category: true,
  id: true,
  isDefault: true,
  name: true,
  position: true,
  version: true,
} satisfies Prisma.WorkflowStateSelect;

export const TEAM_RESPONSE_SELECT = {
  archivedAt: true,
  id: true,
  key: true,
  name: true,
  teamMembers: {
    orderBy: { membershipId: 'asc' },
    select: { membershipId: true },
    where: { membership: { status: MembershipStatus.ACTIVE }, removedAt: null },
  },
  version: true,
  workflowStates: {
    orderBy: { position: 'asc' },
    select: WORKFLOW_STATE_SELECT,
  },
} satisfies Prisma.TeamSelect;

export const TEAM_LIST_SELECT = {
  _count: {
    select: {
      teamMembers: {
        where: { membership: { status: MembershipStatus.ACTIVE }, removedAt: null },
      },
    },
  },
  archivedAt: true,
  id: true,
  key: true,
  name: true,
  version: true,
} satisfies Prisma.TeamSelect;

export type TeamResponseRow = Prisma.TeamGetPayload<{ select: typeof TEAM_RESPONSE_SELECT }>;
export type TeamListRow = Prisma.TeamGetPayload<{ select: typeof TEAM_LIST_SELECT }>;
export type WorkflowStateRow = Prisma.WorkflowStateGetPayload<{
  select: typeof WORKFLOW_STATE_SELECT;
}>;

export function toTeamResponse(team: TeamResponseRow): TeamResponseDto {
  return {
    archived: team.archivedAt !== null,
    id: team.id,
    key: team.key,
    memberIds: team.teamMembers.map(({ membershipId }) => membershipId),
    name: team.name,
    version: team.version,
    workflowStates: team.workflowStates,
  };
}

export function toTeamListResponse(teams: TeamListRow[]): TeamListResponseDto {
  return {
    items: teams.map((team) => ({
      archived: team.archivedAt !== null,
      id: team.id,
      key: team.key,
      memberCount: team._count.teamMembers,
      name: team.name,
      version: team.version,
    })),
    nextCursor: null,
  };
}

export function toWorkflowStateListResponse(
  items: WorkflowStateRow[],
): WorkflowStateListResponseDto {
  return { items, nextCursor: null };
}
