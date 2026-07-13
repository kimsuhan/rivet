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
  API_HANDOFF_CREATED,
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
import type {
  AssignTeamTasksDto,
  ClaimIssueDto,
  CreateIssueDto,
  IssueListQueryDto,
  StartIssueDto,
  UpdateIssueDto,
} from './dto/issue-request.dto';
import type {
  AssignTeamTasksResponseDto,
  ClaimIssueResponseDto,
  CreateIssueResponseDto,
  FeatureWorkQueueCountsResponseDto,
  IssueCompletionBlockRelationResponseDto,
  IssueCompletionHandoffResponseDto,
  IssueDetailResponseDto,
  IssueHandoffFlowResponseDto,
  IssueListResponseDto,
  IssueMemberSummaryResponseDto,
  IssueRelationIssueResponseDto,
  IssueSummaryResponseDto,
  IssueWorkflowRelationResponseDto,
  UpdateIssueResponseDto,
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
    select: {
      assigneeMembershipId: true,
      blockedRelations: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          blockingIssue: {
            select: {
              featureStatus: true,
              id: true,
              identifier: true,
              title: true,
              workflowState: { select: { category: true } },
            },
          },
        },
        where: { blockingIssue: { deletedAt: null } },
      },
      id: true,
      identifier: true,
      projectRole: true,
      team: { select: { archivedAt: true, id: true, key: true, name: true } },
      workflowState: { select: { category: true } },
    },
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
type SortField = 'createdAt' | 'priority' | 'progress' | 'status' | 'updatedAt';
type SortDirection = 'asc' | 'desc';

interface AutomatedHandoffCompletionResult {
  blockRelations: IssueCompletionBlockRelationResponseDto[];
  downstreamIssueIds: string[];
  handoff: IssueCompletionHandoffResponseDto;
  parentIssueId: string;
}

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

interface ProjectRoleTeamLockRow {
  role: ProjectRole;
  teamId: string;
}

interface AutomaticTeamTaskAssignment extends ProjectRoleTeamLockRow {
  assigneeMembershipId?: string | null;
}

interface FeatureStartLockRow {
  id: string;
  priority: IssuePriority;
  projectId: string;
  title: string;
  type: IssueType;
}

interface IssueLockRow {
  assigneeMembershipId: string | null;
  descriptionMarkdown: string | null;
  featureStatus: FeatureIssueStatus | null;
  id: string;
  identifier: string;
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
  value: number | string | [StateCategory, number, IssueType];
}

