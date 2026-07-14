import { randomUUID } from 'node:crypto';

import { HttpStatus, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { MembershipStatus, Prisma, ProjectRole, ProjectStatus } from '@rivet/database';
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
import type {
  ArchiveProjectDto,
  CreateProjectDto,
  ProjectListQueryDto,
  ProjectRoleTeamInputDto,
  UpdateProjectDto,
} from './dto/project-request.dto';
import type {
  ProjectListResponseDto,
  ProjectProgressResponseDto,
  ProjectResponseDto,
} from './dto/project-response.dto';

const PROJECT_SELECT = {
  archivedAt: true,
  createdAt: true,
  description: true,
  id: true,
  leadMembership: {
    select: {
      id: true,
      role: true,
      status: true,
      user: { select: { avatarFileId: true, displayName: true, id: true } },
    },
  },
  name: true,
  roleTeams: {
    select: {
      role: true,
      team: { select: { archivedAt: true, id: true, key: true, name: true } },
    },
  },
  startDate: true,
  status: true,
  targetDate: true,
  updatedAt: true,
  version: true,
} satisfies Prisma.ProjectSelect;

const PROJECT_ROLE_POSITION: Record<ProjectRole, number> = {
  [ProjectRole.BACKEND]: 0,
  [ProjectRole.WEB_FRONTEND]: 1,
  [ProjectRole.APP_FRONTEND]: 2,
};

type ProjectRow = Prisma.ProjectGetPayload<{ select: typeof PROJECT_SELECT }>;
type Transaction = Prisma.TransactionClient;
type SortField = 'targetDate' | 'updatedAt';
type SortDirection = 'asc' | 'desc';

interface ProjectCursor {
  id: string;
  value: Date | null;
}

interface ProjectLockRow {
  archivedAt: Date | null;
  description: string | null;
  id: string;
  leadMembershipId: string | null;
  name: string;
  startDate: Date | null;
  status: ProjectStatus;
  targetDate: Date | null;
  version: number;
}

interface RoleTeamRow {
  role: ProjectRole;
  teamId: string;
}

interface ProgressRow {
  completed: bigint;
  projectId: string;
  total: bigint;
}

function invalidQuery(message: string): never {
  throw new ApiError({ code: 'INVALID_QUERY', message, status: HttpStatus.BAD_REQUEST });
}

function resourceNotFound(message = '프로젝트를 찾을 수 없습니다.'): never {
  throw new ApiError({ code: 'RESOURCE_NOT_FOUND', message, status: HttpStatus.NOT_FOUND });
}

function versionConflict(currentVersion: number): never {
  throw new ApiError({
    code: 'VERSION_CONFLICT',
    currentVersion,
    message: '프로젝트가 다른 요청에서 변경되었습니다.',
    status: HttpStatus.CONFLICT,
  });
}

function validationError(field: string, message: string): never {
  throw new ApiError({
    code: 'VALIDATION_ERROR',
    fieldErrors: { [field]: [message] },
    message: '프로젝트 정보를 확인해 주세요.',
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  });
}

function normalizeName(value: string): string {
  const name = value.normalize('NFC').trim();
  if ([...name].length < 1 || [...name].length > 200) {
    return validationError('name', '프로젝트 이름은 1~200자로 입력해 주세요.');
  }
  return name;
}

function normalizeDescription(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }

  const description = value.normalize('NFC').trim();
  if ([...description].length < 1 || [...description].length > 5000) {
    return validationError('description', '프로젝트 설명은 1~5,000자로 입력해 주세요.');
  }
  return description;
}

function parseDate(
  value: string | null | undefined,
  field: 'startDate' | 'targetDate',
): Date | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return validationError(field, '날짜는 YYYY-MM-DD 형식이어야 합니다.');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return validationError(field, '유효한 날짜를 입력해 주세요.');
  }
  return date;
}

function dateValue(value: Date | null): string | null {
  return value?.toISOString().slice(0, 10) ?? null;
}

function validateDateOrder(startDate: Date | null, targetDate: Date | null): void {
  if (startDate && targetDate && targetDate < startDate) {
    throw new ApiError({
      code: 'PROJECT_DATE_INVALID',
      fieldErrors: { targetDate: ['목표일은 시작일보다 빠를 수 없습니다.'] },
      message: '프로젝트 일정을 확인해 주세요.',
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });
  }
}

