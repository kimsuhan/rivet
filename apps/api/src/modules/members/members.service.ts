import { HttpStatus, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { MembershipStatus, Prisma, StateCategory } from '@rivet/database';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import { notifyResourceChanged } from '../../common/realtime/notify-resource-changed';
import type {
  MemberDetailResponseDto,
  MemberListQueryDto,
  MemberListResponseDto,
  MemberSummaryResponseDto,
} from './dto/member.dto';

const MEMBER_DETAIL_SELECT = {
  deactivatedAt: true,
  id: true,
  joinedAt: true,
  role: true,
  status: true,
  teamMemberships: {
    select: {
      team: { select: { archivedAt: true, id: true, key: true, name: true } },
    },
    where: { removedAt: null },
  },
  user: { select: { avatarFileId: true, displayName: true, email: true, id: true } },
} satisfies Prisma.WorkspaceMembershipSelect;

type MemberDetailRow = Prisma.WorkspaceMembershipGetPayload<{
  select: typeof MEMBER_DETAIL_SELECT;
}>;

type MemberSummaryRow = {
  deactivatedAt: Date | null;
  id: string;
  joinedAt: Date;
  role: 'ADMIN' | 'MEMBER';
  status: 'ACTIVE' | 'INACTIVE';
  user: { avatarFileId: string | null; displayName: string; email: string; id: string };
};

function invalidQuery(message: string): never {
  throw new ApiError({ code: 'INVALID_QUERY', message, status: HttpStatus.BAD_REQUEST });
}

function parseStatuses(value: string | undefined): MembershipStatus[] {
  if (value === undefined) {
    return [MembershipStatus.ACTIVE, MembershipStatus.INACTIVE];
  }

  const statuses = value.split(',').map((status) => status.trim());
  if (statuses.some((status) => status.length === 0)) {
    invalidQuery('멤버 상태 필터를 확인해 주세요.');
  }

  return [
    ...new Set(
      statuses.map((status) => {
        if (status === MembershipStatus.ACTIVE || status === MembershipStatus.INACTIVE) {
          return status;
        }
        return invalidQuery('멤버 상태 필터를 확인해 주세요.');
      }),
    ),
  ];
}

function parseCursor(value: string | undefined): { id: string; joinedAt: Date } | null {
  if (value === undefined) {
    return null;
  }

  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) {
      return invalidQuery('커서를 확인해 주세요.');
    }

    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) {
      return invalidQuery('커서를 확인해 주세요.');
    }

    const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== 'string' ||
      typeof parsed[1] !== 'string' ||
      !isUUID(parsed[1], '4')
    ) {
      return invalidQuery('커서를 확인해 주세요.');
    }

    const joinedAt = new Date(parsed[0]);
    if (Number.isNaN(joinedAt.getTime()) || joinedAt.toISOString() !== parsed[0]) {
      return invalidQuery('커서를 확인해 주세요.');
    }

    return { id: parsed[1], joinedAt };
  } catch {
    return invalidQuery('커서를 확인해 주세요.');
  }
}

function encodeCursor(row: Pick<MemberSummaryRow, 'id' | 'joinedAt'>): string {
  return Buffer.from(JSON.stringify([row.joinedAt.toISOString(), row.id])).toString('base64url');
}

function toMemberSummary(row: MemberSummaryRow, includeEmail: boolean): MemberSummaryResponseDto {
  const response: MemberSummaryResponseDto = {
    deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
    id: row.id,
    joinedAt: row.joinedAt.toISOString(),
    role: row.role,
    status: row.status,
    user: {
      avatarFileId: row.user.avatarFileId,
      displayName: row.user.displayName,
      id: row.user.id,
    },
  };

  if (includeEmail) {
    response.email = row.user.email;
  }

  return response;
}

function toMemberDetail(row: MemberDetailRow, includeEmail: boolean): MemberDetailResponseDto {
  const teams = row.teamMemberships
    .map(({ team }) => ({
      archived: team.archivedAt !== null,
      id: team.id,
      key: team.key,
      name: team.name,
    }))
    .sort(
      (left, right) => left.name.localeCompare(right.name, 'ko') || left.id.localeCompare(right.id),
    );

  return { ...toMemberSummary(row, includeEmail), teams };
}

@Injectable()
export class MembersService {
  constructor(private readonly database: DatabaseService) {}

  async list(
    context: { includeEmail: boolean; workspaceId: string | null },
    dto: MemberListQueryDto,
  ): Promise<MemberListResponseDto> {
    const workspaceId = this.requireWorkspace(context.workspaceId);
    const statuses = parseStatuses(dto.status);
    const cursor = parseCursor(dto.cursor);
    const limit = dto.limit ?? 50;
    const query = dto.query?.trim();

    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      invalidQuery('조회 개수를 확인해 주세요.');
    }
    if (dto.query !== undefined && (!query || [...query].length > 100)) {
      invalidQuery('검색어를 확인해 주세요.');
    }
    if (dto.teamId !== undefined) {
      if (!isUUID(dto.teamId, '4')) {
        invalidQuery('팀 필터를 확인해 주세요.');
      }

      const team = await this.database.client.team.findFirst({
        select: { id: true },
        where: { id: dto.teamId, workspaceId },
      });
      if (!team) {
        throw new ApiError({
          code: 'RESOURCE_NOT_FOUND',
          message: '요청한 팀을 찾을 수 없습니다.',
          status: HttpStatus.NOT_FOUND,
        });
      }
    }

