import { randomUUID } from 'node:crypto';

import { HttpStatus, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';

import {
  HandoffKind,
  IssueFileKind,
  IssuePriority,
  IssueStatus,
  MembershipStatus,
  Prisma,
  ProjectRole,
  StateCategory,
} from '@rivet/database';
import {
  ISSUE_CHANGED,
  ISSUE_CHANGED_SCHEMA_VERSION,
  ISSUE_CREATED,
  ISSUE_CREATED_SCHEMA_VERSION,
  ISSUE_PURGE_SCHEDULED,
  ISSUE_PURGE_SCHEDULED_SCHEMA_VERSION,
  type IssueChangedField,
  TEAM_WORK_CHANGED,
  TEAM_WORK_CHANGED_SCHEMA_VERSION,
  TEAM_WORK_CREATED,
  TEAM_WORK_CREATED_SCHEMA_VERSION,
  type TeamWorkChangedOutboxPayload,
  type TeamWorkCreatedOutboxPayload,
} from '@rivet/event-contracts';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import { notifyResourceChanged } from '../../common/realtime/notify-resource-changed';
import {
  assertActiveMentionMemberships,
  type ParsedOptionalMarkdown,
  parseOptionalMarkdown,
} from '../../common/validation/markdown';
import { isInlineDisplayable } from '../files/file-content';
import { FilesService } from '../files/files.service';
import type {
  AssignTeamWorksDto,
  ClaimTeamWorkDto,
  CreateIssueDto,
  InitialRoleAssignmentDto,
  IssueListQueryDto,
  IssueStatusAction,
  StartIssueDto,
  UpdateIssueDto,
} from './dto/issue-request.dto';
import type {
  AssignTeamWorksResponseDto,
  ClaimTeamWorkResponseDto,
  CreateIssueResponseDto,
  IssueDetailResponseDto,
  IssueListResponseDto,
  IssueMemberSummaryResponseDto,
  IssueSummaryResponseDto,
  IssueWorkflowSummaryResponseDto,
  StartIssueResponseDto,
  TeamWorkListResponseDto,
  TeamWorkSummaryResponseDto,
  UpdateIssueResponseDto,
} from './dto/issue-response.dto';

type Transaction = Prisma.TransactionClient;
export type IssueMutationContext = { membershipId: string; userId: string; workspaceId: string };

const MEMBER_SELECT = {
  id: true,
  role: true,
  status: true,
  user: { select: { avatarFileId: true, displayName: true, id: true } },
} satisfies Prisma.WorkspaceMembershipSelect;

const TEAM_WORK_SELECT = {
  assigneeTeamMember: { select: { membership: { select: MEMBER_SELECT } } },
  createdAt: true,
  id: true,
  identifier: true,
  handoffTargets: { select: { handoff: { select: { kind: true } } } },
  issue: {
    select: {
      id: true,
      identifier: true,
      priority: true,
      status: true,
      teamWorks: {
        select: { projectRole: true },
        where: { deletedAt: null },
      },
      title: true,
    },
  },
  projectRole: true,
  workNoteMarkdown: true,
  team: { select: { archivedAt: true, id: true, key: true, name: true } },
  updatedAt: true,
  version: true,
  workflowState: {
    select: {
      category: true,
      id: true,
      isDefault: true,
      name: true,
      position: true,
      version: true,
    },
  },
} satisfies Prisma.TeamWorkSelect;

const ISSUE_SELECT = {
  createdAt: true,
  createdByMembership: { select: MEMBER_SELECT },
  descriptionMarkdown: true,
  fileAttachments: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      createdAt: true,
      createdByMembership: {
        select: { user: { select: { avatarFileId: true, displayName: true, id: true } } },
      },
      file: {
        select: {
          createdAt: true,
          detectedMimeType: true,
          id: true,
          originalName: true,
          sizeBytes: true,
        },
      },
      id: true,
      kind: true,
    },
    where: { kind: IssueFileKind.ISSUE_ATTACHMENT },
  },
  handoffs: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      authorMembership: { select: MEMBER_SELECT },
      bodyMarkdown: true,
      createdAt: true,
      id: true,
      kind: true,
      sequenceNumber: true,
      sourceTeamWork: {
        select: {
          id: true,
          identifier: true,
          projectRole: true,
          team: { select: { archivedAt: true, id: true, key: true, name: true } },
          workflowState: {
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
      },
      targets: {
        orderBy: { teamWorkId: 'asc' },
        select: {
          teamWork: {
            select: {
              id: true,
              identifier: true,
              projectRole: true,
              team: { select: { archivedAt: true, id: true, key: true, name: true } },
              workflowState: {
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
          },
        },
      },
    },
  },
  id: true,
  identifier: true,
  labels: {
    orderBy: { labelId: 'asc' },
    select: { label: { select: { archivedAt: true, color: true, id: true, name: true } } },
  },
  priority: true,
  project: { select: { archivedAt: true, id: true, name: true, status: true } },
  status: true,
  teamWorks: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: TEAM_WORK_SELECT,
    where: { deletedAt: null },
  },
  title: true,
  updatedAt: true,
  version: true,
} satisfies Prisma.IssueSelect;

type IssueRow = Prisma.IssueGetPayload<{ select: typeof ISSUE_SELECT }>;
export type TeamWorkRow = Prisma.TeamWorkGetPayload<{ select: typeof TEAM_WORK_SELECT }>;

function resourceNotFound(message = '이슈를 찾을 수 없습니다.'): never {
  throw new ApiError({ code: 'RESOURCE_NOT_FOUND', message, status: HttpStatus.NOT_FOUND });
}

function conflict(code: string, message: string, currentVersion?: number): never {
  throw new ApiError({
    code,
    ...(currentVersion ? { currentVersion } : {}),
    message,
    status: HttpStatus.CONFLICT,
  });
}

