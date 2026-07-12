import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';

import {
  FeatureIssueStatus,
  HandoffKind,
  IssueFileKind,
  IssuePriority,
  IssueType,
  MembershipRole,
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
  ISSUE_UNBLOCKED,
  ISSUE_UNBLOCKED_SCHEMA_VERSION,
  type IssueChangedField,
  type IssueChangedOutboxPayload,
  type IssueCreatedOutboxPayload,
  type IssuePurgeScheduledOutboxPayload,
  type IssueUnblockedDurationBucket,
  type IssueUnblockedOutboxPayload,
} from '@rivet/event-contracts';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import { notifyResourceChanged } from '../../common/realtime/notify-resource-changed';
import {
  assertActiveMentionMemberships,
  type ParsedOptionalMarkdown,
  parseOptionalMarkdown,
} from '../../common/validation/markdown';
import { IssueCollaborationService } from '../collaboration/issue-collaboration.service';
import { isInlineDisplayable } from '../files/file-content';
import { FilesService } from '../files/files.service';
import type { CreateIssueDto, IssueListQueryDto, UpdateIssueDto } from './dto/issue-request.dto';
import type {
  IssueDetailResponseDto,
  IssueListResponseDto,
  IssueMemberSummaryResponseDto,
  IssueSummaryResponseDto,
} from './dto/issue-response.dto';

const ISSUE_SELECT = {
  assigneeTeamMember: {
    select: {
      membership: {
        select: {
          id: true,
          role: true,
          status: true,
          user: { select: { avatarFileId: true, displayName: true, id: true } },
        },
      },
    },
  },
  createdAt: true,
  createdByMembership: {
    select: {
      id: true,
      role: true,
      status: true,
      user: { select: { avatarFileId: true, displayName: true, id: true } },
    },
  },
  descriptionMarkdown: true,
  blockedRelations: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      blockingIssue: {
        select: {
          featureStatus: true,
          id: true,
          identifier: true,
          projectRole: true,
          title: true,
          workflowState: { select: { category: true } },
        },
      },
      createdAt: true,
      id: true,
    },
    where: { blockingIssue: { deletedAt: null } },
  },
  blockingRelations: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      blockedIssue: {
        select: {
          featureStatus: true,
          id: true,
          identifier: true,
          projectRole: true,
          title: true,
          workflowState: { select: { category: true } },
        },
      },
      createdAt: true,
      id: true,
    },
    where: { blockedIssue: { deletedAt: null } },
  },
  childIssues: {
    select: { workflowState: { select: { category: true } } },
    where: { deletedAt: null, type: IssueType.TEAM_TASK },
  },
  featureStatus: true,
  handoffs: {
    orderBy: [{ sequenceNumber: 'desc' }],
    select: { createdAt: true, kind: true },
  },
  id: true,
  identifier: true,
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
  labels: {
    orderBy: { labelId: 'asc' },
    select: {
      label: { select: { archivedAt: true, color: true, id: true, name: true } },
    },
  },
  priority: true,
  project: { select: { archivedAt: true, id: true, name: true, status: true } },
  projectRole: true,
  parentIssue: { select: { id: true, identifier: true, title: true } },
  team: { select: { archivedAt: true, id: true, key: true, name: true } },
  title: true,
  type: true,
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
} satisfies Prisma.IssueSelect;

type IssueRow = Prisma.IssueGetPayload<{ select: typeof ISSUE_SELECT }>;
type Transaction = Prisma.TransactionClient;
type SortField = 'createdAt' | 'priority' | 'status' | 'updatedAt';
type SortDirection = 'asc' | 'desc';

interface TeamLockRow {
  archivedAt: Date | null;
  id: string;
  key: string;
  nextIssueNumber: number;
}

interface WorkflowStateLockRow {
  category: StateCategory;
  id: string;
  isDefault: boolean;
  name: string;
  position: number;
  version: number;
}

interface LabelLockRow {
  archivedAt: Date | null;
  color: string;
  id: string;
  name: string;
}

interface ProjectLockRow {
  archivedAt: Date | null;
  deletedAt: Date | null;
  id: string;
}

interface ParentIssueLockRow {
  id: string;
  projectId: string | null;
  type: IssueType;
}

interface IssueLockRow {
  assigneeMembershipId: string | null;
  descriptionMarkdown: string | null;
  featureStatus: FeatureIssueStatus | null;
  id: string;
  priority: IssuePriority;
  projectId: string | null;
  projectRole: ProjectRole | null;
  parentIssueId: string | null;
  teamId: string | null;
  title: string;
  type: IssueType;
  version: number;
  workflowStateId: string | null;
}

interface IssueTrashLockRow {
  id: string;
  type: IssueType;
  version: number;
}

interface IssueUnblockedCandidateRow {
  blockedProjectRole: ProjectRole | null;
  blockingStartedAt: Date;
  blockingProjectRole: ProjectRole | null;
  issueId: string;
}

interface MembershipLockRow {
  displayName: string;
  id: string;
  role: MembershipRole;
  status: MembershipStatus;
}

interface IssueCursor {
  id: string;
  value: string | [StateCategory, number, IssueType];
}

const FEATURE_STATUS_CATEGORY: Record<FeatureIssueStatus, StateCategory> = {
  [FeatureIssueStatus.UNSORTED]: StateCategory.BACKLOG,
  [FeatureIssueStatus.PAUSED]: StateCategory.BACKLOG,
  [FeatureIssueStatus.TODO]: StateCategory.UNSTARTED,
  [FeatureIssueStatus.IN_PROGRESS]: StateCategory.STARTED,
  [FeatureIssueStatus.REVIEW]: StateCategory.STARTED,
  [FeatureIssueStatus.DONE]: StateCategory.COMPLETED,
  [FeatureIssueStatus.CANCELED]: StateCategory.CANCELED,
};

const FEATURE_STATUS_POSITION: Record<FeatureIssueStatus, number> = {
  [FeatureIssueStatus.UNSORTED]: 0,
  [FeatureIssueStatus.PAUSED]: 1,
  [FeatureIssueStatus.TODO]: 0,
  [FeatureIssueStatus.IN_PROGRESS]: 0,
  [FeatureIssueStatus.REVIEW]: 1,
  [FeatureIssueStatus.DONE]: 0,
  [FeatureIssueStatus.CANCELED]: 0,
};

const STATE_CATEGORY_ORDER: StateCategory[] = [
  StateCategory.BACKLOG,
  StateCategory.UNSTARTED,
  StateCategory.STARTED,
  StateCategory.COMPLETED,
  StateCategory.CANCELED,
];

type StatusSortRow = {
  featureStatus: FeatureIssueStatus | null;
  id: string;
  type: IssueType;
  workflowState: { category: StateCategory; position: number } | null;
};

function invalidQuery(message: string): never {
  throw new ApiError({ code: 'INVALID_QUERY', message, status: HttpStatus.BAD_REQUEST });
}

function resourceNotFound(message = '이슈를 찾을 수 없습니다.'): never {
  throw new ApiError({ code: 'RESOURCE_NOT_FOUND', message, status: HttpStatus.NOT_FOUND });
}

function versionConflict(currentVersion: number): never {
  throw new ApiError({
    code: 'VERSION_CONFLICT',
    currentVersion,
    message: '이슈가 다른 요청에서 변경되었습니다.',
    status: HttpStatus.CONFLICT,
  });
}

function issueTypeFieldInvalid(message: string): never {
  throw new ApiError({
    code: 'ISSUE_TYPE_FIELD_INVALID',
    message,
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  });
}

function normalizeTitle(value: string): string {
  const title = value.normalize('NFC').trim();
  const length = [...title].length;

  if (length < 1 || length > 500) {
    throw new ApiError({
      code: 'VALIDATION_ERROR',
      fieldErrors: { title: ['이슈 제목은 1~500자로 입력해 주세요.'] },
      message: '이슈 제목을 확인해 주세요.',
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });
  }

  return title;
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

  return [...new Set(items)].sort();
}

function parseCursor(
  value: string | undefined,
  sort: SortField,
  direction: SortDirection,
  scope: string,
): IssueCursor | undefined {
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
      parsed.length !== 5 ||
      parsed[0] !== sort ||
      parsed[1] !== direction ||
      parsed[2] !== scope ||
      typeof parsed[4] !== 'string' ||
      !isUUID(parsed[4], '4')
    ) {
      return invalidQuery('현재 정렬 조건에 맞는 커서를 사용해 주세요.');
    }

    const cursorValue = parsed[3];
    if (sort === 'createdAt' || sort === 'updatedAt') {
      if (typeof cursorValue !== 'string') {
        return invalidQuery('커서를 확인해 주세요.');
      }
      const date = new Date(cursorValue);
      if (Number.isNaN(date.getTime()) || date.toISOString() !== cursorValue) {
        return invalidQuery('커서를 확인해 주세요.');
      }
    } else if (sort === 'priority') {
      if (
        typeof cursorValue !== 'string' ||
        !Object.values(IssuePriority).includes(cursorValue as IssuePriority)
      ) {
        return invalidQuery('커서를 확인해 주세요.');
      }
    } else if (
      !Array.isArray(cursorValue) ||
      cursorValue.length !== 3 ||
      typeof cursorValue[0] !== 'string' ||
      !Object.values(StateCategory).includes(cursorValue[0] as StateCategory) ||
      !Number.isInteger(cursorValue[1]) ||
      (cursorValue[1] as number) < 0 ||
      typeof cursorValue[2] !== 'string' ||
      !Object.values(IssueType).includes(cursorValue[2] as IssueType)
    ) {
      return invalidQuery('커서를 확인해 주세요.');
    }

    return {
      id: parsed[4],
      value: cursorValue as string | [StateCategory, number, IssueType],
    };
  } catch {
    return invalidQuery('커서를 확인해 주세요.');
  }
}

