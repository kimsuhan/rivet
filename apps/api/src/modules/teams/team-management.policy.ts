import { HttpStatus, Injectable } from '@nestjs/common';

import { MembershipRole, Prisma, TeamMemberRole } from '@rivet/database';

import { ApiError } from '../../common/errors/api-error';
import { teamResourceNotFound } from './team.errors';

export type TeamManagementContext = {
  membershipId: string;
  role: 'ADMIN' | 'MEMBER';
  workspaceId: string;
};

@Injectable()
export class TeamManagementPolicy {
  async assertCanManageTeam(
    transaction: Prisma.TransactionClient,
    context: TeamManagementContext,
    teamId: string,
  ): Promise<void> {
    const [team] = await transaction.$queryRaw<Array<{ canManage: boolean }>>`
      SELECT (
        ${context.role}::"MembershipRole" = ${MembershipRole.ADMIN}::"MembershipRole"
        OR EXISTS (
          SELECT 1
          FROM "team_members" AS manager
          WHERE manager."workspace_id" = team."workspace_id"
            AND manager."team_id" = team."id"
            AND manager."membership_id" = ${context.membershipId}::uuid
            AND manager."role" = ${TeamMemberRole.LEAD}::"TeamMemberRole"
            AND manager."removed_at" IS NULL
        )
      ) AS "canManage"
      FROM "teams" AS team
      WHERE team."workspace_id" = ${context.workspaceId}::uuid
        AND team."id" = ${teamId}::uuid
        AND team."archived_at" IS NULL
      FOR UPDATE OF team
    `;

    if (!team) {
      throw teamResourceNotFound('팀을 찾을 수 없습니다.');
    }
    if (!team.canManage) {
      throw new ApiError({
        code: 'FORBIDDEN',
        message: '이 팀을 관리할 권한이 없습니다.',
        status: HttpStatus.FORBIDDEN,
      });
    }
  }
}
