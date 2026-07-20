import { HttpStatus, Injectable } from '@nestjs/common';

import { MembershipRole, MembershipStatus, Prisma, StateCategory } from '@rivet/database';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import { notifyResourceChanged } from '../../common/realtime/notify-resource-changed';
import type { CreateTeamDto } from './dto/create-team.dto';
import type { UpdateTeamDto, VersionDto } from './dto/team-request.dto';
import type { TeamResponseDto } from './dto/team-response.dto';
import { teamOpenIssueConflict, teamResourceNotFound, teamVersionConflict } from './team.errors';
import { TeamRepository } from './team.repository';
import { normalizeTeamResourceName } from './team-input.policy';
import { toTeamResponse, WORKFLOW_STATE_SELECT } from './team-response.mapper';
import { teamUniqueConstraintTargets } from './team-unique.policy';

@Injectable()
export class TeamsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly teams: TeamRepository,
  ) {}

  async create(
    context: { membershipId: string; workspaceId: string },
    dto: CreateTeamDto,
  ): Promise<TeamResponseDto> {
    const { name, normalizedName } = normalizeTeamResourceName(dto.name);
    const key = dto.key.trim();

    try {
      return await this.database.client.$transaction(async (transaction) => {
        const membershipIds = [...new Set([context.membershipId, ...dto.memberIds])].sort();
        const memberships = await transaction.$queryRaw<
          Array<{ id: string; role: MembershipRole; status: MembershipStatus }>
        >`
          SELECT "id", "role", "status"
          FROM "workspace_memberships"
          WHERE "workspace_id" = ${context.workspaceId}::uuid
            AND "id" IN (${Prisma.join(
              membershipIds.map((membershipId) => Prisma.sql`${membershipId}::uuid`),
            )})
          ORDER BY "id"
          FOR UPDATE
        `;
        const requester = memberships.find(({ id }) => id === context.membershipId);
        const activeMembershipIds = new Set(
          memberships
            .filter(({ status }) => status === MembershipStatus.ACTIVE)
            .map(({ id }) => id),
        );

        if (
          requester?.role !== MembershipRole.ADMIN ||
          requester.status !== MembershipStatus.ACTIVE ||
          !dto.memberIds.includes(context.membershipId)
        ) {
          throw new ApiError({
            code: 'FORBIDDEN',
            message: '이 팀을 생성할 권한이 없습니다.',
            status: HttpStatus.FORBIDDEN,
          });
        }

        if (!dto.memberIds.every((membershipId) => activeMembershipIds.has(membershipId))) {
          throw teamResourceNotFound('팀에 추가할 멤버를 찾을 수 없습니다.');
        }

        const team = await transaction.team.create({
          data: { key, name, normalizedName, workspaceId: context.workspaceId },
          select: {
            archivedAt: true,
            id: true,
            key: true,
            name: true,
            version: true,
          },
        });
        await transaction.teamMember.createMany({
          data: dto.memberIds.map((membershipId) => ({
            membershipId,
            teamId: team.id,
            workspaceId: context.workspaceId,
          })),
        });

        const workflowStates = await transaction.workflowState.createManyAndReturn({
          data: [
            {
              category: StateCategory.BACKLOG,
              isDefault: true,
              name: '미분류',
              normalizedName: '미분류',
              position: 0,
              teamId: team.id,
              workspaceId: context.workspaceId,
            },
            {
              category: StateCategory.BACKLOG,
              isDefault: false,
              name: '보류',
              normalizedName: '보류',
              position: 1,
              teamId: team.id,
              workspaceId: context.workspaceId,
            },
            {
              category: StateCategory.UNSTARTED,
              isDefault: false,
              name: '할 일',
              normalizedName: '할 일',
              position: 2,
              teamId: team.id,
              workspaceId: context.workspaceId,
            },
            {
              category: StateCategory.STARTED,
              isDefault: false,
              name: '진행 중',
              normalizedName: '진행 중',
              position: 3,
              teamId: team.id,
              workspaceId: context.workspaceId,
            },
            {
              category: StateCategory.STARTED,
              isDefault: false,
              name: '검토',
              normalizedName: '검토',
              position: 4,
              teamId: team.id,
              workspaceId: context.workspaceId,
            },
            {
              category: StateCategory.COMPLETED,
              isDefault: false,
              name: '완료',
              normalizedName: '완료',
              position: 5,
              teamId: team.id,
              workspaceId: context.workspaceId,
            },
            {
              category: StateCategory.CANCELED,
              isDefault: false,
              name: '취소',
              normalizedName: '취소',
              position: 6,
              teamId: team.id,
              workspaceId: context.workspaceId,
            },
          ],
          select: WORKFLOW_STATE_SELECT,
        });
        await notifyResourceChanged(transaction, {
          changeType: 'CREATED',
          resourceId: team.id,
          resourceType: 'TEAM',
          version: team.version,
          workspaceId: context.workspaceId,
        });

        return {
          archived: team.archivedAt !== null,
          id: team.id,
          key: team.key,
          memberIds: [...dto.memberIds].sort(),
          name: team.name,
          version: team.version,
          workflowStates: workflowStates.sort((left, right) => left.position - right.position),
        };
      });
    } catch (error) {
      return this.throwTeamUniqueConflict(error, context.workspaceId, normalizedName, key);
    }
  }

  async update(workspaceId: string, teamId: string, dto: UpdateTeamDto): Promise<TeamResponseDto> {
    if (dto.name === undefined && dto.key === undefined) {
      throw new ApiError({
        code: 'VALIDATION_ERROR',
        fieldErrors: { name: ['팀 이름이나 키 중 하나를 변경해 주세요.'] },
        message: '변경할 팀 정보를 입력해 주세요.',
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      });
    }

    const normalized = dto.name === undefined ? undefined : normalizeTeamResourceName(dto.name);
    const key = dto.key?.trim();

    try {
      return await this.database.client.$transaction(async (transaction) => {
        const current = await transaction.team.findFirst({
          select: { key: true, name: true, nextIssueNumber: true, version: true },
          where: { archivedAt: null, id: teamId, workspaceId },
        });

        if (!current) {
          throw teamResourceNotFound('팀을 찾을 수 없습니다.');
        }
        if (current.version !== dto.version) {
          throw teamVersionConflict(current.version);
        }

        const changesName = normalized !== undefined && normalized.name !== current.name;
        const changesKey = key !== undefined && key !== current.key;

        if (!changesName && !changesKey) {
          return toTeamResponse(await this.teams.find(transaction, workspaceId, teamId));
        }
        if (changesKey && current.nextIssueNumber !== 1) {
          throw new ApiError({
            code: 'TEAM_KEY_LOCKED',
            message: '팀 작업 번호가 발급된 뒤에는 팀 키를 변경할 수 없습니다.',
            status: HttpStatus.CONFLICT,
          });
        }

        const updated = await transaction.team.updateManyAndReturn({
          data: {
            ...(changesKey ? { key } : {}),
            ...(changesName ? normalized : {}),
            version: { increment: 1 },
          },
          select: { version: true },
          where: {
            archivedAt: null,
            id: teamId,
            ...(changesKey ? { nextIssueNumber: 1 } : {}),
            version: dto.version,
            workspaceId,
          },
        });

        if (updated.length === 0) {
          const latest = await transaction.team.findFirst({
            select: { archivedAt: true, nextIssueNumber: true, version: true },
            where: { id: teamId, workspaceId },
          });
          if (!latest) {
            throw teamResourceNotFound('팀을 찾을 수 없습니다.');
          }
          if (latest.archivedAt !== null) {
            throw teamResourceNotFound('팀을 찾을 수 없습니다.');
          }
          if (changesKey && latest.nextIssueNumber !== 1) {
            throw new ApiError({
              code: 'TEAM_KEY_LOCKED',
              message: '팀 작업 번호가 발급된 뒤에는 팀 키를 변경할 수 없습니다.',
              status: HttpStatus.CONFLICT,
            });
          }
          throw teamVersionConflict(latest.version);
        }
        await notifyResourceChanged(transaction, {
          changeType: 'UPDATED',
          resourceId: teamId,
          resourceType: 'TEAM',
          version: updated[0]!.version,
          workspaceId,
        });

        return toTeamResponse(await this.teams.find(transaction, workspaceId, teamId));
      });
    } catch (error) {
      return this.throwTeamUniqueConflict(error, workspaceId, normalized?.normalizedName, key);
    }
  }

  addMember(workspaceId: string, teamId: string, membershipId: string): Promise<TeamResponseDto> {
    return this.database.client.$transaction(async (transaction) => {
      const accessibleRows = await transaction.$queryRaw<Array<{ teamId: string }>>`
        SELECT team."id" AS "teamId"
        FROM "teams" team
        INNER JOIN "workspace_memberships" membership
          ON membership."workspace_id" = team."workspace_id"
        WHERE team."workspace_id" = ${workspaceId}::uuid
          AND team."id" = ${teamId}::uuid
          AND team."archived_at" IS NULL
          AND membership."id" = ${membershipId}::uuid
          AND membership."status" = ${MembershipStatus.ACTIVE}::"MembershipStatus"
        FOR UPDATE OF team, membership
      `;

      if (!accessibleRows[0]) {
        throw teamResourceNotFound('팀 또는 추가할 활성 멤버를 찾을 수 없습니다.');
      }

      const current = await transaction.teamMember.findUnique({
        select: { removedAt: true },
        where: { teamId_membershipId: { membershipId, teamId } },
      });
      if (current?.removedAt === null) {
        return toTeamResponse(await this.teams.find(transaction, workspaceId, teamId));
      }

      const joinedAt = new Date();
      await transaction.teamMember.upsert({
        create: { joinedAt, membershipId, teamId, workspaceId },
        update: { joinedAt, removedAt: null },
        where: { teamId_membershipId: { membershipId, teamId } },
      });
      const updated = await transaction.team.update({
        data: { version: { increment: 1 } },
        select: { version: true },
        where: { id: teamId },
      });
      await notifyResourceChanged(transaction, {
        changeType: 'UPDATED',
        resourceId: teamId,
        resourceType: 'TEAM',
        version: updated.version,
        workspaceId,
      });

      return toTeamResponse(await this.teams.find(transaction, workspaceId, teamId));
    });
  }

  removeMember(workspaceId: string, teamId: string, membershipId: string): Promise<void> {
    return this.database.client.$transaction(async (transaction) => {
      const currentRows = await transaction.$queryRaw<Array<{ membershipId: string }>>`
        SELECT team_member."membership_id" AS "membershipId"
        FROM "teams" team
        INNER JOIN "team_members" team_member
          ON team_member."workspace_id" = team."workspace_id"
         AND team_member."team_id" = team."id"
        WHERE team."workspace_id" = ${workspaceId}::uuid
          AND team."id" = ${teamId}::uuid
          AND team."archived_at" IS NULL
          AND team_member."membership_id" = ${membershipId}::uuid
          AND team_member."removed_at" IS NULL
        FOR UPDATE OF team, team_member
      `;
      if (!currentRows[0]) {
        throw teamResourceNotFound('팀 또는 팀 멤버를 찾을 수 없습니다.');
      }

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
        WHERE work."workspace_id" = ${workspaceId}::uuid
          AND work."team_id" = ${teamId}::uuid
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
        throw teamOpenIssueConflict(
          'TEAM_MEMBER_HAS_OPEN_ASSIGNMENTS',
          '이 팀의 미완료 담당 작업을 정리한 뒤 멤버를 제거해 주세요.',
          openAssignments,
        );
      }

      await transaction.teamMember.update({
        data: { removedAt: new Date() },
        where: { teamId_membershipId: { membershipId, teamId } },
      });
      const updated = await transaction.team.update({
        data: { version: { increment: 1 } },
        select: { version: true },
        where: { id: teamId },
      });
      await notifyResourceChanged(transaction, {
        changeType: 'UPDATED',
        resourceId: teamId,
        resourceType: 'TEAM',
        version: updated.version,
        workspaceId,
      });
    });
  }

  archive(workspaceId: string, teamId: string, dto: VersionDto): Promise<TeamResponseDto> {
    return this.database.client.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ archivedAt: Date | null; version: number }>>`
        SELECT "archived_at" AS "archivedAt", "version"
        FROM "teams"
        WHERE "workspace_id" = ${workspaceId}::uuid
          AND "id" = ${teamId}::uuid
        FOR UPDATE
      `;
      const current = rows[0];
      if (!current) {
        throw teamResourceNotFound('팀을 찾을 수 없습니다.');
      }
      if (current.version !== dto.version) {
        throw teamVersionConflict(current.version);
      }
      if (current.archivedAt !== null) {
        return toTeamResponse(await this.teams.find(transaction, workspaceId, teamId));
      }

      const openIssues = await transaction.$queryRaw<
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
        WHERE work."workspace_id" = ${workspaceId}::uuid
          AND work."team_id" = ${teamId}::uuid
          AND work."deleted_at" IS NULL
          AND issue."deleted_at" IS NULL
          AND state."category" NOT IN (
            ${StateCategory.COMPLETED}::"StateCategory",
            ${StateCategory.CANCELED}::"StateCategory"
          )
        ORDER BY work."id"
        FOR UPDATE OF work
      `;
      if (openIssues.length > 0) {
        throw teamOpenIssueConflict(
          'TEAM_HAS_OPEN_ISSUES',
          '미완료 팀 작업을 정리한 뒤 팀을 보관해 주세요.',
          openIssues,
        );
      }

      const updated = await transaction.team.updateMany({
        data: { archivedAt: new Date(), version: { increment: 1 } },
        where: { archivedAt: null, id: teamId, version: dto.version, workspaceId },
      });
      if (updated.count === 0) {
        const latest = await transaction.team.findFirst({
          select: { version: true },
          where: { id: teamId, workspaceId },
        });
        if (!latest) {
          throw teamResourceNotFound('팀을 찾을 수 없습니다.');
        }
        throw teamVersionConflict(latest.version);
      }

      const team = toTeamResponse(await this.teams.find(transaction, workspaceId, teamId));
      await notifyResourceChanged(transaction, {
        changeType: 'UPDATED',
        resourceId: teamId,
        resourceType: 'TEAM',
        version: team.version,
        workspaceId,
      });
      return team;
    });
  }

  private async throwTeamUniqueConflict(
    error: unknown,
    workspaceId: string,
    normalizedName?: string,
    key?: string,
  ): Promise<never> {
    if (error instanceof ApiError) {
      throw error;
    }
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }

    const targets = teamUniqueConstraintTargets(error);
    if (
      targets.some(
        (target) =>
          target === 'normalized_name' ||
          target === 'normalizedName' ||
          target.includes('teams_active_normalized_name_key'),
      )
    ) {
      throw new ApiError({
        code: 'TEAM_NAME_IN_USE',
        message: '이미 사용 중인 팀 이름입니다.',
        status: HttpStatus.CONFLICT,
      });
    }
    if (
      targets.some((target) => target === 'key' || target.includes('teams_workspace_id_key_key'))
    ) {
      throw new ApiError({
        code: 'TEAM_KEY_IN_USE',
        message: '이미 사용 중인 팀 키입니다.',
        status: HttpStatus.CONFLICT,
      });
    }

    if (normalizedName) {
      const nameConflict = await this.database.client.team.findFirst({
        select: { id: true },
        where: { archivedAt: null, normalizedName, workspaceId },
      });
      if (nameConflict) {
        throw new ApiError({
          code: 'TEAM_NAME_IN_USE',
          message: '이미 사용 중인 팀 이름입니다.',
          status: HttpStatus.CONFLICT,
        });
      }
    }

    if (key) {
      const keyConflict = await this.database.client.team.findUnique({
        select: { id: true },
        where: { workspaceId_key: { key, workspaceId } },
      });
      if (keyConflict) {
        throw new ApiError({
          code: 'TEAM_KEY_IN_USE',
          message: '이미 사용 중인 팀 키입니다.',
          status: HttpStatus.CONFLICT,
        });
      }
    }

    throw error;
  }
}