function issueCategory(issue: {
  featureStatus: FeatureIssueStatus | null;
  workflowState: { category: StateCategory } | null;
}): StateCategory {
  if (issue.featureStatus !== null) {
    return FEATURE_STATUS_CATEGORY[issue.featureStatus];
  }
  if (issue.workflowState !== null) {
    return issue.workflowState.category;
  }
  throw new Error('ISSUE_STATUS_INVARIANT_VIOLATION');
}

function issueStatusPosition(issue: IssueRow): number {
  if (issue.featureStatus !== null) {
    return FEATURE_STATUS_POSITION[issue.featureStatus];
  }
  if (issue.workflowState !== null) {
    return issue.workflowState.position;
  }
  throw new Error('ISSUE_STATUS_INVARIANT_VIOLATION');
}

function statusTuple(issue: StatusSortRow): [number, number, number, string] {
  const category = issueCategory(issue);
  return [
    STATE_CATEGORY_ORDER.indexOf(category),
    issue.featureStatus === null
      ? (issue.workflowState?.position ?? 0)
      : FEATURE_STATUS_POSITION[issue.featureStatus],
    issue.type === IssueType.FEATURE ? 0 : 1,
    issue.id,
  ];
}

function compareStatusRows(left: StatusSortRow, right: StatusSortRow): number {
  const leftTuple = statusTuple(left);
  const rightTuple = statusTuple(right);
  for (let index = 0; index < leftTuple.length; index += 1) {
    const leftValue = leftTuple[index]!;
    const rightValue = rightTuple[index]!;
    if (leftValue < rightValue) return -1;
    if (leftValue > rightValue) return 1;
  }
  return 0;
}

function isTerminalCategory(category: StateCategory): boolean {
  return category === StateCategory.COMPLETED || category === StateCategory.CANCELED;
}

function blockingDurationBucket(seconds: number): IssueUnblockedDurationBucket {
  if (seconds < 60 * 60) return 'LT_1_HOUR';
  if (seconds < 24 * 60 * 60) return 'LT_1_DAY';
  if (seconds < 7 * 24 * 60 * 60) return 'LT_7_DAYS';
  return 'GTE_7_DAYS';
}

function cursorValue(row: IssueRow, sort: SortField): string | [StateCategory, number, IssueType] {
  switch (sort) {
    case 'createdAt':
      return row.createdAt.toISOString();
    case 'updatedAt':
      return row.updatedAt.toISOString();
    case 'priority':
      return row.priority;
    case 'status':
      return [issueCategory(row), issueStatusPosition(row), row.type];
  }
}

function encodeCursor(
  row: IssueRow,
  sort: SortField,
  direction: SortDirection,
  scope: string,
): string {
  return Buffer.from(
    JSON.stringify([sort, direction, scope, cursorValue(row, sort), row.id]),
  ).toString('base64url');
}

function toMemberResponse(member: {
  id: string;
  role: MembershipRole;
  status: MembershipStatus;
  user: { avatarFileId: string | null; displayName: string; id: string };
}): IssueMemberSummaryResponseDto {
  return {
    id: member.id,
    role: member.role,
    status: member.status,
    user: {
      avatarFileId: member.user.avatarFileId,
      displayName: member.user.displayName,
      id: member.user.id,
    },
  };
}

function toSummaryResponse(issue: IssueRow): IssueSummaryResponseDto {
  const children = issue.childIssues.filter(
    ({ workflowState }) => workflowState?.category !== StateCategory.CANCELED,
  );
  const completed = children.filter(
    ({ workflowState }) => workflowState?.category === StateCategory.COMPLETED,
  ).length;

  return {
    assignee: issue.assigneeTeamMember
      ? toMemberResponse(issue.assigneeTeamMember.membership)
      : null,
    blocked: issue.blockedRelations.some(
      ({ blockingIssue }) => !isTerminalCategory(issueCategory(blockingIssue)),
    ),
    createdAt: issue.createdAt.toISOString(),
    id: issue.id,
    identifier: issue.identifier,
    labels: issue.labels.map(({ label }) => ({
      archived: label.archivedAt !== null,
      color: label.color,
      id: label.id,
      name: label.name,
    })),
    parentIssue: issue.parentIssue,
    priority: issue.priority,
    progress:
      issue.type === IssueType.FEATURE
        ? {
            completed,
            percentage: children.length === 0 ? 0 : Math.round((completed / children.length) * 100),
            total: children.length,
          }
        : null,
    project: issue.project
      ? {
          archived: issue.project.archivedAt !== null,
          id: issue.project.id,
          name: issue.project.name,
          status: issue.project.status,
        }
      : null,
    projectRole: issue.projectRole,
    status: {
      category: issueCategory(issue),
      featureStatus: issue.featureStatus,
      workflowState: issue.workflowState,
    },
    team: issue.team
      ? {
          archived: issue.team.archivedAt !== null,
          id: issue.team.id,
          key: issue.team.key,
          name: issue.team.name,
        }
      : null,
    title: issue.title,
    type: issue.type,
    updatedAt: issue.updatedAt.toISOString(),
    version: issue.version,
  };
}

function toDetailResponse(issue: IssueRow): IssueDetailResponseDto {
  const relationIssue = (related: {
    featureStatus: FeatureIssueStatus | null;
    id: string;
    identifier: string;
    projectRole: ProjectRole | null;
    title: string;
    workflowState: { category: StateCategory } | null;
  }) => ({
    category: issueCategory(related),
    featureStatus: related.featureStatus,
    id: related.id,
    identifier: related.identifier,
    projectRole: related.projectRole,
    title: related.title,
  });

  return {
    ...toSummaryResponse(issue),
    attachments: issue.fileAttachments.map((attachment) => ({
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
      kind: IssueFileKind.ISSUE_ATTACHMENT,
      uploader: attachment.createdByMembership.user,
    })),
    blockers: issue.blockedRelations.map(({ blockingIssue, createdAt, id }) => ({
      createdAt: createdAt.toISOString(),
      id,
      issue: relationIssue(blockingIssue),
      resolved: isTerminalCategory(issueCategory(blockingIssue)),
    })),
    blocking: issue.blockingRelations.map(({ blockedIssue, createdAt, id }) => ({
      createdAt: createdAt.toISOString(),
      id,
      issue: relationIssue(blockedIssue),
      resolved: isTerminalCategory(issueCategory(issue)),
    })),
    createdBy: toMemberResponse(issue.createdByMembership),
    descriptionMarkdown: issue.descriptionMarkdown,
    handoffSummary:
      issue.type === IssueType.TEAM_TASK && issue.projectRole === ProjectRole.BACKEND
        ? {
            count: issue.handoffs.length,
            hasInitial: issue.handoffs.some(({ kind }) => kind === HandoffKind.INITIAL),
            latestCreatedAt: issue.handoffs[0]?.createdAt.toISOString() ?? null,
          }
        : null,
  };
}