function unprocessable(code: string, message: string): never {
  throw new ApiError({ code, message, status: HttpStatus.UNPROCESSABLE_ENTITY });
}

function memberResponse(member: IssueRow['createdByMembership']): IssueMemberSummaryResponseDto {
  return { id: member.id, role: member.role, status: member.status, user: member.user };
}

function teamResponse(team: { archivedAt: Date | null; id: string; key: string; name: string }) {
  return { archived: team.archivedAt !== null, id: team.id, key: team.key, name: team.name };
}

function workflowStateResponse(state: TeamWorkRow['workflowState']) {
  return { ...state };
}

function teamWorkReference(teamWork: {
  id: string;
  identifier: string;
  projectRole: ProjectRole;
  team: { archivedAt: Date | null; id: string; key: string; name: string };
  workflowState: TeamWorkRow['workflowState'];
}) {
  return {
    id: teamWork.id,
    identifier: teamWork.identifier,
    projectRole: teamWork.projectRole,
    team: teamResponse(teamWork.team),
    workflowState: workflowStateResponse(teamWork.workflowState),
  };
}

export function toTeamWorkSummary(row: TeamWorkRow): TeamWorkSummaryResponseDto {
  const isFrontend =
    row.projectRole === ProjectRole.WEB_FRONTEND || row.projectRole === ProjectRole.APP_FRONTEND;
  const hasBackendTeamWork = row.issue.teamWorks.some(
    ({ projectRole }) => projectRole === ProjectRole.BACKEND,
  );
  const hasInitialHandoff = row.handoffTargets.some(
    ({ handoff }) => handoff.kind === HandoffKind.INITIAL,
  );
  return {
    assignee: row.assigneeTeamMember ? memberResponse(row.assigneeTeamMember.membership) : null,
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    identifier: row.identifier,
    issue: {
      id: row.issue.id,
      identifier: row.issue.identifier,
      priority: row.issue.priority,
      status: row.issue.status,
      title: row.issue.title,
    },
    projectRole: row.projectRole,
    readinessStatus: isFrontend
      ? hasInitialHandoff || !hasBackendTeamWork
        ? 'READY'
        : 'API_HANDOFF_PENDING'
      : null,
    workNoteMarkdown: row.workNoteMarkdown,
    stateCategory: row.workflowState.category,
    team: teamResponse(row.team),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
    workflowState: workflowStateResponse(row.workflowState),
  };
}

export function toTeamWorkDetail(row: TeamWorkRow) {
  return toTeamWorkSummary(row);
}

function workflowSummary(teamWorks: TeamWorkRow[]): IssueWorkflowSummaryResponseDto {
  const completedCount = teamWorks.filter(
    ({ workflowState }) => workflowState.category === StateCategory.COMPLETED,
  ).length;
  const canceledCount = teamWorks.filter(
    ({ workflowState }) => workflowState.category === StateCategory.CANCELED,
  ).length;
  const validCount = teamWorks.length - canceledCount;
  return {
    activeRoles: [
      ...new Set(
        teamWorks
          .filter(
            ({ workflowState }) =>
              workflowState.category !== StateCategory.COMPLETED &&
              workflowState.category !== StateCategory.CANCELED,
          )
          .map(({ projectRole }) => projectRole),
      ),
    ].sort(),
    allTeamWorksCompleted: validCount > 0 && completedCount === validCount,
    canceledCount,
    completedCount,
    teamWorkCount: teamWorks.length,
    unassignedCount: teamWorks.filter(
      ({ assigneeTeamMember, workflowState }) =>
        assigneeTeamMember === null &&
        workflowState.category !== StateCategory.COMPLETED &&
        workflowState.category !== StateCategory.CANCELED,
    ).length,
  };
}

export function toIssueSummary(row: IssueRow): IssueSummaryResponseDto {
  const completed = row.teamWorks.filter(
    ({ workflowState }) => workflowState.category === StateCategory.COMPLETED,
  ).length;
  const valid = row.teamWorks.filter(
    ({ workflowState }) => workflowState.category !== StateCategory.CANCELED,
  ).length;
  return {
    createdAt: row.createdAt.toISOString(),
    createdBy: memberResponse(row.createdByMembership),
    id: row.id,
    identifier: row.identifier,
    labels: row.labels.map(({ label }) => ({
      archived: label.archivedAt !== null,
      color: label.color,
      id: label.id,
      name: label.name,
    })),
    priority: row.priority,
    progress: {
      completed,
      percentage: valid === 0 ? 0 : Math.round((completed / valid) * 100),
      total: valid,
    },
    project: {
      archived: row.project.archivedAt !== null,
      id: row.project.id,
      name: row.project.name,
      status: row.project.status,
    },
    status: row.status,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
    workflowSummary: workflowSummary(row.teamWorks),
  };
}

export function toIssueDetail(row: IssueRow): IssueDetailResponseDto {
  return {
    ...toIssueSummary(row),
    attachments: row.fileAttachments.map((attachment) => ({
      createdAt: attachment.createdAt.toISOString(),
      file: {
        createdAt: attachment.file.createdAt.toISOString(),
        detectedMimeType: attachment.file.detectedMimeType,
        id: attachment.file.id,
        inlineDisplayable: isInlineDisplayable(attachment.file.detectedMimeType),
        linked: true,
        originalName: attachment.file.originalName,
        scope: 'WORKSPACE',
        sizeBytes: Number(attachment.file.sizeBytes),
      },
      id: attachment.id,
      kind: 'ISSUE_ATTACHMENT',
      uploader: attachment.createdByMembership.user,
    })),
    descriptionMarkdown: row.descriptionMarkdown,
    handoffFlows: row.handoffs.map((handoff) => ({
      author: memberResponse(handoff.authorMembership),
      bodyMarkdown: handoff.bodyMarkdown,
      createdAt: handoff.createdAt.toISOString(),
      id: handoff.id,
      kind: handoff.kind,
      sequenceNumber: handoff.sequenceNumber,
      sourceTeamWork: teamWorkReference(handoff.sourceTeamWork),
      targets: handoff.targets.map(({ teamWork }) => ({ teamWork: teamWorkReference(teamWork) })),
    })),
    teamWorks: row.teamWorks.map(toTeamWorkSummary),
  };
}

