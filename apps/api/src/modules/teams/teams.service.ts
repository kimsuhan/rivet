import { HttpStatus, Injectable } from '@nestjs/common';

import { MembershipRole, MembershipStatus, Prisma, StateCategory } from '@rivet/database';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import { notifyResourceChanged } from '../../common/realtime/notify-resource-changed';
import type { CreateTeamDto } from './dto/create-team.dto';
import type { TeamListQueryDto, UpdateTeamDto, VersionDto } from './dto/team-request.dto';
import type {
  TeamListResponseDto,
  TeamResponseDto,
  WorkflowStateListResponseDto,
  WorkflowStateResponseDto,
} from './dto/team-response.dto';
import type {
  DeleteWorkflowStateQueryDto,
  ReorderWorkflowStatesDto,
  UpdateWorkflowStateDto,
} from './dto/workflow-state-request.dto';

function normalizeName(value: string): { name: string; normalizedName: string } {
  const name = value.normalize('NFC').trim();
  return { name, normalizedName: name.toLowerCase() };
}

function uniqueTargets(error: Prisma.PrismaClientKnownRequestError): string[] {
  const target = error.meta?.target;

  if (typeof target === 'string') {
    return [target];
  }

  return Array.isArray(target)
    ? target.filter((value): value is string => typeof value === 'string')
    : [];
}

function resourceNotFound(message: string): ApiError {
  return new ApiError({ code: 'RESOURCE_NOT_FOUND', message, status: HttpStatus.NOT_FOUND });
}

function versionConflict(currentVersion: number): ApiError {
  return new ApiError({
    code: 'VERSION_CONFLICT',
    currentVersion,
    message: '리소스가 다른 요청에서 변경되었습니다.',
    status: HttpStatus.CONFLICT,
  });
}

function openIssueConflict(
  code: 'TEAM_HAS_OPEN_ISSUES' | 'TEAM_MEMBER_HAS_OPEN_ASSIGNMENTS',
  message: string,
  issues: Array<{ id: string; identifier: string; title: string }>,
): ApiError {
  return new ApiError({ code, details: { issues }, message, status: HttpStatus.CONFLICT });
}

@Injectable()
export class TeamsService {
  constructor(private readonly database: DatabaseService) {}