@Injectable()
export class IssuesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly collaboration: IssueCollaborationService,
    private readonly files: FilesService,
  ) {}

  async list(
    context: { membershipId: string; workspaceId: string },
    dto: IssueListQueryDto,
  ): Promise<IssueListResponseDto> {
    if (dto.type !== undefined && !Object.values(IssueType).includes(dto.type as IssueType)) {
      invalidQuery('이슈 유형 필터를 확인해 주세요.');
    }

    const sort = dto.sort ?? 'updatedAt';
    if (!['createdAt', 'priority', 'status', 'updatedAt'].includes(sort)) {
      invalidQuery('정렬 기준을 확인해 주세요.');
    }
    const direction = dto.sortDirection ?? 'desc';
    if (direction !== 'asc' && direction !== 'desc') {
      invalidQuery('정렬 방향을 확인해 주세요.');
    }

    const typedSort = sort as SortField;
    const teamIds = parseCsv(dto.teamId, (item) => isUUID(item, '4'), '팀 필터를 확인해 주세요.');
    const projectIds = parseCsv(
      dto.projectId,
      (item) => isUUID(item, '4'),
      '프로젝트 필터를 확인해 주세요.',
    );
    const projectRoles = parseCsv(
      dto.projectRole,
      (item) => Object.values(ProjectRole).includes(item as ProjectRole),
      '프로젝트 역할 필터를 확인해 주세요.',
    ) as ProjectRole[] | undefined;
    const featureStatuses = parseCsv(
      dto.featureStatus,
      (item) => Object.values(FeatureIssueStatus).includes(item as FeatureIssueStatus),
      '기능 이슈 상태 필터를 확인해 주세요.',
    ) as FeatureIssueStatus[] | undefined;
    const workflowStateIds = parseCsv(
      dto.workflowStateId,
      (item) => isUUID(item, '4'),
      '워크플로 상태 필터를 확인해 주세요.',
    );
    const stateCategories = parseCsv(
      dto.stateCategory,
      (item) => Object.values(StateCategory).includes(item as StateCategory),
      '상태 범주 필터를 확인해 주세요.',
    ) as StateCategory[] | undefined;
    const priorities = parseCsv(
      dto.priority,
      (item) => Object.values(IssuePriority).includes(item as IssuePriority),
      '우선순위 필터를 확인해 주세요.',
    ) as IssuePriority[] | undefined;
    const labelIds = parseCsv(
      dto.labelId,
      (item) => isUUID(item, '4'),
      '라벨 필터를 확인해 주세요.',
    );
    const assigneeIds = parseCsv(
      dto.assigneeMembershipId,
      (item) => item === 'me' || isUUID(item, '4'),
      '담당자 필터를 확인해 주세요.',
    )
      ?.map((item) => (item === 'me' ? context.membershipId : item))
      .filter((item, index, items) => items.indexOf(item) === index)
      .sort();
    const blocked = dto.blocked === undefined ? undefined : dto.blocked === 'true';
    const cursorScope = createHash('sha256')
      .update(
        JSON.stringify([
          context.workspaceId,
          dto.type ?? null,
          teamIds ?? null,
          projectIds ?? null,
          projectRoles ?? null,
          dto.parentIssueId ?? null,
          featureStatuses ?? null,
          workflowStateIds ?? null,
          stateCategories ?? null,
          assigneeIds ?? null,
          priorities ?? null,
          labelIds ?? null,
          blocked ?? null,
        ]),
      )
      .digest('base64url');
    const cursor = parseCursor(dto.cursor, typedSort, direction, cursorScope);

    const where: Prisma.IssueWhereInput = {
      ...(assigneeIds ? { assigneeMembershipId: { in: assigneeIds } } : {}),
      ...(labelIds ? { labels: { some: { labelId: { in: labelIds } } } } : {}),
      ...(blocked === undefined
        ? {}
        : {
            blockedRelations: blocked
              ? {
                  some: {
                    blockingIssue: {
                      deletedAt: null,
                      workflowState: {
                        category: { notIn: [StateCategory.COMPLETED, StateCategory.CANCELED] },
                      },
                    },
                  },
                }
              : {
                  none: {
                    blockingIssue: {
                      deletedAt: null,
                      workflowState: {
                        category: { notIn: [StateCategory.COMPLETED, StateCategory.CANCELED] },
                      },
                    },
                  },
                },
          }),
      ...(featureStatuses ? { featureStatus: { in: featureStatuses } } : {}),
      ...(dto.parentIssueId ? { parentIssueId: dto.parentIssueId } : {}),
      ...(priorities ? { priority: { in: priorities } } : {}),
      ...(projectIds ? { projectId: { in: projectIds } } : {}),
      ...(projectRoles ? { projectRole: { in: projectRoles } } : {}),
      ...(stateCategories
        ? {
            OR: [
              { workflowState: { category: { in: stateCategories } } },
              {
                featureStatus: {
                  in: Object.values(FeatureIssueStatus).filter((status) =>
                    stateCategories.includes(FEATURE_STATUS_CATEGORY[status]),
                  ),
                },
              },
            ],
          }
        : {}),
      ...(teamIds ? { teamId: { in: teamIds } } : {}),
      ...(dto.type ? { type: dto.type as IssueType } : {}),
      ...(workflowStateIds ? { workflowStateId: { in: workflowStateIds } } : {}),
      deletedAt: null,
      workspaceId: context.workspaceId,
    };
    if (cursor) {
      const cursorIssue = await this.database.client.issue.findFirst({
        select: ISSUE_SELECT,
        where: { AND: [where, { id: cursor.id }] },
      });
      if (
        !cursorIssue ||
        JSON.stringify(cursorValue(cursorIssue, typedSort)) !== JSON.stringify(cursor.value)
      ) {
        invalidQuery('목록이 변경되었습니다. 첫 페이지부터 다시 조회해 주세요.');
      }
    }
    const limit = dto.limit ?? 50;
    if (typedSort === 'status') {
      return this.listByStatus(where, cursor, direction, limit, cursorScope);
    }

    const orderBy: Prisma.IssueOrderByWithRelationInput[] = [
      { [typedSort]: direction },
      { id: direction },
    ];
    const issues = await this.database.client.issue.findMany({
      ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
      orderBy,
      select: ISSUE_SELECT,
      take: limit + 1,
      where,
    });
    const page = issues.slice(0, limit);

    return {
      items: page.map(toSummaryResponse),
      nextCursor:
        issues.length > limit && page.length > 0
          ? encodeCursor(page[page.length - 1]!, typedSort, direction, cursorScope)
          : null,
    };
  }

  private async listByStatus(
    where: Prisma.IssueWhereInput,
    cursor: IssueCursor | undefined,
    direction: SortDirection,
    limit: number,
    cursorScope: string,
  ): Promise<IssueListResponseDto> {
    const sortRows = await this.database.client.issue.findMany({
      select: {
        featureStatus: true,
        id: true,
        type: true,
        workflowState: { select: { category: true, position: true } },
      },
      where,
    });
    sortRows.sort((left, right) => {
      const comparison = compareStatusRows(left, right);
      return direction === 'asc' ? comparison : -comparison;
    });

    const startIndex = cursor ? sortRows.findIndex(({ id }) => id === cursor.id) + 1 : 0;
    if (cursor && startIndex === 0) {
      invalidQuery('현재 필터에 맞는 커서를 사용해 주세요.');
    }
    const pageIds = sortRows.slice(startIndex, startIndex + limit + 1).map(({ id }) => id);
    const selected = await this.database.client.issue.findMany({
      select: ISSUE_SELECT,
      where: { AND: [where, { id: { in: pageIds } }] },
    });
    const byId = new Map(selected.map((issue) => [issue.id, issue]));
    const issues = pageIds.map((id) => byId.get(id)).filter((issue) => issue !== undefined);
    const page = issues.slice(0, limit);

    return {
      items: page.map(toSummaryResponse),
      nextCursor:
        issues.length > limit && page.length > 0
          ? encodeCursor(page[page.length - 1]!, 'status', direction, cursorScope)
          : null,
    };
  }

  async create(
    context: { membershipId: string; userId: string; workspaceId: string },
    dto: CreateIssueDto,
  ): Promise<IssueDetailResponseDto> {
    const title = normalizeTitle(dto.title);
    const labelIds = [...new Set(dto.labelIds ?? [])].sort();
    const attachmentFileIds = [...new Set(dto.attachmentFileIds ?? [])].sort();
    const description = parseOptionalMarkdown(dto.descriptionMarkdown, 100_000);

    if (dto.type === IssueType.FEATURE) {
      if (!dto.projectId || !dto.featureStatus) {
        issueTypeFieldInvalid('기능 이슈에는 프로젝트와 기능 상태가 필요합니다.');
      }
      if (
        dto.teamId !== undefined ||
        dto.workflowStateId !== undefined ||
        dto.assigneeMembershipId !== undefined ||
        dto.projectRole !== undefined ||
        dto.parentIssueId !== undefined
      ) {
        issueTypeFieldInvalid('기능 이슈에는 팀 작업 전용 필드를 사용할 수 없습니다.');
      }
      const projectId = dto.projectId;
      const featureStatus = dto.featureStatus;

      return this.database.client.$transaction(async (transaction) => {
        // Lock order: workspace counter -> project -> actor -> labels -> inserted issue.
        const [workspace] = await transaction.$queryRaw<Array<{ nextFeatureIssueNumber: number }>>`
          SELECT "next_feature_issue_number" AS "nextFeatureIssueNumber"
          FROM "workspaces"
          WHERE "id" = ${context.workspaceId}::uuid
          FOR UPDATE
        `;
        if (!workspace) {
          return resourceNotFound('워크스페이스를 찾을 수 없습니다.');
        }
        await this.lockActiveProject(transaction, context.workspaceId, projectId);
        await this.lockActorMembership(transaction, context.workspaceId, context.membershipId);
        await this.lockLabels(transaction, context.workspaceId, labelIds);
        await assertActiveMentionMemberships(
          transaction,
          context.workspaceId,
          description.mentionedMembershipIds,
        );

        await transaction.workspace.update({
          data: { nextFeatureIssueNumber: { increment: 1 } },
          where: { id: context.workspaceId },
        });
        const identifier = `F-${workspace.nextFeatureIssueNumber}`;
        const issue = await transaction.issue.create({
          data: {
            createdByMembershipId: context.membershipId,
            descriptionMarkdown: description.bodyMarkdown,
            featureStatus,
            identifier,
            priority: dto.priority ?? IssuePriority.NONE,
            projectId,
            sequenceNumber: workspace.nextFeatureIssueNumber,
            title,
            type: IssueType.FEATURE,
            workspaceId: context.workspaceId,
          },
          select: { id: true },
        });

        const changeEventId = await this.createIssueRelations(
          transaction,
          context,
          issue.id,
          identifier,
          title,
          labelIds,
          null,
          description.mentionedMembershipIds,
        );
        await this.syncDescriptionReferences(transaction, context, issue.id, description);
        await this.files.attachIssueFiles(transaction, context, issue.id, attachmentFileIds);
        const created = await this.findIssue(transaction, context.workspaceId, issue.id);
        await notifyResourceChanged(transaction, {
          changeType: 'CREATED',
          eventId: changeEventId,
          resourceId: issue.id,
          resourceType: 'ISSUE',
          version: created.version,
          workspaceId: context.workspaceId,
        });
        return toDetailResponse(created);
      });
    }

    if (!dto.teamId) {
      issueTypeFieldInvalid('팀 작업에는 팀이 필요합니다.');
    }
    if (dto.featureStatus !== undefined) {
      issueTypeFieldInvalid('팀 작업에는 기능 이슈 상태를 사용할 수 없습니다.');
    }
    if ((dto.projectId === undefined) !== (dto.projectRole === undefined)) {
      issueTypeFieldInvalid('프로젝트와 프로젝트 역할은 함께 지정해야 합니다.');
    }
    if (dto.parentIssueId !== undefined && dto.projectId === undefined) {
      issueTypeFieldInvalid('상위 기능 이슈가 있는 팀 작업에는 프로젝트가 필요합니다.');
    }

    return this.database.client.$transaction(async (transaction) => {
      // Lock order: workspace -> project/role/parent -> team -> state -> membership -> labels.
      await this.lockWorkspace(transaction, context.workspaceId);
      if (dto.projectId && dto.projectRole) {
        await this.lockProjectRoleTeam(
          transaction,
          context.workspaceId,
          dto.projectId,
          dto.projectRole,
          dto.teamId!,
        );
      }
      if (dto.parentIssueId && dto.projectId) {
        await this.lockParentFeature(
          transaction,
          context.workspaceId,
          dto.projectId,
          dto.parentIssueId,
        );
      }
      const team = await this.lockActiveTeam(transaction, context.workspaceId, dto.teamId!);
      const workflowState = await this.lockWorkflowState(
        transaction,
        context.workspaceId,
        team.id,
        dto.workflowStateId,
      );
      await this.lockMemberships(
        transaction,
        context.workspaceId,
        team.id,
        context.membershipId,
        dto.assigneeMembershipId ?? undefined,
      );
      await this.lockLabels(transaction, context.workspaceId, labelIds);
      await assertActiveMentionMemberships(
        transaction,
        context.workspaceId,
        description.mentionedMembershipIds,
      );

      await transaction.team.update({
        data: { nextIssueNumber: { increment: 1 } },
        where: { id: team.id },
      });
      const issue = await transaction.issue.create({
        data: {
          assigneeMembershipId: dto.assigneeMembershipId ?? null,
          createdByMembershipId: context.membershipId,
          descriptionMarkdown: description.bodyMarkdown,
          identifier: `${team.key}-${team.nextIssueNumber}`,
          parentIssueId: dto.parentIssueId ?? null,
          priority: dto.priority ?? IssuePriority.NONE,
          projectId: dto.projectId ?? null,
          projectRole: dto.projectRole ?? null,
          sequenceNumber: team.nextIssueNumber,
          teamId: team.id,
          title,
          type: IssueType.TEAM_TASK,
          workflowStateId: workflowState.id,
          workspaceId: context.workspaceId,
        },
        select: { id: true },
      });

      const changeEventId = await this.createIssueRelations(
        transaction,
        context,
        issue.id,
        `${team.key}-${team.nextIssueNumber}`,
        title,
        labelIds,
        dto.assigneeMembershipId ?? null,
        description.mentionedMembershipIds,
      );

      await this.syncDescriptionReferences(transaction, context, issue.id, description);
      await this.files.attachIssueFiles(transaction, context, issue.id, attachmentFileIds);

      const created = await this.findIssue(transaction, context.workspaceId, issue.id);
      await notifyResourceChanged(transaction, {
        changeType: 'CREATED',
        eventId: changeEventId,
        resourceId: issue.id,
        resourceType: 'ISSUE',
        version: created.version,
        workspaceId: context.workspaceId,
      });
      return toDetailResponse(created);
    });
  }

  async get(workspaceId: string, issueRef: string): Promise<IssueDetailResponseDto> {
    const normalizedRef = issueRef.normalize('NFC').trim();
    const issue = await this.database.client.issue.findFirst({
      select: ISSUE_SELECT,
      where: {
        OR: isUUID(normalizedRef, '4')
          ? [{ id: normalizedRef.toLowerCase() }, { identifier: normalizedRef.toUpperCase() }]
          : [{ identifier: normalizedRef.toUpperCase() }],
        workspaceId,
        deletedAt: null,
      },
    });

    if (!issue) {
      return resourceNotFound();
    }
    return toDetailResponse(issue);
  }

  async update(
    context: { membershipId: string; userId: string; workspaceId: string },
    issueId: string,
    dto: UpdateIssueDto,
  ): Promise<IssueDetailResponseDto> {
    const preliminary = await this.database.client.issue.findFirst({
      select: {
        id: true,
        parentIssueId: true,
        projectId: true,
        projectRole: true,
        teamId: true,
        type: true,
      },
      where: { deletedAt: null, id: issueId, workspaceId: context.workspaceId },
    });
    if (!preliminary) {
      return resourceNotFound();
    }
    if (preliminary.type === IssueType.FEATURE) {
      if (
        dto.teamId !== undefined ||
        dto.workflowStateId !== undefined ||
        dto.assigneeMembershipId !== undefined ||
        dto.projectRole !== undefined ||
        dto.parentIssueId !== undefined ||
        dto.handoff !== undefined
      ) {
        issueTypeFieldInvalid('기능 이슈에는 팀 작업 전용 필드를 사용할 수 없습니다.');
      }
      if (dto.projectId !== undefined && dto.projectId !== preliminary.projectId) {
        throw new ApiError({
          code: 'ISSUE_PROJECT_IMMUTABLE',
          message: '기능 이슈의 프로젝트는 변경할 수 없습니다.',
          status: HttpStatus.CONFLICT,
        });
      }
      return this.updateFeatureIssue(context, issueId, dto);
    }

    if (dto.featureStatus !== undefined) {
      issueTypeFieldInvalid('팀 작업에는 기능 이슈 상태를 사용할 수 없습니다.');
    }
    if (!preliminary.teamId) {
      throw new Error('TEAM_TASK_TEAM_INVARIANT_VIOLATION');
    }
    const teamId = preliminary.teamId;
    if (dto.teamId !== undefined && dto.teamId !== teamId) {
      throw new ApiError({
        code: 'ISSUE_TEAM_IMMUTABLE',
        message: '팀 작업의 팀은 변경할 수 없습니다.',
        status: HttpStatus.CONFLICT,
      });
    }
    const targetProjectId = dto.projectId === undefined ? preliminary.projectId : dto.projectId;
    const targetProjectRole =
      dto.projectRole === undefined ? preliminary.projectRole : dto.projectRole;
    const targetParentIssueId =
      dto.parentIssueId === undefined ? preliminary.parentIssueId : dto.parentIssueId;
    if ((targetProjectId === null) !== (targetProjectRole === null)) {
      issueTypeFieldInvalid('프로젝트와 프로젝트 역할은 함께 지정해야 합니다.');
    }
    if (targetParentIssueId !== null && targetProjectId === null) {
      issueTypeFieldInvalid('상위 기능 이슈가 있는 팀 작업에는 프로젝트가 필요합니다.');
    }
    if (preliminary.parentIssueId && targetProjectId !== preliminary.projectId) {
      throw new ApiError({
        code: 'ISSUE_PROJECT_IMMUTABLE',
        message: '하위 팀 작업의 프로젝트는 변경할 수 없습니다.',
        status: HttpStatus.CONFLICT,
      });
    }

    const title = dto.title === undefined ? undefined : normalizeTitle(dto.title);
    const requestedLabelIds =
      dto.labelIds === undefined ? undefined : [...new Set(dto.labelIds)].sort();
    const requestedDescription =
      dto.descriptionMarkdown === undefined
        ? undefined
        : parseOptionalMarkdown(dto.descriptionMarkdown, 100_000);

    return this.database.client.$transaction(async (transaction) => {
      // Preliminary read finds the immutable team. Reference rows are locked before the issue:
      // workspace -> project/role/parent -> team -> state -> membership -> labels -> issue.
      await this.lockWorkspace(transaction, context.workspaceId);
      if (targetProjectId && targetProjectRole) {
        await this.lockProjectRoleTeam(
          transaction,
          context.workspaceId,
          targetProjectId,
          targetProjectRole,
          teamId,
        );
      }
      if (targetParentIssueId && targetProjectId) {
        await this.lockParentFeature(
          transaction,
          context.workspaceId,
          targetProjectId,
          targetParentIssueId,
        );
      }
      await this.lockActiveTeam(transaction, context.workspaceId, teamId);
      const requestedState =
        dto.workflowStateId === undefined
          ? undefined
          : await this.lockWorkflowState(
              transaction,
              context.workspaceId,
              teamId,
              dto.workflowStateId,
            );
      const requestedAssignee = await this.lockMemberships(
        transaction,
        context.workspaceId,
        teamId,
        context.membershipId,
        dto.assigneeMembershipId ?? undefined,
      );
      const requestedLabels = await this.lockLabels(
        transaction,
        context.workspaceId,
        requestedLabelIds ?? [],
        false,
      );
      if (requestedDescription) {
        await assertActiveMentionMemberships(
          transaction,
          context.workspaceId,
          requestedDescription.mentionedMembershipIds,
        );
      }

      const [current] = await transaction.$queryRaw<IssueLockRow[]>`
        SELECT
          "id",
          "type",
          "team_id" AS "teamId",
          "title",
          "description_markdown" AS "descriptionMarkdown",
          "feature_status" AS "featureStatus",
          "workflow_state_id" AS "workflowStateId",
          "assignee_membership_id" AS "assigneeMembershipId",
          "project_id" AS "projectId",
          "project_role" AS "projectRole",
          "parent_issue_id" AS "parentIssueId",
          "priority",
          "version"
        FROM "issues"
        WHERE "workspace_id" = ${context.workspaceId}::uuid
          AND "id" = ${issueId}::uuid
          AND "deleted_at" IS NULL
        FOR UPDATE
      `;
      if (!current || current.teamId !== teamId || current.type !== IssueType.TEAM_TASK) {
        return resourceNotFound();
      }
      if (current.version !== dto.version) {
        return versionConflict(current.version);
      }

      const currentSnapshot = await this.findIssue(transaction, context.workspaceId, issueId);
      if (!currentSnapshot.workflowState) {
        throw new Error('TEAM_TASK_STATE_INVARIANT_VIOLATION');
      }
      const currentLabelIds = currentSnapshot.labels.map(({ label }) => label.id);
      const currentDescriptionMentionIds = requestedDescription
        ? (
            await transaction.mention.findMany({
              orderBy: { mentionedMembershipId: 'asc' },
              select: { mentionedMembershipId: true },
              where: { commentId: null, issueId, workspaceId: context.workspaceId },
            })
          ).map(({ mentionedMembershipId }) => mentionedMembershipId)
        : [];
      const currentLabelIdSet = new Set(currentLabelIds);
      if (
        requestedLabelIds !== undefined &&
        requestedLabels.some(
          ({ archivedAt, id }) => archivedAt !== null && !currentLabelIdSet.has(id),
        )
      ) {
        return resourceNotFound('보관된 라벨을 새로 연결할 수 없습니다.');
      }
      const changesTitle = title !== undefined && title !== current.title;
      const changesDescription =
        requestedDescription !== undefined &&
        requestedDescription.bodyMarkdown !== current.descriptionMarkdown;
      const changesState =
        dto.workflowStateId !== undefined && dto.workflowStateId !== current.workflowStateId;
      const changesAssignee =
        dto.assigneeMembershipId !== undefined &&
        dto.assigneeMembershipId !== current.assigneeMembershipId;
      const changesPriority = dto.priority !== undefined && dto.priority !== current.priority;
      const changesProject = dto.projectId !== undefined && dto.projectId !== current.projectId;
      const changesProjectRole =
        dto.projectRole !== undefined && dto.projectRole !== current.projectRole;
      const changesParent =
        dto.parentIssueId !== undefined && dto.parentIssueId !== current.parentIssueId;
      const changesLabels =
        requestedLabelIds !== undefined &&
        (requestedLabelIds.length !== currentLabelIds.length ||
          requestedLabelIds.some((labelId, index) => labelId !== currentLabelIds[index]));
      const completesIssue =
        changesState &&
        currentSnapshot.workflowState.category !== StateCategory.COMPLETED &&
        requestedState?.category === StateCategory.COMPLETED;
      if (dto.handoff && !completesIssue) {
        throw new ApiError({
          code: 'HANDOFF_REQUIRES_COMPLETION',
          message: '상태 완료와 최초 작업 전달은 같은 요청에서 처리해야 합니다.',
          status: HttpStatus.UNPROCESSABLE_ENTITY,
        });
      }
      if (completesIssue) {
        await this.collaboration.ensureInitialHandoffForCompletion(
          transaction,
          context,
          issueId,
          dto.handoff,
        );
      }

      if (
        !changesTitle &&
        !changesDescription &&
        !changesState &&
        !changesAssignee &&
        !changesPriority &&
        !changesProject &&
        !changesProjectRole &&
        !changesParent &&
        !changesLabels
      ) {
        return toDetailResponse(await this.findIssue(transaction, context.workspaceId, issueId));
      }

      await transaction.issue.update({
        data: {
          ...(changesAssignee ? { assigneeMembershipId: dto.assigneeMembershipId } : {}),
          ...(changesPriority ? { priority: dto.priority } : {}),
          ...(changesProject ? { projectId: dto.projectId } : {}),
          ...(changesProjectRole ? { projectRole: dto.projectRole } : {}),
          ...(changesParent ? { parentIssueId: dto.parentIssueId } : {}),
          ...(changesState ? { workflowStateId: dto.workflowStateId } : {}),
          ...(changesTitle ? { title } : {}),
          ...(changesDescription
            ? { descriptionMarkdown: requestedDescription!.bodyMarkdown }
            : {}),
          version: { increment: 1 },
        },
        where: { workspaceId_id: { id: issueId, workspaceId: context.workspaceId } },
      });

      if (changesLabels && requestedLabelIds) {
        await transaction.issueLabel.deleteMany({
          where: { issueId, workspaceId: context.workspaceId },
        });
        if (requestedLabelIds.length > 0) {
          await transaction.issueLabel.createMany({
            data: requestedLabelIds.map((labelId) => ({
              issueId,
              labelId,
              workspaceId: context.workspaceId,
            })),
          });
        }
      }
      const newlyMentionedMembershipIds = changesDescription
        ? requestedDescription!.mentionedMembershipIds.filter(
            (membershipId) => !currentDescriptionMentionIds.includes(membershipId),
          )
        : [];
      if (changesDescription) {
        await this.syncDescriptionReferences(transaction, context, issueId, requestedDescription!);
      }

      const events: Prisma.ActivityEventCreateManyInput[] = [];
      if (changesTitle) {
        events.push(this.activity(context, issueId, 'title', current.title, title!));
      }
      if (changesDescription) {
        events.push(
          this.activity(
            context,
            issueId,
            'descriptionMarkdown',
            { hasContent: current.descriptionMarkdown !== null },
            { hasContent: requestedDescription!.bodyMarkdown !== null },
          ),
        );
      }
      if (changesState) {
        events.push(
          this.activity(
            context,
            issueId,
            'workflowStateId',
            {
              category: currentSnapshot.workflowState.category,
              id: currentSnapshot.workflowState.id,
              name: currentSnapshot.workflowState.name,
            },
            {
              category: requestedState!.category,
              id: requestedState!.id,
              name: requestedState!.name,
            },
          ),
        );
      }
      if (changesAssignee) {
        events.push(
          this.activity(
            context,
            issueId,
            'assigneeMembershipId',
            currentSnapshot.assigneeTeamMember
              ? {
                  displayName: currentSnapshot.assigneeTeamMember.membership.user.displayName,
                  id: currentSnapshot.assigneeTeamMember.membership.id,
                }
              : null,
            requestedAssignee
              ? { displayName: requestedAssignee.displayName, id: requestedAssignee.id }
              : null,
          ),
        );
      }
      if (changesPriority) {
        events.push(this.activity(context, issueId, 'priority', current.priority, dto.priority!));
      }
      if (changesProject) {
        events.push(
          this.activity(context, issueId, 'projectId', current.projectId, dto.projectId!),
        );
      }
      if (changesProjectRole) {
        events.push(
          this.activity(context, issueId, 'projectRole', current.projectRole, dto.projectRole!),
        );
      }
      if (changesParent) {
        events.push(
          this.activity(
            context,
            issueId,
            'parentIssueId',
            current.parentIssueId,
            dto.parentIssueId!,
          ),
        );
      }
      if (changesLabels) {
        events.push(
          this.activity(
            context,
            issueId,
            'labelIds',
            currentSnapshot.labels.map(({ label }) => ({ id: label.id, name: label.name })),
            requestedLabels.map(({ id, name }) => ({ id, name })),
          ),
        );
      }
      await transaction.activityEvent.createMany({ data: events });

      const subscriptions = [
        ...(changesAssignee && dto.assigneeMembershipId ? [dto.assigneeMembershipId] : []),
        ...(requestedDescription?.mentionedMembershipIds ?? []),
      ];
      if (subscriptions.length > 0) {
        await transaction.issueSubscription.createMany({
          data: [...new Set(subscriptions)].sort().map((membershipId) => ({
            issueId,
            membershipId,
            workspaceId: context.workspaceId,
          })),
          skipDuplicates: true,
        });
      }

      const changedFields: IssueChangedField[] = [
        ...(changesTitle ? (['TITLE'] as const) : []),
        ...(changesDescription ? (['DESCRIPTION'] as const) : []),
        ...(changesState ? (['WORKFLOW_STATE'] as const) : []),
        ...(changesAssignee ? (['ASSIGNEE'] as const) : []),
        ...(changesPriority ? (['PRIORITY'] as const) : []),
        ...(changesProject ? (['PROJECT'] as const) : []),
        ...(changesProjectRole ? (['PROJECT_ROLE'] as const) : []),
        ...(changesParent ? (['PARENT_ISSUE'] as const) : []),
        ...(changesLabels ? (['LABELS'] as const) : []),
      ];
      const terminalCategory =
        changesState &&
        requestedState &&
        currentSnapshot.workflowState.category !== requestedState.category &&
        (requestedState.category === StateCategory.COMPLETED ||
          requestedState.category === StateCategory.CANCELED)
          ? requestedState.category
          : null;
      const changeEventId = await this.createIssueChangedOutbox(transaction, context, issueId, {
        assigneeMembershipId: changesAssignee ? (dto.assigneeMembershipId ?? null) : null,
        changedFields,
        mentionedMembershipIds: newlyMentionedMembershipIds,
        terminalCategory,
      });
      if (
        changesState &&
        requestedState &&
        !isTerminalCategory(currentSnapshot.workflowState.category) &&
        isTerminalCategory(requestedState.category)
      ) {
        await this.createIssueUnblockedOutboxEvents(transaction, context, issueId);
      }

      const updated = await this.findIssue(transaction, context.workspaceId, issueId);
      await notifyResourceChanged(transaction, {
        changeType: 'UPDATED',
        eventId: changeEventId,
        resourceId: issueId,
        resourceType: 'ISSUE',
        version: updated.version,
        workspaceId: context.workspaceId,
      });
      return toDetailResponse(updated);
    });
  }

  async trash(
    context: { membershipId: string; workspaceId: string },
    issueId: string,
    version: number,
  ): Promise<void> {
    await this.database.client.$transaction(async (transaction) => {
      await this.lockWorkspace(transaction, context.workspaceId);
      await this.lockActorMembership(transaction, context.workspaceId, context.membershipId);
      const [issue] = await transaction.$queryRaw<IssueTrashLockRow[]>`
        SELECT "id", "type", "version"
        FROM "issues"
        WHERE "workspace_id" = ${context.workspaceId}::uuid
          AND "id" = ${issueId}::uuid
          AND "deleted_at" IS NULL
        FOR UPDATE
      `;
      if (!issue) {
        return resourceNotFound();
      }
      if (issue.version !== version) {
        return versionConflict(issue.version);
      }

      if (issue.type === IssueType.FEATURE) {
        const child = await transaction.issue.findFirst({
          select: { id: true },
          where: {
            deletedAt: null,
            parentIssueId: issueId,
            workspaceId: context.workspaceId,
          },
        });
        if (child) {
          throw new ApiError({
            code: 'ISSUE_HAS_CHILDREN',
            message: '삭제되지 않은 하위 팀 작업이 있는 기능 이슈는 휴지통으로 옮길 수 없습니다.',
            status: HttpStatus.CONFLICT,
          });
        }
      } else {
        const outgoingBlock = await transaction.issueBlockRelation.findFirst({
          select: { id: true },
          where: {
            blockedIssue: { deletedAt: null },
            blockingIssueId: issueId,
            workspaceId: context.workspaceId,
          },
        });
        if (outgoingBlock) {
          throw new ApiError({
            code: 'ISSUE_BLOCKS_OTHERS',
            message: '삭제되지 않은 다른 팀 작업을 차단 중인 작업은 휴지통으로 옮길 수 없습니다.',
            status: HttpStatus.CONFLICT,
          });
        }
      }

      const deletedAt = new Date();
      const purgeAt = new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
      await transaction.issue.update({
        data: {
          deletedAt,
          deletedByMembershipId: context.membershipId,
          purgeAt,
          version: { increment: 1 },
        },
        where: { workspaceId_id: { id: issueId, workspaceId: context.workspaceId } },
      });
      await transaction.activityEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          afterData: { purgeAt: purgeAt.toISOString() },
          eventType: 'ISSUE_TRASHED',
          issueId,
          workspaceId: context.workspaceId,
        },
      });
      await transaction.outboxEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          aggregateId: issueId,
          aggregateType: 'ISSUE',
          availableAt: purgeAt,
          eventType: ISSUE_PURGE_SCHEDULED,
          payload: {
            issueId,
            purgeAt: purgeAt.toISOString(),
            schemaVersion: ISSUE_PURGE_SCHEDULED_SCHEMA_VERSION,
          } satisfies IssuePurgeScheduledOutboxPayload,
          workspaceId: context.workspaceId,
        },
      });
      await notifyResourceChanged(transaction, {
        changeType: 'DELETED',
        resourceId: issueId,
        resourceType: 'ISSUE',
        version: issue.version + 1,
        workspaceId: context.workspaceId,
      });
    });
  }

  private async updateFeatureIssue(
    context: { membershipId: string; userId: string; workspaceId: string },
    issueId: string,
    dto: UpdateIssueDto,
  ): Promise<IssueDetailResponseDto> {
    const title = dto.title === undefined ? undefined : normalizeTitle(dto.title);
    const requestedLabelIds =
      dto.labelIds === undefined ? undefined : [...new Set(dto.labelIds)].sort();
    const requestedDescription =
      dto.descriptionMarkdown === undefined
        ? undefined
        : parseOptionalMarkdown(dto.descriptionMarkdown, 100_000);

    return this.database.client.$transaction(async (transaction) => {
      await this.lockWorkspace(transaction, context.workspaceId);
      await this.lockActorMembership(transaction, context.workspaceId, context.membershipId);
      const requestedLabels = await this.lockLabels(
        transaction,
        context.workspaceId,
        requestedLabelIds ?? [],
        false,
      );
      if (requestedDescription) {
        await assertActiveMentionMemberships(
          transaction,
          context.workspaceId,
          requestedDescription.mentionedMembershipIds,
        );
      }
      const [current] = await transaction.$queryRaw<IssueLockRow[]>`
        SELECT
          "id",
          "type",
          "team_id" AS "teamId",
          "title",
          "description_markdown" AS "descriptionMarkdown",
          "feature_status" AS "featureStatus",
          "workflow_state_id" AS "workflowStateId",
          "assignee_membership_id" AS "assigneeMembershipId",
          "project_id" AS "projectId",
          "project_role" AS "projectRole",
          "parent_issue_id" AS "parentIssueId",
          "priority",
          "version"
        FROM "issues"
        WHERE "workspace_id" = ${context.workspaceId}::uuid
          AND "id" = ${issueId}::uuid
          AND "deleted_at" IS NULL
        FOR UPDATE
      `;
      if (!current || current.type !== IssueType.FEATURE || current.featureStatus === null) {
        return resourceNotFound();
      }
      if (current.version !== dto.version) {
        return versionConflict(current.version);
      }

      const currentSnapshot = await this.findIssue(transaction, context.workspaceId, issueId);
      const currentLabelIds = currentSnapshot.labels.map(({ label }) => label.id);
      const currentDescriptionMentionIds = requestedDescription
        ? (
            await transaction.mention.findMany({
              orderBy: { mentionedMembershipId: 'asc' },
              select: { mentionedMembershipId: true },
              where: { commentId: null, issueId, workspaceId: context.workspaceId },
            })
          ).map(({ mentionedMembershipId }) => mentionedMembershipId)
        : [];
      const currentLabelIdSet = new Set(currentLabelIds);
      if (
        requestedLabelIds !== undefined &&
        requestedLabels.some(
          ({ archivedAt, id }) => archivedAt !== null && !currentLabelIdSet.has(id),
        )
      ) {
        return resourceNotFound('보관된 라벨을 새로 연결할 수 없습니다.');
      }

      const changesTitle = title !== undefined && title !== current.title;
      const changesDescription =
        requestedDescription !== undefined &&
        requestedDescription.bodyMarkdown !== current.descriptionMarkdown;
      const changesStatus =
        dto.featureStatus !== undefined && dto.featureStatus !== current.featureStatus;
      const changesPriority = dto.priority !== undefined && dto.priority !== current.priority;
      const changesLabels =
        requestedLabelIds !== undefined &&
        (requestedLabelIds.length !== currentLabelIds.length ||
          requestedLabelIds.some((labelId, index) => labelId !== currentLabelIds[index]));
      if (
        !changesTitle &&
        !changesDescription &&
        !changesStatus &&
        !changesPriority &&
        !changesLabels
      ) {
        return toDetailResponse(currentSnapshot);
      }

      await transaction.issue.update({
        data: {
          ...(changesStatus ? { featureStatus: dto.featureStatus } : {}),
          ...(changesPriority ? { priority: dto.priority } : {}),
          ...(changesTitle ? { title } : {}),
          ...(changesDescription
            ? { descriptionMarkdown: requestedDescription!.bodyMarkdown }
            : {}),
          version: { increment: 1 },
        },
        where: { workspaceId_id: { id: issueId, workspaceId: context.workspaceId } },
      });
      if (changesLabels && requestedLabelIds) {
        await transaction.issueLabel.deleteMany({
          where: { issueId, workspaceId: context.workspaceId },
        });
        if (requestedLabelIds.length > 0) {
          await transaction.issueLabel.createMany({
            data: requestedLabelIds.map((labelId) => ({
              issueId,
              labelId,
              workspaceId: context.workspaceId,
            })),
          });
        }
      }
      const newlyMentionedMembershipIds = changesDescription
        ? requestedDescription!.mentionedMembershipIds.filter(
            (membershipId) => !currentDescriptionMentionIds.includes(membershipId),
          )
        : [];
      if (changesDescription) {
        await this.syncDescriptionReferences(transaction, context, issueId, requestedDescription!);
        if (requestedDescription!.mentionedMembershipIds.length > 0) {
          await transaction.issueSubscription.createMany({
            data: requestedDescription!.mentionedMembershipIds.map((membershipId) => ({
              issueId,
              membershipId,
              workspaceId: context.workspaceId,
            })),
            skipDuplicates: true,
          });
        }
      }

      const events: Prisma.ActivityEventCreateManyInput[] = [];
      if (changesTitle) {
        events.push(this.activity(context, issueId, 'title', current.title, title!));
      }
      if (changesDescription) {
        events.push(
          this.activity(
            context,
            issueId,
            'descriptionMarkdown',
            { hasContent: current.descriptionMarkdown !== null },
            { hasContent: requestedDescription!.bodyMarkdown !== null },
          ),
        );
      }
      if (changesStatus) {
        events.push(
          this.activity(
            context,
            issueId,
            'featureStatus',
            current.featureStatus,
            dto.featureStatus!,
          ),
        );
      }
      if (changesPriority) {
        events.push(this.activity(context, issueId, 'priority', current.priority, dto.priority!));
      }
      if (changesLabels) {
        events.push(
          this.activity(
            context,
            issueId,
            'labelIds',
            currentSnapshot.labels.map(({ label }) => ({ id: label.id, name: label.name })),
            requestedLabels.map(({ id, name }) => ({ id, name })),
          ),
        );
      }
      await transaction.activityEvent.createMany({ data: events });

      const changedFields: IssueChangedField[] = [
        ...(changesTitle ? (['TITLE'] as const) : []),
        ...(changesDescription ? (['DESCRIPTION'] as const) : []),
        ...(changesStatus ? (['FEATURE_STATUS'] as const) : []),
        ...(changesPriority ? (['PRIORITY'] as const) : []),
        ...(changesLabels ? (['LABELS'] as const) : []),
      ];
      const currentCategory = FEATURE_STATUS_CATEGORY[current.featureStatus];
      const requestedCategory = changesStatus
        ? FEATURE_STATUS_CATEGORY[dto.featureStatus!]
        : currentCategory;
      const terminalCategory =
        changesStatus &&
        currentCategory !== requestedCategory &&
        (requestedCategory === StateCategory.COMPLETED ||
          requestedCategory === StateCategory.CANCELED)
          ? requestedCategory
          : null;
      const changeEventId = await this.createIssueChangedOutbox(transaction, context, issueId, {
        assigneeMembershipId: null,
        changedFields,
        mentionedMembershipIds: newlyMentionedMembershipIds,
        terminalCategory,
      });
      if (
        changesStatus &&
        !isTerminalCategory(currentCategory) &&
        isTerminalCategory(requestedCategory)
      ) {
        await this.createIssueUnblockedOutboxEvents(transaction, context, issueId);
      }

      const updated = await this.findIssue(transaction, context.workspaceId, issueId);
      await notifyResourceChanged(transaction, {
        changeType: 'UPDATED',
        eventId: changeEventId,
        resourceId: issueId,
        resourceType: 'ISSUE',
        version: updated.version,
        workspaceId: context.workspaceId,
      });
      return toDetailResponse(updated);
    });
  }

  private activity(
    context: { membershipId: string; workspaceId: string },
    issueId: string,
    fieldName: string,
    beforeData: Prisma.InputJsonValue | null,
    afterData: Prisma.InputJsonValue | null,
  ): Prisma.ActivityEventCreateManyInput {
    return {
      actorMembershipId: context.membershipId,
      afterData: afterData ?? Prisma.JsonNull,
      beforeData: beforeData ?? Prisma.JsonNull,
      eventType: 'ISSUE_UPDATED',
      fieldName,
      issueId,
      workspaceId: context.workspaceId,
    };
  }

  private async findIssue(
    transaction: Transaction,
    workspaceId: string,
    issueId: string,
  ): Promise<IssueRow> {
    const issue = await transaction.issue.findFirst({
      select: ISSUE_SELECT,
      where: { deletedAt: null, id: issueId, workspaceId },
    });
    if (!issue) {
      return resourceNotFound();
    }
    return issue;
  }

  private async createIssueRelations(
    transaction: Transaction,
    context: { membershipId: string; workspaceId: string },
    issueId: string,
    identifier: string,
    title: string,
    labelIds: string[],
    assigneeMembershipId: string | null,
    mentionedMembershipIds: string[],
  ): Promise<string> {
    if (labelIds.length > 0) {
      await transaction.issueLabel.createMany({
        data: labelIds.map((labelId) => ({
          issueId,
          labelId,
          workspaceId: context.workspaceId,
        })),
      });
    }
    await transaction.issueSubscription.createMany({
      data: [
        ...new Set(
          [context.membershipId, assigneeMembershipId, ...mentionedMembershipIds].filter(
            Boolean,
          ) as string[],
        ),
      ]
        .sort()
        .map((membershipId) => ({ issueId, membershipId, workspaceId: context.workspaceId })),
      skipDuplicates: true,
    });
    await transaction.activityEvent.create({
      data: {
        actorMembershipId: context.membershipId,
        afterData: { identifier, title },
        eventType: 'ISSUE_CREATED',
        issueId,
        workspaceId: context.workspaceId,
      },
    });
    const changeEventId = randomUUID();
    await transaction.outboxEvent.create({
      data: {
        actorMembershipId: context.membershipId,
        aggregateId: issueId,
        aggregateType: 'ISSUE',
        eventType: ISSUE_CREATED,
        id: changeEventId,
        payload: {
          assigneeMembershipId,
          issueId,
          mentionedMembershipIds,
          schemaVersion: ISSUE_CREATED_SCHEMA_VERSION,
        } satisfies IssueCreatedOutboxPayload,
        workspaceId: context.workspaceId,
      },
    });
    return changeEventId;
  }

  private async syncDescriptionReferences(
    transaction: Transaction,
    context: { membershipId: string; userId: string; workspaceId: string },
    issueId: string,
    description: ParsedOptionalMarkdown,
  ): Promise<void> {
    await transaction.mention.deleteMany({
      where: { commentId: null, issueId, workspaceId: context.workspaceId },
    });
    if (description.mentionedMembershipIds.length > 0) {
      await transaction.mention.createMany({
        data: description.mentionedMembershipIds.map((mentionedMembershipId) => ({
          issueId,
          mentionedMembershipId,
          workspaceId: context.workspaceId,
        })),
      });
    }
    await this.files.syncBodyImages(
      transaction,
      context,
      issueId,
      IssueFileKind.DESCRIPTION_IMAGE,
      description.fileIds,
    );
  }

  private async createIssueChangedOutbox(
    transaction: Transaction,
    context: { membershipId: string; workspaceId: string },
    issueId: string,
    change: {
      assigneeMembershipId: string | null;
      changedFields: IssueChangedField[];
      mentionedMembershipIds: string[];
      terminalCategory: typeof StateCategory.COMPLETED | typeof StateCategory.CANCELED | null;
    },
  ): Promise<string> {
    const subscriberMembershipIds = change.terminalCategory
      ? (
          await transaction.issueSubscription.findMany({
            orderBy: { membershipId: 'asc' },
            select: { membershipId: true },
            where: { issueId, workspaceId: context.workspaceId },
          })
        ).map(({ membershipId }) => membershipId)
      : [];
    const changeEventId = randomUUID();
    await transaction.outboxEvent.create({
      data: {
        actorMembershipId: context.membershipId,
        aggregateId: issueId,
        aggregateType: 'ISSUE',
        eventType: ISSUE_CHANGED,
        id: changeEventId,
        payload: {
          assigneeMembershipId: change.assigneeMembershipId,
          changedFields: change.changedFields,
          issueId,
          mentionedMembershipIds: change.mentionedMembershipIds,
          schemaVersion: ISSUE_CHANGED_SCHEMA_VERSION,
          subscriberMembershipIds,
          terminalCategory: change.terminalCategory,
        } satisfies IssueChangedOutboxPayload,
        workspaceId: context.workspaceId,
      },
    });
    return changeEventId;
  }

  private async createIssueUnblockedOutboxEvents(
    transaction: Transaction,
    context: { membershipId: string; workspaceId: string },
    blockerIssueId: string,
  ): Promise<void> {
    const candidates = await transaction.$queryRaw<IssueUnblockedCandidateRow[]>`
      SELECT
        "relation"."blocked_issue_id" AS "issueId",
        "blocked"."project_role" AS "blockedProjectRole",
        "blocker"."project_role" AS "blockingProjectRole",
        "relation"."created_at" AS "blockingStartedAt"
      FROM "issue_block_relations" AS "relation"
      INNER JOIN "issues" AS "blocked"
        ON "blocked"."workspace_id" = "relation"."workspace_id"
        AND "blocked"."id" = "relation"."blocked_issue_id"
        AND "blocked"."deleted_at" IS NULL
      INNER JOIN "workflow_states" AS "blocked_state"
        ON "blocked_state"."workspace_id" = "blocked"."workspace_id"
        AND "blocked_state"."id" = "blocked"."workflow_state_id"
        AND "blocked_state"."category" NOT IN (
          'COMPLETED'::"StateCategory",
          'CANCELED'::"StateCategory"
        )
      INNER JOIN "issues" AS "blocker"
        ON "blocker"."workspace_id" = "relation"."workspace_id"
        AND "blocker"."id" = "relation"."blocking_issue_id"
        AND "blocker"."deleted_at" IS NULL
      WHERE "relation"."workspace_id" = ${context.workspaceId}::uuid
        AND "relation"."blocking_issue_id" = ${blockerIssueId}::uuid
        AND NOT EXISTS (
          SELECT 1
          FROM "issue_block_relations" AS "remaining_relation"
          INNER JOIN "issues" AS "remaining_blocker"
            ON "remaining_blocker"."workspace_id" = "remaining_relation"."workspace_id"
            AND "remaining_blocker"."id" = "remaining_relation"."blocking_issue_id"
            AND "remaining_blocker"."deleted_at" IS NULL
          INNER JOIN "workflow_states" AS "remaining_state"
            ON "remaining_state"."workspace_id" = "remaining_blocker"."workspace_id"
            AND "remaining_state"."id" = "remaining_blocker"."workflow_state_id"
          WHERE "remaining_relation"."workspace_id" = "relation"."workspace_id"
            AND "remaining_relation"."blocked_issue_id" = "relation"."blocked_issue_id"
            AND "remaining_state"."category" NOT IN (
              'COMPLETED'::"StateCategory",
              'CANCELED'::"StateCategory"
            )
        )
      ORDER BY "relation"."blocked_issue_id", "relation"."id"
    `;
    if (candidates.length === 0) return;

    await transaction.outboxEvent.createMany({
      data: candidates.map((candidate) => ({
        actorMembershipId: context.membershipId,
        aggregateId: candidate.issueId,
        aggregateType: 'ISSUE',
        eventType: ISSUE_UNBLOCKED,
        id: randomUUID(),
        payload: {
          blockedProjectRole: candidate.blockedProjectRole,
          blockerIssueId,
          blockingDurationBucket: blockingDurationBucket(
            Math.max(0, Date.now() - candidate.blockingStartedAt.getTime()) / 1_000,
          ),
          blockingProjectRole: candidate.blockingProjectRole,
          issueId: candidate.issueId,
          schemaVersion: ISSUE_UNBLOCKED_SCHEMA_VERSION,
        } satisfies IssueUnblockedOutboxPayload,
        workspaceId: context.workspaceId,
      })),
    });
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
        message: '활성 워크스페이스 멤버만 이슈를 변경할 수 있습니다.',
        status: HttpStatus.FORBIDDEN,
      });
    }
  }

  private async lockWorkspace(transaction: Transaction, workspaceId: string): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "workspaces"
      WHERE "id" = ${workspaceId}::uuid
      FOR UPDATE
    `;
    if (rows.length === 0) {
      return resourceNotFound('워크스페이스를 찾을 수 없습니다.');
    }
  }

  private async lockActiveProject(
    transaction: Transaction,
    workspaceId: string,
    projectId: string,
  ): Promise<ProjectLockRow> {
    const [project] = await transaction.$queryRaw<ProjectLockRow[]>`
      SELECT "id", "archived_at" AS "archivedAt", "deleted_at" AS "deletedAt"
      FROM "projects"
      WHERE "workspace_id" = ${workspaceId}::uuid
        AND "id" = ${projectId}::uuid
      FOR UPDATE
    `;
    if (!project || project.archivedAt !== null || project.deletedAt !== null) {
      return resourceNotFound('활성 프로젝트를 찾을 수 없습니다.');
    }
    return project;
  }

  private async lockProjectRoleTeam(
    transaction: Transaction,
    workspaceId: string,
    projectId: string,
    projectRole: ProjectRole,
    teamId: string,
  ): Promise<void> {
    await this.lockActiveProject(transaction, workspaceId, projectId);
    const [roleTeam] = await transaction.$queryRaw<Array<{ teamId: string }>>`
      SELECT "team_id" AS "teamId"
      FROM "project_role_teams"
      WHERE "workspace_id" = ${workspaceId}::uuid
        AND "project_id" = ${projectId}::uuid
        AND "role" = ${projectRole}::"ProjectRole"
      FOR UPDATE
    `;
    if (!roleTeam || roleTeam.teamId !== teamId) {
      throw new ApiError({
        code: 'PROJECT_ROLE_TEAM_MISMATCH',
        message: '프로젝트 역할의 담당 팀과 이슈 팀이 일치해야 합니다.',
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      });
    }
  }

  private async lockParentFeature(
    transaction: Transaction,
    workspaceId: string,
    projectId: string,
    parentIssueId: string,
  ): Promise<ParentIssueLockRow> {
    const [parent] = await transaction.$queryRaw<ParentIssueLockRow[]>`
      SELECT "id", "project_id" AS "projectId", "type"
      FROM "issues"
      WHERE "workspace_id" = ${workspaceId}::uuid
        AND "id" = ${parentIssueId}::uuid
        AND "deleted_at" IS NULL
      FOR UPDATE
    `;
    if (!parent || parent.type !== IssueType.FEATURE || parent.projectId !== projectId) {
      throw new ApiError({
        code: 'PARENT_ISSUE_PROJECT_MISMATCH',
        message: '상위 기능 이슈는 같은 프로젝트에 속해야 합니다.',
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      });
    }
    return parent;
  }

  private async lockActiveTeam(
    transaction: Transaction,
    workspaceId: string,
    teamId: string,
  ): Promise<TeamLockRow> {
    const [team] = await transaction.$queryRaw<TeamLockRow[]>`
      SELECT
        "id",
        "key",
        "next_issue_number" AS "nextIssueNumber",
        "archived_at" AS "archivedAt"
      FROM "teams"
      WHERE "workspace_id" = ${workspaceId}::uuid
        AND "id" = ${teamId}::uuid
      FOR UPDATE
    `;
    if (!team || team.archivedAt !== null) {
      return resourceNotFound('활성 팀을 찾을 수 없습니다.');
    }
    return team;
  }

  private async lockWorkflowState(
    transaction: Transaction,
    workspaceId: string,
    teamId: string,
    workflowStateId: string | undefined,
  ): Promise<WorkflowStateLockRow> {
    const rows = workflowStateId
      ? await transaction.$queryRaw<WorkflowStateLockRow[]>`
          SELECT
            "id",
            "name",
            "category",
            "position",
            "is_default" AS "isDefault",
            "version"
          FROM "workflow_states"
          WHERE "workspace_id" = ${workspaceId}::uuid
            AND "team_id" = ${teamId}::uuid
            AND "id" = ${workflowStateId}::uuid
          FOR UPDATE
        `
      : await transaction.$queryRaw<WorkflowStateLockRow[]>`
          SELECT
            "id",
            "name",
            "category",
            "position",
            "is_default" AS "isDefault",
            "version"
          FROM "workflow_states"
          WHERE "workspace_id" = ${workspaceId}::uuid
            AND "team_id" = ${teamId}::uuid
            AND "is_default" = TRUE
          FOR UPDATE
        `;
    const [state] = rows;
    if (!state) {
      return resourceNotFound('워크플로 상태를 찾을 수 없습니다.');
    }
    return state;
  }

  private async lockMemberships(
    transaction: Transaction,
    workspaceId: string,
    teamId: string,
    actorMembershipId: string,
    assigneeMembershipId: string | undefined,
  ): Promise<MembershipLockRow | null> {
    const membershipIds = [
      ...new Set([actorMembershipId, assigneeMembershipId].filter(Boolean) as string[]),
    ].sort();
    const memberships = await transaction.$queryRaw<MembershipLockRow[]>(Prisma.sql`
      SELECT
        "membership"."id",
        "membership"."role",
        "membership"."status",
        "user"."display_name" AS "displayName"
      FROM "workspace_memberships" AS "membership"
      INNER JOIN "users" AS "user" ON "user"."id" = "membership"."user_id"
      WHERE "membership"."workspace_id" = ${workspaceId}::uuid
        AND "membership"."id" IN (${Prisma.join(
          membershipIds.map((membershipId) => Prisma.sql`${membershipId}::uuid`),
        )})
      ORDER BY "membership"."id"
      FOR UPDATE OF "membership"
    `);
    const actor = memberships.find(({ id }) => id === actorMembershipId);
    if (!actor || actor.status !== MembershipStatus.ACTIVE) {
      throw new ApiError({
        code: 'FORBIDDEN',
        message: '활성 워크스페이스 멤버만 이슈를 변경할 수 있습니다.',
        status: HttpStatus.FORBIDDEN,
      });
    }
    if (!assigneeMembershipId) {
      return null;
    }

    const assignee = memberships.find(({ id }) => id === assigneeMembershipId);
    if (!assignee || assignee.status !== MembershipStatus.ACTIVE) {
      throw new ApiError({
        code: 'ASSIGNEE_NOT_TEAM_MEMBER',
        message: '담당자는 해당 팀의 활성 멤버여야 합니다.',
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      });
    }

    const [teamMember] = await transaction.$queryRaw<Array<{ membershipId: string }>>`
      SELECT "membership_id" AS "membershipId"
      FROM "team_members"
      WHERE "workspace_id" = ${workspaceId}::uuid
        AND "team_id" = ${teamId}::uuid
        AND "membership_id" = ${assigneeMembershipId}::uuid
        AND "removed_at" IS NULL
      FOR UPDATE
    `;
    if (!teamMember) {
      throw new ApiError({
        code: 'ASSIGNEE_NOT_TEAM_MEMBER',
        message: '담당자는 해당 팀의 활성 멤버여야 합니다.',
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      });
    }
    return assignee;
  }

  private async lockLabels(
    transaction: Transaction,
    workspaceId: string,
    labelIds: string[],
    rejectArchived = true,
  ): Promise<LabelLockRow[]> {
    if (labelIds.length === 0) {
      return [];
    }

    const labels = await transaction.$queryRaw<LabelLockRow[]>(Prisma.sql`
      SELECT
        "id",
        "name",
        "color",
        "archived_at" AS "archivedAt"
      FROM "labels"
      WHERE "workspace_id" = ${workspaceId}::uuid
        AND "id" IN (${Prisma.join(labelIds.map((labelId) => Prisma.sql`${labelId}::uuid`))})
      ORDER BY "id"
      FOR UPDATE
    `);
    if (
      labels.length !== labelIds.length ||
      (rejectArchived && labels.some(({ archivedAt }) => archivedAt !== null))
    ) {
      return resourceNotFound('사용할 수 있는 라벨을 찾을 수 없습니다.');
    }
    return labels;
  }
}
