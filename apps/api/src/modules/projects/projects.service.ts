import { randomUUID } from 'node:crypto';

import { HttpStatus, Injectable } from '@nestjs/common';

import { MembershipRole, Prisma, ProjectStatus, StateCategory } from '@rivet/database';
import {
  PROJECT_CREATED,
  PROJECT_CREATED_SCHEMA_VERSION,
  PROJECT_PURGE_SCHEDULED,
  PROJECT_PURGE_SCHEDULED_SCHEMA_VERSION,
  PROJECT_STATUS_CHANGED,
  PROJECT_STATUS_CHANGED_SCHEMA_VERSION,
  type ProjectCreatedOutboxPayload,
  type ProjectPurgeScheduledOutboxPayload,
  type ProjectStatusChangedOutboxPayload,
} from '@rivet/event-contracts';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import { notifyResourceChanged } from '../../common/realtime/notify-resource-changed';
import { normalizeProjectTeamIds } from './domain/project-team';
import type {
  ArchiveProjectDto,
  CreateProjectDto,
  UpdateProjectDto,
} from './dto/project-request.dto';
import type { ProjectResponseDto } from './dto/project-response.dto';
import { projectValidationError, projectVersionConflict } from './project.errors';
import { ProjectRepository } from './project.repository';
import {
  normalizeProjectDescription,
  normalizeProjectName,
  parseProjectDate,
  validateProjectDateOrder,
} from './project-input.policy';
import { projectDateValue } from './project-list.cursor';
import { projectProgress, toProjectResponse } from './project-response.mapper';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly projects: ProjectRepository,
  ) {}

  async create(
    context: { membershipId: string; membershipRole: MembershipRole; workspaceId: string },
    dto: CreateProjectDto,
  ): Promise<ProjectResponseDto> {
    const name = normalizeProjectName(dto.name);
    const description = normalizeProjectDescription(dto.description) ?? null;
    const startDate = parseProjectDate(dto.startDate, 'startDate') ?? null;
    const targetDate = parseProjectDate(dto.targetDate, 'targetDate') ?? null;
    const teamIds = normalizeProjectTeamIds(dto.teamIds);
    validateProjectDateOrder(startDate, targetDate);

    if (
      teamIds.length > 0 &&
      context.membershipRole !== MembershipRole.ADMIN &&
      dto.leadMembershipId !== context.membershipId
    ) {
      throw new ApiError({
        code: 'PROJECT_TEAM_MANAGE_FORBIDDEN',
        message: '워크스페이스 관리자와 프로젝트 리드만 참여 팀을 설정할 수 있습니다.',
        status: HttpStatus.FORBIDDEN,
      });
    }

    const result = await this.database.client.$transaction(async (transaction) => {
      await this.projects.lockWorkspace(transaction, context.workspaceId);
      await this.projects.lockActiveMembership(
        transaction,
        context.workspaceId,
        dto.leadMembershipId ?? undefined,
      );
      await this.projects.lockActiveTeams(
        transaction,
        context.workspaceId,
        teamIds,
      );

      const project = await transaction.project.create({
        data: {
          description,
          leadMembershipId: dto.leadMembershipId ?? null,
          name,
          startDate,
          status: dto.status ?? ProjectStatus.PLANNED,
          targetDate,
          workspaceId: context.workspaceId,
        },
        select: { id: true },
      });
      if (teamIds.length > 0) {
        await transaction.projectTeam.createMany({
          data: teamIds.map((teamId) => ({
            projectId: project.id,
            teamId,
            workspaceId: context.workspaceId,
          })),
        });
      }
      await transaction.activityEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          afterData: {
            name,
            teamIds,
            status: dto.status ?? ProjectStatus.PLANNED,
          },
          eventType: 'PROJECT_CREATED',
          projectId: project.id,
          workspaceId: context.workspaceId,
        },
      });
      await transaction.outboxEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          aggregateId: project.id,
          aggregateType: 'PROJECT',
          eventType: PROJECT_CREATED,
          id: randomUUID(),
          payload: {
            hasTargetDate: targetDate !== null,
            teamCount: teamIds.length,
            schemaVersion: PROJECT_CREATED_SCHEMA_VERSION,
          } satisfies ProjectCreatedOutboxPayload,
          workspaceId: context.workspaceId,
        },
      });

      const created = await this.projects.find(transaction, context.workspaceId, project.id);
      await notifyResourceChanged(transaction, {
        changeType: 'CREATED',
        resourceId: project.id,
        resourceType: 'PROJECT',
        version: created.version,
        workspaceId: context.workspaceId,
      });
      return toProjectResponse(created, projectProgress(0, 0));
    });
    return result;
  }

  async update(
    context: { membershipId: string; membershipRole: MembershipRole; workspaceId: string },
    projectId: string,
    dto: UpdateProjectDto,
  ): Promise<ProjectResponseDto> {
    if (
      dto.name === undefined &&
      dto.description === undefined &&
      dto.status === undefined &&
      dto.leadMembershipId === undefined &&
      dto.startDate === undefined &&
      dto.targetDate === undefined &&
      dto.teamIds === undefined
    ) {
      return projectValidationError('project', '변경할 프로젝트 정보를 입력해 주세요.');
    }

    const requestedName = dto.name === undefined ? undefined : normalizeProjectName(dto.name);
    const requestedDescription = normalizeProjectDescription(dto.description);
    const requestedStartDate = parseProjectDate(dto.startDate, 'startDate');
    const requestedTargetDate = parseProjectDate(dto.targetDate, 'targetDate');
    const requestedTeamIds =
      dto.teamIds === undefined ? undefined : normalizeProjectTeamIds(dto.teamIds);

    const outcome = await this.database.client.$transaction(async (transaction) => {
      await this.projects.lockWorkspace(transaction, context.workspaceId);
      const current = await this.projects.lock(transaction, context.workspaceId, projectId);
      if (current.version !== dto.version) {
        return projectVersionConflict(current.version);
      }

      const nextStartDate =
        requestedStartDate === undefined ? current.startDate : requestedStartDate;
      const nextTargetDate =
        requestedTargetDate === undefined ? current.targetDate : requestedTargetDate;
      validateProjectDateOrder(nextStartDate, nextTargetDate);

      const changesLead =
        dto.leadMembershipId !== undefined && dto.leadMembershipId !== current.leadMembershipId;
      if (changesLead) {
        await this.projects.lockActiveMembership(
          transaction,
          context.workspaceId,
          dto.leadMembershipId ?? undefined,
        );
      }

      const currentProjectTeams = await transaction.projectTeam.findMany({
        orderBy: [{ teamId: 'asc' }, { id: 'asc' }],
        select: { id: true, isActive: true, teamId: true },
        where: { projectId, workspaceId: context.workspaceId },
      });
      const currentActiveTeamIds = currentProjectTeams
        .filter(({ isActive }) => isActive)
        .map(({ teamId }) => teamId)
        .sort();
      const changesProjectTeams =
        requestedTeamIds !== undefined &&
        (requestedTeamIds.length !== currentActiveTeamIds.length ||
          requestedTeamIds.some((teamId, index) => teamId !== currentActiveTeamIds[index]));
      if (changesProjectTeams && requestedTeamIds) {
        if (
          context.membershipRole !== MembershipRole.ADMIN &&
          current.leadMembershipId !== context.membershipId
        ) {
          throw new ApiError({
            code: 'PROJECT_TEAM_MANAGE_FORBIDDEN',
            message: '워크스페이스 관리자와 프로젝트 리드만 참여 팀을 변경할 수 있습니다.',
            status: HttpStatus.FORBIDDEN,
          });
        }
        await this.projects.lockActiveTeams(
          transaction,
          context.workspaceId,
          requestedTeamIds,
        );
        const requestedTeamIdSet = new Set(requestedTeamIds);
        const deactivatedProjectTeamIds = currentProjectTeams
          .filter(({ isActive, teamId }) => isActive && !requestedTeamIdSet.has(teamId))
          .map(({ id }) => id);

        if (deactivatedProjectTeamIds.length > 0) {
          const blockingIssues = await transaction.teamWork.findMany({
            orderBy: [{ identifier: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              identifier: true,
              issue: { select: { title: true } },
              projectTeamId: true,
              team: { select: { id: true, key: true, name: true } },
            },
            where: {
              deletedAt: null,
              projectTeamId: { in: deactivatedProjectTeamIds },
              workflowState: {
                category: { notIn: [StateCategory.COMPLETED, StateCategory.CANCELED] },
              },
              workspaceId: context.workspaceId,
            },
          });
          if (blockingIssues.length > 0) {
            throw new ApiError({
              code: 'PROJECT_TEAM_IN_USE',
              details: { issues: blockingIssues },
              message: '진행 중인 팀 작업이 있는 참여 팀은 제외할 수 없습니다.',
              status: HttpStatus.CONFLICT,
            });
          }
        }
      }

      const changesName = requestedName !== undefined && requestedName !== current.name;
      const changesDescription =
        requestedDescription !== undefined && requestedDescription !== current.description;
      const changesStatus = dto.status !== undefined && dto.status !== current.status;
      const changesStartDate =
        requestedStartDate !== undefined &&
        projectDateValue(requestedStartDate) !== projectDateValue(current.startDate);
      const changesTargetDate =
        requestedTargetDate !== undefined &&
        projectDateValue(requestedTargetDate) !== projectDateValue(current.targetDate);
      if (
        !changesName &&
        !changesDescription &&
        !changesStatus &&
        !changesLead &&
        !changesStartDate &&
        !changesTargetDate &&
        !changesProjectTeams
      ) {
        const row = await this.projects.find(transaction, context.workspaceId, projectId);
        const progressByProject = await this.projects.progressByProject(
          transaction,
          context.workspaceId,
          [projectId],
        );
        return {
          response: toProjectResponse(
            row,
            progressByProject.get(projectId) ?? projectProgress(0, 0),
          ),
          statusChange: null,
        };
      }

      await transaction.project.update({
        data: {
          ...(changesDescription ? { description: requestedDescription } : {}),
          ...(changesLead ? { leadMembershipId: dto.leadMembershipId } : {}),
          ...(changesName ? { name: requestedName } : {}),
          ...(changesStartDate ? { startDate: requestedStartDate } : {}),
          ...(changesStatus ? { status: dto.status } : {}),
          ...(changesTargetDate ? { targetDate: requestedTargetDate } : {}),
          version: { increment: 1 },
        },
        where: { workspaceId_id: { id: projectId, workspaceId: context.workspaceId } },
      });

      if (changesProjectTeams && requestedTeamIds) {
        const deactivatedAt = new Date();
        if (requestedTeamIds.length === 0) {
          await transaction.projectTeam.updateMany({
            data: { deactivatedAt, isActive: false },
            where: { isActive: true, projectId, workspaceId: context.workspaceId },
          });
        } else {
          await transaction.projectTeam.updateMany({
            data: { deactivatedAt, isActive: false },
            where: {
              isActive: true,
              projectId,
              teamId: { notIn: requestedTeamIds },
              workspaceId: context.workspaceId,
            },
          });
          for (const teamId of requestedTeamIds) {
            await transaction.projectTeam.upsert({
              create: { projectId, teamId, workspaceId: context.workspaceId },
              update: { deactivatedAt: null, isActive: true },
              where: { projectId_teamId: { projectId, teamId } },
            });
          }
        }
      }

      const events: Prisma.ActivityEventCreateManyInput[] = [];
      const addEvent = (
        fieldName: string,
        beforeData: Prisma.InputJsonValue | null,
        afterData: Prisma.InputJsonValue | null,
      ) => {
        events.push({
          actorMembershipId: context.membershipId,
          afterData: afterData ?? Prisma.JsonNull,
          beforeData: beforeData ?? Prisma.JsonNull,
          eventType: 'PROJECT_UPDATED',
          fieldName,
          projectId,
          workspaceId: context.workspaceId,
        });
      };
      if (changesName) addEvent('name', current.name, requestedName!);
      if (changesDescription) {
        addEvent('description', current.description, requestedDescription ?? null);
      }
      if (changesStatus) addEvent('status', current.status, dto.status!);
      if (changesLead) {
        addEvent('leadMembershipId', current.leadMembershipId, dto.leadMembershipId ?? null);
      }
      if (changesStartDate) {
        addEvent(
          'startDate',
          projectDateValue(current.startDate),
          projectDateValue(requestedStartDate ?? null),
        );
      }
      if (changesTargetDate) {
        addEvent(
          'targetDate',
          projectDateValue(current.targetDate),
          projectDateValue(requestedTargetDate ?? null),
        );
      }
      if (changesProjectTeams) {
        addEvent(
          'projectTeams',
          currentActiveTeamIds,
          requestedTeamIds!,
        );
      }
      await transaction.activityEvent.createMany({ data: events });

      const row = await this.projects.find(transaction, context.workspaceId, projectId);
      await notifyResourceChanged(transaction, {
        changeType: 'UPDATED',
        resourceId: projectId,
        resourceType: 'PROJECT',
        version: row.version,
        workspaceId: context.workspaceId,
      });
      const progressByProject = await this.projects.progressByProject(
        transaction,
        context.workspaceId,
        [projectId],
      );
      const response = toProjectResponse(
        row,
        progressByProject.get(projectId) ?? projectProgress(0, 0),
      );
      if (changesStatus) {
        await transaction.outboxEvent.create({
          data: {
            actorMembershipId: context.membershipId,
            aggregateId: projectId,
            aggregateType: 'PROJECT',
            eventType: PROJECT_STATUS_CHANGED,
            id: randomUUID(),
            payload: {
              fromStatus: current.status,
              progress: response.progress.percentage,
              schemaVersion: PROJECT_STATUS_CHANGED_SCHEMA_VERSION,
              toStatus: response.status,
            } satisfies ProjectStatusChangedOutboxPayload,
            workspaceId: context.workspaceId,
          },
        });
      }
      return {
        response,
        statusChange: changesStatus
          ? { fromStatus: current.status, toStatus: response.status }
          : null,
      };
    });
    return outcome.response;
  }

  archive(
    context: { membershipId: string; membershipRole: MembershipRole; workspaceId: string },
    projectId: string,
    dto: ArchiveProjectDto,
  ): Promise<ProjectResponseDto> {
    return this.database.client.$transaction(async (transaction) => {
      await this.projects.lockWorkspace(transaction, context.workspaceId);
      const current = await this.projects.lock(transaction, context.workspaceId, projectId);
      if (current.version !== dto.version) {
        return projectVersionConflict(current.version);
      }
      const changesArchive = current.archivedAt === null;
      if (changesArchive) {
        await transaction.project.update({
          data: { archivedAt: new Date(), version: { increment: 1 } },
          where: { workspaceId_id: { id: projectId, workspaceId: context.workspaceId } },
        });
        await transaction.activityEvent.create({
          data: {
            actorMembershipId: context.membershipId,
            eventType: 'PROJECT_ARCHIVED',
            projectId,
            workspaceId: context.workspaceId,
          },
        });
      }

      const row = await this.projects.find(transaction, context.workspaceId, projectId);
      if (changesArchive) {
        await notifyResourceChanged(transaction, {
          changeType: 'UPDATED',
          resourceId: projectId,
          resourceType: 'PROJECT',
          version: row.version,
          workspaceId: context.workspaceId,
        });
      }
      const progressByProject = await this.projects.progressByProject(
        transaction,
        context.workspaceId,
        [projectId],
      );
      return toProjectResponse(row, progressByProject.get(projectId) ?? projectProgress(0, 0));
    });
  }

  async trash(
    context: { membershipId: string; membershipRole: MembershipRole; workspaceId: string },
    projectId: string,
    version: number,
  ): Promise<void> {
    await this.database.client.$transaction(async (transaction) => {
      await this.projects.lockWorkspace(transaction, context.workspaceId);
      await this.projects.lockActorMembership(
        transaction,
        context.workspaceId,
        context.membershipId,
      );
      const current = await this.projects.lock(transaction, context.workspaceId, projectId);
      if (current.version !== version) {
        return projectVersionConflict(current.version);
      }

      const linkedIssue = await transaction.issue.findFirst({
        select: { id: true },
        where: { projectId, workspaceId: context.workspaceId },
      });
      if (linkedIssue) {
        throw new ApiError({
          code: 'PROJECT_NOT_EMPTY',
          message: '연결된 이슈가 있는 프로젝트는 휴지통으로 옮길 수 없습니다.',
          status: HttpStatus.CONFLICT,
        });
      }

      const deletedAt = new Date();
      const purgeAt = new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
      await transaction.project.update({
        data: {
          deletedAt,
          deletedByMembershipId: context.membershipId,
          purgeAt,
          version: { increment: 1 },
        },
        where: { workspaceId_id: { id: projectId, workspaceId: context.workspaceId } },
      });
      await transaction.activityEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          afterData: { purgeAt: purgeAt.toISOString() },
          eventType: 'PROJECT_TRASHED',
          projectId,
          workspaceId: context.workspaceId,
        },
      });
      await transaction.outboxEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          aggregateId: projectId,
          aggregateType: 'PROJECT',
          availableAt: purgeAt,
          eventType: PROJECT_PURGE_SCHEDULED,
          payload: {
            projectId,
            purgeAt: purgeAt.toISOString(),
            schemaVersion: PROJECT_PURGE_SCHEDULED_SCHEMA_VERSION,
          } satisfies ProjectPurgeScheduledOutboxPayload,
          workspaceId: context.workspaceId,
        },
      });
      await notifyResourceChanged(transaction, {
        changeType: 'DELETED',
        resourceId: projectId,
        resourceType: 'PROJECT',
        version: current.version + 1,
        workspaceId: context.workspaceId,
      });
    });
  }
}
