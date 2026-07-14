import { randomUUID } from 'node:crypto';

import { HttpStatus, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { HandoffKind, MembershipStatus, Prisma, ProjectRole, StateCategory } from '@rivet/database';
import {
  TEAM_WORK_CHANGED,
  TEAM_WORK_CHANGED_SCHEMA_VERSION,
  type TeamWorkChangedField,
  type TeamWorkChangedOutboxPayload,
} from '@rivet/event-contracts';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import { notifyResourceChanged } from '../../common/realtime/notify-resource-changed';
import { IssueCollaborationService } from '../collaboration/issue-collaboration.service';
import { shouldAutoStartOnAssignment } from './domain/team-work-transition';
import type {
  RemoveTeamWorkDto,
  TeamWorkListQueryDto,
  UpdateTeamWorkDto,
} from './dto/issue-request.dto';
import type {
  IssueDetailResponseDto,
  TeamWorkDetailResponseDto,
  TeamWorkListResponseDto,
  UpdateTeamWorkResponseDto,
} from './dto/issue-response.dto';
import {
  type IssueMutationContext,
  IssuesService,
  toIssueDetail,
  toIssueSummary,
  toTeamWorkDetail,
  toTeamWorkSummary,
} from './issues.service';

function values(value: string | undefined): string[] {
  return value
    ? [
        ...new Set(
          value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ]
    : [];
}

function notFound(): never {
  throw new ApiError({
    code: 'RESOURCE_NOT_FOUND',
    message: '팀 작업을 찾을 수 없습니다.',
    status: HttpStatus.NOT_FOUND,
  });
}

@Injectable()
export class TeamWorksService {
  constructor(
    private readonly database: DatabaseService,
    private readonly issues: IssuesService,
    private readonly collaboration: IssueCollaborationService,
  ) {}

  async list(
    context: IssueMutationContext,
    query: TeamWorkListQueryDto,
  ): Promise<TeamWorkListResponseDto> {
    const teamIds = values(query.teamId);
    const projectIds = values(query.projectId);
    const roles = values(query.projectRole);
    const workflowStateIds = values(query.workflowStateId);
    const categories = values(query.stateCategory);
    const assignees = values(query.assigneeMembershipId).map((value) =>
      value === 'me' ? context.membershipId : value,
    );
    if (
      [...teamIds, ...projectIds, ...workflowStateIds, ...assignees].some((id) => !isUUID(id, '4'))
    ) {
      throw new ApiError({
        code: 'INVALID_QUERY',
        message: '팀 작업 필터가 올바르지 않습니다.',
        status: HttpStatus.BAD_REQUEST,
      });
    }
    if (
      roles.some((role) => !Object.values(ProjectRole).includes(role as ProjectRole)) ||
      categories.some(
        (category) => !Object.values(StateCategory).includes(category as StateCategory),
      )
    ) {
      throw new ApiError({
        code: 'INVALID_QUERY',
        message: '역할 또는 상태 범주 필터가 올바르지 않습니다.',
        status: HttpStatus.BAD_REQUEST,
      });
    }
    const where: Prisma.TeamWorkWhereInput = {
      deletedAt: null,
      issue: {
        deletedAt: null,
        ...(projectIds.length ? { projectId: { in: projectIds } } : {}),
        ...(query.query
          ? {
              OR: [
                { title: { contains: query.query, mode: 'insensitive' } },
                { identifier: { contains: query.query, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      workspaceId: context.workspaceId,
      ...(query.unassigned === 'true'
        ? { assigneeMembershipId: null }
        : assignees.length
          ? { assigneeMembershipId: { in: assignees } }
          : {}),
      ...(roles.length ? { projectRole: { in: roles as ProjectRole[] } } : {}),
      ...(teamIds.length ? { teamId: { in: teamIds } } : {}),
      ...(categories.length
        ? { workflowState: { category: { in: categories as StateCategory[] } } }
        : {}),
      ...(workflowStateIds.length ? { workflowStateId: { in: workflowStateIds } } : {}),
    };
    let rows = await this.database.client.teamWork.findMany({
      orderBy: [
        { [query.sort ?? 'updatedAt']: query.sortDirection ?? 'desc' },
        { id: query.sortDirection ?? 'desc' },
      ],
      select: {
        id: true,
      },
      where,
    });
    if (query.cursor) {
      const index = rows.findIndex(({ id }) => id === query.cursor);
      rows = index >= 0 ? rows.slice(index + 1) : [];
    }
    const ids = rows.slice(0, query.limit).map(({ id }) => id);
    const detailed = await Promise.all(
      ids.map((id) => this.issues.findTeamWork(this.database.client, context.workspaceId, id)),
    );
    const filtered = detailed;
    return {
      items: filtered.map(toTeamWorkSummary),
      nextCursor: rows.length > query.limit ? (ids.at(-1) ?? null) : null,
      totalCount: await this.database.client.teamWork.count({ where }),
    };
  }

  async get(workspaceId: string, teamWorkRef: string): Promise<TeamWorkDetailResponseDto> {
    const row = await this.database.client.teamWork.findFirst({
      select: { id: true },
      where: {
        deletedAt: null,
        workspaceId,
        ...(isUUID(teamWorkRef, '4')
          ? { id: teamWorkRef }
          : { identifier: teamWorkRef.toUpperCase() }),
      },
    });
    if (!row) notFound();
    return toTeamWorkDetail(
      await this.issues.findTeamWork(this.database.client, workspaceId, row.id),
    );
  }

  async update(
    context: IssueMutationContext,
    teamWorkId: string,
    dto: UpdateTeamWorkDto,
  ): Promise<UpdateTeamWorkResponseDto> {
    if (
      dto.workflowStateId === undefined &&
      dto.assigneeMembershipId === undefined &&
      dto.workNoteMarkdown === undefined &&
      dto.handoff === undefined
    ) {
      throw new ApiError({
        code: 'TEAM_WORK_CHANGE_REQUIRED',
        message: '변경할 팀 작업 필드가 필요합니다.',
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      });
    }
    if (
      dto.workNoteMarkdown !== undefined &&
      dto.workNoteMarkdown !== null &&
      this.containsUnsupportedWorkNoteContent(dto.workNoteMarkdown)
    ) {
      throw new ApiError({
        code: 'TEAM_WORK_NOTE_INVALID',
        message: '작업 노트에는 멘션, 본문 이미지와 파일을 포함할 수 없습니다.',
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      });
    }
    return this.database.client.$transaction(async (transaction) => {
      const current = await this.issues.findTeamWork(transaction, context.workspaceId, teamWorkId);
      if (current.version !== dto.version) {
        throw new ApiError({
          code: 'TEAM_WORK_VERSION_CONFLICT',
          currentVersion: current.version,
          message: '팀 작업이 다른 요청에서 변경되었습니다.',
          status: HttpStatus.CONFLICT,
        });
      }
      if (dto.workNoteMarkdown !== undefined || dto.handoff !== undefined) {
        const activeTeamMember = await transaction.teamMember.findFirst({
          select: { membershipId: true },
          where: {
            membershipId: context.membershipId,
            membership: { status: MembershipStatus.ACTIVE },
            teamId: current.team.id,
            workspaceId: context.workspaceId,
          },
        });
        if (!activeTeamMember) {
          throw new ApiError({
            code: 'TEAM_WORK_TEAM_MEMBER_REQUIRED',
            message: '해당 팀의 활성 멤버만 작업 노트와 작업 전달을 수정할 수 있습니다.',
            status: HttpStatus.FORBIDDEN,
          });
        }
      }
      let nextCategory = current.workflowState.category;
      if (dto.workflowStateId) {
        const state = await transaction.workflowState.findFirst({
          select: { category: true, id: true },
          where: {
            id: dto.workflowStateId,
            teamId: current.team.id,
            workspaceId: context.workspaceId,
          },
        });
        if (!state) notFound();
        nextCategory = state.category;
      }
      if (dto.assigneeMembershipId) {
        const member = await transaction.teamMember.findFirst({
          select: { membershipId: true },
          where: {
            membership: { status: MembershipStatus.ACTIVE },
            membershipId: dto.assigneeMembershipId,
            teamId: current.team.id,
            workspaceId: context.workspaceId,
          },
        });
        if (!member)
          throw new ApiError({
            code: 'ASSIGNEE_NOT_TEAM_MEMBER',
            message: '담당자는 해당 팀의 활성 멤버여야 합니다.',
            status: HttpStatus.UNPROCESSABLE_ENTITY,
          });
      }
      let autoStartStateId: string | undefined;
      if (
        dto.workflowStateId === undefined &&
        dto.assigneeMembershipId &&
        shouldAutoStartOnAssignment(current.workflowState)
      ) {
        autoStartStateId = await this.issues.firstUnstartedStateId(
          transaction,
          context.workspaceId,
          current.team.id,
        );
        nextCategory = StateCategory.UNSTARTED;
      }
      const isCompletionTransition =
        dto.workflowStateId !== undefined && nextCategory === StateCategory.COMPLETED;
      if (isCompletionTransition) {
        if (!dto.completionMode) {
          throw new ApiError({
            code: 'TEAM_WORK_COMPLETION_MODE_REQUIRED',
            message: '완료로 전환하려면 완료 방식을 선택해야 합니다.',
            status: HttpStatus.UNPROCESSABLE_ENTITY,
          });
        }
        if (dto.completionMode === 'COMPLETE_ONLY' && dto.handoff) {
          throw new ApiError({
            code: 'TEAM_WORK_HANDOFF_NOT_ALLOWED',
            message: '이 작업만 완료할 때는 작업 전달을 포함할 수 없습니다.',
            status: HttpStatus.UNPROCESSABLE_ENTITY,
          });
        }
        if (dto.completionMode === 'HANDOFF_AND_COMPLETE') {
          if (!dto.handoff) {
            throw new ApiError({
              code: 'TEAM_WORK_HANDOFF_REQUIRED',
              message: '프론트에 전달 후 완료하려면 전달 내용이 필요합니다.',
              status: HttpStatus.UNPROCESSABLE_ENTITY,
            });
          }
          const frontendRoleCount = await transaction.projectRoleTeam.count({
            where: {
              projectId: current.issue.projectId,
              role: { in: [ProjectRole.WEB_FRONTEND, ProjectRole.APP_FRONTEND] },
              workspaceId: context.workspaceId,
            },
          });
          if (frontendRoleCount === 0) {
            throw new ApiError({
              code: 'TEAM_WORK_HANDOFF_NO_FRONTEND_ROLE',
              message: '프로젝트에 프론트 역할이 없어 전달할 수 없습니다.',
              status: HttpStatus.UNPROCESSABLE_ENTITY,
            });
          }
        }
      } else if (dto.completionMode !== undefined || dto.handoff !== undefined) {
        throw new ApiError({
          code: 'TEAM_WORK_COMPLETION_MODE_NOT_ALLOWED',
          message: '완료 상태로 전환하는 요청에서만 완료 방식과 작업 전달을 사용할 수 있습니다.',
          status: HttpStatus.UNPROCESSABLE_ENTITY,
        });
      }
      const changed = await transaction.teamWork.updateMany({
        data: {
          ...(dto.assigneeMembershipId !== undefined
            ? { assigneeMembershipId: dto.assigneeMembershipId }
            : {}),
          ...(dto.workNoteMarkdown !== undefined
            ? { workNoteMarkdown: dto.workNoteMarkdown || null }
            : {}),
          ...(dto.workflowStateId
            ? { workflowStateId: dto.workflowStateId }
            : autoStartStateId
              ? { workflowStateId: autoStartStateId }
              : {}),
          version: { increment: 1 },
        },
        where: { id: teamWorkId, version: dto.version, workspaceId: context.workspaceId },
      });
      if (changed.count !== 1)
        throw new ApiError({
          code: 'TEAM_WORK_VERSION_CONFLICT',
          currentVersion: current.version,
          message: '팀 작업이 다른 요청에서 변경되었습니다.',
          status: HttpStatus.CONFLICT,
        });
      if (dto.assigneeMembershipId)
        await transaction.issueSubscription.createMany({
          data: [
            {
              issueId: current.issue.id,
              membershipId: dto.assigneeMembershipId,
              workspaceId: context.workspaceId,
            },
          ],
          skipDuplicates: true,
        });
      await transaction.activityEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          afterData: {
            assigneeMembershipId: dto.assigneeMembershipId,
            workNoteMarkdown: dto.workNoteMarkdown,
            workflowStateId: dto.workflowStateId ?? autoStartStateId,
          },
          eventType: 'TEAM_WORK_CHANGED',
          issueId: current.issue.id,
          teamWorkId,
          workspaceId: context.workspaceId,
        },
      });
      const handoff = dto.handoff
        ? await this.collaboration.createHandoffInTransaction(transaction, context, teamWorkId, {
            bodyMarkdown: dto.handoff.bodyMarkdown,
            ...(dto.handoff.destinationRoles
              ? { destinationRoles: dto.handoff.destinationRoles }
              : {}),
            kind: HandoffKind.INITIAL,
          })
        : undefined;
      await this.issues.recalculateIssueStatus(transaction, context.workspaceId, current.issue.id);
      const changedFields: TeamWorkChangedField[] = [
        ...(dto.workflowStateId || autoStartStateId ? ['WORKFLOW_STATE' as const] : []),
        ...(dto.assigneeMembershipId !== undefined ? ['ASSIGNEE' as const] : []),
        ...(dto.workNoteMarkdown !== undefined ? ['WORK_NOTE' as const] : []),
      ];
      const subscriberMembershipIds =
        nextCategory === StateCategory.COMPLETED || nextCategory === StateCategory.CANCELED
          ? (
              await transaction.issueSubscription.findMany({
                orderBy: { membershipId: 'asc' },
                select: { membershipId: true },
                where: { issueId: current.issue.id, workspaceId: context.workspaceId },
              })
            ).map(({ membershipId }) => membershipId)
          : [];
      const eventId = randomUUID();
      if (changedFields.length > 0) {
        await transaction.outboxEvent.create({
          data: {
            actorMembershipId: context.membershipId,
            aggregateId: teamWorkId,
            aggregateType: 'TEAM_WORK',
            eventType: TEAM_WORK_CHANGED,
            id: eventId,
            payload: {
              ...(dto.assigneeMembershipId !== undefined
                ? { assigneeMembershipId: dto.assigneeMembershipId }
                : {}),
              changedFields,
              issueId: current.issue.id,
              schemaVersion: TEAM_WORK_CHANGED_SCHEMA_VERSION,
              subscriberMembershipIds,
              teamWorkId,
              terminalCategory:
                nextCategory === StateCategory.COMPLETED
                  ? 'COMPLETED'
                  : nextCategory === StateCategory.CANCELED
                    ? 'CANCELED'
                    : null,
            } satisfies TeamWorkChangedOutboxPayload,
            workspaceId: context.workspaceId,
          },
        });
      }
      const updated = await this.issues.findTeamWork(transaction, context.workspaceId, teamWorkId);
      const issue = await this.issues.findIssue(transaction, context.workspaceId, current.issue.id);
      await notifyResourceChanged(transaction, {
        changeType: 'UPDATED',
        eventId,
        resourceId: teamWorkId,
        resourceType: 'TEAM_WORK',
        version: updated.version,
        workspaceId: context.workspaceId,
      });
      await notifyResourceChanged(transaction, {
        changeType: 'UPDATED',
        resourceId: issue.id,
        resourceType: 'ISSUE',
        version: issue.version,
        workspaceId: context.workspaceId,
      });
      const downstreamTeamWorks = handoff
        ? await Promise.all(
            handoff.targetTeamWorkIds.map((id) =>
              this.issues.findTeamWork(transaction, context.workspaceId, id),
            ),
          )
        : [];
      return {
        ...(handoff
          ? { downstreamTeamWorks: downstreamTeamWorks.map(toTeamWorkSummary), handoff }
          : {}),
        issue: toIssueSummary(issue),
        teamWork: toTeamWorkDetail(updated),
      };
    });
  }

  async remove(
    context: IssueMutationContext,
    teamWorkId: string,
    dto: RemoveTeamWorkDto,
  ): Promise<IssueDetailResponseDto> {
    return this.database.client
      .$transaction(async (transaction) => {
        const current = await this.issues.findTeamWork(
          transaction,
          context.workspaceId,
          teamWorkId,
        );
        if (current.version !== dto.version) {
          throw new ApiError({
            code: 'TEAM_WORK_VERSION_CONFLICT',
            currentVersion: current.version,
            message: '팀 작업이 다른 요청에서 변경되었습니다.',
            status: HttpStatus.CONFLICT,
          });
        }
        await transaction.$queryRaw`
        SELECT "id" FROM "issues"
        WHERE "id" = ${current.issue.id}::uuid AND "workspace_id" = ${context.workspaceId}::uuid
        FOR UPDATE
      `;
        const removed = await transaction.teamWork.updateMany({
          data: { deletedAt: new Date(), version: { increment: 1 } },
          where: {
            deletedAt: null,
            id: teamWorkId,
            version: dto.version,
            workspaceId: context.workspaceId,
          },
        });
        if (removed.count !== 1) {
          throw new ApiError({
            code: 'TEAM_WORK_VERSION_CONFLICT',
            currentVersion: current.version,
            message: '팀 작업이 다른 요청에서 변경되었습니다.',
            status: HttpStatus.CONFLICT,
          });
        }
        await transaction.activityEvent.create({
          data: {
            actorMembershipId: context.membershipId,
            beforeData: { identifier: current.identifier, projectRole: current.projectRole },
            eventType: 'TEAM_WORK_REMOVED',
            issueId: current.issue.id,
            teamWorkId,
            workspaceId: context.workspaceId,
          },
        });
        await this.issues.recalculateIssueStatus(
          transaction,
          context.workspaceId,
          current.issue.id,
        );
        const issue = await this.issues.findIssue(
          transaction,
          context.workspaceId,
          current.issue.id,
        );
        await notifyResourceChanged(transaction, {
          changeType: 'DELETED',
          resourceId: teamWorkId,
          resourceType: 'TEAM_WORK',
          version: dto.version + 1,
          workspaceId: context.workspaceId,
        });
        await notifyResourceChanged(transaction, {
          changeType: 'UPDATED',
          resourceId: issue.id,
          resourceType: 'ISSUE',
          version: issue.version,
          workspaceId: context.workspaceId,
        });
        return issue;
      })
      .then(toIssueDetail);
  }

  private containsUnsupportedWorkNoteContent(value: string): boolean {
    return /(?:!\[[^\]]*\]\(|@\[[^\]]+\]\(|\/files\/[0-9a-f-]{36})/imu.test(value);
  }
}
