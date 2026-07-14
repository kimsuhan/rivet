import { HttpStatus, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { MembershipRole, MembershipStatus, Prisma } from '@rivet/database';
import { ISSUE_PURGE_SCHEDULED, PROJECT_PURGE_SCHEDULED } from '@rivet/event-contracts';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import { notifyResourceChanged } from '../../common/realtime/notify-resource-changed';
import type { TrashListQueryDto } from './dto/trash-request.dto';
import type {
  TrashItemResponseDto,
  TrashListResponseDto,
  TrashRestoreResponseDto,
} from './dto/trash-response.dto';

const DELETER_SELECT = {
  id: true,
  user: { select: { avatarFileId: true, displayName: true } },
} satisfies Prisma.WorkspaceMembershipSelect;

const TRASH_ISSUE_SELECT = {
  createdAt: true,
  deletedAt: true,
  deletedByMembership: { select: DELETER_SELECT },
  id: true,
  identifier: true,
  project: { select: { id: true, name: true } },
  purgeAt: true,
  title: true,
  version: true,
} satisfies Prisma.IssueSelect;

const TRASH_PROJECT_SELECT = {
  createdAt: true,
  deletedAt: true,
  deletedByMembership: { select: DELETER_SELECT },
  id: true,
  name: true,
  purgeAt: true,
  roleTeams: {
    orderBy: { role: 'asc' },
    select: {
      role: true,
      team: { select: { archivedAt: true, id: true, name: true } },
    },
  },
  version: true,
} satisfies Prisma.ProjectSelect;

type TrashIssueRow = Prisma.IssueGetPayload<{ select: typeof TRASH_ISSUE_SELECT }>;
type TrashProjectRow = Prisma.ProjectGetPayload<{ select: typeof TRASH_PROJECT_SELECT }>;
type Transaction = Prisma.TransactionClient;

interface RestoreIssueLockRow {
  databaseNow: Date;
  deletedAt: Date;
  projectId: string;
  purgeAt: Date;
  version: number;
}

interface RestoreProjectLockRow {
  archivedAt: Date | null;
  databaseNow: Date;
  deletedAt: Date;
  purgeAt: Date;
  version: number;
}

function invalidQuery(message: string): never {
  throw new ApiError({ code: 'INVALID_QUERY', message, status: HttpStatus.BAD_REQUEST });
}

function resourceNotFound(): never {
  throw new ApiError({
    code: 'RESOURCE_NOT_FOUND',
    message: '휴지통 리소스를 찾을 수 없습니다.',
    status: HttpStatus.NOT_FOUND,
  });
}

function versionConflict(currentVersion: number): never {
  throw new ApiError({
    code: 'VERSION_CONFLICT',
    currentVersion,
    message: '휴지통 리소스가 다른 요청에서 변경되었습니다.',
    status: HttpStatus.CONFLICT,
  });
}

function parseResourceTypes(value: string | undefined): Array<'ISSUE' | 'PROJECT'> {
  if (value === undefined) return ['ISSUE', 'PROJECT'];
  const types = [...new Set(value.split(',').map((item) => item.trim()))];
  if (types.length === 0 || types.some((type) => type !== 'ISSUE' && type !== 'PROJECT')) {
    invalidQuery('휴지통 리소스 유형을 확인해 주세요.');
  }
  return types as Array<'ISSUE' | 'PROJECT'>;
}

function parseCursor(value: string | undefined): { createdAt: Date; id: string } | null {
  if (value === undefined) return null;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) invalidQuery('커서를 확인해 주세요.');
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) invalidQuery('커서를 확인해 주세요.');
    const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== 'string' ||
      typeof parsed[1] !== 'string' ||
      !isUUID(parsed[1], '4')
    ) {
      invalidQuery('커서를 확인해 주세요.');
    }
    const createdAt = new Date(parsed[0]);
    if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== parsed[0]) {
      invalidQuery('커서를 확인해 주세요.');
    }
    return { createdAt, id: parsed[1] };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return invalidQuery('커서를 확인해 주세요.');
  }
}

function encodeCursor(item: Pick<TrashItemResponseDto, 'createdAt' | 'id'>): string {
  return Buffer.from(JSON.stringify([item.createdAt, item.id])).toString('base64url');
}

function deleter(row: TrashIssueRow | TrashProjectRow) {
  if (!row.deletedByMembership || !row.deletedAt || !row.purgeAt) {
    throw new Error('TRASH_STATE_INVARIANT_VIOLATION');
  }
  return {
    avatarFileId: row.deletedByMembership.user.avatarFileId,
    displayName: row.deletedByMembership.user.displayName,
    id: row.deletedByMembership.id,
  };
}

