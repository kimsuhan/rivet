import { MembershipRole, MembershipStatus, Prisma, TeamMemberRole } from '@rivet/database';

import type {
  TeamListResponseDto,
  TeamResponseDto,
  WorkflowStateListResponseDto,
} from './dto/team-response.dto';

export const WORKFLOW_STATE_SELECT = {
  category: true,
  color: true,
  disabledAt: true,
  id: true,
  isDefault: true,
  name: true,
  position: true,
  version: true,
} satisfies Prisma.WorkflowStateSelect;

export const TEAM_RESPONSE_SELECT = {
  archivedAt: true,
  description: true,
  id: true,
  key: true,
  name: true,
  teamMembers: {
    orderBy: { membershipId: 'asc' },
    select: { membershipId: true, role: true },
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
  description: true,
  id: true,
  key: true,
  name: true,
  teamMembers: {
    orderBy: { membershipId: 'asc' },
    select: { membershipId: true, role: true },
    where: { membership: { status: MembershipStatus.ACTIVE }, removedAt: null },
  },
  version: true,
} satisfies Prisma.TeamSelect;

export type TeamResponseRow = Prisma.TeamGetPayload<{ select: typeof TEAM_RESPONSE_SELECT }>;
export type TeamListRow = Prisma.TeamGetPayload<{ select: typeof TEAM_LIST_SELECT }>;
export type WorkflowStateRow = Prisma.WorkflowStateGetPayload<{
  select: typeof WORKFLOW_STATE_SELECT;
}>;

type TeamResponseContext = { membershipId: string; role: 'ADMIN' | 'MEMBER' };

function canManageTeam(
  context: TeamResponseContext,
  teamMembers: Array<{ membershipId: string; role: TeamMemberRole }>,
): boolean {
  return (
    context.role === MembershipRole.ADMIN ||
    teamMembers.some(
      ({ membershipId, role }) =>
        membershipId === context.membershipId && role === TeamMemberRole.LEAD,
    )
  );
}

export function toTeamResponse(
  team: TeamResponseRow,
  context: TeamResponseContext,
): TeamResponseDto {
  return {
    archived: team.archivedAt !== null,
    canManage: canManageTeam(context, team.teamMembers),
    description: team.description,
    id: team.id,
    key: team.key,
    leaderIds: team.teamMembers
      .filter(({ role }) => role === TeamMemberRole.LEAD)
      .map(({ membershipId }) => membershipId),
    memberIds: team.teamMembers.map(({ membershipId }) => membershipId),
    name: team.name,
    version: team.version,
    workflowStates: team.workflowStates,
  };
}

export function toTeamListResponse(
  teams: TeamListRow[],
  context: TeamResponseContext,
): TeamListResponseDto {
  return {
    items: teams.map((team) => ({
      archived: team.archivedAt !== null,
      canManage: canManageTeam(context, team.teamMembers),
      description: team.description,
      id: team.id,
      key: team.key,
      leaderCount: team.teamMembers.filter(({ role }) => role === TeamMemberRole.LEAD).length,
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
