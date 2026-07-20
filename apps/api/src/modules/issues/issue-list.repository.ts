import { Injectable } from '@nestjs/common';

import { Prisma } from '@rivet/database';

import { DatabaseService } from '../../common/database/database.service';
import type { IssueListCursor } from './issue-list.cursor';
import type {
  IssueListFilters,
  IssueListOrderRow,
  IssueSortClause,
  IssueSortDirection,
  IssueSortField,
} from './issue-list.policy';

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
}
