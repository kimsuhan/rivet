import { HttpStatus, Injectable } from '@nestjs/common';

import { MembershipStatus, Prisma, StateCategory } from '@rivet/database';

import { ApiError } from '../../common/errors/api-error';
import type { IssueCollaborationContext } from './issue-collaboration.context';
import { collaborationResourceNotFound } from './issue-collaboration.errors';

export type HandoffTeamWorkLockRow = {
  category: StateCategory;
  id: string;
  issueId: string;
  projectId: string;
  projectTeamId: string;
  teamId: string;
};

@Injectable()
export class IssueCollaborationLockService {
  async lockWorkspace(transaction: Prisma.TransactionClient, workspaceId: string): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "workspaces"
      WHERE "id" = ${workspaceId}::uuid
      FOR UPDATE
    `;
    if (rows.length === 0) collaborationResourceNotFound('워크스페이스를 찾을 수 없습니다.');
  }

  async lockActiveActor(
    transaction: Prisma.TransactionClient,
    context: IssueCollaborationContext,
  ): Promise<void> {
    const [membership] = await transaction.$queryRaw<Array<{ status: MembershipStatus }>>`
      SELECT "status"
      FROM "workspace_memberships"
      WHERE "workspace_id" = ${context.workspaceId}::uuid
        AND "id" = ${context.membershipId}::uuid
      FOR UPDATE
    `;
    if (!membership || membership.status !== MembershipStatus.ACTIVE) {
      throw new ApiError({
        code: 'FORBIDDEN',
        message: '활성 워크스페이스 멤버만 이 작업을 수행할 수 있습니다.',
        status: HttpStatus.FORBIDDEN,
      });
    }
  }

  async lockIssue(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    issueId: string,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "issues"
      WHERE "workspace_id" = ${workspaceId}::uuid AND "id" = ${issueId}::uuid AND "deleted_at" IS NULL
      FOR UPDATE
    `;
    if (rows.length === 0) collaborationResourceNotFound('이슈를 찾을 수 없습니다.');
  }

  async lockHandoffTeamWork(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    teamWorkId: string,
  ): Promise<HandoffTeamWorkLockRow> {
    const [row] = await transaction.$queryRaw<HandoffTeamWorkLockRow[]>`
      SELECT "work"."id", "work"."issue_id" AS "issueId", "work"."project_team_id" AS "projectTeamId", "work"."team_id" AS "teamId",
             "issue"."project_id" AS "projectId", "state"."category"
      FROM "team_works" AS "work"
      INNER JOIN "issues" AS "issue"
        ON "issue"."workspace_id" = "work"."workspace_id" AND "issue"."id" = "work"."issue_id" AND "issue"."deleted_at" IS NULL
      INNER JOIN "workflow_states" AS "state"
        ON "state"."workspace_id" = "work"."workspace_id" AND "state"."id" = "work"."workflow_state_id"
      WHERE "work"."workspace_id" = ${workspaceId}::uuid AND "work"."id" = ${teamWorkId}::uuid AND "work"."deleted_at" IS NULL
      FOR UPDATE OF "work"
    `;
    if (!row) collaborationResourceNotFound('팀 작업을 찾을 수 없습니다.');
    return row;
  }
}
