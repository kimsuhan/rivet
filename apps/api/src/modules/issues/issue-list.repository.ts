import { Injectable } from '@nestjs/common';

import { Prisma } from '@rivet/database';

import { DatabaseService } from '../../common/database/database.service';
import type { IssueListCursor } from './issue-list.cursor';
import type {
  IssueGroupField,
  IssueGroupRow,
  IssueListFilters,
  IssueListOrderRow,
  IssueSortClause,
  IssueSortDirection,
  IssueSortField,
} from './issue-list.policy';

function issueGroupValue(field: IssueGroupField): Prisma.Sql {
  switch (field) {
    case 'assigneeMembershipId':
      return Prisma.sql`assignee_group.\"value\"`;
    case 'createdByMembershipId':
      return Prisma.sql`i."created_by_membership_id"::text`;
    case 'priority':
      return Prisma.sql`i."priority"::text`;
    case 'projectId':
      return Prisma.sql`i."project_id"::text`;
    case 'status':
      return Prisma.sql`i."status"::text`;
  }
}

function issueGroupLabel(field: IssueGroupField): Prisma.Sql {
  switch (field) {
    case 'assigneeMembershipId':
      return Prisma.sql`assignee_group.\"label\"`;
    case 'createdByMembershipId':
      return Prisma.sql`creator_user."display_name"`;
    case 'priority':
      return Prisma.sql`i."priority"::text`;
    case 'projectId':
      return Prisma.sql`project."name"`;
    case 'status':
      return Prisma.sql`i."status"::text`;
  }
}

function issueGroupImageFileId(field: IssueGroupField): Prisma.Sql {
  switch (field) {
    case 'assigneeMembershipId':
      return Prisma.sql`assignee_group.\"imageFileId\"`;
    case 'createdByMembershipId':
      return Prisma.sql`creator_user."avatar_file_id"`;
    case 'projectId':
      return Prisma.sql`project."logo_file_id"`;
    case 'priority':
    case 'status':
      return Prisma.sql`NULL::uuid`;
  }
}

function issueAssigneeGroupPredicate(filters: IssueListFilters): Prisma.Sql {
  const predicates: Prisma.Sql[] = [];
  if (filters.assigneeIds.length) {
    predicates.push(
      Prisma.sql`team_work."assignee_membership_id" IN (${Prisma.join(
        filters.assigneeIds.map((id) => Prisma.sql`${id}::uuid`),
      )})`,
    );
  }
  if (filters.unassigned) {
    predicates.push(Prisma.sql`team_work."assignee_membership_id" IS NULL`);
  }
  return predicates.length ? Prisma.sql`(${Prisma.join(predicates, ' OR ')})` : Prisma.sql`TRUE`;
}

function issueAssigneeGroupJoin(filters: IssueListFilters, enabled: boolean): Prisma.Sql {
  if (!enabled) return Prisma.sql``;
  const includeIssuesWithoutTeamWorks = filters.unassigned || filters.assigneeIds.length === 0;
  return Prisma.sql`
    JOIN LATERAL (
      SELECT DISTINCT
        COALESCE(team_work.\"assignee_membership_id\"::text, '__unassigned__') AS "value",
        COALESCE(assignee_user.\"display_name\", '담당자 없음') AS "label",
        assignee_user.\"avatar_file_id\" AS "imageFileId"
      FROM "team_works" team_work
      LEFT JOIN "workspace_memberships" assignee_membership
        ON assignee_membership."workspace_id" = team_work."workspace_id"
        AND assignee_membership."id" = team_work."assignee_membership_id"
      LEFT JOIN "users" assignee_user
        ON assignee_user."id" = assignee_membership."user_id"
      WHERE team_work."workspace_id" = i."workspace_id"
        AND team_work."issue_id" = i."id"
        AND team_work."deleted_at" IS NULL
        AND ${issueAssigneeGroupPredicate(filters)}

      UNION ALL

      SELECT '__unassigned__' AS "value", '담당자 없음' AS "label", NULL::uuid AS "imageFileId"
      WHERE ${includeIssuesWithoutTeamWorks}
        AND NOT EXISTS (
        SELECT 1
        FROM "team_works" existing_team_work
        WHERE existing_team_work."workspace_id" = i."workspace_id"
          AND existing_team_work."issue_id" = i."id"
          AND existing_team_work."deleted_at" IS NULL
      )
    ) assignee_group ON TRUE
  `;
}