function issueResponse(row: TrashIssueRow): TrashItemResponseDto {
  if (!row.deletedAt || !row.purgeAt) throw new Error('TRASH_STATE_INVARIANT_VIOLATION');
  return {
    createdAt: row.createdAt.toISOString(),
    deletedAt: row.deletedAt.toISOString(),
    deletedBy: deleter(row),
    id: row.id,
    identifier: row.identifier,
    name: row.title,
    project: row.project,
    purgeAt: row.purgeAt.toISOString(),
    resourceType: 'ISSUE',
    roleTeams: [],
    version: row.version,
  };
}

function projectResponse(row: TrashProjectRow): TrashItemResponseDto {
  if (!row.deletedAt || !row.purgeAt) throw new Error('TRASH_STATE_INVARIANT_VIOLATION');
  return {
    createdAt: row.createdAt.toISOString(),
    deletedAt: row.deletedAt.toISOString(),
    deletedBy: deleter(row),
    id: row.id,
    identifier: null,
    name: row.name,
    project: null,
    purgeAt: row.purgeAt.toISOString(),
    resourceType: 'PROJECT',
    roleTeams: row.roleTeams.map(({ role, team }) => ({
      role,
      teamArchived: team.archivedAt !== null,
      teamId: team.id,
      teamName: team.name,
    })),
    version: row.version,
  };
}

@Injectable()
export class TrashService {
  constructor(private readonly database: DatabaseService) {}

  async list(workspaceId: string, dto: TrashListQueryDto): Promise<TrashListResponseDto> {
    const resourceTypes = parseResourceTypes(dto.resourceType);
    const cursor = parseCursor(dto.cursor);
    const query = dto.query?.normalize('NFC').trim();
    if (query !== undefined && [...query].length === 0) invalidQuery('검색어를 확인해 주세요.');
    const limit = dto.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      invalidQuery('조회 개수를 확인해 주세요.');
    }

    const cursorWhere = cursor
      ? {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        }
      : {};
    const deletedByMembershipId = dto.deletedByMembershipId?.toLowerCase();
    const [issues, projects] = await Promise.all([
      resourceTypes.includes('ISSUE')
        ? this.database.client.issue.findMany({
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: TRASH_ISSUE_SELECT,
            take: limit + 1,
            where: {
              ...cursorWhere,
              deletedAt: { not: null },
              ...(deletedByMembershipId ? { deletedByMembershipId } : {}),
              ...(query
                ? {
                    OR: [
                      { identifier: { contains: query, mode: 'insensitive' as const } },
                      { title: { contains: query, mode: 'insensitive' as const } },
                    ],
                  }
                : {}),
              workspaceId,
            },
          })
        : Promise.resolve([]),
      resourceTypes.includes('PROJECT')
        ? this.database.client.project.findMany({
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: TRASH_PROJECT_SELECT,
            take: limit + 1,
            where: {
              ...cursorWhere,
              deletedAt: { not: null },
              ...(deletedByMembershipId ? { deletedByMembershipId } : {}),
              ...(query ? { name: { contains: query, mode: 'insensitive' } } : {}),
              workspaceId,
            },
          })
        : Promise.resolve([]),
    ]);