    const and: Prisma.WorkspaceMembershipWhereInput[] = [];
    if (query) {
      const search: Prisma.WorkspaceMembershipWhereInput[] = [
        { user: { displayName: { contains: query, mode: 'insensitive' } } },
      ];
      if (context.includeEmail) {
        search.push({
          user: { normalizedEmail: { contains: query.toLowerCase() } },
        });
      }
      and.push({ OR: search });
    }
    if (cursor) {
      and.push({
        OR: [
          { joinedAt: { gt: cursor.joinedAt } },
          { id: { gt: cursor.id }, joinedAt: cursor.joinedAt },
        ],
      });
    }

    const where: Prisma.WorkspaceMembershipWhereInput = {
      AND: and,
      status: { in: statuses },
      workspaceId,
    };
    if (dto.teamId) {
      where.teamMemberships = { some: { removedAt: null, teamId: dto.teamId } };
    }

    const rows = await this.database.client.workspaceMembership.findMany({
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
      select: {
        deactivatedAt: true,
        id: true,
        joinedAt: true,
        role: true,
        status: true,
        user: { select: { avatarFileId: true, displayName: true, email: true, id: true } },
      },
      take: limit + 1,
      where,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);

    return {
      items: page.map((row) => toMemberSummary(row, context.includeEmail)),
      nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
    };
  }

  async get(
    context: { includeEmail: boolean; workspaceId: string | null },
    membershipId: string,
  ): Promise<MemberDetailResponseDto> {
    const workspaceId = this.requireWorkspace(context.workspaceId);
    const member = await this.findDetail(this.database.client, workspaceId, membershipId);
    return toMemberDetail(member, context.includeEmail);
  }

  async deactivate(
    context: { membershipId: string; workspaceId: string },
    membershipId: string,
  ): Promise<MemberDetailResponseDto> {
    const member = await this.database.client.$transaction(async (transaction) => {
      const [target] = await transaction.$queryRaw<
        Array<{
          deactivatedAt: Date | null;
          id: string;
          status: 'ACTIVE' | 'INACTIVE';
          userId: string;
        }>
      >`
        SELECT "id",
               "user_id" AS "userId",
               "status",
               "deactivated_at" AS "deactivatedAt"
        FROM "workspace_memberships"
        WHERE "workspace_id" = ${context.workspaceId}::uuid
          AND "id" = ${membershipId}::uuid
        FOR UPDATE
      `;

      if (!target) {
        throw new ApiError({
          code: 'RESOURCE_NOT_FOUND',
          message: '요청한 멤버를 찾을 수 없습니다.',
          status: HttpStatus.NOT_FOUND,
        });
      }
      if (target.id === context.membershipId) {
        throw new ApiError({
          code: 'FORBIDDEN',
          message: '관리자는 자기 자신을 비활성화할 수 없습니다.',
          status: HttpStatus.FORBIDDEN,
        });
      }

      const revokedAt = new Date();
      if (target.status === MembershipStatus.ACTIVE) {
        const openAssignments = await transaction.$queryRaw<
          Array<{ id: string; identifier: string; title: string }>
        >`
          SELECT work."id", work."identifier", issue."title"
          FROM "team_works" work
          INNER JOIN "issues" issue
            ON issue."workspace_id" = work."workspace_id"
           AND issue."id" = work."issue_id"
          INNER JOIN "workflow_states" state
            ON state."workspace_id" = work."workspace_id"
           AND state."team_id" = work."team_id"
           AND state."id" = work."workflow_state_id"
          WHERE work."workspace_id" = ${context.workspaceId}::uuid
            AND work."assignee_membership_id" = ${membershipId}::uuid
            AND work."deleted_at" IS NULL
            AND issue."deleted_at" IS NULL
            AND state."category" NOT IN (
              ${StateCategory.COMPLETED}::"StateCategory",
              ${StateCategory.CANCELED}::"StateCategory"
            )
          ORDER BY work."id"
          FOR UPDATE OF work
        `;
        if (openAssignments.length > 0) {
          throw new ApiError({
            code: 'MEMBER_HAS_OPEN_ASSIGNMENTS',
            details: { issues: openAssignments },
            message: '미완료 담당 작업을 정리한 뒤 멤버를 비활성화해 주세요.',
            status: HttpStatus.CONFLICT,
          });
        }

        const updated = await transaction.workspaceMembership.updateMany({
          data: { deactivatedAt: revokedAt, status: MembershipStatus.INACTIVE },
          where: {
            id: membershipId,
            status: MembershipStatus.ACTIVE,
            workspaceId: context.workspaceId,
          },
        });
        if (updated.count === 1) {
          await notifyResourceChanged(transaction, {
            changeType: 'UPDATED',
            resourceId: membershipId,
            resourceType: 'MEMBER',
            version: null,
            workspaceId: context.workspaceId,
          });
        }
      }
      await transaction.session.updateMany({
        data: { revokedAt },
        where: { revokedAt: null, userId: target.userId },
      });

      return this.findDetail(transaction, context.workspaceId, membershipId);
    });

    return toMemberDetail(member, true);
  }

  private async findDetail(
    client: Pick<Prisma.TransactionClient, 'workspaceMembership'>,
    workspaceId: string,
    membershipId: string,
  ): Promise<MemberDetailRow> {
    const member = await client.workspaceMembership.findFirst({
      select: MEMBER_DETAIL_SELECT,
      where: { id: membershipId, workspaceId },
    });

    if (!member) {
      throw new ApiError({
        code: 'RESOURCE_NOT_FOUND',
        message: '요청한 멤버를 찾을 수 없습니다.',
        status: HttpStatus.NOT_FOUND,
      });
    }

    return member;
  }

  private requireWorkspace(workspaceId: string | null): string {
    if (!workspaceId) {
      throw new ApiError({
        code: 'RESOURCE_NOT_FOUND',
        message: '현재 워크스페이스를 찾을 수 없습니다.',
        status: HttpStatus.NOT_FOUND,
      });
    }
    return workspaceId;
  }
}