function csvValues(value: string | undefined): string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

@Injectable()
export class IssuesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly files: FilesService,
  ) {}

  async list(
    context: IssueMutationContext,
    query: IssueListQueryDto,
  ): Promise<IssueListResponseDto> {
    const projectIds = csvValues(query.projectId);
    const statuses = csvValues(query.status);
    const priorities = csvValues(query.priority);
    const labelIds = csvValues(query.labelId);
    const creatorIds = csvValues(query.createdByMembershipId);
    if (
      projectIds.some((id) => !isUUID(id, '4')) ||
      labelIds.some((id) => !isUUID(id, '4')) ||
      creatorIds.some((id) => !isUUID(id, '4'))
    ) {
      throw new ApiError({
        code: 'INVALID_QUERY',
        message: 'ID 필터가 올바르지 않습니다.',
        status: HttpStatus.BAD_REQUEST,
      });
    }
    if (
      statuses.some((value) => !Object.values(IssueStatus).includes(value as IssueStatus)) ||
      priorities.some((value) => !Object.values(IssuePriority).includes(value as IssuePriority))
    ) {
      throw new ApiError({
        code: 'INVALID_QUERY',
        message: '상태 또는 우선순위 필터가 올바르지 않습니다.',
        status: HttpStatus.BAD_REQUEST,
      });
    }
    const issueWhere: Prisma.IssueWhereInput = {
      createdAt: {
        ...(query.createdFrom ? { gte: new Date(query.createdFrom) } : {}),
        ...(query.createdTo ? { lte: new Date(query.createdTo) } : {}),
      },
      deletedAt: null,
      updatedAt: {
        ...(query.updatedFrom ? { gte: new Date(query.updatedFrom) } : {}),
        ...(query.updatedTo ? { lte: new Date(query.updatedTo) } : {}),
      },
      workspaceId: context.workspaceId,
      ...(creatorIds.length ? { createdByMembershipId: { in: creatorIds } } : {}),
      ...(query.cursor
        ? { id: { [query.sortDirection === 'asc' ? 'gt' : 'lt']: query.cursor } }
        : {}),
      ...(labelIds.length ? { labels: { some: { labelId: { in: labelIds } } } } : {}),
      ...(priorities.length ? { priority: { in: priorities as IssuePriority[] } } : {}),
      ...(projectIds.length ? { projectId: { in: projectIds } } : {}),
      ...(statuses.length ? { status: { in: statuses as IssueStatus[] } } : {}),
      ...(query.query
        ? {
            OR: [
              { identifier: { contains: query.query, mode: 'insensitive' as const } },
              { title: { contains: query.query, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const rows = await this.database.client.issue.findMany({
      orderBy: [
        { [query.sort ?? 'updatedAt']: query.sortDirection ?? 'desc' },
        { id: query.sortDirection ?? 'desc' },
      ],
      select: ISSUE_SELECT,
      where: issueWhere,
      take: query.limit + 1,
    });
    const hasNext = rows.length > query.limit;
    const page = hasNext ? rows.slice(0, query.limit) : rows;
    const totalCount = await this.database.client.issue.count({ where: issueWhere });
    return {
      items: (page as IssueRow[]).map(toIssueSummary),
      nextCursor: hasNext ? page.at(-1)!.id : null,
      totalCount,
    };
  }

  async create(
    context: IssueMutationContext,
    dto: CreateIssueDto,
  ): Promise<CreateIssueResponseDto> {
    const description = parseOptionalMarkdown(dto.descriptionMarkdown, 100_000);
    return this.database.client.$transaction(async (transaction) => {
      const workspace = await transaction.workspace.findUnique({
        select: { nextIssueNumber: true },
        where: { id: context.workspaceId },
      });
      if (!workspace) resourceNotFound('워크스페이스를 찾을 수 없습니다.');
      await this.assertProject(transaction, context.workspaceId, dto.projectId);
      await this.assertActor(transaction, context.workspaceId, context.membershipId);
      await this.assertLabels(transaction, context.workspaceId, dto.labelIds ?? []);
      await assertActiveMentionMemberships(
        transaction,
        context.workspaceId,
        description.mentionedMembershipIds,
      );
      await transaction.workspace.update({
        data: { nextIssueNumber: { increment: 1 } },
        where: { id: context.workspaceId },
      });
      const issue = await transaction.issue.create({
        data: {
          createdByMembershipId: context.membershipId,
          descriptionMarkdown: description.bodyMarkdown,
          identifier: `F-${workspace.nextIssueNumber}`,
          priority: dto.priority ?? IssuePriority.NONE,
          projectId: dto.projectId,
          sequenceNumber: workspace.nextIssueNumber,
          title: dto.title,
          workspaceId: context.workspaceId,
        },
        select: { id: true },
      });
      await transaction.issueSubscription.create({
        data: {
          issueId: issue.id,
          membershipId: context.membershipId,
          workspaceId: context.workspaceId,
        },
      });
      if ((dto.labelIds ?? []).length)
        await transaction.issueLabel.createMany({
          data: [...new Set(dto.labelIds)].map((labelId) => ({
            issueId: issue.id,
            labelId,
            workspaceId: context.workspaceId,
          })),
        });
      await this.syncDescription(transaction, context, issue.id, description);
      await this.files.attachIssueFiles(
        transaction,
        context,
        issue.id,
        dto.attachmentFileIds ?? [],
      );
      const createdTeamWorks = await this.createTeamWorks(
        transaction,
        context,
        issue.id,
        dto.projectId,
        dto.initialRoles ?? [],
      );
      await this.recalculateIssueStatus(transaction, context.workspaceId, issue.id);
      await transaction.activityEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          afterData: { identifier: `F-${workspace.nextIssueNumber}`, title: dto.title },
          eventType: 'ISSUE_CREATED',
          issueId: issue.id,
          workspaceId: context.workspaceId,
        },
      });
      const eventId = randomUUID();
      await transaction.outboxEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          aggregateId: issue.id,
          aggregateType: 'ISSUE',
          eventType: ISSUE_CREATED,
          id: eventId,
          payload: {
            issueId: issue.id,
            mentionedMembershipIds: description.mentionedMembershipIds,
            schemaVersion: ISSUE_CREATED_SCHEMA_VERSION,
          },
          workspaceId: context.workspaceId,
        },
      });
      const row = await this.findIssue(transaction, context.workspaceId, issue.id);
      await notifyResourceChanged(transaction, {
        changeType: 'CREATED',
        eventId,
        resourceId: issue.id,
        resourceType: 'ISSUE',
        version: row.version,
        workspaceId: context.workspaceId,
      });
      return {
        createdTeamWorks: createdTeamWorks.map(toTeamWorkSummary),
        issue: toIssueDetail(row),
      };
    });
  }

  async start(
    context: IssueMutationContext,
    issueId: string,
    dto: StartIssueDto,
  ): Promise<StartIssueResponseDto> {
    return this.database.client.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "issues"
        WHERE "id" = ${issueId}::uuid AND "workspace_id" = ${context.workspaceId}::uuid
          AND "deleted_at" IS NULL
        FOR UPDATE
      `;
      const current = await transaction.issue.findFirst({
        select: { id: true, projectId: true, status: true },
        where: { deletedAt: null, id: issueId, workspaceId: context.workspaceId },
      });
      if (!current) resourceNotFound();
      if (
        current.status === IssueStatus.PAUSED ||
        current.status === IssueStatus.CANCELED ||
        current.status === IssueStatus.DONE
      ) {
        conflict(
          'ISSUE_REOPEN_REQUIRED',
          '팀 작업을 시작하려면 이슈를 재개하거나 다시 열어야 합니다.',
        );
      }
      const created = await this.createTeamWorks(
        transaction,
        context,
        issueId,
        current.projectId,
        dto.roleAssignments,
        dto.requireCurrentUserTeamMembership,
      );
      await this.recalculateIssueStatus(transaction, context.workspaceId, issueId);
      const issue = await this.findIssue(transaction, context.workspaceId, issueId);
      await notifyResourceChanged(transaction, {
        changeType: 'UPDATED',
        resourceId: issueId,
        resourceType: 'ISSUE',
        version: issue.version,
        workspaceId: context.workspaceId,
      });
      return { issue: toIssueSummary(issue), teamWorks: created.map(toTeamWorkSummary) };
    });
  }

  async listTeamWorks(workspaceId: string, issueId: string): Promise<TeamWorkListResponseDto> {
    const issue = await this.findIssue(this.database.client, workspaceId, issueId);
    return {
      items: issue.teamWorks.map(toTeamWorkSummary),
      nextCursor: null,
      totalCount: issue.teamWorks.length,
    };
  }

  async claim(
    context: IssueMutationContext,
    issueId: string,
    dto: ClaimTeamWorkDto,
  ): Promise<ClaimTeamWorkResponseDto> {
    return this.database.client.$transaction(async (transaction) => {
      const candidates = await transaction.teamWork.findMany({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: TEAM_WORK_SELECT,
        where: {
          assigneeMembershipId: null,
          deletedAt: null,
          issueId,
          projectRole: dto.projectRole,
          workspaceId: context.workspaceId,
          ...(dto.teamWorkId ? { id: dto.teamWorkId } : {}),
        },
      });
      if (candidates.length !== 1)
        conflict('CLAIM_TARGET_REQUIRED', '맡을 팀 작업을 하나 선택해 주세요.');
      const candidate = candidates[0] as TeamWorkRow;
      await this.assertTeamMember(
        transaction,
        context.workspaceId,
        candidate.team.id,
        context.membershipId,
      );
      const changed = await transaction.teamWork.updateMany({
        data: { assigneeMembershipId: context.membershipId, version: { increment: 1 } },
        where: { assigneeMembershipId: null, id: candidate.id, version: candidate.version },
      });
      if (changed.count !== 1)
        conflict('ISSUE_ASSIGNMENT_CONFLICT', '팀 작업 담당자가 이미 변경됐습니다.');
      await transaction.issueSubscription.createMany({
        data: [{ issueId, membershipId: context.membershipId, workspaceId: context.workspaceId }],
        skipDuplicates: true,
      });
      await transaction.activityEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          afterData: { id: context.membershipId },
          eventType: 'TEAM_WORK_ASSIGNEE_CHANGED',
          fieldName: 'assigneeMembershipId',
          issueId,
          teamWorkId: candidate.id,
          workspaceId: context.workspaceId,
        },
      });
      const eventId = randomUUID();
      await transaction.outboxEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          aggregateId: candidate.id,
          aggregateType: 'TEAM_WORK',
          eventType: TEAM_WORK_CHANGED,
          id: eventId,
          payload: {
            assigneeMembershipId: context.membershipId,
            changedFields: ['ASSIGNEE'],
            issueId,
            schemaVersion: TEAM_WORK_CHANGED_SCHEMA_VERSION,
            subscriberMembershipIds: [],
            teamWorkId: candidate.id,
            terminalCategory: null,
          } satisfies TeamWorkChangedOutboxPayload,
          workspaceId: context.workspaceId,
        },
      });
      await this.recalculateIssueStatus(transaction, context.workspaceId, issueId);
      const teamWork = await this.findTeamWork(transaction, context.workspaceId, candidate.id);
      const issue = await this.findIssue(transaction, context.workspaceId, issueId);
      await notifyResourceChanged(transaction, {
        changeType: 'UPDATED',
        eventId,
        resourceId: teamWork.id,
        resourceType: 'TEAM_WORK',
        version: teamWork.version,
        workspaceId: context.workspaceId,
      });
      return {
        issue: toIssueSummary(issue),
        teamWork: toTeamWorkSummary(teamWork),
        workflowSummary: workflowSummary(issue.teamWorks),
      };
    });
  }

  async assignTeamWorks(
    context: IssueMutationContext,
    issueId: string,
    dto: AssignTeamWorksDto,
  ): Promise<AssignTeamWorksResponseDto> {
    return this.database.client.$transaction(async (transaction) => {
      const updated: TeamWorkRow[] = [];
      for (const assignment of dto.assignments) {
        const current = await this.findTeamWork(
          transaction,
          context.workspaceId,
          assignment.teamWorkId,
        );
        if (current.issue.id !== issueId)
          resourceNotFound('이슈에 속한 팀 작업을 찾을 수 없습니다.');
        await this.assertTeamMember(
          transaction,
          context.workspaceId,
          current.team.id,
          assignment.assigneeMembershipId,
        );
        const changed = await transaction.teamWork.updateMany({
          data: {
            assigneeMembershipId: assignment.assigneeMembershipId,
            version: { increment: 1 },
          },
          where: { id: current.id, version: assignment.version, workspaceId: context.workspaceId },
        });
        if (changed.count !== 1)
          conflict(
            'TEAM_WORK_VERSION_CONFLICT',
            '팀 작업이 다른 요청에서 변경되었습니다.',
            current.version,
          );
        await transaction.issueSubscription.createMany({
          data: [
            {
              issueId,
              membershipId: assignment.assigneeMembershipId,
              workspaceId: context.workspaceId,
            },
          ],
          skipDuplicates: true,
        });
        await transaction.activityEvent.create({
          data: {
            actorMembershipId: context.membershipId,
            afterData: { id: assignment.assigneeMembershipId },
            eventType: 'TEAM_WORK_ASSIGNEE_CHANGED',
            fieldName: 'assigneeMembershipId',
            issueId,
            teamWorkId: current.id,
            workspaceId: context.workspaceId,
          },
        });
        const eventId = randomUUID();
        await transaction.outboxEvent.create({
          data: {
            actorMembershipId: context.membershipId,
            aggregateId: current.id,
            aggregateType: 'TEAM_WORK',
            eventType: TEAM_WORK_CHANGED,
            id: eventId,
            payload: {
              assigneeMembershipId: assignment.assigneeMembershipId,
              changedFields: ['ASSIGNEE'],
              issueId,
              schemaVersion: TEAM_WORK_CHANGED_SCHEMA_VERSION,
              subscriberMembershipIds: [],
              teamWorkId: current.id,
              terminalCategory: null,
            } satisfies TeamWorkChangedOutboxPayload,
            workspaceId: context.workspaceId,
          },
        });
        await notifyResourceChanged(transaction, {
          changeType: 'UPDATED',
          eventId,
          resourceId: current.id,
          resourceType: 'TEAM_WORK',
          version: current.version + 1,
          workspaceId: context.workspaceId,
        });
        updated.push(await this.findTeamWork(transaction, context.workspaceId, current.id));
      }
      await this.recalculateIssueStatus(transaction, context.workspaceId, issueId);
      const issue = await this.findIssue(transaction, context.workspaceId, issueId);
      return {
        issue: toIssueSummary(issue),
        teamWorks: updated.map(toTeamWorkSummary),
        workflowSummary: workflowSummary(issue.teamWorks),
      };
    });
  }

  async get(workspaceId: string, issueRef: string): Promise<IssueDetailResponseDto> {
    const issue = await this.database.client.issue.findFirst({
      select: ISSUE_SELECT,
      where: {
        deletedAt: null,
        workspaceId,
        ...(isUUID(issueRef, '4') ? { id: issueRef } : { identifier: issueRef.toUpperCase() }),
      },
    });
    if (!issue) resourceNotFound();
    return toIssueDetail(issue);
  }

  async update(
    context: IssueMutationContext,
    issueId: string,
    dto: UpdateIssueDto,
  ): Promise<UpdateIssueResponseDto> {
    if (
      dto.title === undefined &&
      dto.descriptionMarkdown === undefined &&
      dto.priority === undefined &&
      dto.labelIds === undefined &&
      dto.statusAction === undefined
    ) {
      unprocessable('ISSUE_CHANGE_REQUIRED', '변경할 이슈 필드가 필요합니다.');
    }
    const description =
      dto.descriptionMarkdown === undefined
        ? undefined
        : parseOptionalMarkdown(dto.descriptionMarkdown, 100_000);
    return this.database.client.$transaction(async (transaction) => {
      const current = await this.findIssue(transaction, context.workspaceId, issueId);
      if (current.version !== dto.version)
        conflict('ISSUE_VERSION_CONFLICT', '이슈가 다른 요청에서 변경되었습니다.', current.version);
      if (dto.statusAction === 'COMPLETE' && current.status !== IssueStatus.REVIEW)
        conflict(
          'ISSUE_COMPLETION_NOT_READY',
          '모든 팀 작업이 완료되어 검토 상태여야 이슈를 완료할 수 있습니다.',
        );
      await this.assertLabels(transaction, context.workspaceId, dto.labelIds ?? []);
      if (description)
        await assertActiveMentionMemberships(
          transaction,
          context.workspaceId,
          description.mentionedMembershipIds,
        );
      let status = dto.statusAction
        ? this.statusFromAction(dto.statusAction, current.status)
        : undefined;
      const changed = await transaction.issue.updateMany({
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(description ? { descriptionMarkdown: description.bodyMarkdown } : {}),
          ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
          ...(status ? { status } : {}),
          version: { increment: 1 },
        },
        where: { id: issueId, version: dto.version, workspaceId: context.workspaceId },
      });
      if (changed.count !== 1)
        conflict('ISSUE_VERSION_CONFLICT', '이슈가 다른 요청에서 변경되었습니다.', current.version);
      if (dto.labelIds) {
        await transaction.issueLabel.deleteMany({ where: { issueId } });
        if (dto.labelIds.length)
          await transaction.issueLabel.createMany({
            data: [...new Set(dto.labelIds)].map((labelId) => ({
              issueId,
              labelId,
              workspaceId: context.workspaceId,
            })),
          });
      }
      if (description) await this.syncDescription(transaction, context, issueId, description);
      if (dto.statusAction === 'RESUME' || dto.statusAction === 'REOPEN') {
        status = await this.recalculateIssueStatus(transaction, context.workspaceId, issueId);
      }
      await transaction.activityEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          afterData: { priority: dto.priority, status, title: dto.title },
          eventType: 'ISSUE_CHANGED',
          issueId,
          workspaceId: context.workspaceId,
        },
      });
      const eventId = randomUUID();
      const changedFields = [
        dto.title !== undefined ? 'TITLE' : null,
        description ? 'DESCRIPTION' : null,
        dto.priority !== undefined ? 'PRIORITY' : null,
        status ? 'STATUS' : null,
        dto.labelIds ? 'LABELS' : null,
      ].filter((field): field is IssueChangedField => field !== null);
      const terminalCategory =
        status === IssueStatus.DONE
          ? ('COMPLETED' as const)
          : status === IssueStatus.CANCELED
            ? ('CANCELED' as const)
            : null;
      const subscriberMembershipIds = terminalCategory
        ? (
            await transaction.issueSubscription.findMany({
              orderBy: { membershipId: 'asc' },
              select: { membershipId: true },
              where: { issueId, workspaceId: context.workspaceId },
            })
          ).map(({ membershipId }) => membershipId)
        : [];
      await transaction.outboxEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          aggregateId: issueId,
          aggregateType: 'ISSUE',
          eventType: ISSUE_CHANGED,
          id: eventId,
          payload: {
            changedFields,
            issueId,
            mentionedMembershipIds: description?.mentionedMembershipIds ?? [],
            schemaVersion: ISSUE_CHANGED_SCHEMA_VERSION,
            subscriberMembershipIds,
            terminalCategory,
          },
          workspaceId: context.workspaceId,
        },
      });
      const updated = await this.findIssue(transaction, context.workspaceId, issueId);
      await notifyResourceChanged(transaction, {
        changeType: 'UPDATED',
        eventId,
        resourceId: issueId,
        resourceType: 'ISSUE',
        version: updated.version,
        workspaceId: context.workspaceId,
      });
      return toIssueDetail(updated);
    });
  }

  async trash(context: IssueMutationContext, issueId: string, version: number): Promise<void> {
    await this.database.client.$transaction(async (transaction) => {
      const current = await transaction.issue.findFirst({
        select: { id: true, version: true },
        where: { deletedAt: null, id: issueId, workspaceId: context.workspaceId },
      });
      if (!current) resourceNotFound();
      if (current.version !== version)
        conflict('ISSUE_VERSION_CONFLICT', '이슈가 다른 요청에서 변경되었습니다.', current.version);
      const deletedAt = new Date();
      const purgeAt = new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
      await transaction.issue.update({
        data: {
          deletedAt,
          deletedByMembershipId: context.membershipId,
          purgeAt,
          version: { increment: 1 },
        },
        where: { id: issueId },
      });
      await transaction.teamWork.updateMany({
        data: { deletedAt },
        where: { issueId, workspaceId: context.workspaceId },
      });
      const eventId = randomUUID();
      await transaction.outboxEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          aggregateId: issueId,
          aggregateType: 'ISSUE',
          eventType: ISSUE_PURGE_SCHEDULED,
          id: eventId,
          payload: {
            issueId,
            purgeAt: purgeAt.toISOString(),
            schemaVersion: ISSUE_PURGE_SCHEDULED_SCHEMA_VERSION,
          },
          workspaceId: context.workspaceId,
        },
      });
      await notifyResourceChanged(transaction, {
        changeType: 'DELETED',
        eventId,
        resourceId: issueId,
        resourceType: 'ISSUE',
        version: version + 1,
        workspaceId: context.workspaceId,
      });
    });
  }

  async recalculateIssueStatus(
    transaction: Transaction,
    workspaceId: string,
    issueId: string,
  ): Promise<IssueStatus> {
    const issue = await transaction.issue.findFirst({
      select: { status: true },
      where: { deletedAt: null, id: issueId, workspaceId },
    });
    if (!issue) resourceNotFound();
    if (
      issue.status === IssueStatus.PAUSED ||
      issue.status === IssueStatus.CANCELED ||
      issue.status === IssueStatus.DONE
    )
      return issue.status;
    const teamWorks = await transaction.teamWork.findMany({
      select: { workflowState: { select: { category: true } } },
      where: { deletedAt: null, issueId, workspaceId },
    });
    const valid = teamWorks.filter(
      ({ workflowState }) => workflowState.category !== StateCategory.CANCELED,
    );
    const next =
      valid.length === 0
        ? IssueStatus.UNSORTED
        : valid.every(({ workflowState }) => workflowState.category === StateCategory.COMPLETED)
          ? IssueStatus.REVIEW
          : valid.some(
                ({ workflowState }) =>
                  workflowState.category === StateCategory.STARTED ||
                  workflowState.category === StateCategory.COMPLETED,
              )
            ? IssueStatus.IN_PROGRESS
            : IssueStatus.TODO;
    if (next !== issue.status)
      await transaction.issue.update({
        data: { status: next, version: { increment: 1 } },
        where: { id: issueId },
      });
    return next;
  }

  async findIssue(
    transaction: Transaction,
    workspaceId: string,
    issueId: string,
  ): Promise<IssueRow> {
    const row = await transaction.issue.findFirst({
      select: ISSUE_SELECT,
      where: { deletedAt: null, id: issueId, workspaceId },
    });
    if (!row) resourceNotFound();
    return row;
  }

  async findTeamWork(
    transaction: Transaction,
    workspaceId: string,
    teamWorkId: string,
  ): Promise<TeamWorkRow> {
    const row = await transaction.teamWork.findFirst({
      select: TEAM_WORK_SELECT,
      where: { deletedAt: null, id: teamWorkId, workspaceId },
    });
    if (!row) resourceNotFound('팀 작업을 찾을 수 없습니다.');
    return row;
  }

  private async createTeamWorks(
    transaction: Transaction,
    context: IssueMutationContext,
    issueId: string,
    projectId: string,
    assignments: InitialRoleAssignmentDto[],
    requireCurrentUserTeamMembership = false,
  ): Promise<TeamWorkRow[]> {
    const created: TeamWorkRow[] = [];
    for (const assignment of assignments) {
      const roleTeam = await transaction.projectRoleTeam.findUnique({
        select: { teamId: true },
        where: { projectId_role: { projectId, role: assignment.projectRole } },
      });
      if (!roleTeam)
        unprocessable('INITIAL_ROLE_NOT_AVAILABLE', '프로젝트에 설정된 역할만 시작할 수 있습니다.');
      if (requireCurrentUserTeamMembership)
        await this.assertTeamMember(
          transaction,
          context.workspaceId,
          roleTeam.teamId,
          context.membershipId,
        );
      if (assignment.assigneeMembershipId)
        await this.assertTeamMember(
          transaction,
          context.workspaceId,
          roleTeam.teamId,
          assignment.assigneeMembershipId,
        );
      const reusable = await transaction.teamWork.findFirst({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { assigneeMembershipId: true, id: true, version: true },
        where: {
          deletedAt: null,
          issueId,
          projectRole: assignment.projectRole,
          teamId: roleTeam.teamId,
          workflowState: { category: { notIn: [StateCategory.COMPLETED, StateCategory.CANCELED] } },
          workspaceId: context.workspaceId,
        },
      });
      if (reusable) {
        if (
          assignment.assigneeMembershipId &&
          reusable.assigneeMembershipId &&
          reusable.assigneeMembershipId !== assignment.assigneeMembershipId
        ) {
          conflict('TEAM_WORK_ASSIGNMENT_CONFLICT', '기존 팀 작업의 담당자가 다릅니다.');
        }
        if (assignment.assigneeMembershipId && reusable.assigneeMembershipId === null) {
          await transaction.teamWork.update({
            data: {
              assigneeMembershipId: assignment.assigneeMembershipId,
              version: { increment: 1 },
            },
            where: { id: reusable.id },
          });
          await transaction.issueSubscription.createMany({
            data: [
              {
                issueId,
                membershipId: assignment.assigneeMembershipId,
                workspaceId: context.workspaceId,
              },
            ],
            skipDuplicates: true,
          });
          const eventId = randomUUID();
          await transaction.outboxEvent.create({
            data: {
              actorMembershipId: context.membershipId,
              aggregateId: reusable.id,
              aggregateType: 'TEAM_WORK',
              eventType: TEAM_WORK_CHANGED,
              id: eventId,
              payload: {
                assigneeMembershipId: assignment.assigneeMembershipId,
                changedFields: ['ASSIGNEE'],
                issueId,
                schemaVersion: TEAM_WORK_CHANGED_SCHEMA_VERSION,
                subscriberMembershipIds: [],
                teamWorkId: reusable.id,
                terminalCategory: null,
              } satisfies TeamWorkChangedOutboxPayload,
              workspaceId: context.workspaceId,
            },
          });
          await notifyResourceChanged(transaction, {
            changeType: 'UPDATED',
            eventId,
            resourceId: reusable.id,
            resourceType: 'TEAM_WORK',
            version: reusable.version + 1,
            workspaceId: context.workspaceId,
          });
        }
        created.push(await this.findTeamWork(transaction, context.workspaceId, reusable.id));
        continue;
      }
      await transaction.$queryRaw`
        SELECT "id" FROM "teams"
        WHERE "id" = ${roleTeam.teamId}::uuid AND "workspace_id" = ${context.workspaceId}::uuid
        FOR UPDATE
      `;
      const team = await transaction.team.findFirst({
        select: { id: true, key: true, nextIssueNumber: true },
        where: { archivedAt: null, id: roleTeam.teamId, workspaceId: context.workspaceId },
      });
      const workflowState = await transaction.workflowState.findFirst({
        orderBy: [{ isDefault: 'desc' }, { position: 'asc' }, { id: 'asc' }],
        select: { id: true },
        where: {
          category: { notIn: [StateCategory.COMPLETED, StateCategory.CANCELED] },
          teamId: roleTeam.teamId,
          workspaceId: context.workspaceId,
        },
      });
      if (!team || !workflowState)
        resourceNotFound('팀 또는 기본 워크플로 상태를 찾을 수 없습니다.');
      await transaction.team.update({
        data: { nextIssueNumber: { increment: 1 } },
        where: { id: team.id },
      });
      const teamWork = await transaction.teamWork.create({
        data: {
          assigneeMembershipId: assignment.assigneeMembershipId ?? null,
          createdByMembershipId: context.membershipId,
          identifier: `${team.key}-${team.nextIssueNumber}`,
          issueId,
          projectRole: assignment.projectRole,
          sequenceNumber: team.nextIssueNumber,
          teamId: team.id,
          workflowStateId: workflowState.id,
          workspaceId: context.workspaceId,
        },
        select: { id: true },
      });
      if (assignment.assigneeMembershipId)
        await transaction.issueSubscription.createMany({
          data: [
            {
              issueId,
              membershipId: assignment.assigneeMembershipId,
              workspaceId: context.workspaceId,
            },
          ],
          skipDuplicates: true,
        });
      await transaction.activityEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          afterData: {
            identifier: `${team.key}-${team.nextIssueNumber}`,
            projectRole: assignment.projectRole,
          },
          eventType: 'TEAM_WORK_CREATED',
          issueId,
          teamWorkId: teamWork.id,
          workspaceId: context.workspaceId,
        },
      });
      const eventId = randomUUID();
      await transaction.outboxEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          aggregateId: teamWork.id,
          aggregateType: 'TEAM_WORK',
          eventType: TEAM_WORK_CREATED,
          id: eventId,
          payload: {
            assigneeMembershipId: assignment.assigneeMembershipId ?? null,
            issueId,
            schemaVersion: TEAM_WORK_CREATED_SCHEMA_VERSION,
            teamWorkId: teamWork.id,
          } satisfies TeamWorkCreatedOutboxPayload,
          workspaceId: context.workspaceId,
        },
      });
      const row = await this.findTeamWork(transaction, context.workspaceId, teamWork.id);
      await notifyResourceChanged(transaction, {
        changeType: 'CREATED',
        eventId,
        resourceId: row.id,
        resourceType: 'TEAM_WORK',
        version: row.version,
        workspaceId: context.workspaceId,
      });
      created.push(row);
    }
    return created;
  }

  private statusFromAction(action: IssueStatusAction, current: IssueStatus): IssueStatus {
    const active =
      current === IssueStatus.UNSORTED ||
      current === IssueStatus.TODO ||
      current === IssueStatus.IN_PROGRESS ||
      current === IssueStatus.REVIEW;
    if (action === 'PAUSE' && active) return IssueStatus.PAUSED;
    if (action === 'RESUME' && current === IssueStatus.PAUSED) return IssueStatus.UNSORTED;
    if (action === 'CANCEL' && current !== IssueStatus.CANCELED && current !== IssueStatus.DONE)
      return IssueStatus.CANCELED;
    if (action === 'COMPLETE' && current === IssueStatus.REVIEW) return IssueStatus.DONE;
    if (action === 'REOPEN' && (current === IssueStatus.DONE || current === IssueStatus.CANCELED))
      return IssueStatus.UNSORTED;
    unprocessable(
      'ISSUE_STATUS_ACTION_INVALID',
      '현재 이슈 상태에서 실행할 수 없는 상태 행동입니다.',
    );
  }

  private async assertActor(
    transaction: Transaction,
    workspaceId: string,
    membershipId: string,
  ): Promise<void> {
    const actor = await transaction.workspaceMembership.findFirst({
      select: { id: true },
      where: { id: membershipId, status: MembershipStatus.ACTIVE, workspaceId },
    });
    if (!actor)
      throw new ApiError({
        code: 'FORBIDDEN',
        message: '활성 멤버십이 필요합니다.',
        status: HttpStatus.FORBIDDEN,
      });
  }

  private async assertProject(
    transaction: Transaction,
    workspaceId: string,
    projectId: string,
  ): Promise<void> {
    const project = await transaction.project.findFirst({
      select: { id: true },
      where: { archivedAt: null, deletedAt: null, id: projectId, workspaceId },
    });
    if (!project) resourceNotFound('프로젝트를 찾을 수 없습니다.');
  }

  private async assertLabels(
    transaction: Transaction,
    workspaceId: string,
    labelIds: string[],
  ): Promise<void> {
    const ids = [...new Set(labelIds)];
    if (!ids.length) return;
    const count = await transaction.label.count({
      where: { archivedAt: null, id: { in: ids }, workspaceId },
    });
    if (count !== ids.length) resourceNotFound('라벨을 찾을 수 없습니다.');
  }

  private async assertTeamMember(
    transaction: Transaction,
    workspaceId: string,
    teamId: string,
    membershipId: string,
  ): Promise<void> {
    const member = await transaction.teamMember.findFirst({
      select: { membershipId: true },
      where: { membership: { status: MembershipStatus.ACTIVE }, membershipId, teamId, workspaceId },
    });
    if (!member)
      throw new ApiError({
        code: 'TEAM_MEMBERSHIP_REQUIRED',
        message: '팀의 활성 멤버여야 합니다.',
        status: HttpStatus.FORBIDDEN,
      });
  }

  private async syncDescription(
    transaction: Transaction,
    context: IssueMutationContext,
    issueId: string,
    description: ParsedOptionalMarkdown,
  ): Promise<void> {
    await transaction.mention.deleteMany({
      where: { commentId: null, issueId, workspaceId: context.workspaceId },
    });
    if (description.mentionedMembershipIds.length)
      await transaction.mention.createMany({
        data: description.mentionedMembershipIds.map((mentionedMembershipId) => ({
          issueId,
          mentionedMembershipId,
          workspaceId: context.workspaceId,
        })),
      });
    await this.files.syncBodyImages(
      transaction,
      context,
      issueId,
      IssueFileKind.DESCRIPTION_IMAGE,
      description.fileIds,
    );
  }
}