interface ProgressSortRow {
  id: string;
  progress: number;
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
const FRONTEND_PROJECT_ROLES = [ProjectRole.WEB_FRONTEND, ProjectRole.APP_FRONTEND] as const;

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

function issueVersionConflict(currentVersion: number): never {
  throw new ApiError({
    code: 'ISSUE_VERSION_CONFLICT',
    currentVersion,
    message: '이슈가 다른 요청에서 변경되었습니다.',
    status: HttpStatus.CONFLICT,
  });
}

function conflict(code: string, message: string, details?: Record<string, unknown>): never {
  throw new ApiError({
    code,
    ...(details === undefined ? {} : { details }),
    message,
    status: HttpStatus.CONFLICT,
  });
}

function unprocessable(code: string, message: string): never {
  throw new ApiError({ code, message, status: HttpStatus.UNPROCESSABLE_ENTITY });
}

function assignmentConflict(message: string, details?: Record<string, unknown>): never {
  throw new ApiError({
    code: 'ISSUE_ASSIGNMENT_CONFLICT',
    ...(details ? { details } : {}),
    message,
    status: HttpStatus.CONFLICT,
  });
}

function teamMembershipRequired(): never {
  throw new ApiError({
    code: 'TEAM_MEMBERSHIP_REQUIRED',
    message: '해당 역할 팀의 활성 멤버만 작업을 맡을 수 있습니다.',
    status: HttpStatus.FORBIDDEN,
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

function handoffChangeSummary(bodyMarkdown: string): string {
  const heading = '## 변경 요약';
  const nextHeading = '\n## API 명세 링크';
  const start = bodyMarkdown.indexOf(heading);
  const end = bodyMarkdown.indexOf(nextHeading, start + heading.length);
  return start === -1
    ? ''
    : bodyMarkdown.slice(start + heading.length, end === -1 ? undefined : end).trim();
}

function jsonRecord(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : null;
}

function jsonStringArray(value: Prisma.JsonValue | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
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

function parseDate(
  value: string | undefined,
  message: string,
  includeWholeDate = false,
): Date | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = new Date(
    includeWholeDate && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999Z` : value,
  );
  if (Number.isNaN(parsed.getTime())) {
    return invalidQuery(message);
  }
  return parsed;
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
    } else if (sort === 'progress') {
      if (
        typeof cursorValue !== 'number' ||
        !Number.isInteger(cursorValue) ||
        cursorValue < 0 ||
        cursorValue > 100
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
      value: cursorValue as number | string | [StateCategory, number, IssueType],
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

export function buildFeatureWorkQueueWhere(workQueue: string): Prisma.IssueWhereInput {
  const activeTask = {
    deletedAt: null,
    type: IssueType.TEAM_TASK,
    workflowState: {
      category: { notIn: [StateCategory.COMPLETED, StateCategory.CANCELED] },
    },
  } satisfies Prisma.IssueWhereInput;

  switch (workQueue) {
    case 'REVIEW_REQUIRED':
      return {
        childIssues: { none: { deletedAt: null, type: IssueType.TEAM_TASK } },
        featureStatus: { notIn: [FeatureIssueStatus.DONE, FeatureIssueStatus.CANCELED] },
        type: IssueType.FEATURE,
      };
    case 'ASSIGNMENT_REQUIRED':
      return {
        childIssues: { some: { ...activeTask, assigneeMembershipId: null } },
        type: IssueType.FEATURE,
      };
    case 'IN_PROGRESS':
      return { childIssues: { some: activeTask }, type: IssueType.FEATURE };
    case 'COMPLETION_REQUIRED':
      return {
        AND: [
          {
            childIssues: {
              some: {
                deletedAt: null,
                type: IssueType.TEAM_TASK,
                workflowState: { category: { not: StateCategory.CANCELED } },
              },
            },
          },
          {
            childIssues: {
              none: {
                deletedAt: null,
                type: IssueType.TEAM_TASK,
                workflowState: {
                  category: { notIn: [StateCategory.COMPLETED, StateCategory.CANCELED] },
                },
              },
            },
          },
        ],
        featureStatus: { notIn: [FeatureIssueStatus.DONE, FeatureIssueStatus.CANCELED] },
        type: IssueType.FEATURE,
      };
    case 'COMPLETED':
      return { featureStatus: FeatureIssueStatus.DONE, type: IssueType.FEATURE };
    default:
      return invalidQuery('작업 대기열 필터를 확인해 주세요.');
  }
}

function blockingDurationBucket(seconds: number): IssueUnblockedDurationBucket {
  if (seconds < 60 * 60) return 'LT_1_HOUR';
  if (seconds < 24 * 60 * 60) return 'LT_1_DAY';
  if (seconds < 7 * 24 * 60 * 60) return 'LT_7_DAYS';
  return 'GTE_7_DAYS';
}

function issueProgress(issue: IssueRow): number {
  const targets = issue.childIssues.filter(
    ({ workflowState }) => workflowState?.category !== StateCategory.CANCELED,
  );
  const completed = targets.filter(
    ({ workflowState }) => workflowState?.category === StateCategory.COMPLETED,
  ).length;
  return targets.length === 0 ? 0 : Math.round((completed / targets.length) * 100);
}

function cursorValue(
  row: IssueRow,
  sort: SortField,
): number | string | [StateCategory, number, IssueType] {
  switch (sort) {
    case 'createdAt':
      return row.createdAt.toISOString();
    case 'updatedAt':
      return row.updatedAt.toISOString();
    case 'priority':
      return row.priority;
    case 'progress':
      return issueProgress(row);
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

function toSummaryResponse(
  issue: IssueRow,
  currentMembershipId?: string,
  currentUserTeamRoles: ProjectRole[] = [],
): IssueSummaryResponseDto {
  const children = issue.childIssues.filter(
    ({ workflowState }) => workflowState?.category !== StateCategory.CANCELED,
  );
  const completed = children.filter(
    ({ workflowState }) => workflowState?.category === StateCategory.COMPLETED,
  ).length;

  const activeChildren = issue.childIssues.filter(
    ({ workflowState }) => workflowState && !isTerminalCategory(workflowState.category),
  );
  const activeRoles = [
    ...new Set(activeChildren.flatMap(({ projectRole }) => projectRole ?? [])),
  ].sort();
  const activeRoleTeams = [
    ...new Set(activeChildren.flatMap(({ projectRole }) => projectRole ?? [])),
  ]
    .sort()
    .flatMap((projectRole) => {
      const roleChildren = activeChildren.filter((child) => child.projectRole === projectRole);
      const team = roleChildren[0]?.team;
      return team
        ? [
            {
              projectRole,
              team: {
                archived: team.archivedAt !== null,
                id: team.id,
                key: team.key,
                name: team.name,
              },
              unassignedCount: roleChildren.filter(
                ({ assigneeMembershipId }) => assigneeMembershipId === null,
              ).length,
            },
          ]
        : [];
    });
  const waitingOn = new Map<string, { identifier: string; issueId: string; title: string }>();
  for (const child of activeChildren) {
    for (const { blockingIssue } of child.blockedRelations) {
      if (!isTerminalCategory(issueCategory(blockingIssue))) {
        waitingOn.set(blockingIssue.id, {
          identifier: blockingIssue.identifier,
          issueId: blockingIssue.id,
          title: blockingIssue.title,
        });
      }
    }
  }
  const canceledCount = issue.childIssues.filter(
    ({ workflowState }) => workflowState?.category === StateCategory.CANCELED,
  ).length;
  const unassignedCount = activeChildren.filter(
    ({ assigneeMembershipId }) => assigneeMembershipId === null,
  ).length;

  return {
    assignee: issue.assigneeTeamMember
      ? toMemberResponse(issue.assigneeTeamMember.membership)
      : null,
    blocked: issue.blockedRelations.some(
      ({ blockingIssue }) => !isTerminalCategory(issueCategory(blockingIssue)),
    ),
    createdAt: issue.createdAt.toISOString(),
    createdBy: toMemberResponse(issue.createdByMembership),
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
    workflowSummary:
      issue.type === IssueType.FEATURE
        ? {
            activeRoles,
            activeRoleTeams,
            allTargetTasksCompleted: children.length > 0 && completed === children.length,
            canceledCount,
            completedCount: completed,
            currentUserAssignedTeamTasks: currentMembershipId
              ? activeChildren
                  .filter(
                    ({ assigneeMembershipId, projectRole }) =>
                      assigneeMembershipId === currentMembershipId && projectRole !== null,
                  )
                  .map(({ id, identifier, projectRole }) => ({
                    id,
                    identifier,
                    projectRole: projectRole!,
                  }))
                  .sort((left, right) => left.id.localeCompare(right.id))
              : [],
            currentUserTeamRoles,
            teamTaskCount: issue.childIssues.length,
            unassignedCount,
            waitingOn: [...waitingOn.values()].sort((left, right) =>
              left.issueId.localeCompare(right.issueId),
            ),
          }
        : null,
  };
}

function toRelationIssueResponse(related: {
  featureStatus: FeatureIssueStatus | null;
  id: string;
  identifier: string;
  projectRole: ProjectRole | null;
  title: string;
  workflowState: { category: StateCategory } | null;
}): IssueRelationIssueResponseDto {
  return {
    category: issueCategory(related),
    featureStatus: related.featureStatus,
    id: related.id,
    identifier: related.identifier,
    projectRole: related.projectRole,
    title: related.title,
  };
}

function toDetailResponse(issue: IssueRow): IssueDetailResponseDto {
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
      issue: toRelationIssueResponse(blockingIssue),
      resolved: isTerminalCategory(issueCategory(blockingIssue)),
    })),
    blocking: issue.blockingRelations.map(({ blockedIssue, createdAt, id }) => ({
      createdAt: createdAt.toISOString(),
      id,
      issue: toRelationIssueResponse(blockedIssue),
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
    if (!['createdAt', 'priority', 'progress', 'status', 'updatedAt'].includes(sort)) {
      invalidQuery('정렬 기준을 확인해 주세요.');
    }
    const direction = dto.sortDirection ?? 'desc';
    if (direction !== 'asc' && direction !== 'desc') {
      invalidQuery('정렬 방향을 확인해 주세요.');
    }

    const typedSort = sort as SortField;
    if (typedSort === 'progress' && dto.type !== IssueType.FEATURE) {
      invalidQuery('진행률 정렬은 기능 이슈 목록에서만 사용할 수 있습니다.');
    }
    if (dto.workQueue !== undefined && dto.type !== undefined && dto.type !== IssueType.FEATURE) {
      invalidQuery('작업 대기열은 기능 이슈 목록에서만 사용할 수 있습니다.');
    }
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
    const activeProjectRoles = parseCsv(
      dto.activeProjectRole,
      (item) => Object.values(ProjectRole).includes(item as ProjectRole),
      '현재 작업 역할 필터를 확인해 주세요.',
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
    const createdByMembershipIds = parseCsv(
      dto.createdByMembershipId,
      (item) => isUUID(item, '4'),
      '만든 사람 필터를 확인해 주세요.',
    );
    const blocked = dto.blocked === undefined ? undefined : dto.blocked === 'true';
    const unassigned = dto.unassigned === undefined ? undefined : dto.unassigned === 'true';
    const createdFrom = parseDate(dto.createdFrom, '생성일 범위를 확인해 주세요.');
    const createdTo = parseDate(dto.createdTo, '생성일 범위를 확인해 주세요.', true);
    const updatedFrom = parseDate(dto.updatedFrom, '최근 수정일 범위를 확인해 주세요.');
    const updatedTo = parseDate(dto.updatedTo, '최근 수정일 범위를 확인해 주세요.', true);
    if (createdFrom && createdTo && createdFrom > createdTo) {
      invalidQuery('생성일 범위를 확인해 주세요.');
    }
    if (updatedFrom && updatedTo && updatedFrom > updatedTo) {
      invalidQuery('최근 수정일 범위를 확인해 주세요.');
    }
    const query = dto.query?.normalize('NFC').trim() || undefined;
    const cursorScope = createHash('sha256')
      .update(
        JSON.stringify([
          context.workspaceId,
          dto.type ?? null,
          query ?? null,
          dto.workQueue ?? null,
          teamIds ?? null,
          projectIds ?? null,
          projectRoles ?? null,
          activeProjectRoles ?? null,
          dto.parentIssueId ?? null,
          featureStatuses ?? null,
          workflowStateIds ?? null,
          stateCategories ?? null,
          assigneeIds ?? null,
          createdByMembershipIds ?? null,
          priorities ?? null,
          labelIds ?? null,
          blocked ?? null,
          unassigned ?? null,
          createdFrom?.toISOString() ?? null,
          createdTo?.toISOString() ?? null,
          updatedFrom?.toISOString() ?? null,
          updatedTo?.toISOString() ?? null,
        ]),
      )
      .digest('base64url');
    const cursor = parseCursor(dto.cursor, typedSort, direction, cursorScope);

    const and: Prisma.IssueWhereInput[] = [];
    if (query) {
      and.push({
        OR: [
          { identifier: { contains: query, mode: 'insensitive' } },
          { title: { contains: query, mode: 'insensitive' } },
        ],
      });
    }
    if (stateCategories) {
      and.push({
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
      });
    }
    if (activeProjectRoles) {
      and.push({
        childIssues: {
          some: {
            deletedAt: null,
            projectRole: { in: activeProjectRoles },
            type: IssueType.TEAM_TASK,
            workflowState: {
              category: { notIn: [StateCategory.COMPLETED, StateCategory.CANCELED] },
            },
          },
        },
      });
    }
    if (unassigned !== undefined) {
      const unassignedTask: Prisma.IssueWhereInput = {
        assigneeMembershipId: null,
        deletedAt: null,
        type: IssueType.TEAM_TASK,
        workflowState: {
          category: { notIn: [StateCategory.COMPLETED, StateCategory.CANCELED] },
        },
      };
      and.push({ childIssues: unassigned ? { some: unassignedTask } : { none: unassignedTask } });
    }

    const workQueueBaseWhere: Prisma.IssueWhereInput = {
      ...(and.length > 0 ? { AND: and } : {}),
      ...(assigneeIds ? { assigneeMembershipId: { in: assigneeIds } } : {}),
      ...(createdByMembershipIds ? { createdByMembershipId: { in: createdByMembershipIds } } : {}),
      ...(createdFrom || createdTo
        ? {
            createdAt: {
              ...(createdFrom ? { gte: createdFrom } : {}),
              ...(createdTo ? { lte: createdTo } : {}),
            },
          }
        : {}),
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
      ...(teamIds ? { teamId: { in: teamIds } } : {}),
      ...(dto.type ? { type: dto.type as IssueType } : {}),
      ...(updatedFrom || updatedTo
        ? {
            updatedAt: {
              ...(updatedFrom ? { gte: updatedFrom } : {}),
              ...(updatedTo ? { lte: updatedTo } : {}),
            },
          }
        : {}),
      ...(workflowStateIds ? { workflowStateId: { in: workflowStateIds } } : {}),
      deletedAt: null,
      workspaceId: context.workspaceId,
    };
    const where: Prisma.IssueWhereInput = dto.workQueue
      ? { AND: [workQueueBaseWhere, buildFeatureWorkQueueWhere(dto.workQueue)] }
      : workQueueBaseWhere;
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
    const includesWorkQueueCounts = dto.type === IssueType.FEATURE || dto.workQueue !== undefined;
    const workQueueCountsPromise = includesWorkQueueCounts
      ? this.countFeatureWorkQueues(workQueueBaseWhere)
      : Promise.resolve(undefined);
    if (typedSort === 'status') {
      const [response, workQueueCounts] = await Promise.all([
        this.listByStatus(context, where, cursor, direction, limit, cursorScope),
        workQueueCountsPromise,
      ]);
      return workQueueCounts ? { ...response, workQueueCounts } : response;
    }
    if (typedSort === 'progress') {
      const [response, workQueueCounts] = await Promise.all([
        this.listByProgress(context, where, cursor, direction, limit, cursorScope),
        workQueueCountsPromise,
      ]);
      return workQueueCounts ? { ...response, workQueueCounts } : response;
    }

    const orderBy: Prisma.IssueOrderByWithRelationInput[] = [
      { [typedSort]: direction },
      { id: direction },
    ];
    const [issues, listTotalCount, workQueueCounts] = await Promise.all([
      this.database.client.issue.findMany({
        ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
        orderBy,
        select: ISSUE_SELECT,
        take: limit + 1,
        where,
      }),
      includesWorkQueueCounts ? Promise.resolve(0) : this.database.client.issue.count({ where }),
      workQueueCountsPromise,
    ]);
    const page = issues.slice(0, limit);
    const totalCount = workQueueCounts ? workQueueCounts[dto.workQueue ?? 'ALL'] : listTotalCount;

    return {
      items: await this.listItems(context, page),
      nextCursor:
        issues.length > limit && page.length > 0
          ? encodeCursor(page[page.length - 1]!, typedSort, direction, cursorScope)
          : null,
      totalCount,
      ...(workQueueCounts ? { workQueueCounts } : {}),
    };
  }

  private async countFeatureWorkQueues(
    where: Prisma.IssueWhereInput,
  ): Promise<FeatureWorkQueueCountsResponseDto> {
    const [all, reviewRequired, assignmentRequired, inProgress, completionRequired, completed] =
      await Promise.all([
        this.database.client.issue.count({
          where: { AND: [where, { type: IssueType.FEATURE }] },
        }),
        this.database.client.issue.count({
          where: { AND: [where, buildFeatureWorkQueueWhere('REVIEW_REQUIRED')] },
        }),
        this.database.client.issue.count({
          where: { AND: [where, buildFeatureWorkQueueWhere('ASSIGNMENT_REQUIRED')] },
        }),
        this.database.client.issue.count({
          where: { AND: [where, buildFeatureWorkQueueWhere('IN_PROGRESS')] },
        }),
        this.database.client.issue.count({
          where: { AND: [where, buildFeatureWorkQueueWhere('COMPLETION_REQUIRED')] },
        }),
        this.database.client.issue.count({
          where: { AND: [where, buildFeatureWorkQueueWhere('COMPLETED')] },
        }),
      ]);

    return {
      ALL: all,
      REVIEW_REQUIRED: reviewRequired,
      ASSIGNMENT_REQUIRED: assignmentRequired,
      IN_PROGRESS: inProgress,
      COMPLETION_REQUIRED: completionRequired,
      COMPLETED: completed,
    };
  }

  private async listByStatus(
    context: { membershipId: string; workspaceId: string },
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
      items: await this.listItems(context, page),
      nextCursor:
        issues.length > limit && page.length > 0
          ? encodeCursor(page[page.length - 1]!, 'status', direction, cursorScope)
          : null,
      totalCount: sortRows.length,
    };
  }

  private async listByProgress(
    context: { membershipId: string; workspaceId: string },
    where: Prisma.IssueWhereInput,
    cursor: IssueCursor | undefined,
    direction: SortDirection,
    limit: number,
    cursorScope: string,
  ): Promise<IssueListResponseDto> {
    const candidates = await this.database.client.issue.findMany({
      select: { id: true },
      where,
    });
    if (candidates.length === 0) {
      return { items: [], nextCursor: null, totalCount: 0 };
    }
    const candidateIds = candidates.map(({ id }) => id).join(',');

    const cursorProgress = cursor?.value;
    if (cursorProgress !== undefined && typeof cursorProgress !== 'number') {
      invalidQuery('현재 정렬 조건에 맞는 커서를 사용해 주세요.');
    }
    const comparison = cursor
      ? direction === 'asc'
        ? Prisma.sql`("progress" > ${cursorProgress as number} OR ("progress" = ${cursorProgress as number} AND "id" > ${cursor.id}::uuid))`
        : Prisma.sql`("progress" < ${cursorProgress as number} OR ("progress" = ${cursorProgress as number} AND "id" < ${cursor.id}::uuid))`
      : Prisma.sql`TRUE`;
    const order = Prisma.raw(direction.toUpperCase());
    const rows = await this.database.client.$queryRaw<ProgressSortRow[]>(Prisma.sql`
      WITH "progress_rows" AS (
        SELECT
          "feature"."id",
          CASE
            WHEN COUNT("task"."id") FILTER (
              WHERE "state"."category" <> 'CANCELED'::"StateCategory"
            ) = 0 THEN 0
            ELSE ROUND(
              COUNT("task"."id") FILTER (
                WHERE "state"."category" = 'COMPLETED'::"StateCategory"
              ) * 100.0 /
              COUNT("task"."id") FILTER (
                WHERE "state"."category" <> 'CANCELED'::"StateCategory"
              )
            )::integer
          END AS "progress"
        FROM "issues" AS "feature"
        LEFT JOIN "issues" AS "task"
          ON "task"."workspace_id" = "feature"."workspace_id"
         AND "task"."parent_issue_id" = "feature"."id"
         AND "task"."type" = 'TEAM_TASK'::"IssueType"
         AND "task"."deleted_at" IS NULL
        LEFT JOIN "workflow_states" AS "state"
          ON "state"."workspace_id" = "task"."workspace_id"
         AND "state"."team_id" = "task"."team_id"
         AND "state"."id" = "task"."workflow_state_id"
        WHERE "feature"."id" = ANY(string_to_array(${candidateIds}, ',')::uuid[])
        GROUP BY "feature"."id"
      )
      SELECT "id", "progress"
      FROM "progress_rows"
      WHERE ${comparison}
      ORDER BY "progress" ${order}, "id" ${order}
      LIMIT ${limit + 1}
    `);
    const pageRows = rows.slice(0, limit);
    const selected = await this.database.client.issue.findMany({
      select: ISSUE_SELECT,
      where: { AND: [where, { id: { in: pageRows.map(({ id }) => id) } }] },
    });
    const byId = new Map(selected.map((issue) => [issue.id, issue]));
    const page = pageRows.map(({ id }) => byId.get(id)).filter((issue) => issue !== undefined);

    return {
      items: await this.listItems(context, page),
      nextCursor:
        rows.length > limit && page.length > 0
          ? encodeCursor(page[page.length - 1]!, 'progress', direction, cursorScope)
          : null,
      totalCount: candidates.length,
    };
  }

  private async listItems(
    context: { membershipId: string; workspaceId: string },
    issues: IssueRow[],
  ): Promise<IssueSummaryResponseDto[]> {
    const projectIds = [
      ...new Set(
        issues.flatMap((issue) =>
          issue.type === IssueType.FEATURE && issue.project ? [issue.project.id] : [],
        ),
      ),
    ];
    const roleTeams =
      projectIds.length === 0
        ? []
        : await this.database.client.projectRoleTeam.findMany({
            orderBy: [{ projectId: 'asc' }, { role: 'asc' }],
            select: { projectId: true, role: true },
            where: {
              project: { archivedAt: null, deletedAt: null },
              projectId: { in: projectIds },
              team: {
                archivedAt: null,
                teamMembers: {
                  some: {
                    membership: { status: MembershipStatus.ACTIVE },
                    membershipId: context.membershipId,
                    removedAt: null,
                  },
                },
              },
              workspaceId: context.workspaceId,
            },
          });
    const rolesByProject = new Map<string, ProjectRole[]>();
    for (const { projectId, role } of roleTeams) {
      rolesByProject.set(projectId, [...(rolesByProject.get(projectId) ?? []), role]);
    }
    return issues.map((issue) =>
      toSummaryResponse(
        issue,
        context.membershipId,
        issue.project ? (rolesByProject.get(issue.project.id) ?? []) : [],
      ),
    );
  }

  async create(
    context: { membershipId: string; userId: string; workspaceId: string },
    dto: CreateIssueDto,
  ): Promise<CreateIssueResponseDto> {
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
        const roleAssignments = await this.lockProjectRoleAssignments(
          transaction,
          context.workspaceId,
          projectId,
        );
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
        const createdTeamTasks = await this.createAutomaticTeamTasks(
          transaction,
          context,
          {
            id: issue.id,
            priority: dto.priority ?? IssuePriority.NONE,
            projectId,
            title,
          },
          this.selectedRoleAssignments(roleAssignments, dto.initialRoles ?? []),
        );
        const created = await this.findIssue(transaction, context.workspaceId, issue.id);
        await notifyResourceChanged(transaction, {
          changeType: 'CREATED',
          eventId: changeEventId,
          resourceId: issue.id,
          resourceType: 'ISSUE',
          version: created.version,
          workspaceId: context.workspaceId,
        });
        return {
          createdTeamTasks: createdTeamTasks.map((task) => toSummaryResponse(task)),
          issue: toDetailResponse(created),
        };
      });
    }

    if (!dto.teamId) {
      issueTypeFieldInvalid('팀 작업에는 팀이 필요합니다.');
    }
    if (dto.featureStatus !== undefined) {
      issueTypeFieldInvalid('팀 작업에는 기능 이슈 상태를 사용할 수 없습니다.');
    }
    if (dto.initialRoles !== undefined) {
      issueTypeFieldInvalid('팀 작업에는 처음 작업할 역할을 사용할 수 없습니다.');
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
      return { createdTeamTasks: [], issue: toDetailResponse(created) };
    });
  }

  async start(
    context: { membershipId: string; userId: string; workspaceId: string },
    issueId: string,
    dto: StartIssueDto,
  ): Promise<CreateIssueResponseDto> {
    if (dto.initialRoles !== undefined && dto.roleAssignments !== undefined) {
      unprocessable(
        'INITIAL_ROLE_INPUT_CONFLICT',
        '처음 작업할 역할과 역할별 담당자를 동시에 보낼 수 없습니다.',
      );
    }
    const roles = dto.roleAssignments?.map(({ projectRole }) => projectRole) ?? dto.initialRoles;
    if (!roles || roles.length === 0) {
      unprocessable('INITIAL_ROLE_REQUIRED', '처음 작업할 역할을 하나 이상 선택해 주세요.');
    }
    const assigneeByRole = new Map(
      (dto.roleAssignments ?? []).map(({ assigneeMembershipId, projectRole }) => [
        projectRole,
        assigneeMembershipId,
      ]),
    );

    return this.database.client.$transaction(async (transaction) => {
      await this.lockWorkspace(transaction, context.workspaceId);
      await this.lockActorMembership(transaction, context.workspaceId, context.membershipId);
      const [feature] = await transaction.$queryRaw<FeatureStartLockRow[]>`
        SELECT "id", "type", "title", "priority", "project_id" AS "projectId"
        FROM "issues"
        WHERE "workspace_id" = ${context.workspaceId}::uuid
          AND "id" = ${issueId}::uuid
          AND "deleted_at" IS NULL
        FOR UPDATE
      `;
      if (!feature || feature.type !== IssueType.FEATURE) {
        return resourceNotFound();
      }

      await this.lockActiveProject(transaction, context.workspaceId, feature.projectId);
      const roleAssignments = await this.lockProjectRoleAssignments(
        transaction,
        context.workspaceId,
        feature.projectId,
      );
      const selectedAssignments = this.selectedRoleAssignments(roleAssignments, roles);
      for (const teamId of new Set(selectedAssignments.map(({ teamId }) => teamId))) {
        await this.lockActiveTeam(transaction, context.workspaceId, teamId);
        if (dto.requireCurrentUserTeamMembership) {
          await this.lockActiveTeamMembership(
            transaction,
            context.workspaceId,
            teamId,
            context.membershipId,
          );
        }
      }
      const existingTasks = await transaction.issue.findMany({
        orderBy: [{ projectRole: 'asc' }, { id: 'asc' }],
        select: ISSUE_SELECT,
        where: {
          deletedAt: null,
          parentIssueId: issueId,
          projectRole: { in: roles },
          type: IssueType.TEAM_TASK,
          workflowState: {
            category: { notIn: [StateCategory.COMPLETED, StateCategory.CANCELED] },
          },
          workspaceId: context.workspaceId,
        },
      });
      const validatedAssignees = new Map<ProjectRole, MembershipLockRow>();
      const missingAssignments: AutomaticTeamTaskAssignment[] = [];
      let changedExistingTask = false;
      for (const assignment of selectedAssignments) {
        const roleTasks = existingTasks.filter(
          ({ projectRole }) => projectRole === assignment.role,
        );
        const assigneeMembershipId = assigneeByRole.get(assignment.role);
        if (assigneeMembershipId) {
          const assignee = await this.lockMemberships(
            transaction,
            context.workspaceId,
            assignment.teamId,
            context.membershipId,
            assigneeMembershipId,
          );
          if (!assignee) {
            throw new Error('ASSIGNEE_MEMBERSHIP_INVARIANT_VIOLATION');
          }
          if (
            roleTasks.some(
              (task) =>
                task.assigneeTeamMember !== null &&
                task.assigneeTeamMember.membership.id !== assigneeMembershipId,
            )
          ) {
            assignmentConflict('이미 다른 담당자가 지정된 팀 작업이 있습니다.', {
              projectRole: assignment.role,
              teamTasks: roleTasks.map((task) => toSummaryResponse(task)),
            });
          }
          validatedAssignees.set(assignment.role, assignee);
        }
        if (roleTasks.length === 0) {
          missingAssignments.push({
            ...assignment,
            assigneeMembershipId: assigneeMembershipId ?? null,
          });
        }
      }
      for (const task of existingTasks) {
        if (!task.projectRole || task.assigneeTeamMember) continue;
        const assignee = validatedAssignees.get(task.projectRole);
        if (assignee) {
          await this.assignExistingTeamTask(transaction, context, task, assignee);
          changedExistingTask = true;
        }
      }
      const createdTeamTasks = await this.createAutomaticTeamTasks(
        transaction,
        context,
        feature,
        missingAssignments,
      );
      if (changedExistingTask || createdTeamTasks.length > 0) {
        await this.touchParentFeature(transaction, context.workspaceId, issueId);
      }
      const updatedFeature = await this.findIssue(transaction, context.workspaceId, issueId);
      await notifyResourceChanged(transaction, {
        changeType: 'UPDATED',
        resourceId: issueId,
        resourceType: 'ISSUE',
        version: updatedFeature.version,
        workspaceId: context.workspaceId,
      });

      return {
        createdTeamTasks: createdTeamTasks.map((task) => toSummaryResponse(task)),
        issue: {
          ...toDetailResponse(updatedFeature),
          ...toSummaryResponse(
            updatedFeature,
            context.membershipId,
            await this.currentUserProjectRoles(
              transaction,
              context.workspaceId,
              feature.projectId,
              context.membershipId,
            ),
          ),
        },
      };
    });
  }

  async claim(
    context: { membershipId: string; userId: string; workspaceId: string },
    issueId: string,
    dto: ClaimIssueDto,
  ): Promise<ClaimIssueResponseDto> {
    return this.database.client.$transaction(async (transaction) => {
      await this.lockWorkspace(transaction, context.workspaceId);
      await this.lockActorMembership(transaction, context.workspaceId, context.membershipId);
      const [feature] = await transaction.$queryRaw<FeatureStartLockRow[]>`
        SELECT "id", "type", "title", "priority", "project_id" AS "projectId"
        FROM "issues"
        WHERE "workspace_id" = ${context.workspaceId}::uuid
          AND "id" = ${issueId}::uuid
          AND "deleted_at" IS NULL
        FOR UPDATE
      `;
      if (!feature || feature.type !== IssueType.FEATURE) {
        return resourceNotFound();
      }
      await this.lockActiveProject(transaction, context.workspaceId, feature.projectId);
      const [roleAssignment] = this.selectedRoleAssignments(
        await this.lockProjectRoleAssignments(transaction, context.workspaceId, feature.projectId),
        [dto.projectRole],
      );
      if (!roleAssignment) {
        return resourceNotFound('프로젝트 역할을 찾을 수 없습니다.');
      }
      await this.lockActiveTeam(transaction, context.workspaceId, roleAssignment.teamId);
      await this.lockActiveTeamMembership(
        transaction,
        context.workspaceId,
        roleAssignment.teamId,
        context.membershipId,
      );

      const activeTasks = await transaction.issue.findMany({
        orderBy: [{ identifier: 'asc' }, { id: 'asc' }],
        select: ISSUE_SELECT,
        where: {
          deletedAt: null,
          parentIssueId: issueId,
          projectId: feature.projectId,
          projectRole: dto.projectRole,
          teamId: roleAssignment.teamId,
          type: IssueType.TEAM_TASK,
          workflowState: {
            category: { notIn: [StateCategory.COMPLETED, StateCategory.CANCELED] },
          },
          workspaceId: context.workspaceId,
        },
      });
      let teamTask: IssueRow;
      if (dto.teamTaskIssueId) {
        const selected = activeTasks.find(({ id }) => id === dto.teamTaskIssueId);
        if (!selected || selected.assigneeTeamMember) {
          assignmentConflict('팀 작업을 더 이상 맡을 수 없습니다.', {
            candidates: activeTasks
              .filter(({ assigneeTeamMember }) => assigneeTeamMember === null)
              .map((task) => toSummaryResponse(task)),
          });
        }
        teamTask = selected;
      } else {
        const candidates = activeTasks.filter(
          ({ assigneeTeamMember }) => assigneeTeamMember === null,
        );
        if (candidates.length > 1) {
          throw new ApiError({
            code: 'CLAIM_TARGET_REQUIRED',
            details: { candidates: candidates.map((task) => toSummaryResponse(task)) },
            message: '맡을 팀 작업을 선택해 주세요.',
            status: HttpStatus.CONFLICT,
          });
        }
        if (candidates[0]) {
          teamTask = candidates[0];
        } else if (activeTasks.length > 0) {
          assignmentConflict('해당 역할의 팀 작업에 이미 담당자가 있습니다.');
        } else {
          const [created] = await this.createAutomaticTeamTasks(transaction, context, feature, [
            { ...roleAssignment, assigneeMembershipId: context.membershipId },
          ]);
          if (!created) {
            throw new Error('CLAIMED_TEAM_TASK_INVARIANT_VIOLATION');
          }
          teamTask = created;
        }
      }

      if (teamTask.assigneeTeamMember === null) {
        const assignee = await this.lockMemberships(
          transaction,
          context.workspaceId,
          roleAssignment.teamId,
          context.membershipId,
          context.membershipId,
        );
        if (!assignee) {
          throw new Error('CLAIM_MEMBERSHIP_INVARIANT_VIOLATION');
        }
        teamTask = await this.assignExistingTeamTask(transaction, context, teamTask, assignee);
      }

      await this.touchParentFeature(transaction, context.workspaceId, issueId);
      const parent = await this.findIssue(transaction, context.workspaceId, issueId);
      const currentUserTeamRoles = await this.currentUserProjectRoles(
        transaction,
        context.workspaceId,
        feature.projectId,
        context.membershipId,
      );
      const parentSummary = toSummaryResponse(parent, context.membershipId, currentUserTeamRoles);
      if (!parentSummary.workflowSummary) {
        throw new Error('FEATURE_WORKFLOW_SUMMARY_INVARIANT_VIOLATION');
      }
      await notifyResourceChanged(transaction, {
        changeType: 'UPDATED',
        resourceId: issueId,
        resourceType: 'ISSUE',
        version: parent.version,
        workspaceId: context.workspaceId,
      });
      return {
        issue: parentSummary,
        teamTask: toSummaryResponse(teamTask),
        workflowSummary: parentSummary.workflowSummary,
      };
    });
  }

  async assignTeamTasks(
    context: { membershipId: string; userId: string; workspaceId: string },
    issueId: string,
    dto: AssignTeamTasksDto,
  ): Promise<AssignTeamTasksResponseDto> {
    return this.database.client.$transaction(async (transaction) => {
      await this.lockWorkspace(transaction, context.workspaceId);
      await this.lockActorMembership(transaction, context.workspaceId, context.membershipId);
      const [feature] = await transaction.$queryRaw<FeatureStartLockRow[]>`
        SELECT "id", "type", "title", "priority", "project_id" AS "projectId"
        FROM "issues"
        WHERE "workspace_id" = ${context.workspaceId}::uuid
          AND "id" = ${issueId}::uuid
          AND "deleted_at" IS NULL
        FOR UPDATE
      `;
      if (!feature || feature.type !== IssueType.FEATURE) {
        return resourceNotFound();
      }
      await this.lockActiveProject(transaction, context.workspaceId, feature.projectId);
      const projectRoleTeams = await this.lockProjectRoleAssignments(
        transaction,
        context.workspaceId,
        feature.projectId,
      );
      const assignments = [...dto.assignments].sort((left, right) =>
        left.teamTaskIssueId.localeCompare(right.teamTaskIssueId),
      );
      await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "issues"
        WHERE "workspace_id" = ${context.workspaceId}::uuid
          AND "id" IN (${Prisma.join(
            assignments.map(({ teamTaskIssueId }) => Prisma.sql`${teamTaskIssueId}::uuid`),
          )})
        ORDER BY "id"
        FOR UPDATE
      `);
      const tasks = await transaction.issue.findMany({
        orderBy: { id: 'asc' },
        select: ISSUE_SELECT,
        where: {
          deletedAt: null,
          id: { in: assignments.map(({ teamTaskIssueId }) => teamTaskIssueId) },
          workspaceId: context.workspaceId,
        },
      });
      const taskById = new Map(tasks.map((task) => [task.id, task]));
      const roleTeamByRole = new Map(projectRoleTeams.map(({ role, teamId }) => [role, teamId]));
      for (const assignment of assignments) {
        const task = taskById.get(assignment.teamTaskIssueId);
        if (
          !task ||
          task.type !== IssueType.TEAM_TASK ||
          task.parentIssue?.id !== issueId ||
          task.project?.id !== feature.projectId ||
          !task.projectRole ||
          !task.team ||
          roleTeamByRole.get(task.projectRole) !== task.team.id ||
          !task.workflowState ||
          isTerminalCategory(task.workflowState.category)
        ) {
          assignmentConflict('담당자를 지정할 수 없는 팀 작업이 포함됐습니다.', {
            ...(await this.teamTaskAssignmentConflictDetails(
              transaction,
              context.workspaceId,
              assignments,
              tasks,
            )),
          });
        }
        if (task.version !== assignment.version) {
          throw new ApiError({
            code: 'ISSUE_VERSION_CONFLICT',
            currentVersion: task.version,
            details: {
              staleTeamTaskIssueId: task.id,
              ...(await this.teamTaskAssignmentConflictDetails(
                transaction,
                context.workspaceId,
                assignments,
                tasks,
              )),
            },
            message: '이슈가 다른 요청에서 변경되었습니다.',
            status: HttpStatus.CONFLICT,
          });
        }
        if (task.assigneeTeamMember) {
          assignmentConflict('팀 작업의 담당자가 이미 변경됐습니다.', {
            ...(await this.teamTaskAssignmentConflictDetails(
              transaction,
              context.workspaceId,
              assignments,
              tasks,
            )),
          });
        }
      }

      const assignees = new Map<string, MembershipLockRow>();
      for (const teamId of new Set(tasks.flatMap(({ team }) => (team ? [team.id] : [])))) {
        await this.lockActiveTeam(transaction, context.workspaceId, teamId);
      }
      for (const assignment of assignments) {
        const task = taskById.get(assignment.teamTaskIssueId)!;
        const assignee = await this.lockMemberships(
          transaction,
          context.workspaceId,
          task.team!.id,
          context.membershipId,
          assignment.assigneeMembershipId,
        );
        if (!assignee) {
          throw new Error('ASSIGNEE_MEMBERSHIP_INVARIANT_VIOLATION');
        }
        assignees.set(task.id, assignee);
      }
      const updatedTasks: IssueRow[] = [];
      for (const assignment of assignments) {
        updatedTasks.push(
          await this.assignExistingTeamTask(
            transaction,
            context,
            taskById.get(assignment.teamTaskIssueId)!,
            assignees.get(assignment.teamTaskIssueId)!,
          ),
        );
      }

      await this.touchParentFeature(transaction, context.workspaceId, issueId);
      const parent = await this.findIssue(transaction, context.workspaceId, issueId);
      const parentSummary = toSummaryResponse(
        parent,
        context.membershipId,
        await this.currentUserProjectRoles(
          transaction,
          context.workspaceId,
          feature.projectId,
          context.membershipId,
        ),
      );
      if (!parentSummary.workflowSummary) {
        throw new Error('FEATURE_WORKFLOW_SUMMARY_INVARIANT_VIOLATION');
      }
      await notifyResourceChanged(transaction, {
        changeType: 'UPDATED',
        resourceId: issueId,
        resourceType: 'ISSUE',
        version: parent.version,
        workspaceId: context.workspaceId,
      });
      return {
        issue: parentSummary,
        teamTasks: updatedTasks.map((task) => toSummaryResponse(task)),
        workflowSummary: parentSummary.workflowSummary,
      };
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
    return { ...toDetailResponse(issue), ...(await this.issueWorkflowContext(workspaceId, issue)) };
  }

  private async issueWorkflowContext(
    workspaceId: string,
    issue: IssueRow,
  ): Promise<{
    handoffFlows: IssueHandoffFlowResponseDto[];
    workflowRelations: IssueWorkflowRelationResponseDto[];
  }> {
    const parentIssueId =
      issue.type === IssueType.FEATURE
        ? issue.id
        : issue.type === IssueType.TEAM_TASK &&
            issue.projectRole !== null &&
            FRONTEND_PROJECT_ROLES.includes(
              issue.projectRole as (typeof FRONTEND_PROJECT_ROLES)[number],
            )
          ? (issue.parentIssue?.id ?? null)
          : null;
    if (!parentIssueId) return { handoffFlows: [], workflowRelations: [] };

    const [sources, relationRows] = await Promise.all([
      this.database.client.issue.findMany({
        orderBy: [{ identifier: 'asc' }, { id: 'asc' }],
        select: {
          blockingRelations: {
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: { blockedIssueId: true },
            where: {
              blockedIssue: {
                deletedAt: null,
                parentIssueId,
                projectRole: { in: [...FRONTEND_PROJECT_ROLES] },
                type: IssueType.TEAM_TASK,
              },
            },
          },
          featureStatus: true,
          handoffs: {
            orderBy: [{ sequenceNumber: 'asc' }, { id: 'asc' }],
            select: {
              authorMembership: {
                select: {
                  id: true,
                  role: true,
                  status: true,
                  user: { select: { avatarFileId: true, displayName: true, id: true } },
                },
              },
              bodyMarkdown: true,
              createdAt: true,
              id: true,
              kind: true,
              sequenceNumber: true,
            },
          },
          id: true,
          identifier: true,
          projectRole: true,
          title: true,
          workflowState: { select: { category: true } },
        },
        where: {
          deletedAt: null,
          handoffs: { some: {} },
          parentIssueId,
          projectRole: ProjectRole.BACKEND,
          type: IssueType.TEAM_TASK,
          workspaceId,
        },
      }),
      issue.type === IssueType.FEATURE
        ? this.database.client.issueBlockRelation.findMany({
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: {
              blockedIssueId: true,
              blockingIssue: { select: { workflowState: { select: { category: true } } } },
              blockingIssueId: true,
              createdAt: true,
              id: true,
            },
            where: {
              blockedIssue: {
                deletedAt: null,
                parentIssueId,
                type: IssueType.TEAM_TASK,
              },
              blockingIssue: {
                deletedAt: null,
                parentIssueId,
                type: IssueType.TEAM_TASK,
              },
              workspaceId,
            },
          })
        : Promise.resolve([]),
    ]);
    const workflowRelations = relationRows.map((relation) => ({
      blockedIssueId: relation.blockedIssueId,
      blockingIssueId: relation.blockingIssueId,
      createdAt: relation.createdAt.toISOString(),
      id: relation.id,
      resolved:
        relation.blockingIssue.workflowState !== null &&
        isTerminalCategory(relation.blockingIssue.workflowState.category),
    }));
    if (sources.length === 0) return { handoffFlows: [], workflowRelations };

    const sourceIds = sources.map(({ id }) => id);
    const downstreamIdsBySource = new Map(
      sources.map((source) => [
        source.id,
        new Set(source.blockingRelations.map(({ blockedIssueId }) => blockedIssueId)),
      ]),
    );
    const [parentDeliveries, handoffActivities] = await Promise.all([
      this.database.client.activityEvent.findMany({
        select: { afterData: true },
        where: { eventType: 'BACKEND_WORK_DELIVERED', issueId: parentIssueId, workspaceId },
      }),
      this.database.client.activityEvent.findMany({
        select: { afterData: true, issueId: true },
        where: { eventType: API_HANDOFF_CREATED, issueId: { in: sourceIds }, workspaceId },
      }),
    ]);
    for (const delivery of parentDeliveries) {
      const after = jsonRecord(delivery.afterData);
      const backendIssue = jsonRecord(after?.backendIssue ?? null);
      const sourceId = typeof backendIssue?.id === 'string' ? backendIssue.id : null;
      const destinationIds = Array.isArray(after?.downstreamIssues)
        ? after.downstreamIssues.flatMap((value) => {
            const downstreamIssue = jsonRecord(value);
            return typeof downstreamIssue?.id === 'string' ? [downstreamIssue.id] : [];
          })
        : [];
      const target = sourceId ? downstreamIdsBySource.get(sourceId) : undefined;
      if (target) destinationIds.forEach((id) => target.add(id));
    }
    for (const activity of handoffActivities) {
      if (!activity.issueId) continue;
      const after = jsonRecord(activity.afterData);
      const target = downstreamIdsBySource.get(activity.issueId);
      if (target) jsonStringArray(after?.downstreamIssueIds).forEach((id) => target.add(id));
    }

    const legacySources = sources.filter(
      ({ id }) => (downstreamIdsBySource.get(id)?.size ?? 0) === 0,
    );
    if (legacySources.length > 0) {
      const legacyDownstreamIssues = await this.database.client.issue.findMany({
        orderBy: [{ projectRole: 'asc' }, { identifier: 'asc' }, { id: 'asc' }],
        select: { id: true },
        where: {
          deletedAt: null,
          parentIssueId,
          projectRole: { in: [...FRONTEND_PROJECT_ROLES] },
          type: IssueType.TEAM_TASK,
          workspaceId,
        },
      });
      for (const source of legacySources) {
        const target = downstreamIdsBySource.get(source.id);
        if (target) legacyDownstreamIssues.forEach(({ id }) => target.add(id));
      }
    }

    const downstreamIds = [
      ...new Set([...downstreamIdsBySource.values()].flatMap((ids) => [...ids])),
    ];
    const downstreamIssues =
      downstreamIds.length === 0
        ? []
        : await this.database.client.issue.findMany({
            orderBy: [{ projectRole: 'asc' }, { identifier: 'asc' }, { id: 'asc' }],
            select: {
              featureStatus: true,
              id: true,
              identifier: true,
              projectRole: true,
              title: true,
              workflowState: { select: { category: true } },
            },
            where: {
              deletedAt: null,
              id: { in: downstreamIds },
              parentIssueId,
              projectRole: { in: [...FRONTEND_PROJECT_ROLES] },
              type: IssueType.TEAM_TASK,
              workspaceId,
            },
          });
    const downstreamById = new Map(
      downstreamIssues.map((downstream) => [downstream.id, downstream]),
    );
    const handoffFlows = sources.flatMap((source): IssueHandoffFlowResponseDto[] => {
      const sourceDownstreamIds = downstreamIdsBySource.get(source.id) ?? new Set<string>();
      if (issue.type === IssueType.TEAM_TASK && !sourceDownstreamIds.has(issue.id)) return [];
      return [
        {
          downstreamIssues: [...sourceDownstreamIds].flatMap((id) => {
            const downstream = downstreamById.get(id);
            return downstream ? [toRelationIssueResponse(downstream)] : [];
          }),
          handoffs: source.handoffs.map((handoff) => ({
            author: toMemberResponse(handoff.authorMembership),
            bodyMarkdown: handoff.bodyMarkdown,
            changeSummary: handoffChangeSummary(handoff.bodyMarkdown),
            createdAt: handoff.createdAt.toISOString(),
            id: handoff.id,
            kind: handoff.kind,
            sequenceNumber: handoff.sequenceNumber,
          })),
          sourceIssue: toRelationIssueResponse(source),
        },
      ];
    });
    return { handoffFlows, workflowRelations };
  }

  async update(
    context: { membershipId: string; userId: string; workspaceId: string },
    issueId: string,
    dto: UpdateIssueDto,
  ): Promise<UpdateIssueResponseDto> {
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
      if (dto.requireCompletedTeamTasks === true && dto.featureStatus !== FeatureIssueStatus.DONE) {
        issueTypeFieldInvalid('팀 작업 완료 확인은 이슈 완료 상태 변경에만 사용할 수 있습니다.');
      }
      return this.updateFeatureIssue(context, issueId, dto);
    }

    if (dto.featureStatus !== undefined || dto.requireCompletedTeamTasks !== undefined) {
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
      // workspace -> project/role(s) -> parent -> team -> state -> membership -> labels -> issue.
      // The parent FOR UPDATE lock also serializes downstream inspection and creation across
      // every backend task and manual child creation for the same feature.
      await this.lockWorkspace(transaction, context.workspaceId);
      let lockedProjectRoleAssignments: ProjectRoleTeamLockRow[] | undefined;
      if (targetProjectId && targetProjectRole) {
        await this.lockProjectRoleTeam(
          transaction,
          context.workspaceId,
          targetProjectId,
          targetProjectRole,
          teamId,
        );
      }
      if (
        preliminary.parentIssueId &&
        preliminary.projectId &&
        preliminary.projectRole === ProjectRole.BACKEND
      ) {
        lockedProjectRoleAssignments = await this.lockProjectRoleAssignments(
          transaction,
          context.workspaceId,
          preliminary.projectId,
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
          "identifier",
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
        return dto.handoff ||
          (current.projectRole === ProjectRole.BACKEND &&
            requestedState?.category === StateCategory.COMPLETED)
          ? issueVersionConflict(current.version)
          : versionConflict(current.version);
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
      let automatedCompletion: AutomatedHandoffCompletionResult | null = null;
      if (dto.handoff && !completesIssue) {
        throw new ApiError({
          code: 'HANDOFF_REQUIRES_COMPLETION',
          message: '상태 완료와 최초 작업 전달은 같은 요청에서 처리해야 합니다.',
          status: HttpStatus.UNPROCESSABLE_ENTITY,
        });
      }
      if (completesIssue) {
        automatedCompletion = await this.prepareInitialHandoffForCompletion(
          transaction,
          context,
          current,
          dto.handoff,
          lockedProjectRoleAssignments,
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
      const response = toDetailResponse(updated);
      if (!automatedCompletion) {
        return response;
      }

      const downstreamTeamTasks: IssueSummaryResponseDto[] = [];
      for (const downstreamIssueId of automatedCompletion.downstreamIssueIds) {
        downstreamTeamTasks.push(
          toSummaryResponse(
            await this.findIssue(transaction, context.workspaceId, downstreamIssueId),
          ),
        );
      }
      const updatedParent = await this.findIssue(
        transaction,
        context.workspaceId,
        automatedCompletion.parentIssueId,
      );
      await notifyResourceChanged(transaction, {
        changeType: 'UPDATED',
        resourceId: automatedCompletion.parentIssueId,
        resourceType: 'ISSUE',
        version: updatedParent.version,
        workspaceId: context.workspaceId,
      });
      const updatedParentIssue = toSummaryResponse(updatedParent);

      return {
        ...response,
        blockRelations: automatedCompletion.blockRelations,
        downstreamTeamTasks,
        handoff: automatedCompletion.handoff,
        updatedParentIssue,
      };
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
          "identifier",
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

      if (dto.requireCompletedTeamTasks === true) {
        const teamTasks = await transaction.issue.findMany({
          select: { workflowState: { select: { category: true } } },
          where: {
            deletedAt: null,
            parentIssueId: issueId,
            type: IssueType.TEAM_TASK,
            workspaceId: context.workspaceId,
          },
        });
        const targetTasks = teamTasks.filter(
          ({ workflowState }) => workflowState?.category !== StateCategory.CANCELED,
        );
        const completedCount = targetTasks.filter(
          ({ workflowState }) => workflowState?.category === StateCategory.COMPLETED,
        ).length;
        if (targetTasks.length === 0 || completedCount !== targetTasks.length) {
          conflict(
            'ISSUE_COMPLETION_NOT_READY',
            '완료되지 않은 팀 작업이 있어 이슈를 완료할 수 없습니다.',
            {
              completedCount,
              targetTaskCount: targetTasks.length,
            },
          );
        }
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

  private selectedRoleAssignments(
    assignments: ProjectRoleTeamLockRow[],
    roles: ProjectRole[],
  ): ProjectRoleTeamLockRow[] {
    const selected = new Set(roles);
    if (
      selected.size !== roles.length ||
      roles.some((role) => !Object.values(ProjectRole).includes(role))
    ) {
      unprocessable('INITIAL_ROLE_NOT_AVAILABLE', '선택한 역할로 작업을 시작할 수 없습니다.');
    }
    const available = assignments.filter(({ role }) => selected.has(role));
    if (available.length !== selected.size) {
      unprocessable('INITIAL_ROLE_NOT_AVAILABLE', '프로젝트에 설정된 역할만 선택할 수 있습니다.');
    }
    return available;
  }

  private async lockProjectRoleAssignments(
    transaction: Transaction,
    workspaceId: string,
    projectId: string,
  ): Promise<ProjectRoleTeamLockRow[]> {
    const assignments = await transaction.$queryRaw<ProjectRoleTeamLockRow[]>`
      SELECT "role", "team_id" AS "teamId"
      FROM "project_role_teams"
      WHERE "workspace_id" = ${workspaceId}::uuid
        AND "project_id" = ${projectId}::uuid
      ORDER BY "role"
      FOR UPDATE
    `;
    if (assignments.length === 0) {
      return resourceNotFound('프로젝트 역할 설정을 찾을 수 없습니다.');
    }
    return assignments;
  }

  private async createAutomaticTeamTasks(
    transaction: Transaction,
    context: { membershipId: string; workspaceId: string },
    parent: { id: string; priority: IssuePriority; projectId: string; title: string },
    assignments: AutomaticTeamTaskAssignment[],
  ): Promise<IssueRow[]> {
    const created: IssueRow[] = [];
    for (const assignment of assignments) {
      const team = await this.lockActiveTeam(transaction, context.workspaceId, assignment.teamId);
      const workflowState = await this.lockWorkflowState(
        transaction,
        context.workspaceId,
        team.id,
        undefined,
      );
      if (assignment.assigneeMembershipId) {
        await this.lockMemberships(
          transaction,
          context.workspaceId,
          team.id,
          context.membershipId,
          assignment.assigneeMembershipId,
        );
      }
      await transaction.team.update({
        data: { nextIssueNumber: { increment: 1 } },
        where: { id: team.id },
      });
      const identifier = `${team.key}-${team.nextIssueNumber}`;
      const issue = await transaction.issue.create({
        data: {
          assigneeMembershipId: assignment.assigneeMembershipId ?? null,
          createdByMembershipId: context.membershipId,
          descriptionMarkdown: null,
          identifier,
          parentIssueId: parent.id,
          priority: parent.priority,
          projectId: parent.projectId,
          projectRole: assignment.role,
          sequenceNumber: team.nextIssueNumber,
          teamId: team.id,
          title: parent.title,
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
        identifier,
        parent.title,
        [],
        assignment.assigneeMembershipId ?? null,
        [],
      );
      const row = await this.findIssue(transaction, context.workspaceId, issue.id);
      await notifyResourceChanged(transaction, {
        changeType: 'CREATED',
        eventId: changeEventId,
        resourceId: issue.id,
        resourceType: 'ISSUE',
        version: row.version,
        workspaceId: context.workspaceId,
      });
      created.push(row);
    }
    return created;
  }

  private async assignExistingTeamTask(
    transaction: Transaction,
    context: { membershipId: string; workspaceId: string },
    current: IssueRow,
    assignee: MembershipLockRow,
  ): Promise<IssueRow> {
    const changed = await transaction.issue.updateMany({
      data: { assigneeMembershipId: assignee.id, version: { increment: 1 } },
      where: {
        assigneeMembershipId: null,
        deletedAt: null,
        id: current.id,
        version: current.version,
        workspaceId: context.workspaceId,
      },
    });
    if (changed.count !== 1) {
      assignmentConflict('팀 작업의 담당자가 이미 변경됐습니다.');
    }
    await transaction.activityEvent.create({
      data: this.activity(context, current.id, 'assigneeMembershipId', null, {
        displayName: assignee.displayName,
        id: assignee.id,
      }),
    });
    await transaction.issueSubscription.createMany({
      data: [{ issueId: current.id, membershipId: assignee.id, workspaceId: context.workspaceId }],
      skipDuplicates: true,
    });
    const eventId = await this.createIssueChangedOutbox(transaction, context, current.id, {
      assigneeMembershipId: assignee.id,
      changedFields: ['ASSIGNEE'],
      mentionedMembershipIds: [],
      terminalCategory: null,
    });
    const updated = await this.findIssue(transaction, context.workspaceId, current.id);
    await notifyResourceChanged(transaction, {
      changeType: 'UPDATED',
      eventId,
      resourceId: current.id,
      resourceType: 'ISSUE',
      version: updated.version,
      workspaceId: context.workspaceId,
    });
    return updated;
  }

  private async touchParentFeature(
    transaction: Transaction,
    workspaceId: string,
    issueId: string,
  ): Promise<void> {
    const updated = await transaction.issue.updateMany({
      data: { version: { increment: 1 } },
      where: {
        deletedAt: null,
        id: issueId,
        type: IssueType.FEATURE,
        workspaceId,
      },
    });
    if (updated.count !== 1) {
      return resourceNotFound();
    }
  }

  private async currentUserProjectRoles(
    transaction: Transaction,
    workspaceId: string,
    projectId: string,
    membershipId: string,
  ): Promise<ProjectRole[]> {
    const assignments = await transaction.projectRoleTeam.findMany({
      orderBy: { role: 'asc' },
      select: { role: true },
      where: {
        project: { archivedAt: null, deletedAt: null },
        projectId,
        team: {
          archivedAt: null,
          teamMembers: {
            some: {
              membership: { status: MembershipStatus.ACTIVE },
              membershipId,
              removedAt: null,
            },
          },
        },
        workspaceId,
      },
    });
    return assignments.map(({ role }) => role);
  }

  private async teamTaskAssignmentConflictDetails(
    transaction: Transaction,
    workspaceId: string,
    assignments: AssignTeamTasksDto['assignments'],
    tasks: IssueRow[],
  ): Promise<Record<string, unknown>> {
    const teamIds = [...new Set(tasks.flatMap(({ team }) => (team ? [team.id] : [])))].sort();
    const teamMembers =
      teamIds.length === 0
        ? []
        : await transaction.teamMember.findMany({
            orderBy: [{ teamId: 'asc' }, { membershipId: 'asc' }],
            select: {
              membership: {
                select: {
                  id: true,
                  role: true,
                  status: true,
                  user: { select: { avatarFileId: true, displayName: true, id: true } },
                },
              },
              teamId: true,
            },
            where: {
              membership: { status: MembershipStatus.ACTIVE },
              removedAt: null,
              team: { archivedAt: null },
              teamId: { in: teamIds },
              workspaceId,
            },
          });

    return {
      candidates: teamIds.map((teamId) => ({
        members: teamMembers
          .filter((teamMember) => teamMember.teamId === teamId)
          .map(({ membership }) => toMemberResponse(membership)),
        teamId,
      })),
      requestedAssignments: assignments,
      teamTasks: tasks.map((task) => toSummaryResponse(task)),
    };
  }

  private async prepareInitialHandoffForCompletion(
    transaction: Transaction,
    context: { membershipId: string; userId: string; workspaceId: string },
    issue: IssueLockRow,
    handoff?: { bodyMarkdown: string; destinationRoles?: ProjectRole[] },
    lockedProjectRoleAssignments?: ProjectRoleTeamLockRow[],
  ): Promise<AutomatedHandoffCompletionResult | null> {
    const handoffBody = handoff ? { bodyMarkdown: handoff.bodyMarkdown } : undefined;
    if (
      issue.type !== IssueType.TEAM_TASK ||
      issue.projectRole !== ProjectRole.BACKEND ||
      !issue.projectId ||
      !issue.parentIssueId
    ) {
      await this.collaboration.ensureInitialHandoffForCompletion(
        transaction,
        context,
        issue.id,
        handoffBody,
      );
      return null;
    }

    const assignments =
      lockedProjectRoleAssignments ??
      (await this.lockProjectRoleAssignments(transaction, context.workspaceId, issue.projectId));
    const frontendAssignments = assignments.filter(({ role }) =>
      FRONTEND_PROJECT_ROLES.includes(role as (typeof FRONTEND_PROJECT_ROLES)[number]),
    );
    const initial = await transaction.apiHandoff.findFirst({
      select: { id: true },
      where: {
        issueId: issue.id,
        kind: HandoffKind.INITIAL,
        workspaceId: context.workspaceId,
      },
    });
    if (initial) {
      await this.collaboration.ensureInitialHandoffForCompletion(
        transaction,
        context,
        issue.id,
        handoffBody,
      );
      return null;
    }

    if (frontendAssignments.length === 0) {
      if ((handoff?.destinationRoles?.length ?? 0) > 0) {
        unprocessable(
          'PROJECT_FRONTEND_ROLE_REQUIRED',
          '프로젝트에 설정된 프론트엔드 역할만 전달 대상으로 선택할 수 있습니다.',
        );
      }
      await this.collaboration.ensureInitialHandoffForCompletion(
        transaction,
        context,
        issue.id,
        handoffBody,
      );
      return null;
    }

    if (!handoff) {
      conflict('HANDOFF_REQUIRED', '후행 프론트 작업을 위해 최초 작업 전달이 필요합니다.');
    }
    const destinationRoles = [...new Set(handoff.destinationRoles ?? [])];
    if (destinationRoles.length === 0) {
      unprocessable(
        'HANDOFF_DESTINATION_REQUIRED',
        '최초 작업 전달에는 하나 이상의 프론트엔드 역할이 필요합니다.',
      );
    }
    if (
      destinationRoles.some(
        (role) =>
          !FRONTEND_PROJECT_ROLES.includes(role as (typeof FRONTEND_PROJECT_ROLES)[number]) ||
          !frontendAssignments.some((assignment) => assignment.role === role),
      )
    ) {
      unprocessable(
        'PROJECT_FRONTEND_ROLE_REQUIRED',
        '프로젝트에 설정된 프론트엔드 역할만 전달 대상으로 선택할 수 있습니다.',
      );
    }
    const selectedAssignments = frontendAssignments.filter(({ role }) =>
      destinationRoles.includes(role),
    );
    const parent = await this.findIssue(transaction, context.workspaceId, issue.parentIssueId);
    const existingTasks = await transaction.issue.findMany({
      orderBy: [{ projectRole: 'asc' }, { identifier: 'asc' }, { id: 'asc' }],
      select: {
        assigneeMembershipId: true,
        id: true,
        identifier: true,
        projectId: true,
        projectRole: true,
        subscriptions: {
          orderBy: { membershipId: 'asc' },
          select: { membershipId: true },
        },
        teamId: true,
        title: true,
        workflowState: { select: { category: true } },
      },
      where: {
        deletedAt: null,
        parentIssueId: issue.parentIssueId,
        projectRole: { in: destinationRoles },
        type: IssueType.TEAM_TASK,
        workspaceId: context.workspaceId,
      },
    });

    const reusableByRole = new Map<ProjectRole, typeof existingTasks>();
    const missingAssignments: ProjectRoleTeamLockRow[] = [];
    for (const assignment of selectedAssignments) {
      const roleTasks = existingTasks.filter(({ projectRole }) => projectRole === assignment.role);
      const scopeConflicts = roleTasks.filter(
        ({ projectId, teamId }) => projectId !== issue.projectId || teamId !== assignment.teamId,
      );
      if (scopeConflicts.length > 0) {
        conflict(
          'DOWNSTREAM_TASK_SCOPE_CONFLICT',
          '기존 후행 작업의 프로젝트 역할과 팀 설정이 일치하지 않습니다.',
          {
            issues: scopeConflicts.map(({ id, identifier, projectRole, teamId, title }) => ({
              id,
              identifier,
              projectRole,
              teamId,
              title,
            })),
          },
        );
      }
      const reusable = roleTasks.filter(
        ({ workflowState }) => workflowState && !isTerminalCategory(workflowState.category),
      );
      if (roleTasks.length > 0 && reusable.length === 0) {
        conflict(
          'DOWNSTREAM_TASK_ALREADY_CLOSED',
          '선택한 역할에 완료 또는 취소된 후행 작업만 있습니다.',
          {
            issues: roleTasks.map(
              ({ id, identifier, projectRole, teamId, title, workflowState }) => ({
                category: workflowState?.category ?? null,
                id,
                identifier,
                projectRole,
                teamId,
                title,
              }),
            ),
          },
        );
      }
      if (reusable.length > 0) {
        reusableByRole.set(assignment.role, reusable);
      } else {
        missingAssignments.push(assignment);
      }
    }

    const createdTasks = await this.createAutomaticTeamTasks(
      transaction,
      context,
      {
        id: parent.id,
        priority: parent.priority,
        projectId: issue.projectId,
        title: parent.title,
      },
      missingAssignments,
    );
    const createdByRole = new Map<ProjectRole, IssueRow>();
    for (const createdTask of createdTasks) {
      if (createdTask.projectRole) createdByRole.set(createdTask.projectRole, createdTask);
    }
    const downstreamIssueIds = selectedAssignments.flatMap(({ role }) => {
      const reusable = reusableByRole.get(role);
      if (reusable) return reusable.map(({ id }) => id);
      const createdTask = createdByRole.get(role);
      return createdTask ? [createdTask.id] : [];
    });
    const createdIssueIds = new Set(createdTasks.map(({ id }) => id));

    const existingRelations = await transaction.issueBlockRelation.findMany({
      select: {
        blockedIssueId: true,
        blockingIssueId: true,
        createdAt: true,
        id: true,
      },
      where: {
        blockedIssueId: { in: downstreamIssueIds },
        blockingIssueId: issue.id,
        workspaceId: context.workspaceId,
      },
    });
    const relationByBlockedIssueId = new Map(
      existingRelations.map((relation) => [relation.blockedIssueId, relation]),
    );
    const createdRelations: typeof existingRelations = [];
    for (const blockedIssueId of downstreamIssueIds) {
      if (relationByBlockedIssueId.has(blockedIssueId) || !createdIssueIds.has(blockedIssueId)) {
        continue;
      }
      const relation = await transaction.issueBlockRelation.create({
        data: {
          blockedIssueId,
          blockingIssueId: issue.id,
          createdByMembershipId: context.membershipId,
          workspaceId: context.workspaceId,
        },
        select: {
          blockedIssueId: true,
          blockingIssueId: true,
          createdAt: true,
          id: true,
        },
      });
      relationByBlockedIssueId.set(blockedIssueId, relation);
      createdRelations.push(relation);
    }
    if (createdRelations.length > 0) {
      await transaction.activityEvent.createMany({
        data: createdRelations.flatMap((relation) => [
          {
            actorMembershipId: context.membershipId,
            afterData: {
              direction: 'BLOCKING',
              issueId: relation.blockedIssueId,
              relationId: relation.id,
            },
            beforeData: Prisma.JsonNull,
            eventType: 'ISSUE_BLOCK_RELATION_ADDED',
            fieldName: 'blockRelations',
            issueId: issue.id,
            workspaceId: context.workspaceId,
          },
          {
            actorMembershipId: context.membershipId,
            afterData: {
              direction: 'BLOCKED_BY',
              issueId: issue.id,
              relationId: relation.id,
            },
            beforeData: Prisma.JsonNull,
            eventType: 'ISSUE_BLOCK_RELATION_ADDED',
            fieldName: 'blockRelations',
            issueId: relation.blockedIssueId,
            workspaceId: context.workspaceId,
          },
        ]),
      });
    }
    for (const relation of createdRelations) {
      if (createdIssueIds.has(relation.blockedIssueId)) continue;
      const updated = await transaction.issue.update({
        data: { version: { increment: 1 } },
        select: { id: true, version: true },
        where: { id: relation.blockedIssueId },
      });
      await notifyResourceChanged(transaction, {
        changeType: 'UPDATED',
        resourceId: updated.id,
        resourceType: 'ISSUE',
        version: updated.version,
        workspaceId: context.workspaceId,
      });
    }

    const recipientIssues = await transaction.issue.findMany({
      select: {
        assigneeMembershipId: true,
        id: true,
        identifier: true,
        projectRole: true,
        subscriptions: { select: { membershipId: true } },
        teamId: true,
        title: true,
      },
      where: { id: { in: downstreamIssueIds }, workspaceId: context.workspaceId },
    });
    const newTeamIds = [
      ...new Set(
        recipientIssues
          .filter(({ id }) => createdIssueIds.has(id))
          .flatMap(({ teamId }) => (teamId ? [teamId] : [])),
      ),
    ];
    const activeNewTeamMembers =
      newTeamIds.length === 0
        ? []
        : await transaction.teamMember.findMany({
            select: { membershipId: true },
            where: {
              membership: { status: MembershipStatus.ACTIVE },
              removedAt: null,
              teamId: { in: newTeamIds },
              workspaceId: context.workspaceId,
            },
          });
    const candidateRecipientMembershipIds = [
      ...new Set([
        ...activeNewTeamMembers.map(({ membershipId }) => membershipId),
        ...recipientIssues
          .filter(({ id }) => !createdIssueIds.has(id))
          .flatMap(({ assigneeMembershipId, subscriptions }) => [
            ...(assigneeMembershipId ? [assigneeMembershipId] : []),
            ...subscriptions.map(({ membershipId }) => membershipId),
          ]),
      ]),
    ]
      .filter((membershipId) => membershipId !== context.membershipId)
      .sort();
    const createdHandoff = await this.collaboration.createHandoffInTransaction(
      transaction,
      context,
      issue.id,
      { bodyMarkdown: handoff.bodyMarkdown, kind: HandoffKind.INITIAL },
      {
        allowManagedInitial: true,
        notificationSnapshot: { candidateRecipientMembershipIds, downstreamIssueIds },
      },
    );
    const recipientIssueById = new Map(recipientIssues.map((item) => [item.id, item]));
    const relationIds = downstreamIssueIds.flatMap((downstreamIssueId) => {
      const relation = relationByBlockedIssueId.get(downstreamIssueId);
      return relation ? [relation.id] : [];
    });
    await transaction.activityEvent.create({
      data: {
        actorMembershipId: context.membershipId,
        afterData: {
          backendIssue: {
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
          },
          downstreamIssues: downstreamIssueIds.map((downstreamIssueId) => {
            const downstreamIssue = recipientIssueById.get(downstreamIssueId);
            if (!downstreamIssue?.projectRole) {
              throw new Error('DOWNSTREAM_ISSUE_INVARIANT_VIOLATION');
            }
            return {
              id: downstreamIssue.id,
              identifier: downstreamIssue.identifier,
              role: downstreamIssue.projectRole,
              title: downstreamIssue.title,
            };
          }),
          handoffId: createdHandoff.id,
          relationIds,
        },
        beforeData: Prisma.JsonNull,
        eventType: 'BACKEND_WORK_DELIVERED',
        issueId: parent.id,
        workspaceId: context.workspaceId,
      },
    });

    return {
      blockRelations: downstreamIssueIds.flatMap((blockedIssueId) => {
        const relation = relationByBlockedIssueId.get(blockedIssueId);
        return relation
          ? [
              {
                blockedIssueId: relation.blockedIssueId,
                blockingIssueId: relation.blockingIssueId,
                createdAt: relation.createdAt.toISOString(),
                id: relation.id,
                resolved: true,
              },
            ]
          : [];
      }),
      downstreamIssueIds,
      handoff: createdHandoff,
      parentIssueId: parent.id,
    };
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

  private async lockActiveTeamMembership(
    transaction: Transaction,
    workspaceId: string,
    teamId: string,
    membershipId: string,
  ): Promise<void> {
    const [membership] = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "membership"."id"
      FROM "workspace_memberships" AS "membership"
      INNER JOIN "team_members" AS "team_member"
        ON "team_member"."workspace_id" = "membership"."workspace_id"
       AND "team_member"."membership_id" = "membership"."id"
      WHERE "membership"."workspace_id" = ${workspaceId}::uuid
        AND "membership"."id" = ${membershipId}::uuid
        AND "membership"."status" = 'ACTIVE'::"MembershipStatus"
        AND "team_member"."team_id" = ${teamId}::uuid
        AND "team_member"."removed_at" IS NULL
      FOR UPDATE OF "membership", "team_member"
    `;
    if (!membership) {
      teamMembershipRequired();
    }
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
