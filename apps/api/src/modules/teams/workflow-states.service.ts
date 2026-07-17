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
  DeleteWorkflowStateQueryDto,
  ReorderWorkflowStatesDto,
  UpdateWorkflowStateDto,
} from './dto/workflow-state-request.dto';
import { teamResourceNotFound, teamVersionConflict } from './team.errors';
import { TeamRepository } from './team.repository';
import { normalizeTeamResourceName } from './team-input.policy';
import { toWorkflowStateListResponse } from './team-response.mapper';
import { teamUniqueConstraintTargets } from './team-unique.policy';

@Injectable()
export class WorkflowStatesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly teams: TeamRepository,
  ) {}

  async updateWorkflowState(
    workspaceId: string,
    stateId: string,
    dto: UpdateWorkflowStateDto,
  ): Promise<WorkflowStateResponseDto> {
    const { name, normalizedName } = normalizeTeamResourceName(dto.name);

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
        throw teamResourceNotFound('워크플로 상태를 찾을 수 없습니다.');
      }
      if (current.version !== dto.version) {
        throw teamVersionConflict(current.version);
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
        throw teamResourceNotFound('워크플로 상태를 찾을 수 없습니다.');
      }
      if (latest.team.archivedAt !== null) {
        throw teamResourceNotFound('워크플로 상태를 찾을 수 없습니다.');
      }
      throw teamVersionConflict(latest.version);
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
        throw teamResourceNotFound('팀을 찾을 수 없습니다.');
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
        throw teamResourceNotFound('워크플로 상태를 찾을 수 없습니다.');
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
          throw teamVersionConflict(current.version);
        }
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
        throw teamResourceNotFound('워크플로 상태를 찾을 수 없습니다.');
      }
      if (target.version !== query.version) {
        throw teamVersionConflict(target.version);
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
        throw teamResourceNotFound('대체할 워크플로 상태를 찾을 수 없습니다.');
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