function sortColumn(field: IssueSortField): Prisma.Sql {
  switch (field) {
    case 'createdAt':
      return Prisma.sql`ordered."createdAt"`;
    case 'priority':
      return Prisma.sql`ordered."priorityRank"`;
    case 'progress':
      return Prisma.sql`ordered."progress"`;
    case 'status':
      return Prisma.sql`ordered."statusRank"`;
    case 'updatedAt':
      return Prisma.sql`ordered."updatedAt"`;
  }
}

function directionSql(direction: IssueSortDirection): Prisma.Sql {
  return direction === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
}

function comparatorSql(direction: IssueSortDirection): Prisma.Sql {
  return direction === 'asc' ? Prisma.sql`>` : Prisma.sql`<`;
}

function cursorValueSql(value: Date | number): Prisma.Sql {
  return value instanceof Date ? Prisma.sql`${value}` : Prisma.sql`${value}::integer`;
}

function issueCursorPredicate(
  sorts: readonly IssueSortClause[],
  cursor: IssueListCursor | undefined,
): Prisma.Sql {
  if (!cursor) return Prisma.sql`TRUE`;

  const keys = [
    ...sorts.map((sort, index) => ({
      column: sortColumn(sort.field),
      direction: sort.direction,
      value: cursorValueSql(cursor.values[index]!),
    })),
    {
      column: Prisma.sql`ordered."id"`,
      direction: sorts.at(-1)!.direction,
      value: Prisma.sql`${cursor.id}::uuid`,
    },
  ];
  const branches = keys.map((key, keyIndex) => {
    const prefix = keys
      .slice(0, keyIndex)
      .map((previous) => Prisma.sql`${previous.column} = ${previous.value}`);
    return Prisma.sql`(${Prisma.join(
      [...prefix, Prisma.sql`${key.column} ${comparatorSql(key.direction)} ${key.value}`],
      ' AND ',
    )})`;
  });
  return Prisma.sql`(${Prisma.join(branches, ' OR ')})`;
}

