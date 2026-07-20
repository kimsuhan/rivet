import { HttpStatus, Injectable } from '@nestjs/common';

import { MembershipStatus, Prisma, ProjectStatus } from '@rivet/database';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import type { ProjectProgressResponseDto } from './dto/project-response.dto';
import { projectNotFound } from './project.errors';
import type { ProjectCursor, ProjectSortDirection, ProjectSortField } from './project-list.cursor';
import { PROJECT_SELECT, projectProgress, type ProjectRow } from './project-response.mapper';

type Transaction = Prisma.TransactionClient;
type DatabaseClient = Transaction | DatabaseService['client'];

export type ProjectLockRow = {
  archivedAt: Date | null;
  description: string | null;
  id: string;
  leadMembershipId: string | null;
  name: string;
  startDate: Date | null;
  status: ProjectStatus;
  targetDate: Date | null;
  version: number;
};

type ProgressRow = {
  completed: bigint;
  projectId: string;
  total: bigint;
};

type ProjectPageCriteria = {
  cursor?: ProjectCursor;
  direction: ProjectSortDirection;
  includeArchived: boolean;
  leadMembershipIds?: string[];
  limit: number;
  sort: ProjectSortField;
  statuses?: ProjectStatus[];
  workspaceId: string;
};

@Injectable()
export class ProjectRepository {
  constructor(private readonly database: DatabaseService) {}

  findPage(criteria: ProjectPageCriteria): Promise<ProjectRow[]> {
    const and: Prisma.ProjectWhereInput[] = [];
    if (criteria.cursor) {
      const idCondition =
        criteria.direction === 'asc' ? { gt: criteria.cursor.id } : { lt: criteria.cursor.id };
      const valueCondition =
        criteria.direction === 'asc'
          ? { gt: criteria.cursor.value! }
          : { lt: criteria.cursor.value! };
      if (criteria.sort === 'updatedAt') {
        and.push({
          OR: [
            { updatedAt: valueCondition },
            { id: idCondition, updatedAt: criteria.cursor.value! },
          ],
        });
      } else if (criteria.cursor.value === null) {
        and.push({ id: idCondition, targetDate: null });
      } else {
        and.push({
          OR: [
            { targetDate: valueCondition },
            { id: idCondition, targetDate: criteria.cursor.value },
            { targetDate: null },
          ],
        });
      }
    }

    return this.database.client.project.findMany({
      orderBy:
        criteria.sort === 'updatedAt'
          ? [{ updatedAt: criteria.direction }, { id: criteria.direction }]
          : [
              { targetDate: { nulls: 'last', sort: criteria.direction } },
              { id: criteria.direction },
            ],
      select: PROJECT_SELECT,
      take: criteria.limit + 1,
      where: {
        ...(and.length > 0 ? { AND: and } : {}),
        ...(criteria.includeArchived ? {} : { archivedAt: null }),
        deletedAt: null,
        ...(criteria.leadMembershipIds
          ? { leadMembershipId: { in: criteria.leadMembershipIds } }
          : {}),
        ...(criteria.statuses ? { status: { in: criteria.statuses } } : {}),
        workspaceId: criteria.workspaceId,
      },
    });
  }

  async findById(workspaceId: string, projectId: string): Promise<ProjectRow> {
    const row = await this.database.client.project.findFirst({
      select: PROJECT_SELECT,
      where: { deletedAt: null, id: projectId, workspaceId },
    });
    return row ?? projectNotFound();
  }

  async find(
    transaction: Transaction,
    workspaceId: string,
    projectId: string,
  ): Promise<ProjectRow> {
    const row = await transaction.project.findFirst({
      select: PROJECT_SELECT,
      where: { deletedAt: null, id: projectId, workspaceId },
    });
    return row ?? projectNotFound();
  }

  async lock(
    transaction: Transaction,
    workspaceId: string,
    projectId: string,
  ): Promise<ProjectLockRow> {
    const [row] = await transaction.$queryRaw<ProjectLockRow[]>`
      SELECT
        "id",
        "name",
        "description",
        "status",
        "lead_membership_id" AS "leadMembershipId",
        "start_date" AS "startDate",
        "target_date" AS "targetDate",
        "archived_at" AS "archivedAt",
        "version"
      FROM "projects"
      WHERE "workspace_id" = ${workspaceId}::uuid
        AND "id" = ${projectId}::uuid
        AND "deleted_at" IS NULL
      FOR UPDATE
    `;
    return row ?? projectNotFound();
  }

