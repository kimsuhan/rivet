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

const EXECUTION_CATEGORY_ORDER: Record<StateCategory, number> = {
  STARTED: 0,
  UNSTARTED: 1,
  BACKLOG: 2,
  COMPLETED: 3,
  CANCELED: 4,
};

const PRIORITY_ORDER = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3, NONE: 4 } as const;

function compareTextDescending(left: string, right: string): number {
  return right.localeCompare(left);
}

function decodeCursor(cursor: string): string {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return typeof parsed === 'object' &&
      parsed !== null &&
      'id' in parsed &&
      typeof parsed.id === 'string'
      ? parsed.id
      : cursor;
  } catch {
    return cursor;
  }
}

function encodeCursor(id: string): string {
  return Buffer.from(JSON.stringify({ id }), 'utf8').toString('base64url');
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
      },
      workspaceId: context.workspaceId,
      ...(query.query
        ? {
            OR: [
              { identifier: { contains: query.query, mode: 'insensitive' } },
              { issue: { identifier: { contains: query.query, mode: 'insensitive' } } },
              { issue: { title: { contains: query.query, mode: 'insensitive' } } },
              { issue: { project: { name: { contains: query.query, mode: 'insensitive' } } } },
            ],
          }
        : {}),
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
    const rows = await this.database.client.teamWork.findMany({
      select: {
        createdAt: true,
        id: true,
        issue: { select: { priority: true } },
        updatedAt: true,
        workflowState: { select: { category: true, position: true } },
      },
      where,
    });
    const sort = query.sort ?? 'updatedAt';
    const direction = query.sortDirection ?? 'desc';
    rows.sort((left, right) => {
      if (sort === 'executionOrder') {
        const category =
          EXECUTION_CATEGORY_ORDER[left.workflowState.category] -
          EXECUTION_CATEGORY_ORDER[right.workflowState.category];
        if (category) return category;
        const priority = PRIORITY_ORDER[left.issue.priority] - PRIORITY_ORDER[right.issue.priority];
        if (priority) return priority;
        const position = left.workflowState.position - right.workflowState.position;
        if (position) return position;
        const updatedAt = right.updatedAt.getTime() - left.updatedAt.getTime();
        return updatedAt || compareTextDescending(left.id, right.id);
      }
      const value =
        sort === 'priority'
          ? PRIORITY_ORDER[left.issue.priority] - PRIORITY_ORDER[right.issue.priority]
          : sort === 'status'
            ? left.workflowState.position - right.workflowState.position
            : left[sort].getTime() - right[sort].getTime();
      if (value) return direction === 'asc' ? value : -value;
      return direction === 'asc'
        ? left.id.localeCompare(right.id)
        : compareTextDescending(left.id, right.id);
    });
    const cursorId = query.cursor ? decodeCursor(query.cursor) : null;
    const start =
      cursorId === null ? 0 : Math.max(0, rows.findIndex(({ id }) => id === cursorId) + 1);
    const page = rows.slice(start, start + query.limit);
    const detailed = await Promise.all(
      page.map(({ id }) => this.issues.findTeamWork(this.database.client, context.workspaceId, id)),
    );
    return {
      items: detailed.map(toTeamWorkSummary),
      nextCursor:
        start + page.length < rows.length && page.length ? encodeCursor(page.at(-1)!.id) : null,
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
      let nextState: { category: StateCategory; id: string; name: string } | undefined;
      if (dto.workflowStateId) {
        const state = await transaction.workflowState.findFirst({
          select: { category: true, id: true, name: true },
          where: {
            id: dto.workflowStateId,
            teamId: current.team.id,
            workspaceId: context.workspaceId,
          },
        });
        if (!state) notFound();
        nextCategory = state.category;
        nextState = state;
      }
      let nextAssignee: { displayName: string; membershipId: string } | undefined;
      if (dto.assigneeMembershipId) {
        const member = await transaction.teamMember.findFirst({
          select: {
            membership: { select: { user: { select: { displayName: true } } } },
            membershipId: true,
          },
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
        nextAssignee = {
          displayName: member.membership.user.displayName,
          membershipId: member.membershipId,
        };
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
              projectId: current.issue.project.id,
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
      const appliedStateId = dto.workflowStateId ?? autoStartStateId;
      type ActivityFieldChange = {
        after: Prisma.InputJsonValue | typeof Prisma.JsonNull;
        before: Prisma.InputJsonValue | typeof Prisma.JsonNull;
        field: string;
        hasValues: boolean;
      };
      const stateChange: ActivityFieldChange | null =
        appliedStateId !== undefined && appliedStateId !== current.workflowState.id
          ? {
              after: { id: nextState?.id ?? null, name: nextState?.name ?? null },
              before: { id: current.workflowState.id, name: current.workflowState.name },
              field: 'workflowStateId',
              hasValues: true,
            }
          : null;
      const assigneeChange: ActivityFieldChange | null =
        dto.assigneeMembershipId !== undefined &&
        dto.assigneeMembershipId !== (current.assigneeTeamMember?.membership.id ?? null)
          ? {
              after: nextAssignee ? { ...nextAssignee } : Prisma.JsonNull,
              before: current.assigneeTeamMember
                ? {
                    displayName: current.assigneeTeamMember.membership.user.displayName,
                    membershipId: current.assigneeTeamMember.membership.id,
                  }
                : Prisma.JsonNull,
              field: 'assigneeMembershipId',
              hasValues: true,
            }
          : null;
      const noteChange: ActivityFieldChange | null =
        dto.workNoteMarkdown !== undefined
          ? {
              after: Prisma.JsonNull,
              before: Prisma.JsonNull,
              field: 'workNoteMarkdown',
              hasValues: false,
            }
          : null;
      const activityChangedFields = [stateChange, assigneeChange, noteChange].filter(
        (change): change is ActivityFieldChange => change !== null,
      );
      // 바뀐 필드가 하나뿐일 때만 fieldName을 기록하고, 이름이 있는 상태·담당자 변경에는
      // 전후 값도 함께 담는다. 여러 필드가 함께 바뀌면 대표 필드를 추측하지 않는다.
      const singleChange = activityChangedFields.length === 1 ? activityChangedFields[0] : null;
      await transaction.activityEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          ...(singleChange
            ? {
                fieldName: singleChange.field,
                ...(singleChange.hasValues
                  ? { afterData: singleChange.after, beforeData: singleChange.before }
                  : {}),
              }
            : {}),
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