function issueFilterPredicates(filters: IssueListFilters): Prisma.Sql[] {
  const predicates = [
    Prisma.sql`i."workspace_id" = ${filters.workspaceId}::uuid`,
    Prisma.sql`i."deleted_at" IS NULL`,
  ];
  if (filters.createdFrom) predicates.push(Prisma.sql`i."created_at" >= ${filters.createdFrom}`);
  if (filters.createdTo) predicates.push(Prisma.sql`i."created_at" <= ${filters.createdTo}`);
  if (filters.updatedFrom) predicates.push(Prisma.sql`i."updated_at" >= ${filters.updatedFrom}`);
  if (filters.updatedTo) predicates.push(Prisma.sql`i."updated_at" <= ${filters.updatedTo}`);
  if (filters.projectIds.length) {
    predicates.push(
      Prisma.sql`i."project_id" IN (${Prisma.join(
        filters.projectIds.map((id) => Prisma.sql`${id}::uuid`),
      )})`,
    );
  }
  if (filters.creatorIds.length) {
    predicates.push(
      Prisma.sql`i."created_by_membership_id" IN (${Prisma.join(
        filters.creatorIds.map((id) => Prisma.sql`${id}::uuid`),
      )})`,
    );
  }
  if (filters.statuses.length) {
    predicates.push(
      Prisma.sql`i."status" IN (${Prisma.join(
        filters.statuses.map((status) => Prisma.sql`${status}::"IssueStatus"`),
      )})`,
    );
  }
  if (filters.priorities.length) {
    predicates.push(
      Prisma.sql`i."priority" IN (${Prisma.join(
        filters.priorities.map((priority) => Prisma.sql`${priority}::"IssuePriority"`),
      )})`,
    );
  }
  if (filters.labelIds.length) {
    predicates.push(
      Prisma.sql`EXISTS (
        SELECT 1
        FROM "issue_labels" il
        WHERE il."workspace_id" = i."workspace_id"
          AND il."issue_id" = i."id"
          AND il."label_id" IN (${Prisma.join(
            filters.labelIds.map((id) => Prisma.sql`${id}::uuid`),
          )})
      )`,
    );
  }
  if (filters.assigneeIds.length || filters.unassigned) {
    const assigneePredicates: Prisma.Sql[] = [];
    if (filters.assigneeIds.length) {
      assigneePredicates.push(Prisma.sql`EXISTS (
        SELECT 1
        FROM "team_works" assignee_tw
        WHERE assignee_tw."workspace_id" = i."workspace_id"
          AND assignee_tw."issue_id" = i."id"
          AND assignee_tw."deleted_at" IS NULL
          AND assignee_tw."assignee_membership_id" IN (${Prisma.join(
            filters.assigneeIds.map((id) => Prisma.sql`${id}::uuid`),
          )})
      )`);
    }
    if (filters.unassigned) {
      assigneePredicates.push(Prisma.sql`(
        NOT EXISTS (
          SELECT 1
          FROM "team_works" any_tw
          WHERE any_tw."workspace_id" = i."workspace_id"
            AND any_tw."issue_id" = i."id"
            AND any_tw."deleted_at" IS NULL
        )
        OR EXISTS (
          SELECT 1
          FROM "team_works" unassigned_tw
          WHERE unassigned_tw."workspace_id" = i."workspace_id"
            AND unassigned_tw."issue_id" = i."id"
            AND unassigned_tw."deleted_at" IS NULL
            AND unassigned_tw."assignee_membership_id" IS NULL
        )
      )`);
    }
    predicates.push(Prisma.sql`(${Prisma.join(assigneePredicates, ' OR ')})`);
  }
  if (filters.query) {
    predicates.push(
      Prisma.sql`(
        strpos(lower(i."identifier"), lower(${filters.query})) > 0
        OR strpos(lower(i."title"), lower(${filters.query})) > 0
      )`,
    );
  }
  return predicates;
}

function issueProgressColumn(sorts: readonly IssueSortClause[]): Prisma.Sql {
  if (!sorts.some(({ field }) => field === 'progress')) return Prisma.sql`0::integer`;

  return Prisma.sql`(
    SELECT CASE
      WHEN COUNT(tw."id") FILTER (
        WHERE ws."category" <> 'CANCELED'::"StateCategory"
      ) = 0 THEN 0
      ELSE ROUND(
        100.0 * COUNT(tw."id") FILTER (
          WHERE ws."category" = 'COMPLETED'::"StateCategory"
        ) / COUNT(tw."id") FILTER (
          WHERE ws."category" <> 'CANCELED'::"StateCategory"
        )
      )::integer
    END
    FROM "team_works" tw
    JOIN "workflow_states" ws
      ON ws."workspace_id" = tw."workspace_id"
      AND ws."team_id" = tw."team_id"
      AND ws."id" = tw."workflow_state_id"
    WHERE tw."workspace_id" = i."workspace_id"
      AND tw."issue_id" = i."id"
      AND tw."deleted_at" IS NULL
  )`;
}

@Injectable()
export class IssueListRepository {
  constructor(private readonly database: DatabaseService) {}