  async lockWorkspace(transaction: Transaction, workspaceId: string): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "workspaces"
      WHERE "id" = ${workspaceId}::uuid
      FOR UPDATE
    `;
    if (rows.length !== 1) {
      return projectNotFound();
    }
  }

  async lockActiveMembership(
    transaction: Transaction,
    workspaceId: string,
    membershipId: string | undefined,
  ): Promise<void> {
    if (membershipId === undefined) {
      return;
    }

    const rows = await transaction.$queryRaw<Array<{ id: string; status: MembershipStatus }>>`
      SELECT "id", "status"
      FROM "workspace_memberships"
      WHERE "workspace_id" = ${workspaceId}::uuid
        AND "id" = ${membershipId}::uuid
      FOR UPDATE
    `;
    if (rows.length !== 1 || rows[0]?.status !== MembershipStatus.ACTIVE) {
      return projectNotFound('활성 프로젝트 리드를 찾을 수 없습니다.');
    }
  }

  async lockActorMembership(
    transaction: Transaction,
    workspaceId: string,
    membershipId: string,
  ): Promise<void> {
    const [membership] = await transaction.$queryRaw<Array<{ status: MembershipStatus }>>`
      SELECT "status"
      FROM "workspace_memberships"
      WHERE "workspace_id" = ${workspaceId}::uuid
        AND "id" = ${membershipId}::uuid
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

  async lockActiveTeams(
    transaction: Transaction,
    workspaceId: string,
    teamIds: string[],
  ): Promise<void> {
    const uniqueTeamIds = [...new Set(teamIds)].sort();
    if (uniqueTeamIds.length === 0) {
      return;
    }

    const rows = await transaction.$queryRaw<Array<{ archivedAt: Date | null; id: string }>>`
      SELECT "id", "archived_at" AS "archivedAt"
      FROM "teams"
      WHERE "workspace_id" = ${workspaceId}::uuid
        AND "id" IN (${Prisma.join(uniqueTeamIds.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY "id"
      FOR UPDATE
    `;
    if (
      rows.length !== uniqueTeamIds.length ||
      rows.some(({ archivedAt }) => archivedAt !== null)
    ) {
      return projectNotFound('활성 프로젝트 담당 팀을 찾을 수 없습니다.');
    }
  }

  async progressByProject(
    client: DatabaseClient,
    workspaceId: string,
    projectIds: string[],
  ): Promise<Map<string, ProjectProgressResponseDto>> {
    if (projectIds.length === 0) {
      return new Map();
    }

    const rows = await client.$queryRaw<ProgressRow[]>`
      SELECT
        i."project_id" AS "projectId",
        COUNT(*) FILTER (WHERE s."category" <> 'CANCELED'::"StateCategory") AS "total",
        COUNT(*) FILTER (WHERE s."category" = 'COMPLETED'::"StateCategory") AS "completed"
      FROM "team_works" tw
      JOIN "issues" i
        ON i."workspace_id" = tw."workspace_id"
        AND i."id" = tw."issue_id"
      JOIN "workflow_states" s
        ON s."workspace_id" = tw."workspace_id"
        AND s."team_id" = tw."team_id"
        AND s."id" = tw."workflow_state_id"
      WHERE tw."workspace_id" = ${workspaceId}::uuid
        AND tw."deleted_at" IS NULL
        AND i."deleted_at" IS NULL
        AND i."project_id" IN (${Prisma.join(projectIds.map((id) => Prisma.sql`${id}::uuid`))})
      GROUP BY i."project_id"
    `;
    return new Map(
      rows.map((row) => {
        const completed = Number(row.completed);
        const total = Number(row.total);
        return [row.projectId, projectProgress(completed, total)];
      }),
    );
  }

  progressForRead(
    workspaceId: string,
    projectIds: string[],
  ): Promise<Map<string, ProjectProgressResponseDto>> {
    return this.progressByProject(this.database.client, workspaceId, projectIds);
  }
}