function normalizeRoleTeams(roleTeams: ProjectRoleTeamInputDto[]): RoleTeamRow[] {
  if (roleTeams.length < 1) {
    throw new ApiError({
      code: 'PROJECT_ROLE_REQUIRED',
      fieldErrors: { roleTeams: ['역할별 담당 팀을 하나 이상 선택해 주세요.'] },
      message: '프로젝트 역할별 담당 팀이 필요합니다.',
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });
  }

  const roles = new Set<ProjectRole>();
  const normalized = roleTeams.map(({ role, teamId }) => {
    if (!Object.values(ProjectRole).includes(role) || roles.has(role)) {
      return validationError('roleTeams', '같은 프로젝트 역할을 중복 선택할 수 없습니다.');
    }
    roles.add(role);
    return { role, teamId: teamId.toLowerCase() };
  });

  return normalized.sort(
    (left, right) => PROJECT_ROLE_POSITION[left.role] - PROJECT_ROLE_POSITION[right.role],
  );
}

function parseCsv(
  value: string | undefined,
  isValid: (item: string) => boolean,
  message: string,
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const items = value.split(',').map((item) => item.trim());
  if (items.length === 0 || items.some((item) => item.length === 0 || !isValid(item))) {
    return invalidQuery(message);
  }
  return [...new Set(items)];
}

function parseCursor(
  value: string | undefined,
  sort: SortField,
  direction: SortDirection,
): ProjectCursor | undefined {
  if (value === undefined) {
    return undefined;
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
      parsed.length !== 4 ||
      parsed[0] !== sort ||
      parsed[1] !== direction ||
      typeof parsed[3] !== 'string' ||
      !isUUID(parsed[3], '4')
    ) {
      return invalidQuery('현재 정렬 조건에 맞는 커서를 사용해 주세요.');
    }

    if (sort === 'targetDate' && parsed[2] === null) {
      return { id: parsed[3], value: null };
    }
    if (typeof parsed[2] !== 'string') {
      return invalidQuery('커서를 확인해 주세요.');
    }

    const date =
      sort === 'updatedAt' ? new Date(parsed[2]) : new Date(`${parsed[2]}T00:00:00.000Z`);
    if (
      Number.isNaN(date.getTime()) ||
      (sort === 'updatedAt'
        ? date.toISOString() !== parsed[2]
        : date.toISOString().slice(0, 10) !== parsed[2])
    ) {
      return invalidQuery('커서를 확인해 주세요.');
    }
    return { id: parsed[3], value: date };
  } catch {
    return invalidQuery('커서를 확인해 주세요.');
  }
}

function encodeCursor(row: ProjectRow, sort: SortField, direction: SortDirection): string {
  const value = sort === 'updatedAt' ? row.updatedAt.toISOString() : dateValue(row.targetDate);
  return Buffer.from(JSON.stringify([sort, direction, value, row.id])).toString('base64url');
}

function progress(completed: number, total: number): ProjectProgressResponseDto {
  return {
    completed,
    percentage: total === 0 ? 0 : Math.round((completed / total) * 100),
    total,
  };
}

