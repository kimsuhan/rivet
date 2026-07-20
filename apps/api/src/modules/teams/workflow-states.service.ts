import { HttpStatus, Injectable } from '@nestjs/common';

import { Prisma, StateCategory } from '@rivet/database';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import { notifyResourceChanged } from '../../common/realtime/notify-resource-changed';
import type {
  WorkflowStateListResponseDto,
  WorkflowStateResponseDto,
} from './dto/team-response.dto';
import type {
  CreateWorkflowStateDto,
  DeleteWorkflowStateQueryDto,
  ReorderWorkflowStatesDto,
  SetWorkflowStateDefaultDto,
  UpdateWorkflowStateDto,
} from './dto/workflow-state-request.dto';
import { teamResourceNotFound, teamVersionConflict } from './team.errors';
import { TeamRepository } from './team.repository';
import { normalizeTeamResourceName } from './team-input.policy';
import { type TeamManagementContext, TeamManagementPolicy } from './team-management.policy';
import { toWorkflowStateListResponse, WORKFLOW_STATE_SELECT } from './team-response.mapper';
import { teamUniqueConstraintTargets } from './team-unique.policy';
import { workflowStateCategoryRank } from './workflow-state-order.policy';

@Injectable()
export class WorkflowStatesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly management: TeamManagementPolicy,
    private readonly teams: TeamRepository,
  ) {}

  async createWorkflowState(
    context: TeamManagementContext,
    teamId: string,
    dto: CreateWorkflowStateDto,
  ): Promise<WorkflowStateResponseDto> {
    const { name, normalizedName } = normalizeTeamResourceName(dto.name);
    const workspaceId = context.workspaceId;

    try {
      return await this.database.client.$transaction(async (transaction) => {
        await this.management.assertCanManageTeam(transaction, context, teamId);

        const states = await transaction.workflowState.findMany({
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
          select: { category: true, id: true, position: true, version: true },
          where: { teamId, workspaceId },
        });
        const categoryRank = workflowStateCategoryRank(dto.category);
        const lastCategoryState = states.findLast((state) => state.category === dto.category);
        const firstLaterState = states.find(
          (state) => workflowStateCategoryRank(state.category) > categoryRank,
        );
        const position = lastCategoryState
          ? lastCategoryState.position + 1
          : (firstLaterState?.position ?? (states.at(-1)?.position ?? -1) + 1);

        const shiftedStates: WorkflowStateResponseDto[] = [];
        for (const state of states
          .filter((candidate) => candidate.position >= position)
          .sort((left, right) => right.position - left.position)) {
          shiftedStates.push(
            await transaction.workflowState.update({
              data: { position: { increment: 1 }, version: { increment: 1 } },
              select: WORKFLOW_STATE_SELECT,
              where: { id: state.id },
            }),
          );
        }
        const created = await transaction.workflowState.create({
          data: {
            category: dto.category,
            ...(dto.color ? { color: dto.color } : {}),
            name,
            normalizedName,
            position,
            teamId,
            workspaceId,
          },
          select: WORKFLOW_STATE_SELECT,
        });
        for (const state of shiftedStates) {
          await notifyResourceChanged(transaction, {
            changeType: 'UPDATED',
            resourceId: state.id,
            resourceType: 'WORKFLOW_STATE',
            version: state.version,
            workspaceId,
          });
        }
        await notifyResourceChanged(transaction, {
          changeType: 'CREATED',
          resourceId: created.id,
          resourceType: 'WORKFLOW_STATE',
          version: created.version,
          workspaceId,
        });
        return created;
      });
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        teamUniqueConstraintTargets(error).some((target) => target.includes('normalized_name'))
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

  setDefaultWorkflowState(
    context: TeamManagementContext,
    stateId: string,
    dto: SetWorkflowStateDefaultDto,
  ): Promise<WorkflowStateListResponseDto> {
    return this.database.client.$transaction(async (transaction) => {
      const workspaceId = context.workspaceId;
      const targets = await transaction.$queryRaw<
        Array<{
          disabledAt: Date | null;
          id: string;
          isDefault: boolean;
          teamId: string;
          version: number;
        }>
      >`
        SELECT state."id", state."is_default" AS "isDefault", state."team_id" AS "teamId",
               state."disabled_at" AS "disabledAt", state."version"
        FROM "workflow_states" state
        INNER JOIN "teams" team
          ON team."workspace_id" = state."workspace_id"
         AND team."id" = state."team_id"
        WHERE state."workspace_id" = ${workspaceId}::uuid
          AND state."id" = ${stateId}::uuid
          AND team."archived_at" IS NULL
        FOR UPDATE OF team, state
      `;
      const target = targets[0];
      if (!target) {
        throw teamResourceNotFound('워크플로 상태를 찾을 수 없습니다.');
      }
      await this.management.assertCanManageTeam(transaction, context, target.teamId);
      if (target.version !== dto.version) {
        throw teamVersionConflict(target.version);
      }
      if (target.disabledAt) {
        throw new ApiError({
          code: 'WORKFLOW_STATE_DISABLED',
          message: '사용 중지된 상태는 기본 상태로 지정할 수 없습니다.',
          status: HttpStatus.CONFLICT,
        });
      }
      if (target.isDefault) {
        return toWorkflowStateListResponse(
          await this.teams.findWorkflowStates(transaction, workspaceId, target.teamId),
        );
      }

      const previousDefaults = await transaction.workflowState.updateManyAndReturn({
        data: { isDefault: false, version: { increment: 1 } },
        select: WORKFLOW_STATE_SELECT,
        where: { isDefault: true, teamId: target.teamId, workspaceId },
      });
      const updated = await transaction.workflowState.update({
        data: { isDefault: true, version: { increment: 1 } },
        select: WORKFLOW_STATE_SELECT,
        where: { id: target.id },
      });
      for (const state of [...previousDefaults, updated]) {
        await notifyResourceChanged(transaction, {
          changeType: 'UPDATED',
          resourceId: state.id,
          resourceType: 'WORKFLOW_STATE',
          version: state.version,
          workspaceId,
        });
      }

      return toWorkflowStateListResponse(
        await this.teams.findWorkflowStates(transaction, workspaceId, target.teamId),
      );
    });
  }

  async updateWorkflowState(
    context: TeamManagementContext,
    stateId: string,
    dto: UpdateWorkflowStateDto,
  ): Promise<WorkflowStateResponseDto> {
    const { name, normalizedName } = normalizeTeamResourceName(dto.name);
    const workspaceId = context.workspaceId;

    try {
      return await this.database.client.$transaction(async (transaction) => {
        const current = await transaction.workflowState.findFirst({
          select: { ...WORKFLOW_STATE_SELECT, teamId: true },
          where: { id: stateId, team: { archivedAt: null }, workspaceId },
        });
        if (!current) {
          throw teamResourceNotFound('워크플로 상태를 찾을 수 없습니다.');
        }
        await this.management.assertCanManageTeam(transaction, context, current.teamId);
        if (current.version !== dto.version) {
          throw teamVersionConflict(current.version);
        }
        if (current.name === name && (dto.color === undefined || current.color === dto.color)) {
          return current;
        }

        const [result] = await transaction.workflowState.updateManyAndReturn({
          data: {
            ...(dto.color !== undefined ? { color: dto.color } : {}),
            name,
            normalizedName,
            version: { increment: 1 },
          },
          select: WORKFLOW_STATE_SELECT,
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
        if (!result) {
          throw teamVersionConflict(current.version);
        }
        return result;
      });
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        teamUniqueConstraintTargets(error).some((target) =>
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
    context: TeamManagementContext,
    teamId: string,
    dto: ReorderWorkflowStatesDto,
  ): Promise<WorkflowStateListResponseDto> {
    return this.database.client.$transaction(async (transaction) => {
      const workspaceId = context.workspaceId;
      await this.management.assertCanManageTeam(transaction, context, teamId);

      const states = await transaction.$queryRaw<
        Array<{ category: StateCategory; id: string; position: number; version: number }>
      >`
        SELECT "category", "id", "position", "version"
        FROM "workflow_states"
        WHERE "workspace_id" = ${workspaceId}::uuid
          AND "team_id" = ${teamId}::uuid
        ORDER BY "id"
        FOR UPDATE
      `;
      const currentById = new Map(states.map((state) => [state.id, state]));

      if (dto.states.some((state) => !currentById.has(state.id))) {
        throw teamResourceNotFound('워크플로 상태를 찾을 수 없습니다.');
      }
      if (
        dto.states.length !== states.length ||
        new Set(dto.states.map(({ id }) => id)).size !== states.length
      ) {
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
          throw teamVersionConflict(current.version);
        }
      }

      const requestedCategories = dto.states.map(({ id }) => currentById.get(id)?.category);
      if (
        requestedCategories.some((category, index) => {
          const previousCategory = requestedCategories[index - 1];
          return (
            category !== undefined &&
            previousCategory !== undefined &&
            workflowStateCategoryRank(category) < workflowStateCategoryRank(previousCategory)
          );
        })
      ) {
        throw new ApiError({
          code: 'VALIDATION_ERROR',
          fieldErrors: { states: ['상태는 같은 시스템 범주 안에서만 순서를 바꿀 수 있습니다.'] },
          message: '시스템 범주의 표시 순서는 변경할 수 없습니다.',
          status: HttpStatus.UNPROCESSABLE_ENTITY,
        });
      }

      const currentOrder = [...states]
        .sort((left, right) => left.position - right.position)
        .map(({ id }) => id);
      if (currentOrder.every((id, index) => id === dto.states[index]?.id)) {
        return toWorkflowStateListResponse(
          await this.teams.findWorkflowStates(transaction, workspaceId, teamId),
        );
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
            select: WORKFLOW_STATE_SELECT,
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

  disableWorkflowState(
    context: TeamManagementContext,
    stateId: string,
    dto: SetWorkflowStateDefaultDto,
  ): Promise<WorkflowStateResponseDto> {
    return this.database.client.$transaction(async (transaction) => {
      const [target] = await transaction.$queryRaw<
        Array<{
          category: StateCategory;
          disabledAt: Date | null;
          id: string;
          isDefault: boolean;
          teamId: string;
          version: number;
        }>
      >`
        SELECT state."id", state."category", state."disabled_at" AS "disabledAt",
               state."is_default" AS "isDefault", state."team_id" AS "teamId", state."version"
        FROM "workflow_states" AS state
        INNER JOIN "teams" AS team
          ON team."workspace_id" = state."workspace_id"
         AND team."id" = state."team_id"
        WHERE state."workspace_id" = ${context.workspaceId}::uuid
          AND state."id" = ${stateId}::uuid
          AND team."archived_at" IS NULL
        FOR UPDATE OF team, state
      `;
      if (!target) {
        throw teamResourceNotFound('워크플로 상태를 찾을 수 없습니다.');
      }
      await this.management.assertCanManageTeam(transaction, context, target.teamId);
      if (target.version !== dto.version) {
        throw teamVersionConflict(target.version);
      }
      if (target.disabledAt !== null) {
        return transaction.workflowState.findUniqueOrThrow({
          select: WORKFLOW_STATE_SELECT,
          where: { id: target.id },
        });
      }
      if (target.isDefault) {
        throw new ApiError({
          code: 'WORKFLOW_STATE_DEFAULT_REQUIRED',
          message: '다른 기본 상태를 지정한 뒤 이 상태를 사용 중지해 주세요.',
          status: HttpStatus.CONFLICT,
        });
      }

      if (target.category === StateCategory.UNSTARTED) {
        const [usage] = await transaction.$queryRaw<
          Array<{ activeProjectCount: number; enabledUnstartedCount: number }>
        >`
          SELECT
            (
              SELECT COUNT(*)::int
              FROM "project_teams" AS project_team
              INNER JOIN "projects" AS project
                ON project."workspace_id" = project_team."workspace_id"
               AND project."id" = project_team."project_id"
               AND project."archived_at" IS NULL
               AND project."deleted_at" IS NULL
              WHERE project_team."workspace_id" = ${context.workspaceId}::uuid
                AND project_team."team_id" = ${target.teamId}::uuid
                AND project_team."is_active" = true
            ) AS "activeProjectCount",
            (
              SELECT COUNT(*)::int
              FROM "workflow_states"
              WHERE "workspace_id" = ${context.workspaceId}::uuid
                AND "team_id" = ${target.teamId}::uuid
                AND "category" = ${StateCategory.UNSTARTED}::"StateCategory"
                AND "disabled_at" IS NULL
            ) AS "enabledUnstartedCount"
        `;
        if ((usage?.activeProjectCount ?? 0) > 0 && (usage?.enabledUnstartedCount ?? 0) <= 1) {
          throw new ApiError({
            code: 'TEAM_UNSTARTED_STATE_REQUIRED',
            message: '활성 프로젝트에 참여 중인 팀은 시작 전 상태를 하나 이상 유지해야 합니다.',
            status: HttpStatus.CONFLICT,
          });
        }
      }

      const updated = await transaction.workflowState.update({
        data: { disabledAt: new Date(), version: { increment: 1 } },
        select: WORKFLOW_STATE_SELECT,
        where: { id: target.id },
      });
      await notifyResourceChanged(transaction, {
        changeType: 'UPDATED',
        resourceId: updated.id,
        resourceType: 'WORKFLOW_STATE',
        version: updated.version,
        workspaceId: context.workspaceId,
      });
      return updated;
    });
  }

  restoreWorkflowState(
    context: TeamManagementContext,
    stateId: string,
    dto: SetWorkflowStateDefaultDto,
  ): Promise<WorkflowStateResponseDto> {
    return this.database.client.$transaction(async (transaction) => {
      const current = await transaction.workflowState.findFirst({
        select: { ...WORKFLOW_STATE_SELECT, teamId: true },
        where: { id: stateId, team: { archivedAt: null }, workspaceId: context.workspaceId },
      });
      if (!current) {
        throw teamResourceNotFound('워크플로 상태를 찾을 수 없습니다.');
      }
      await this.management.assertCanManageTeam(transaction, context, current.teamId);
      if (current.version !== dto.version) {
        throw teamVersionConflict(current.version);
      }
      if (current.disabledAt === null) {
        return current;
      }

      const updated = await transaction.workflowState.update({
        data: { disabledAt: null, version: { increment: 1 } },
        select: WORKFLOW_STATE_SELECT,
        where: { id: current.id },
      });
      await notifyResourceChanged(transaction, {
        changeType: 'UPDATED',
        resourceId: updated.id,
        resourceType: 'WORKFLOW_STATE',
        version: updated.version,
        workspaceId: context.workspaceId,
      });
      return updated;
    });
  }

  deleteWorkflowState(
    context: TeamManagementContext,
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
        throw teamResourceNotFound('워크플로 상태를 찾을 수 없습니다.');
      }
      await this.management.assertCanManageTeam(transaction, context, target.teamId);
      if (target.version !== query.version) {
        throw teamVersionConflict(target.version);
      }

      if (target.category === StateCategory.UNSTARTED) {
        const [usage] = await transaction.$queryRaw<
          Array<{ activeProjectCount: number; unstartedCount: number }>
        >`
          SELECT
            (
              SELECT COUNT(*)::int
              FROM "project_teams" project_team
              INNER JOIN "projects" project
                ON project."workspace_id" = project_team."workspace_id"
               AND project."id" = project_team."project_id"
               AND project."archived_at" IS NULL
               AND project."deleted_at" IS NULL
              WHERE project_team."workspace_id" = ${context.workspaceId}::uuid
                AND project_team."team_id" = ${target.teamId}::uuid
                AND project_team."is_active" = true
            ) AS "activeProjectCount",
            (
              SELECT COUNT(*)::int
              FROM "workflow_states" state
              WHERE state."workspace_id" = ${context.workspaceId}::uuid
                AND state."team_id" = ${target.teamId}::uuid
                AND state."category" = 'UNSTARTED'::"StateCategory"
                AND state."disabled_at" IS NULL
            ) AS "unstartedCount"
        `;
        if ((usage?.activeProjectCount ?? 0) > 0 && (usage?.unstartedCount ?? 0) <= 1) {
          throw new ApiError({
            code: 'TEAM_UNSTARTED_STATE_REQUIRED',
            message: '활성 프로젝트에 참여 중인 팀은 시작 전 상태를 하나 이상 유지해야 합니다.',
            status: HttpStatus.CONFLICT,
          });
        }
      }

      const states = await transaction.$queryRaw<
        Array<{
          disabledAt: Date | null;
          id: string;
          name: string;
          position: number;
          version: number;
        }>
      >`
        SELECT "id", "disabled_at" AS "disabledAt", "name", "position", "version"
        FROM "workflow_states"
        WHERE "workspace_id" = ${context.workspaceId}::uuid
          AND "team_id" = ${target.teamId}::uuid
        ORDER BY "id"
        FOR UPDATE
      `;
      const stateIds = new Set(states.map(({ id }) => id));

      if (query.replacementStateId && !stateIds.has(query.replacementStateId)) {
        throw teamResourceNotFound('대체할 워크플로 상태를 찾을 수 없습니다.');
      }
      if (
        query.replacementStateId &&
        states.find(({ id }) => id === query.replacementStateId)?.disabledAt
      ) {
        throw new ApiError({
          code: 'WORKFLOW_STATE_DISABLED',
          message: '사용 중지된 상태를 대체 상태로 사용할 수 없습니다.',
          status: HttpStatus.CONFLICT,
        });
      }

      const affectedIssues = await transaction.$queryRaw<
        Array<{ id: string; identifier: string; issueId: string; title: string }>
      >`
        SELECT work."id", work."identifier", work."issue_id" AS "issueId", issue."title"
        FROM "team_works" work
        INNER JOIN "issues" issue
          ON issue."workspace_id" = work."workspace_id"
         AND issue."id" = work."issue_id"
        WHERE work."workspace_id" = ${context.workspaceId}::uuid
          AND work."team_id" = ${target.teamId}::uuid
          AND work."workflow_state_id" = ${target.id}::uuid
          AND work."deleted_at" IS NULL
          AND issue."deleted_at" IS NULL
        ORDER BY work."id"
        FOR UPDATE OF work
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
          throw teamResourceNotFound('대체할 워크플로 상태를 찾을 수 없습니다.');
        }
        const reassignedIssues = await transaction.teamWork.updateManyAndReturn({
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
            eventType: 'TEAM_WORK_CHANGED',
            fieldName: 'workflowStateId',
            issueId: issue.issueId,
            teamWorkId: issue.id,
            workspaceId: context.workspaceId,
          })),
        });
        for (const issue of reassignedIssues) {
          await notifyResourceChanged(transaction, {
            changeType: 'UPDATED',
            resourceId: issue.id,
            resourceType: 'TEAM_WORK',
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
}