  listOrderRows(
    filters: IssueListFilters,
    sorts: readonly IssueSortClause[],
    cursor: IssueListCursor | undefined,
    take: number,
  ): Promise<IssueListOrderRow[]> {
    const orderBy = [
      ...sorts.map(
        ({ direction, field }) => Prisma.sql`${sortColumn(field)} ${directionSql(direction)}`,
      ),
      Prisma.sql`ordered."id" ${directionSql(sorts.at(-1)!.direction)}`,
    ];

    return this.database.client.$queryRaw<IssueListOrderRow[]>(Prisma.sql`
      WITH ordered AS (
        SELECT
          i."id" AS "id",
          i."created_at" AS "createdAt",
          i."updated_at" AS "updatedAt",
          CASE i."priority"
            WHEN 'NONE'::"IssuePriority" THEN 0
            WHEN 'LOW'::"IssuePriority" THEN 1
            WHEN 'MEDIUM'::"IssuePriority" THEN 2
            WHEN 'HIGH'::"IssuePriority" THEN 3
            WHEN 'URGENT'::"IssuePriority" THEN 4
          END AS "priorityRank",
          CASE i."status"
            WHEN 'UNSORTED'::"IssueStatus" THEN 0
            WHEN 'TODO'::"IssueStatus" THEN 1
            WHEN 'IN_PROGRESS'::"IssueStatus" THEN 2
            WHEN 'REVIEW'::"IssueStatus" THEN 3
            WHEN 'DONE'::"IssueStatus" THEN 4
            WHEN 'PAUSED'::"IssueStatus" THEN 5
            WHEN 'CANCELED'::"IssueStatus" THEN 6
          END AS "statusRank",
          ${issueProgressColumn(sorts)} AS "progress"
        FROM "issues" i
        WHERE ${Prisma.join(issueFilterPredicates(filters), ' AND ')}
      )
      SELECT
        ordered."id",
        ordered."createdAt",
        ordered."updatedAt",
        ordered."priorityRank",
        ordered."statusRank",
        ordered."progress"
      FROM ordered
      WHERE ${issueCursorPredicate(sorts, cursor)}
      ORDER BY ${Prisma.join(orderBy, ', ')}
      LIMIT ${take}
    `);
  }

  count(where: Prisma.IssueWhereInput): Promise<number> {
    return this.database.client.issue.count({ where });
  }

  groupRows(
    filters: IssueListFilters,
    groupBy: IssueGroupField,
    subGroupBy: IssueGroupField | undefined,
  ): Promise<IssueGroupRow[]> {
    const mainValue = issueGroupValue(groupBy);
    const mainLabel = issueGroupLabel(groupBy);
    const mainImageFileId = issueGroupImageFileId(groupBy);
    const subValue = subGroupBy ? issueGroupValue(subGroupBy) : Prisma.sql`NULL::text`;
    const subLabel = subGroupBy ? issueGroupLabel(subGroupBy) : Prisma.sql`NULL::text`;
    const subImageFileId = subGroupBy ? issueGroupImageFileId(subGroupBy) : Prisma.sql`NULL::uuid`;
    const groupColumns = subGroupBy
      ? [mainValue, mainLabel, mainImageFileId, subValue, subLabel, subImageFileId]
      : [mainValue, mainLabel, mainImageFileId];
    const assigneeGroupJoin = issueAssigneeGroupJoin(
      filters,
      groupBy === 'assigneeMembershipId' || subGroupBy === 'assigneeMembershipId',
    );

    return this.database.client.$queryRaw<IssueGroupRow[]>(Prisma.sql`
      SELECT
        ${mainValue} AS "mainValue",
        ${mainLabel} AS "mainLabel",
        ${mainImageFileId} AS "mainImageFileId",
        ${subValue} AS "subValue",
        ${subLabel} AS "subLabel",
        ${subImageFileId} AS "subImageFileId",
        COUNT(DISTINCT i."id")::bigint AS "count"
      FROM "issues" i
      JOIN "projects" project
        ON project."workspace_id" = i."workspace_id"
        AND project."id" = i."project_id"
      JOIN "workspace_memberships" creator_membership
        ON creator_membership."workspace_id" = i."workspace_id"
        AND creator_membership."id" = i."created_by_membership_id"
      JOIN "users" creator_user
        ON creator_user."id" = creator_membership."user_id"
      ${assigneeGroupJoin}
      WHERE ${Prisma.join(issueFilterPredicates(filters), ' AND ')}
      GROUP BY ${Prisma.join(groupColumns, ', ')}
      ORDER BY ${mainLabel} ASC, ${mainValue} ASC, ${subLabel} ASC NULLS FIRST, ${subValue} ASC NULLS FIRST
    `);
  }
}