  async create(
    context: { membershipId: string; workspaceId: string },
    dto: CreateTeamDto,
  ): Promise<TeamResponseDto> {
    const { name, normalizedName } = normalizeName(dto.name);
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
          throw resourceNotFound('팀에 추가할 멤버를 찾을 수 없습니다.');
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
              category: StateCategory.UNSTARTED,
              isDefault: false,
              name: '할 일',
              normalizedName: '할 일',
              position: 1,
              teamId: team.id,
              workspaceId: context.workspaceId,
            },
            {
              category: StateCategory.STARTED,
              isDefault: false,
              name: '진행 중',
              normalizedName: '진행 중',
              position: 2,
              teamId: team.id,
              workspaceId: context.workspaceId,
            },
            {
              category: StateCategory.STARTED,
              isDefault: false,
              name: '검토',
              normalizedName: '검토',
              position: 3,
              teamId: team.id,
              workspaceId: context.workspaceId,
            },
            {
              category: StateCategory.COMPLETED,
              isDefault: false,
              name: '완료',
              normalizedName: '완료',
              position: 4,
              teamId: team.id,
              workspaceId: context.workspaceId,
            },
            {
              category: StateCategory.BACKLOG,
              isDefault: false,
              name: '보류',
              normalizedName: '보류',
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
          select: {
            category: true,
            id: true,
            isDefault: true,
            name: true,
            position: true,
            version: true,
          },
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

  async list(workspaceId: string, query: TeamListQueryDto): Promise<TeamListResponseDto> {
    const teams = await this.database.client.team.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
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
      },
      where: {
        ...(query.includeArchived ? {} : { archivedAt: null }),
        workspaceId,
      },
    });

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

  get(workspaceId: string, teamId: string): Promise<TeamResponseDto> {
    return this.findTeamResponse(this.database.client, workspaceId, teamId);
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

    const normalized = dto.name === undefined ? undefined : normalizeName(dto.name);
    const key = dto.key?.trim();

    try {
      return await this.database.client.$transaction(async (transaction) => {
        const current = await transaction.team.findFirst({
          select: { key: true, name: true, nextIssueNumber: true, version: true },
          where: { archivedAt: null, id: teamId, workspaceId },
        });

        if (!current) {
          throw resourceNotFound('팀을 찾을 수 없습니다.');
        }
        if (current.version !== dto.version) {
          throw versionConflict(current.version);
        }

        const changesName = normalized !== undefined && normalized.name !== current.name;
        const changesKey = key !== undefined && key !== current.key;

        if (!changesName && !changesKey) {
          return this.findTeamResponse(transaction, workspaceId, teamId);
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
            throw resourceNotFound('팀을 찾을 수 없습니다.');
          }
          if (latest.archivedAt !== null) {
            throw resourceNotFound('팀을 찾을 수 없습니다.');
          }
          if (changesKey && latest.nextIssueNumber !== 1) {
            throw new ApiError({
              code: 'TEAM_KEY_LOCKED',
              message: '팀 작업 번호가 발급된 뒤에는 팀 키를 변경할 수 없습니다.',
              status: HttpStatus.CONFLICT,
            });
          }
          throw versionConflict(latest.version);
        }
        await notifyResourceChanged(transaction, {
          changeType: 'UPDATED',
          resourceId: teamId,
          resourceType: 'TEAM',
          version: updated[0]!.version,
          workspaceId,
        });

        return this.findTeamResponse(transaction, workspaceId, teamId);
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
        throw resourceNotFound('팀 또는 추가할 활성 멤버를 찾을 수 없습니다.');
      }

      const current = await transaction.teamMember.findUnique({
        select: { removedAt: true },
        where: { teamId_membershipId: { membershipId, teamId } },
      });
      if (current?.removedAt === null) {
        return this.findTeamResponse(transaction, workspaceId, teamId);
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

      return this.findTeamResponse(transaction, workspaceId, teamId);
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
        throw resourceNotFound('팀 또는 팀 멤버를 찾을 수 없습니다.');
      }

      const openAssignments = await transaction.$queryRaw<
        Array<{ id: string; identifier: string; title: string }>
      >`
        SELECT issue."id", issue."identifier", issue."title"
        FROM "issues" issue
        INNER JOIN "workflow_states" state
          ON state."workspace_id" = issue."workspace_id"
         AND state."team_id" = issue."team_id"
         AND state."id" = issue."workflow_state_id"
        WHERE issue."workspace_id" = ${workspaceId}::uuid
          AND issue."team_id" = ${teamId}::uuid
          AND issue."assignee_membership_id" = ${membershipId}::uuid
          AND issue."deleted_at" IS NULL
          AND state."category" NOT IN (
            ${StateCategory.COMPLETED}::"StateCategory",
            ${StateCategory.CANCELED}::"StateCategory"
          )
        ORDER BY issue."id"
        FOR UPDATE OF issue
      `;
      if (openAssignments.length > 0) {
        throw openIssueConflict(
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
        throw resourceNotFound('팀을 찾을 수 없습니다.');
      }
      if (current.version !== dto.version) {
        throw versionConflict(current.version);
      }
      if (current.archivedAt !== null) {
        return this.findTeamResponse(transaction, workspaceId, teamId);
      }

      const openIssues = await transaction.$queryRaw<
        Array<{ id: string; identifier: string; title: string }>
      >`
        SELECT issue."id", issue."identifier", issue."title"
        FROM "issues" issue
        INNER JOIN "workflow_states" state
          ON state."workspace_id" = issue."workspace_id"
         AND state."team_id" = issue."team_id"
         AND state."id" = issue."workflow_state_id"
        WHERE issue."workspace_id" = ${workspaceId}::uuid
          AND issue."team_id" = ${teamId}::uuid
          AND issue."deleted_at" IS NULL
          AND state."category" NOT IN (
            ${StateCategory.COMPLETED}::"StateCategory",
            ${StateCategory.CANCELED}::"StateCategory"
          )
        ORDER BY issue."id"
        FOR UPDATE OF issue
      `;
      if (openIssues.length > 0) {
        throw openIssueConflict(
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
          throw resourceNotFound('팀을 찾을 수 없습니다.');
        }
        throw versionConflict(latest.version);
      }

      const team = await this.findTeamResponse(transaction, workspaceId, teamId);
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

  async listWorkflowStates(
    workspaceId: string,
    teamId: string,
  ): Promise<WorkflowStateListResponseDto> {
    const team = await this.database.client.team.findFirst({
      select: { id: true },
      where: { id: teamId, workspaceId },
    });
    if (!team) {
      throw resourceNotFound('팀을 찾을 수 없습니다.');
    }

    return this.findWorkflowStates(this.database.client, workspaceId, teamId);
  }

  async updateWorkflowState(
    workspaceId: string,
    stateId: string,
    dto: UpdateWorkflowStateDto,
  ): Promise<WorkflowStateResponseDto> {
    const { name, normalizedName } = normalizeName(dto.name);

    try {
      const current = await this.database.client.workflowState.findFirst({
        select: {
          category: true,
          id: true,
          isDefault: true,
          name: true,
          position: true,
          version: true,
        },
        where: { id: stateId, team: { archivedAt: null }, workspaceId },
      });
      if (!current) {
        throw resourceNotFound('워크플로 상태를 찾을 수 없습니다.');
      }
      if (current.version !== dto.version) {
        throw versionConflict(current.version);
      }
      if (current.name === name) {
        return current;
      }

      const updated = await this.database.client.$transaction(async (transaction) => {
        const [result] = await transaction.workflowState.updateManyAndReturn({
          data: { name, normalizedName, version: { increment: 1 } },
          select: {
            category: true,
            id: true,
            isDefault: true,
            name: true,
            position: true,
            version: true,
          },
          where: {
            id: stateId,
            team: { archivedAt: null },
            version: dto.version,
            workspaceId,
          },
        });
        if (result) {
          await notifyResourceChanged(transaction, {
            changeType: 'UPDATED',
            resourceId: result.id,
            resourceType: 'WORKFLOW_STATE',
            version: result.version,
            workspaceId,
          });
        }
        return result ?? null;
      });
      if (updated) {
        return updated;
      }

      const latest = await this.database.client.workflowState.findFirst({
        select: { team: { select: { archivedAt: true } }, version: true },
        where: { id: stateId, workspaceId },
      });
      if (!latest) {
        throw resourceNotFound('워크플로 상태를 찾을 수 없습니다.');
      }
      if (latest.team.archivedAt !== null) {
        throw resourceNotFound('워크플로 상태를 찾을 수 없습니다.');
      }
      throw versionConflict(latest.version);
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        uniqueTargets(error).some((target) =>
          ['normalized_name', 'normalizedName'].includes(target),
        )
      ) {
        throw new ApiError({
          code: 'VALIDATION_ERROR',
          fieldErrors: { name: ['같은 이름의 워크플로 상태가 이미 있습니다.'] },
          message: '같은 이름의 워크플로 상태가 이미 있습니다.',
          status: HttpStatus.UNPROCESSABLE_ENTITY,
        });
      }
      throw error;
    }
  }

  reorderWorkflowStates(
    workspaceId: string,
    teamId: string,
    dto: ReorderWorkflowStatesDto,
  ): Promise<WorkflowStateListResponseDto> {
    return this.database.client.$transaction(async (transaction) => {
      const teams = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "teams"
        WHERE "workspace_id" = ${workspaceId}::uuid
          AND "id" = ${teamId}::uuid
          AND "archived_at" IS NULL
        FOR UPDATE
      `;
      if (!teams[0]) {
        throw resourceNotFound('팀을 찾을 수 없습니다.');
      }

      const states = await transaction.$queryRaw<
        Array<{ id: string; position: number; version: number }>
      >`
        SELECT "id", "position", "version"
        FROM "workflow_states"
        WHERE "workspace_id" = ${workspaceId}::uuid
          AND "team_id" = ${teamId}::uuid
        ORDER BY "id"
        FOR UPDATE
      `;
      const currentById = new Map(states.map((state) => [state.id, state]));

      if (dto.states.some((state) => !currentById.has(state.id))) {
        throw resourceNotFound('워크플로 상태를 찾을 수 없습니다.');
      }
      if (dto.states.length !== states.length) {
        throw new ApiError({
          code: 'VALIDATION_ERROR',
          fieldErrors: { states: ['현재 팀의 모든 상태를 한 번씩 입력해 주세요.'] },
          message: '상태 순서 요청이 완전하지 않습니다.',
          status: HttpStatus.UNPROCESSABLE_ENTITY,
        });
      }

      for (const requested of dto.states) {
        const current = currentById.get(requested.id);
        if (current && current.version !== requested.version) {
          throw versionConflict(current.version);
        }
      }

      const currentOrder = [...states]
        .sort((left, right) => left.position - right.position)
        .map(({ id }) => id);
      if (currentOrder.every((id, index) => id === dto.states[index]?.id)) {
        return this.findWorkflowStates(transaction, workspaceId, teamId);
      }

      const temporaryPositionStart = Math.max(...states.map(({ position }) => position)) + 1;
      for (const [index, state] of dto.states.entries()) {
        await transaction.workflowState.update({
          data: { position: temporaryPositionStart + index },
          where: { id: state.id },
        });
      }

      const updated: WorkflowStateResponseDto[] = [];
      for (const [position, state] of dto.states.entries()) {
        updated.push(
          await transaction.workflowState.update({
            data: { position, version: { increment: 1 } },
            select: {
              category: true,
              id: true,
              isDefault: true,
              name: true,
              position: true,
              version: true,
            },
            where: { id: state.id },
          }),
        );
      }
      for (const state of updated) {
        await notifyResourceChanged(transaction, {
          changeType: 'UPDATED',
          resourceId: state.id,
          resourceType: 'WORKFLOW_STATE',
          version: state.version,
          workspaceId,
        });
      }

      return { items: updated, nextCursor: null };
    });
  }

  deleteWorkflowState(
    context: { membershipId: string; workspaceId: string },
    stateId: string,
    query: DeleteWorkflowStateQueryDto,
  ): Promise<void> {
    return this.database.client.$transaction(async (transaction) => {
      if (query.replacementStateId === stateId) {
        throw new ApiError({
          code: 'VALIDATION_ERROR',
          fieldErrors: { replacementStateId: ['삭제할 상태와 다른 대체 상태를 선택해 주세요.'] },
          message: '대체 상태가 올바르지 않습니다.',
          status: HttpStatus.UNPROCESSABLE_ENTITY,
        });
      }

      const targets = await transaction.$queryRaw<
        Array<{
          category: StateCategory;
          id: string;
          isDefault: boolean;
          name: string;
          teamId: string;
          version: number;
        }>
      >`
        SELECT state."id", state."category", state."is_default" AS "isDefault", state."name",
               state."team_id" AS "teamId", state."version"
        FROM "workflow_states" state
        INNER JOIN "teams" team
          ON team."workspace_id" = state."workspace_id"
         AND team."id" = state."team_id"
        WHERE state."workspace_id" = ${context.workspaceId}::uuid
          AND state."id" = ${stateId}::uuid
          AND team."archived_at" IS NULL
        FOR UPDATE OF team, state
      `;
      const target = targets[0];
      if (!target) {
        throw resourceNotFound('워크플로 상태를 찾을 수 없습니다.');
      }
      if (target.version !== query.version) {
        throw versionConflict(target.version);
      }

      if (target.category === StateCategory.UNSTARTED) {
        const [usage] = await transaction.$queryRaw<
          Array<{ activeRoleCount: number; unstartedCount: number }>
        >`
          SELECT
            COUNT(DISTINCT role."project_id")::int AS "activeRoleCount",
            COUNT(state."id")::int AS "unstartedCount"
          FROM "workflow_states" state
          LEFT JOIN "project_role_teams" role
            ON role."workspace_id" = state."workspace_id"
           AND role."team_id" = state."team_id"
          LEFT JOIN "projects" project
            ON project."workspace_id" = role."workspace_id"
           AND project."id" = role."project_id"
           AND project."archived_at" IS NULL
           AND project."deleted_at" IS NULL
          WHERE state."workspace_id" = ${context.workspaceId}::uuid
            AND state."team_id" = ${target.teamId}::uuid
            AND state."category" = 'UNSTARTED'::"StateCategory"
        `;
        if ((usage?.activeRoleCount ?? 0) > 0 && (usage?.unstartedCount ?? 0) <= 1) {
          throw new ApiError({
            code: 'TEAM_UNSTARTED_STATE_REQUIRED',
            message: '활성 프로젝트 역할에 연결된 팀은 시작 전 상태를 하나 이상 유지해야 합니다.',
            status: HttpStatus.CONFLICT,
          });
        }
      }

      const states = await transaction.$queryRaw<
        Array<{ id: string; name: string; position: number; version: number }>
      >`
        SELECT "id", "name", "position", "version"
        FROM "workflow_states"
        WHERE "workspace_id" = ${context.workspaceId}::uuid
          AND "team_id" = ${target.teamId}::uuid
        ORDER BY "id"
        FOR UPDATE
      `;
      const stateIds = new Set(states.map(({ id }) => id));

      if (query.replacementStateId && !stateIds.has(query.replacementStateId)) {
        throw resourceNotFound('대체할 워크플로 상태를 찾을 수 없습니다.');
      }

      const affectedIssues = await transaction.$queryRaw<
        Array<{ id: string; identifier: string; title: string }>
      >`
        SELECT "id", "identifier", "title"
        FROM "issues"
        WHERE "workspace_id" = ${context.workspaceId}::uuid
          AND "team_id" = ${target.teamId}::uuid
          AND "workflow_state_id" = ${target.id}::uuid
        ORDER BY "id"
        FOR UPDATE
      `;
      if ((target.isDefault || affectedIssues.length > 0) && !query.replacementStateId) {
        throw new ApiError({
          code: 'WORKFLOW_STATE_IN_USE',
          details: { issues: affectedIssues },
          message: '사용 중인 상태를 삭제하려면 같은 팀의 대체 상태를 선택해 주세요.',
          status: HttpStatus.CONFLICT,
        });
      }

      if (query.replacementStateId && affectedIssues.length > 0) {
        const replacement = states.find(({ id }) => id === query.replacementStateId);
        if (!replacement) {
          throw resourceNotFound('대체할 워크플로 상태를 찾을 수 없습니다.');
        }
        const reassignedIssues = await transaction.issue.updateManyAndReturn({
          data: { version: { increment: 1 }, workflowStateId: replacement.id },
          select: { id: true, version: true },
          where: {
            id: { in: affectedIssues.map(({ id }) => id) },
            workspaceId: context.workspaceId,
          },
        });
        await transaction.activityEvent.createMany({
          data: affectedIssues.map((issue) => ({
            actorMembershipId: context.membershipId,
            afterData: { id: replacement.id, name: replacement.name },
            beforeData: { id: target.id, name: target.name },
            eventType: 'ISSUE_UPDATED',
            fieldName: 'workflowStateId',
            issueId: issue.id,
            workspaceId: context.workspaceId,
          })),
        });
        for (const issue of reassignedIssues) {
          await notifyResourceChanged(transaction, {
            changeType: 'UPDATED',
            resourceId: issue.id,
            resourceType: 'ISSUE',
            version: issue.version,
            workspaceId: context.workspaceId,
          });
        }
      }

      await transaction.workflowState.delete({ where: { id: target.id } });

      const remainingStates = states
        .filter(({ id }) => id !== target.id)
        .sort((left, right) => left.position - right.position);
      const movedStates = remainingStates.filter((state, position) => state.position !== position);
      const temporaryPositionStart = Math.max(...states.map(({ position }) => position)) + 1;

      for (const [index, state] of movedStates.entries()) {
        await transaction.workflowState.update({
          data: { position: temporaryPositionStart + index },
          where: { id: state.id },
        });
      }

      for (const [position, state] of remainingStates.entries()) {
        const moves = state.position !== position;
        const becomesDefault = target.isDefault && state.id === query.replacementStateId;

        if (moves || becomesDefault) {
          await transaction.workflowState.update({
            data: {
              ...(becomesDefault ? { isDefault: true } : {}),
              ...(moves ? { position } : {}),
              version: { increment: 1 },
            },
            where: { id: state.id },
          });
          await notifyResourceChanged(transaction, {
            changeType: 'UPDATED',
            resourceId: state.id,
            resourceType: 'WORKFLOW_STATE',
            version: state.version + 1,
            workspaceId: context.workspaceId,
          });
        }
      }
      await notifyResourceChanged(transaction, {
        changeType: 'DELETED',
        resourceId: target.id,
        resourceType: 'WORKFLOW_STATE',
        version: null,
        workspaceId: context.workspaceId,
      });
    });
  }

  private async findTeamResponse(
    client: Prisma.TransactionClient | typeof this.database.client,
    workspaceId: string,
    teamId: string,
  ): Promise<TeamResponseDto> {
    const team = await client.team.findFirst({
      select: {
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
          select: {
            category: true,
            id: true,
            isDefault: true,
            name: true,
            position: true,
            version: true,
          },
        },
      },
      where: { id: teamId, workspaceId },
    });

    if (!team) {
      throw resourceNotFound('팀을 찾을 수 없습니다.');
    }

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

  private async findWorkflowStates(
    client: Prisma.TransactionClient | typeof this.database.client,
    workspaceId: string,
    teamId: string,
  ): Promise<WorkflowStateListResponseDto> {
    const items = await client.workflowState.findMany({
      orderBy: { position: 'asc' },
      select: {
        category: true,
        id: true,
        isDefault: true,
        name: true,
        position: true,
        version: true,
      },
      where: { teamId, workspaceId },
    });

    return { items, nextCursor: null };
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

    const targets = uniqueTargets(error);
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