function toResponse(
  row: ProjectRow,
  projectProgress: ProjectProgressResponseDto,
): ProjectResponseDto {
  return {
    archived: row.archivedAt !== null,
    createdAt: row.createdAt.toISOString(),
    description: row.description,
    id: row.id,
    lead: row.leadMembership
      ? {
          id: row.leadMembership.id,
          role: row.leadMembership.role,
          status: row.leadMembership.status,
          user: {
            avatarFileId: row.leadMembership.user.avatarFileId,
            displayName: row.leadMembership.user.displayName,
            id: row.leadMembership.user.id,
          },
        }
      : null,
    name: row.name,
    progress: projectProgress,
    roleTeams: row.roleTeams
      .map(({ role, team }) => ({
        role,
        team: {
          archived: team.archivedAt !== null,
          id: team.id,
          key: team.key,
          name: team.name,
        },
      }))
      .sort((left, right) => PROJECT_ROLE_POSITION[left.role] - PROJECT_ROLE_POSITION[right.role]),
    startDate: dateValue(row.startDate),
    status: row.status,
    targetDate: dateValue(row.targetDate),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

@Injectable()
export class ProjectsService {
  constructor(private readonly database: DatabaseService) {}

  async list(workspaceId: string, dto: ProjectListQueryDto): Promise<ProjectListResponseDto> {
    const statuses = parseCsv(
      dto.status,
      (item) => Object.values(ProjectStatus).includes(item as ProjectStatus),
      '프로젝트 상태 필터를 확인해 주세요.',
    ) as ProjectStatus[] | undefined;
    const leadMembershipIds = parseCsv(
      dto.leadMembershipId,
      (item) => isUUID(item, '4'),
      '프로젝트 리드 필터를 확인해 주세요.',
    )?.map((item) => item.toLowerCase());
    const sort: SortField =
      dto.sort === undefined || dto.sort === 'updatedAt'
        ? 'updatedAt'
        : dto.sort === 'targetDate'
          ? 'targetDate'
          : invalidQuery('정렬 기준을 확인해 주세요.');
    const direction: SortDirection =
      dto.sortDirection === undefined || dto.sortDirection === 'desc'
        ? 'desc'
        : dto.sortDirection === 'asc'
          ? 'asc'
          : invalidQuery('정렬 방향을 확인해 주세요.');
    const cursor = parseCursor(dto.cursor, sort, direction);
    const limit = dto.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      invalidQuery('조회 개수를 확인해 주세요.');
    }

    const and: Prisma.ProjectWhereInput[] = [];
    if (cursor) {
      const idCondition = direction === 'asc' ? { gt: cursor.id } : { lt: cursor.id };
      const valueCondition = direction === 'asc' ? { gt: cursor.value! } : { lt: cursor.value! };
      if (sort === 'updatedAt') {
        and.push({
          OR: [{ updatedAt: valueCondition }, { id: idCondition, updatedAt: cursor.value! }],
        });
      } else if (cursor.value === null) {
        and.push({ id: idCondition, targetDate: null });
      } else {
        and.push({
          OR: [
            { targetDate: valueCondition },
            { id: idCondition, targetDate: cursor.value },
            { targetDate: null },
          ],
        });
      }
    }

    const rows = await this.database.client.project.findMany({
      orderBy:
        sort === 'updatedAt'
          ? [{ updatedAt: direction }, { id: direction }]
          : [{ targetDate: { nulls: 'last', sort: direction } }, { id: direction }],
      select: PROJECT_SELECT,
      take: limit + 1,
      where: {
        ...(and.length > 0 ? { AND: and } : {}),
        ...(dto.includeArchived ? {} : { archivedAt: null }),
        deletedAt: null,
        ...(leadMembershipIds ? { leadMembershipId: { in: leadMembershipIds } } : {}),
        ...(statuses ? { status: { in: statuses } } : {}),
        workspaceId,
      },
    });
    const page = rows.slice(0, limit);
    const progressByProject = await this.progressByProject(
      this.database.client,
      workspaceId,
      page.map(({ id }) => id),
    );
    const last = page.at(-1);

    return {
      items: page.map((row) => toResponse(row, progressByProject.get(row.id) ?? progress(0, 0))),
      nextCursor: rows.length > limit && last ? encodeCursor(last, sort, direction) : null,
    };
  }

  async create(
    context: { membershipId: string; workspaceId: string },
    dto: CreateProjectDto,
  ): Promise<ProjectResponseDto> {
    const name = normalizeName(dto.name);
    const description = normalizeDescription(dto.description) ?? null;
    const startDate = parseDate(dto.startDate, 'startDate') ?? null;
    const targetDate = parseDate(dto.targetDate, 'targetDate') ?? null;
    const roleTeams = normalizeRoleTeams(dto.roleTeams);
    validateDateOrder(startDate, targetDate);

    const result = await this.database.client.$transaction(async (transaction) => {
      await this.lockWorkspaceGraph(transaction, context.workspaceId);
      await this.lockActiveMembership(
        transaction,
        context.workspaceId,
        dto.leadMembershipId ?? undefined,
      );
      await this.lockActiveTeams(
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

      const created = await this.findProject(transaction, context.workspaceId, project.id);
      await notifyResourceChanged(transaction, {
        changeType: 'CREATED',
        resourceId: project.id,
        resourceType: 'PROJECT',
        version: created.version,
        workspaceId: context.workspaceId,
      });
      return toResponse(created, progress(0, 0));
    });
    return result;
  }

  async get(workspaceId: string, projectId: string): Promise<ProjectResponseDto> {
    const row = await this.database.client.project.findFirst({
      select: PROJECT_SELECT,
      where: { deletedAt: null, id: projectId, workspaceId },
    });
    if (!row) {
      return resourceNotFound();
    }
    const progressByProject = await this.progressByProject(this.database.client, workspaceId, [
      projectId,
    ]);
    return toResponse(row, progressByProject.get(projectId) ?? progress(0, 0));
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
      return validationError('project', '변경할 프로젝트 정보를 입력해 주세요.');
    }

    const requestedName = dto.name === undefined ? undefined : normalizeName(dto.name);
    const requestedDescription = normalizeDescription(dto.description);
    const requestedStartDate = parseDate(dto.startDate, 'startDate');
    const requestedTargetDate = parseDate(dto.targetDate, 'targetDate');
    const requestedRoleTeams =
      dto.roleTeams === undefined ? undefined : normalizeRoleTeams(dto.roleTeams);

    const outcome = await this.database.client.$transaction(async (transaction) => {
      await this.lockWorkspaceGraph(transaction, context.workspaceId);
      const current = await this.lockProject(transaction, context.workspaceId, projectId);
      if (current.version !== dto.version) {
        return versionConflict(current.version);
      }

      const nextStartDate =
        requestedStartDate === undefined ? current.startDate : requestedStartDate;
      const nextTargetDate =
        requestedTargetDate === undefined ? current.targetDate : requestedTargetDate;
      validateDateOrder(nextStartDate, nextTargetDate);

      const changesLead =
        dto.leadMembershipId !== undefined && dto.leadMembershipId !== current.leadMembershipId;
      if (changesLead) {
        await this.lockActiveMembership(
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
        await this.lockActiveTeams(
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
            select: { id: true, identifier: true, issue: { select: { title: true } }, projectRole: true, teamId: true },
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
        dateValue(requestedStartDate) !== dateValue(current.startDate);
      const changesTargetDate =
        requestedTargetDate !== undefined &&
        dateValue(requestedTargetDate) !== dateValue(current.targetDate);
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
        const row = await this.findProject(transaction, context.workspaceId, projectId);
        const progressByProject = await this.progressByProject(transaction, context.workspaceId, [
          projectId,
        ]);
        return {
          response: toResponse(row, progressByProject.get(projectId) ?? progress(0, 0)),
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
        addEvent('startDate', dateValue(current.startDate), dateValue(requestedStartDate ?? null));
      }
      if (changesTargetDate) {
        addEvent(
          'targetDate',
          dateValue(current.targetDate),
          dateValue(requestedTargetDate ?? null),
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

      const row = await this.findProject(transaction, context.workspaceId, projectId);
      await notifyResourceChanged(transaction, {
        changeType: 'UPDATED',
        resourceId: projectId,
        resourceType: 'PROJECT',
        version: row.version,
        workspaceId: context.workspaceId,
      });
      const progressByProject = await this.progressByProject(transaction, context.workspaceId, [
        projectId,
      ]);
      const response = toResponse(row, progressByProject.get(projectId) ?? progress(0, 0));
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
      await this.lockWorkspaceGraph(transaction, context.workspaceId);
      const current = await this.lockProject(transaction, context.workspaceId, projectId);
      if (current.version !== dto.version) {
        return versionConflict(current.version);
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

      const row = await this.findProject(transaction, context.workspaceId, projectId);
      if (changesArchive) {
        await notifyResourceChanged(transaction, {
          changeType: 'UPDATED',
          resourceId: projectId,
          resourceType: 'PROJECT',
          version: row.version,
          workspaceId: context.workspaceId,
        });
      }
      const progressByProject = await this.progressByProject(transaction, context.workspaceId, [
        projectId,
      ]);
      return toResponse(row, progressByProject.get(projectId) ?? progress(0, 0));
    });
  }

  async trash(
    context: { membershipId: string; workspaceId: string },
    projectId: string,
    version: number,
  ): Promise<void> {
    await this.database.client.$transaction(async (transaction) => {
      await this.lockWorkspaceGraph(transaction, context.workspaceId);
      await this.lockActorMembership(transaction, context.workspaceId, context.membershipId);
      const current = await this.lockProject(transaction, context.workspaceId, projectId);
      if (current.version !== version) {
        return versionConflict(current.version);
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

  private async findProject(
    transaction: Transaction,
    workspaceId: string,
    projectId: string,
  ): Promise<ProjectRow> {
    const row = await transaction.project.findFirst({
      select: PROJECT_SELECT,
      where: { deletedAt: null, id: projectId, workspaceId },
    });
    if (!row) {
      return resourceNotFound();
    }
    return row;
  }

  private async lockProject(
    transaction: Transaction,
    workspaceId: string,
    projectId: string,
  ): Promise<ProjectLockRow> {
    const [row] = await transaction.$queryRaw<ProjectLockRow[]>`
      SELECT
        "id",
        "name",
        "description",
        "status",
        "lead_membership_id" AS "leadMembershipId",
        "start_date" AS "startDate",
        "target_date" AS "targetDate",
        "archived_at" AS "archivedAt",
        "version"
      FROM "projects"
      WHERE "workspace_id" = ${workspaceId}::uuid
        AND "id" = ${projectId}::uuid
        AND "deleted_at" IS NULL
      FOR UPDATE
    `;
    return row ?? resourceNotFound();
  }

  private async lockWorkspaceGraph(transaction: Transaction, workspaceId: string): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "workspaces"
      WHERE "id" = ${workspaceId}::uuid
      FOR UPDATE
    `;
    if (rows.length !== 1) {
      return resourceNotFound();
    }
  }

  private async lockActiveMembership(
    transaction: Transaction,
    workspaceId: string,
    membershipId: string | undefined,
  ): Promise<void> {
    if (membershipId === undefined) {
      return;
    }

    const rows = await transaction.$queryRaw<Array<{ id: string; status: MembershipStatus }>>`
      SELECT "id", "status"
      FROM "workspace_memberships"
      WHERE "workspace_id" = ${workspaceId}::uuid
        AND "id" = ${membershipId}::uuid
      FOR UPDATE
    `;
    if (rows.length !== 1 || rows[0]?.status !== MembershipStatus.ACTIVE) {
      return resourceNotFound('활성 프로젝트 리드를 찾을 수 없습니다.');
    }
  }

  private async lockActorMembership(
    transaction: Transaction,
    workspaceId: string,
    membershipId: string,
  ): Promise<void> {
    const [membership] = await transaction.$queryRaw<Array<{ status: MembershipStatus }>>`
      SELECT "status"
      FROM "workspace_memberships"
      WHERE "workspace_id" = ${workspaceId}::uuid
        AND "id" = ${membershipId}::uuid
      FOR UPDATE
    `;
    if (!membership || membership.status !== MembershipStatus.ACTIVE) {
      throw new ApiError({
        code: 'FORBIDDEN',
        message: '활성 워크스페이스 멤버만 이 작업을 수행할 수 있습니다.',
        status: HttpStatus.FORBIDDEN,
      });
    }
  }

  private async lockActiveTeams(
    transaction: Transaction,
    workspaceId: string,
    teamIds: string[],
  ): Promise<void> {
    const uniqueTeamIds = [...new Set(teamIds)].sort();
    const rows = await transaction.$queryRaw<Array<{ archivedAt: Date | null; id: string }>>`
      SELECT "id", "archived_at" AS "archivedAt"
      FROM "teams"
      WHERE "workspace_id" = ${workspaceId}::uuid
        AND "id" IN (${Prisma.join(uniqueTeamIds.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY "id"
      FOR UPDATE
    `;
    if (
      rows.length !== uniqueTeamIds.length ||
      rows.some(({ archivedAt }) => archivedAt !== null)
    ) {
      return resourceNotFound('활성 프로젝트 담당 팀을 찾을 수 없습니다.');
    }
  }

  private async progressByProject(
    transaction: Transaction | DatabaseService['client'],
    workspaceId: string,
    projectIds: string[],
  ): Promise<Map<string, ProjectProgressResponseDto>> {
    if (projectIds.length === 0) {
      return new Map();
    }

    const rows = await transaction.$queryRaw<ProgressRow[]>`
      SELECT
        i."project_id" AS "projectId",
        COUNT(*) FILTER (WHERE s."category" <> 'CANCELED'::"StateCategory") AS "total",
        COUNT(*) FILTER (WHERE s."category" = 'COMPLETED'::"StateCategory") AS "completed"
      FROM "team_works" tw
      JOIN "issues" i
        ON i."workspace_id" = tw."workspace_id"
        AND i."id" = tw."issue_id"
      JOIN "workflow_states" s
        ON s."workspace_id" = tw."workspace_id"
        AND s."team_id" = tw."team_id"
        AND s."id" = tw."workflow_state_id"
      WHERE tw."workspace_id" = ${workspaceId}::uuid
        AND tw."deleted_at" IS NULL
        AND i."deleted_at" IS NULL
        AND i."project_id" IN (${Prisma.join(projectIds.map((id) => Prisma.sql`${id}::uuid`))})
      GROUP BY i."project_id"
    `;
    return new Map(
      rows.map((row) => {
        const completed = Number(row.completed);
        const total = Number(row.total);
        return [row.projectId, progress(completed, total)];
      }),
    );
  }
}
