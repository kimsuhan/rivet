import { randomUUID } from 'node:crypto';

import { HttpStatus, Injectable } from '@nestjs/common';

import { Prisma, ProjectRole, ProjectStatus } from '@rivet/database';
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
import { normalizeProjectRoleTeams } from './domain/project-role';
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
    context: { membershipId: string; workspaceId: string },
    dto: CreateProjectDto,
  ): Promise<ProjectResponseDto> {
    const name = normalizeProjectName(dto.name);
    const description = normalizeProjectDescription(dto.description) ?? null;
    const startDate = parseProjectDate(dto.startDate, 'startDate') ?? null;
    const targetDate = parseProjectDate(dto.targetDate, 'targetDate') ?? null;
    const roleTeams = normalizeProjectRoleTeams(dto.roleTeams);
    validateProjectDateOrder(startDate, targetDate);

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
        roleTeams.map(({ teamId }) => teamId),
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
      await transaction.projectRoleTeam.createMany({
        data: roleTeams.map(({ role, teamId }) => ({
          projectId: project.id,
          role,
          teamId,
          workspaceId: context.workspaceId,
        })),
      });
      await transaction.activityEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          afterData: {
            name,
            roleTeams: roleTeams.map(({ role, teamId }) => ({ role, teamId })),
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
            roleCount: roleTeams.length,
            roles: roleTeams.map(({ role }) => role),
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
    context: { membershipId: string; workspaceId: string },
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
      dto.roleTeams === undefined
    ) {
      return projectValidationError('project', '변경할 프로젝트 정보를 입력해 주세요.');
    }

    const requestedName = dto.name === undefined ? undefined : normalizeProjectName(dto.name);
    const requestedDescription = normalizeProjectDescription(dto.description);
    const requestedStartDate = parseProjectDate(dto.startDate, 'startDate');
    const requestedTargetDate = parseProjectDate(dto.targetDate, 'targetDate');
    const requestedRoleTeams =
      dto.roleTeams === undefined ? undefined : normalizeProjectRoleTeams(dto.roleTeams);

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

      const currentRoleTeams = await transaction.projectRoleTeam.findMany({
        orderBy: { role: 'asc' },
        select: { role: true, teamId: true },
        where: { projectId, workspaceId: context.workspaceId },
      });
      let changedRoles: ProjectRole[] = [];
      if (requestedRoleTeams) {
        await this.projects.lockActiveTeams(
          transaction,
          context.workspaceId,
          requestedRoleTeams.map(({ teamId }) => teamId),
        );
        const currentByRole = new Map(currentRoleTeams.map((item) => [item.role, item.teamId]));
        const requestedByRole = new Map(requestedRoleTeams.map((item) => [item.role, item.teamId]));
        changedRoles = Object.values(ProjectRole).filter(
          (role) => currentByRole.get(role) !== requestedByRole.get(role),
        );

        if (changedRoles.length > 0) {
          const blockingIssues = await transaction.teamWork.findMany({
            orderBy: [{ projectRole: 'asc' }, { identifier: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              identifier: true,
              issue: { select: { title: true } },
              projectRole: true,
              teamId: true,
            },
            where: {
              issue: { projectId },
              projectRole: { in: changedRoles },
              workspaceId: context.workspaceId,
            },
          });
          if (blockingIssues.length > 0) {
            throw new ApiError({
              code: 'PROJECT_ROLE_IN_USE',
              details: { issues: blockingIssues },
              message: '사용 중인 프로젝트 역할의 담당 팀은 변경할 수 없습니다.',
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
      const changesRoleTeams = changedRoles.length > 0;

      if (
        !changesName &&
        !changesDescription &&
        !changesStatus &&
        !changesLead &&
        !changesStartDate &&
        !changesTargetDate &&
        !changesRoleTeams
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

      if (changesRoleTeams && requestedRoleTeams) {
        await transaction.projectRoleTeam.deleteMany({
          where: { projectId, role: { in: changedRoles }, workspaceId: context.workspaceId },
        });
        const changedRoleSet = new Set(changedRoles);
        const replacements = requestedRoleTeams.filter(({ role }) => changedRoleSet.has(role));
        if (replacements.length > 0) {
          await transaction.projectRoleTeam.createMany({
            data: replacements.map(({ role, teamId }) => ({
              projectId,
              role,
              teamId,
              workspaceId: context.workspaceId,
            })),
          });
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
      if (changesRoleTeams) {
        addEvent(
          'roleTeams',
          currentRoleTeams.map(({ role, teamId }) => ({ role, teamId })),
          requestedRoleTeams!.map(({ role, teamId }) => ({ role, teamId })),
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
    context: { membershipId: string; workspaceId: string },
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
    context: { membershipId: string; workspaceId: string },
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