    const merged = [...issues.map(issueResponse), ...projects.map(projectResponse)].sort(
      (left, right) => {
        const time = right.createdAt.localeCompare(left.createdAt);
        return time === 0 ? right.id.localeCompare(left.id) : time;
      },
    );
    const page = merged.slice(0, limit);
    return {
      items: page,
      nextCursor: merged.length > limit && page.length > 0 ? encodeCursor(page.at(-1)!) : null,
    };
  }

  async restoreIssue(
    context: { membershipId: string; workspaceId: string },
    issueId: string,
    version: number,
  ): Promise<TrashRestoreResponseDto> {
    return this.database.client.$transaction(async (transaction) => {
      await this.lockAdmin(transaction, context);
      const [issue] = await transaction.$queryRaw<RestoreIssueLockRow[]>`
        SELECT "deleted_at" AS "deletedAt",
               "purge_at" AS "purgeAt",
               "project_id" AS "projectId",
               "version",
               CURRENT_TIMESTAMP AS "databaseNow"
        FROM "issues"
        WHERE "workspace_id" = ${context.workspaceId}::uuid
          AND "id" = ${issueId}::uuid
          AND "deleted_at" IS NOT NULL
        FOR UPDATE
      `;
      if (!issue) resourceNotFound();
      if (issue.version !== version) versionConflict(issue.version);
      if (issue.databaseNow >= issue.purgeAt) resourceNotFound();

      await transaction.issue.update({
        data: {
          deletedAt: null,
          deletedByMembershipId: null,
          purgeAt: null,
          version: { increment: 1 },
        },
        where: { workspaceId_id: { id: issueId, workspaceId: context.workspaceId } },
      });
      await transaction.teamWork.updateMany({
        data: { deletedAt: null },
        where: { issueId, workspaceId: context.workspaceId },
      });
      await transaction.activityEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          beforeData: { purgeAt: issue.purgeAt.toISOString() },
          eventType: 'ISSUE_RESTORED',
          issueId,
          workspaceId: context.workspaceId,
        },
      });
      await transaction.outboxEvent.updateMany({
        data: { canceledAt: new Date() },
        where: {
          aggregateId: issueId,
          canceledAt: null,
          eventType: ISSUE_PURGE_SCHEDULED,
          processedAt: null,
          workspaceId: context.workspaceId,
        },
      });
      await notifyResourceChanged(transaction, {
        changeType: 'RESTORED',
        resourceId: issueId,
        resourceType: 'ISSUE',
        version: issue.version + 1,
        workspaceId: context.workspaceId,
      });

      const warnings: string[] = [];
      if (issue.projectId) {
        const project = await transaction.project.findFirst({
          select: { archivedAt: true, deletedAt: true },
          where: { id: issue.projectId, workspaceId: context.workspaceId },
        });
        if (project?.archivedAt) warnings.push('PROJECT_ARCHIVED');
        if (project?.deletedAt) warnings.push('PROJECT_IN_TRASH');
      }
      const archivedTeamWork = await transaction.teamWork.findFirst({
        select: { id: true },
        where: { issueId, team: { archivedAt: { not: null } }, workspaceId: context.workspaceId },
      });
      if (archivedTeamWork) warnings.push('TEAM_ARCHIVED');

      return { id: issueId, resourceType: 'ISSUE', version: issue.version + 1, warnings };
    });
  }

  async restoreProject(
    context: { membershipId: string; workspaceId: string },
    projectId: string,
    version: number,
  ): Promise<TrashRestoreResponseDto> {
    return this.database.client.$transaction(async (transaction) => {
      await this.lockAdmin(transaction, context);
      const [project] = await transaction.$queryRaw<RestoreProjectLockRow[]>`
        SELECT "archived_at" AS "archivedAt",
               "deleted_at" AS "deletedAt",
               "purge_at" AS "purgeAt",
               "version",
               CURRENT_TIMESTAMP AS "databaseNow"
        FROM "projects"
        WHERE "workspace_id" = ${context.workspaceId}::uuid
          AND "id" = ${projectId}::uuid
          AND "deleted_at" IS NOT NULL
        FOR UPDATE
      `;
      if (!project) resourceNotFound();
      if (project.version !== version) versionConflict(project.version);
      if (project.databaseNow >= project.purgeAt) resourceNotFound();

      await transaction.project.update({
        data: {
          deletedAt: null,
          deletedByMembershipId: null,
          purgeAt: null,
          version: { increment: 1 },
        },
        where: { workspaceId_id: { id: projectId, workspaceId: context.workspaceId } },
      });
      await transaction.activityEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          beforeData: { purgeAt: project.purgeAt.toISOString() },
          eventType: 'PROJECT_RESTORED',
          projectId,
          workspaceId: context.workspaceId,
        },
      });
      await transaction.outboxEvent.updateMany({
        data: { canceledAt: new Date() },
        where: {
          aggregateId: projectId,
          canceledAt: null,
          eventType: PROJECT_PURGE_SCHEDULED,
          processedAt: null,
          workspaceId: context.workspaceId,
        },
      });
      await notifyResourceChanged(transaction, {
        changeType: 'RESTORED',
        resourceId: projectId,
        resourceType: 'PROJECT',
        version: project.version + 1,
        workspaceId: context.workspaceId,
      });

      const warnings = project.archivedAt ? ['PROJECT_ARCHIVED'] : [];
      const archivedRoleTeam = await transaction.projectRoleTeam.findFirst({
        select: { teamId: true },
        where: { projectId, team: { archivedAt: { not: null } }, workspaceId: context.workspaceId },
      });
      if (archivedRoleTeam) warnings.push('TEAM_ARCHIVED');
      return { id: projectId, resourceType: 'PROJECT', version: project.version + 1, warnings };
    });
  }

  private async lockAdmin(
    transaction: Transaction,
    context: { membershipId: string; workspaceId: string },
  ): Promise<void> {
    const [workspace] = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "workspaces"
      WHERE "id" = ${context.workspaceId}::uuid
      FOR UPDATE
    `;
    if (!workspace) resourceNotFound();
    const [membership] = await transaction.$queryRaw<
      Array<{ role: MembershipRole; status: MembershipStatus }>
    >`
      SELECT "role", "status"
      FROM "workspace_memberships"
      WHERE "workspace_id" = ${context.workspaceId}::uuid
        AND "id" = ${context.membershipId}::uuid
      FOR UPDATE
    `;
    if (
      !membership ||
      membership.role !== MembershipRole.ADMIN ||
      membership.status !== MembershipStatus.ACTIVE
    ) {
      throw new ApiError({
        code: 'FORBIDDEN',
        message: '관리자만 휴지통을 관리할 수 있습니다.',
        status: HttpStatus.FORBIDDEN,
      });
    }
  }
}
