import { randomUUID } from 'node:crypto';

import { HttpStatus, Injectable } from '@nestjs/common';

import {
  HandoffKind,
  IssueFileKind,
  MembershipRole,
  MembershipStatus,
  Prisma,
  ProjectRole,
  StateCategory,
} from '@rivet/database';
import {
  API_HANDOFF_CREATED,
  API_HANDOFF_CREATED_SCHEMA_VERSION,
  type ApiHandoffCreatedOutboxPayload,
  COMMENT_CREATED,
  COMMENT_CREATED_SCHEMA_VERSION,
  COMMENT_MENTIONS_ADDED,
  COMMENT_MENTIONS_ADDED_SCHEMA_VERSION,
  type CommentCreatedOutboxPayload,
  type CommentMentionsAddedOutboxPayload,
  TEAM_WORK_CREATED,
  TEAM_WORK_CREATED_SCHEMA_VERSION,
  type TeamWorkCreatedOutboxPayload,
} from '@rivet/event-contracts';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import { notifyResourceChanged } from '../../common/realtime/notify-resource-changed';
import {
  assertActiveMentionMemberships,
  type ParsedMarkdown,
  parseMarkdown,
} from '../../common/validation/markdown';
import { FilesService } from '../files/files.service';
import type {
  CreateCommentDto,
  CreateIssueHandoffDto,
  IssueTimelineQueryDto,
  UpdateCommentDto,
} from './dto/issue-collaboration-request.dto';
import type {
  CollaborationMemberSummaryResponseDto,
  CommentResourceResponseDto,
  HandoffResourceResponseDto,
  TimelineItemResponseDto,
  TimelineResponseDto,
} from './dto/issue-collaboration-response.dto';

type Transaction = Prisma.TransactionClient;
type Context = { membershipId: string; userId: string; workspaceId: string };
type TimelineType = 'ACTIVITY' | 'COMMENT' | 'HANDOFF';

const COMMENT_SELECT = {
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
  deletedAt: true,
  editedAt: true,
  id: true,
  teamWorkId: true,
  version: true,
} satisfies Prisma.CommentSelect;

type CommentRow = Prisma.CommentGetPayload<{ select: typeof COMMENT_SELECT }>;

interface HandoffTeamWorkLockRow {
  id: string;
  issueId: string;
  projectId: string;
  projectRole: ProjectRole;
  teamId: string;
  category: StateCategory;
}

interface TimelineCursor {
  createdAt: Date;
  createdAtIso: string;
  direction: 'asc' | 'desc';
  id: string;
  type: TimelineType;
}

interface CommentLockRow {
  authorMembershipId: string;
  bodyMarkdown: string | null;
  deletedAt: Date | null;
  id: string;
  issueId: string;
  teamWorkId: string | null;
  version: number;
}

const TERMINAL_CATEGORIES = [StateCategory.COMPLETED, StateCategory.CANCELED] as const;
const FRONTEND_ROLES = [ProjectRole.WEB_FRONTEND, ProjectRole.APP_FRONTEND] as const;

function resourceNotFound(message = '리소스를 찾을 수 없습니다.'): never {
  throw new ApiError({ code: 'RESOURCE_NOT_FOUND', message, status: HttpStatus.NOT_FOUND });
}

function conflict(
  code: string,
  message: string,
  options: { currentVersion?: number; details?: Record<string, unknown> } = {},
): never {
  throw new ApiError({ code, message, status: HttpStatus.CONFLICT, ...options });
}

function unprocessable(code: string, message: string): never {
  throw new ApiError({ code, message, status: HttpStatus.UNPROCESSABLE_ENTITY });
}

function invalidQuery(message: string): never {
  throw new ApiError({ code: 'INVALID_QUERY', message, status: HttpStatus.BAD_REQUEST });
}

function toMemberResponse(member: {
  id: string;
  role: MembershipRole;
  status: MembershipStatus;
  user: { avatarFileId: string | null; displayName: string; id: string };
}): CollaborationMemberSummaryResponseDto {
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

function toCommentResponse(comment: CommentRow): CommentResourceResponseDto {
  return {
    author: toMemberResponse(comment.authorMembership),
    bodyMarkdown: comment.bodyMarkdown,
    createdAt: comment.createdAt.toISOString(),
    deletedAt: comment.deletedAt?.toISOString() ?? null,
    editedAt: comment.editedAt?.toISOString() ?? null,
    id: comment.id,
    teamWorkId: comment.teamWorkId,
    version: comment.version,
  };
}

function parseHandoffMarkdown(value: string): ParsedMarkdown {
  const bodyMarkdown = value.normalize('NFC').trim();
  if ([...bodyMarkdown].length > 50_000) {
    unprocessable('HANDOFF_CONTENT_REQUIRED', '작업 전달은 50,000자 이하여야 합니다.');
  }

  const hasUnsafeControlCharacter = [...bodyMarkdown].some((character) => {
    const code = character.charCodeAt(0);
    return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
  });
  if (
    hasUnsafeControlCharacter ||
    /<\/?[a-z][^>]*>/iu.test(bodyMarkdown) ||
    /\b(?:javascript|vbscript|data)\s*:/iu.test(bodyMarkdown)
  ) {
    unprocessable('MARKDOWN_INVALID', '안전하지 않은 Markdown은 저장할 수 없습니다.');
  }

  const parsed = parseMarkdown(bodyMarkdown, 50_000);
  if (parsed.bodyMarkdown.replace(/^#{1,6}[ \t].*$/gmu, '').trim().length === 0) {
    unprocessable('HANDOFF_CONTENT_REQUIRED', '작업 전달의 실제 변경 내용을 입력해 주세요.');
  }
  return parsed;
}

export function normalizeHandoffBodyMarkdown(value: string): string {
  return parseHandoffMarkdown(value).bodyMarkdown;
}

function encodeTimelineCursor(item: TimelineItemResponseDto, direction: 'asc' | 'desc'): string {
  const id = timelineItemId(item);
  return Buffer.from(
    JSON.stringify(['timeline-v1', direction, item.createdAt, id, item.type]),
    'utf8',
  ).toString('base64url');
}

function parseTimelineCursor(
  value: string | undefined,
  direction: 'asc' | 'desc',
): TimelineCursor | null {
  if (!value) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 5 ||
      parsed[0] !== 'timeline-v1' ||
      parsed[1] !== direction ||
      typeof parsed[2] !== 'string' ||
      typeof parsed[3] !== 'string' ||
      (parsed[4] !== 'ACTIVITY' && parsed[4] !== 'COMMENT' && parsed[4] !== 'HANDOFF') ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(parsed[3])
    ) {
      return invalidQuery('타임라인 커서를 확인해 주세요.');
    }

    const createdAt = new Date(parsed[2]);
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== parsed[2]) {
      return invalidQuery('타임라인 커서를 확인해 주세요.');
    }
    return {
      createdAt,
      createdAtIso: parsed[2],
      direction,
      id: parsed[3],
      type: parsed[4],
    };
  } catch {
    return invalidQuery('타임라인 커서를 확인해 주세요.');
  }
}

function timelineCursorWhere(
  sourceType: TimelineType,
  cursor: TimelineCursor | null,
):
  | {
      OR: Array<{
        createdAt: Date | { gt?: Date; lt?: Date };
        id?: string | { gt?: string; lt?: string };
      }>;
    }
  | undefined {
  if (!cursor) {
    return undefined;
  }

  const isAscending = cursor.direction === 'asc';
  const includeEqualId = isAscending
    ? sourceType.localeCompare(cursor.type) > 0
    : sourceType.localeCompare(cursor.type) < 0;
  const rows: Array<{
    createdAt: Date | { gt?: Date; lt?: Date };
    id?: string | { gt?: string; lt?: string };
  }> = [
    { createdAt: isAscending ? { gt: cursor.createdAt } : { lt: cursor.createdAt } },
    {
      createdAt: cursor.createdAt,
      id: isAscending ? { gt: cursor.id } : { lt: cursor.id },
    },
  ];
  if (includeEqualId) {
    rows.push({ createdAt: cursor.createdAt, id: cursor.id });
  }
  return { OR: rows };
}

function compareTimelineItems(
  left: TimelineItemResponseDto,
  right: TimelineItemResponseDto,
  direction: 'asc' | 'desc',
): number {
  const leftId = timelineItemId(left);
  const rightId = timelineItemId(right);
  const result =
    left.createdAt.localeCompare(right.createdAt) ||
    leftId.localeCompare(rightId) ||
    left.type.localeCompare(right.type);
  return direction === 'asc' ? result : -result;
}

function timelineItemId(item: TimelineItemResponseDto): string {
  if (item.type === 'ACTIVITY') return item.activity!.id;
  if (item.type === 'COMMENT') return item.comment!.id;
  return item.handoff!.id;
}

@Injectable()
export class IssueCollaborationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly files: FilesService,
  ) {}

  async createComment(
    context: Context,
    issueId: string,
    dto: CreateCommentDto,
  ): Promise<CommentResourceResponseDto> {
    const markdown = parseMarkdown(dto.bodyMarkdown, 50_000);

    return this.database.client.$transaction(async (transaction) => {
      await this.lockWorkspace(transaction, context.workspaceId);
      await this.lockActiveActor(transaction, context);
      await assertActiveMentionMemberships(
        transaction,
        context.workspaceId,
        markdown.mentionedMembershipIds,
      );
      await this.lockIssue(transaction, context.workspaceId, issueId);
      if (dto.teamWorkId) {
        const teamWork = await transaction.teamWork.findFirst({
          select: { id: true },
          where: { deletedAt: null, id: dto.teamWorkId, issueId, workspaceId: context.workspaceId },
        });
        if (!teamWork) resourceNotFound('이슈에 속한 팀 작업을 찾을 수 없습니다.');
      }

      const comment = await transaction.comment.create({
        data: {
          authorMembershipId: context.membershipId,
          bodyMarkdown: markdown.bodyMarkdown,
          issueId,
          teamWorkId: dto.teamWorkId ?? null,
          workspaceId: context.workspaceId,
        },
        select: COMMENT_SELECT,
      });
      await this.syncCommentReferences(transaction, context, issueId, comment.id, markdown);
      await transaction.issueSubscription.createMany({
        data: [...new Set([context.membershipId, ...markdown.mentionedMembershipIds])]
          .sort()
          .map((membershipId) => ({ issueId, membershipId, workspaceId: context.workspaceId })),
        skipDuplicates: true,
      });
      const subscriberMembershipIds = await this.subscriberMembershipIds(
        transaction,
        context.workspaceId,
        issueId,
      );
      await transaction.activityEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          afterData: { commentId: comment.id },
          beforeData: Prisma.JsonNull,
          eventType: COMMENT_CREATED,
          fieldName: 'comment',
          issueId,
          teamWorkId: dto.teamWorkId ?? null,
          workspaceId: context.workspaceId,
        },
      });
      await transaction.outboxEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          aggregateId: comment.id,
          aggregateType: 'COMMENT',
          eventType: COMMENT_CREATED,
          payload: {
            commentId: comment.id,
            hasMention: markdown.mentionedMembershipIds.length > 0,
            issueId,
            teamWorkId: dto.teamWorkId ?? null,
            mentionedMembershipIds: markdown.mentionedMembershipIds,
            schemaVersion: COMMENT_CREATED_SCHEMA_VERSION,
            subscriberMembershipIds,
          } satisfies CommentCreatedOutboxPayload,
          workspaceId: context.workspaceId,
        },
      });
      await notifyResourceChanged(transaction, {
        changeType: 'CREATED',
        resourceId: comment.id,
        resourceType: 'COMMENT',
        version: comment.version,
        workspaceId: context.workspaceId,
      });

      return toCommentResponse(comment);
    });
  }

  async updateComment(
    context: Context,
    commentId: string,
    dto: UpdateCommentDto,
  ): Promise<CommentResourceResponseDto> {
    const markdown = parseMarkdown(dto.bodyMarkdown, 50_000);
    const issueId = await this.commentIssueId(context.workspaceId, commentId);

    return this.database.client.$transaction(async (transaction) => {
      await this.lockWorkspace(transaction, context.workspaceId);
      await this.lockActiveActor(transaction, context);
      await assertActiveMentionMemberships(
        transaction,
        context.workspaceId,
        markdown.mentionedMembershipIds,
      );
      await this.lockIssue(transaction, context.workspaceId, issueId);
      const current = await this.lockComment(transaction, context.workspaceId, issueId, commentId);
      this.assertCommentMutationAllowed(current, context.membershipId, dto.version);
      if (current.bodyMarkdown === markdown.bodyMarkdown) {
        return toCommentResponse(
          await this.findComment(transaction, context.workspaceId, commentId),
        );
      }

      const previousMentionIds = (
        await transaction.mention.findMany({
          orderBy: { mentionedMembershipId: 'asc' },
          select: { mentionedMembershipId: true },
          where: { commentId, issueId, workspaceId: context.workspaceId },
        })
      ).map(({ mentionedMembershipId }) => mentionedMembershipId);
      const newlyMentionedMembershipIds = markdown.mentionedMembershipIds.filter(
        (membershipId) => !previousMentionIds.includes(membershipId),
      );
      await transaction.comment.update({
        data: {
          bodyMarkdown: markdown.bodyMarkdown,
          editedAt: new Date(),
          version: { increment: 1 },
        },
        where: { id: commentId },
      });
      await this.syncCommentReferences(transaction, context, issueId, commentId, markdown);
      if (markdown.mentionedMembershipIds.length > 0) {
        await transaction.issueSubscription.createMany({
          data: markdown.mentionedMembershipIds.map((membershipId) => ({
            issueId,
            membershipId,
            workspaceId: context.workspaceId,
          })),
          skipDuplicates: true,
        });
      }
      await transaction.activityEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          afterData: { commentId },
          beforeData: { commentId },
          eventType: 'COMMENT_UPDATED',
          fieldName: 'comment',
          issueId,
          teamWorkId: current.teamWorkId,
          workspaceId: context.workspaceId,
        },
      });
      if (newlyMentionedMembershipIds.length > 0) {
        await transaction.outboxEvent.create({
          data: {
            actorMembershipId: context.membershipId,
            aggregateId: commentId,
            aggregateType: 'COMMENT',
            eventType: COMMENT_MENTIONS_ADDED,
            payload: {
              commentId,
              issueId,
              teamWorkId: current.teamWorkId,
              mentionedMembershipIds: newlyMentionedMembershipIds,
              schemaVersion: COMMENT_MENTIONS_ADDED_SCHEMA_VERSION,
            } satisfies CommentMentionsAddedOutboxPayload,
            workspaceId: context.workspaceId,
          },
        });
      }

      const updated = await this.findComment(transaction, context.workspaceId, commentId);
      await notifyResourceChanged(transaction, {
        changeType: 'UPDATED',
        resourceId: commentId,
        resourceType: 'COMMENT',
        version: updated.version,
        workspaceId: context.workspaceId,
      });
      return toCommentResponse(updated);
    });
  }

  async deleteComment(context: Context, commentId: string, version: number): Promise<void> {
    const issueId = await this.commentIssueId(context.workspaceId, commentId);

    await this.database.client.$transaction(async (transaction) => {
      await this.lockWorkspace(transaction, context.workspaceId);
      await this.lockActiveActor(transaction, context);
      await this.lockIssue(transaction, context.workspaceId, issueId);
      const current = await this.lockComment(transaction, context.workspaceId, issueId, commentId);
      this.assertCommentMutationAllowed(current, context.membershipId, version);

      await transaction.comment.update({
        data: { bodyMarkdown: null, deletedAt: new Date(), version: { increment: 1 } },
        where: { id: commentId },
      });
      await this.syncCommentReferences(transaction, context, issueId, commentId, {
        bodyMarkdown: '',
        fileIds: [],
        mentionedMembershipIds: [],
      });
      await transaction.activityEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          afterData: { commentId, deleted: true },
          beforeData: { commentId, deleted: false },
          eventType: 'COMMENT_DELETED',
          fieldName: 'comment',
          issueId,
          teamWorkId: current.teamWorkId,
          workspaceId: context.workspaceId,
        },
      });
      await notifyResourceChanged(transaction, {
        changeType: 'DELETED',
        resourceId: commentId,
        resourceType: 'COMMENT',
        version: current.version + 1,
        workspaceId: context.workspaceId,
      });
    });
  }

  async createHandoff(
    context: Context,
    teamWorkId: string,
    dto: CreateIssueHandoffDto,
  ): Promise<HandoffResourceResponseDto> {
    return this.database.client.$transaction(async (transaction) => {
      await this.lockWorkspace(transaction, context.workspaceId);
      await this.lockActiveActor(transaction, context);
      return this.createHandoffInTransaction(transaction, context, teamWorkId, dto);
    });
  }

  async createHandoffInTransaction(
    transaction: Transaction,
    context: Context,
    teamWorkId: string,
    dto: {
      bodyMarkdown: string;
      destinationRoles?: (typeof ProjectRole.WEB_FRONTEND | typeof ProjectRole.APP_FRONTEND)[];
      kind: HandoffKind;
    },
  ): Promise<HandoffResourceResponseDto> {
    const markdown = parseHandoffMarkdown(dto.bodyMarkdown);
    const source = await this.lockHandoffTeamWork(transaction, context.workspaceId, teamWorkId);
    if (source.projectRole !== ProjectRole.BACKEND) {
      unprocessable(
        'HANDOFF_NOT_ALLOWED',
        '백엔드 역할의 팀 작업에만 작업 전달을 작성할 수 있습니다.',
      );
    }
    const sourceTeamMember = await transaction.teamMember.findFirst({
      select: { membershipId: true },
      where: {
        membership: { status: MembershipStatus.ACTIVE },
        membershipId: context.membershipId,
        teamId: source.teamId,
        workspaceId: context.workspaceId,
      },
    });
    if (!sourceTeamMember) {
      throw new ApiError({
        code: 'TEAM_WORK_TEAM_MEMBER_REQUIRED',
        message: '원본 백엔드 팀의 활성 멤버만 작업 전달을 작성할 수 있습니다.',
        status: HttpStatus.FORBIDDEN,
      });
    }
    await assertActiveMentionMemberships(
      transaction,
      context.workspaceId,
      markdown.mentionedMembershipIds,
    );

    const handoffs = await transaction.apiHandoff.findMany({
      orderBy: { sequenceNumber: 'desc' },
      select: {
        id: true,
        kind: true,
        sequenceNumber: true,
        targets: { select: { teamWorkId: true } },
      },
      where: { sourceTeamWorkId: teamWorkId, workspaceId: context.workspaceId },
    });
    const hasInitial = handoffs.some(({ kind }) => kind === HandoffKind.INITIAL);
    if (dto.kind === HandoffKind.INITIAL && hasInitial) {
      conflict('INITIAL_HANDOFF_EXISTS', '최초 작업 전달이 이미 존재합니다.');
    }
    if (dto.kind === HandoffKind.FOLLOW_UP && !hasInitial) {
      conflict('INITIAL_HANDOFF_REQUIRED', '최초 작업 전달을 먼저 작성해 주세요.');
    }
    if (dto.kind === HandoffKind.INITIAL && source.category !== StateCategory.COMPLETED) {
      unprocessable(
        'HANDOFF_REQUIRES_COMPLETION',
        '최초 작업 전달은 백엔드 팀 작업 완료와 함께 작성해야 합니다.',
      );
    }

    const targetTeamWorkIds =
      dto.kind === HandoffKind.INITIAL
        ? await this.ensureHandoffTargets(
            transaction,
            context,
            teamWorkId,
            source.issueId,
            source.projectId,
            dto.destinationRoles,
          )
        : [
            ...new Set(
              handoffs
                .find(({ kind }) => kind === HandoffKind.INITIAL)
                ?.targets.map(({ teamWorkId: targetId }) => targetId) ?? [],
            ),
          ].sort();
    if (dto.kind === HandoffKind.INITIAL && targetTeamWorkIds.length === 0) {
      unprocessable(
        'HANDOFF_DESTINATION_REQUIRED',
        '최초 작업 전달 대상 역할을 하나 이상 선택해 주세요.',
      );
    }

    const created = await transaction.apiHandoff.create({
      data: {
        authorMembershipId: context.membershipId,
        bodyMarkdown: markdown.bodyMarkdown,
        issueId: source.issueId,
        kind: dto.kind,
        sequenceNumber: (handoffs[0]?.sequenceNumber ?? 0) + 1,
        sourceTeamWorkId: teamWorkId,
        workspaceId: context.workspaceId,
      },
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
    });
    if (targetTeamWorkIds.length > 0) {
      await transaction.apiHandoffTarget.createMany({
        data: targetTeamWorkIds.map((targetTeamWorkId) => ({
          handoffId: created.id,
          teamWorkId: targetTeamWorkId,
          workspaceId: context.workspaceId,
        })),
      });
    }
    if (markdown.mentionedMembershipIds.length > 0) {
      await transaction.mention.createMany({
        data: markdown.mentionedMembershipIds.map((mentionedMembershipId) => ({
          apiHandoffId: created.id,
          issueId: source.issueId,
          mentionedMembershipId,
          workspaceId: context.workspaceId,
        })),
      });
    }
    await this.files.syncBodyImages(
      transaction,
      context,
      source.issueId,
      IssueFileKind.HANDOFF_IMAGE,
      markdown.fileIds,
      { apiHandoffId: created.id },
    );
    const targets = await transaction.teamWork.findMany({
      orderBy: [{ projectRole: 'asc' }, { identifier: 'asc' }, { id: 'asc' }],
      select: {
        assigneeMembershipId: true,
        team: {
          select: {
            teamMembers: {
              select: { membershipId: true },
              where: { membership: { status: MembershipStatus.ACTIVE } },
            },
          },
        },
      },
      where: { id: { in: targetTeamWorkIds }, workspaceId: context.workspaceId },
    });
    const subscriptions = await transaction.issueSubscription.findMany({
      select: { membershipId: true },
      where: { issueId: source.issueId, workspaceId: context.workspaceId },
    });
    const candidateRecipientMembershipIds = [
      ...new Set([
        ...targets.flatMap(({ assigneeMembershipId, team }) => [
          ...(assigneeMembershipId ? [assigneeMembershipId] : []),
          ...team.teamMembers.map(({ membershipId }) => membershipId),
        ]),
        ...subscriptions.map(({ membershipId }) => membershipId),
      ]),
    ]
      .filter((membershipId) => membershipId !== context.membershipId)
      .sort();
    if (markdown.mentionedMembershipIds.length > 0) {
      await transaction.issueSubscription.createMany({
        data: markdown.mentionedMembershipIds.map((membershipId) => ({
          issueId: source.issueId,
          membershipId,
          workspaceId: context.workspaceId,
        })),
        skipDuplicates: true,
      });
    }

    await transaction.activityEvent.create({
      data: {
        actorMembershipId: context.membershipId,
        afterData: {
          targetTeamWorkIds,
          handoffId: created.id,
          kind: created.kind,
          sequenceNumber: created.sequenceNumber,
        },
        beforeData: Prisma.JsonNull,
        eventType: API_HANDOFF_CREATED,
        fieldName: 'handoff',
        issueId: source.issueId,
        teamWorkId,
        workspaceId: context.workspaceId,
      },
    });
    await transaction.outboxEvent.create({
      data: {
        actorMembershipId: context.membershipId,
        aggregateId: created.id,
        aggregateType: 'API_HANDOFF',
        eventType: API_HANDOFF_CREATED,
        payload: {
          candidateRecipientMembershipIds,
          targetTeamWorkIds,
          handoffId: created.id,
          issueId: source.issueId,
          kind: created.kind,
          mentionedMembershipIds: markdown.mentionedMembershipIds,
          schemaVersion: API_HANDOFF_CREATED_SCHEMA_VERSION,
          sourceTeamWorkId: teamWorkId,
        } satisfies ApiHandoffCreatedOutboxPayload,
        workspaceId: context.workspaceId,
      },
    });
    await notifyResourceChanged(transaction, {
      changeType: 'CREATED',
      resourceId: created.id,
      resourceType: 'HANDOFF',
      version: null,
      workspaceId: context.workspaceId,
    });

    return {
      author: toMemberResponse(created.authorMembership),
      bodyMarkdown: created.bodyMarkdown,
      createdAt: created.createdAt.toISOString(),
      id: created.id,
      issueId: source.issueId,
      kind: created.kind,
      sequenceNumber: created.sequenceNumber,
      sourceTeamWorkId: teamWorkId,
      targetTeamWorkIds,
    };
  }

  async timeline(
    workspaceId: string,
    issueId: string,
    dto: IssueTimelineQueryDto,
  ): Promise<TimelineResponseDto> {
    const direction = dto.sortDirection ?? 'asc';
    const cursor = parseTimelineCursor(dto.cursor, direction);
    const exists = await this.database.client.issue.findFirst({
      select: { id: true },
      where: { deletedAt: null, id: issueId, workspaceId },
    });
    if (!exists) {
      resourceNotFound('이슈를 찾을 수 없습니다.');
    }

    const cursorForActivity = timelineCursorWhere('ACTIVITY', cursor);
    const cursorForComment = timelineCursorWhere('COMMENT', cursor);
    const cursorForHandoff = timelineCursorWhere('HANDOFF', cursor);
    const [activities, comments, handoffs] = await Promise.all([
      this.database.client.activityEvent.findMany({
        orderBy: [{ createdAt: direction }, { id: direction }],
        select: {
          actorMembership: {
            select: {
              id: true,
              role: true,
              status: true,
              user: { select: { avatarFileId: true, displayName: true, id: true } },
            },
          },
          afterData: true,
          beforeData: true,
          createdAt: true,
          eventType: true,
          fieldName: true,
          id: true,
          teamWork: { select: { identifier: true } },
          teamWorkId: true,
        },
        take: dto.limit + 1,
        where: {
          eventType: {
            notIn: [API_HANDOFF_CREATED, COMMENT_CREATED, 'COMMENT_DELETED', 'COMMENT_UPDATED'],
          },
          issueId,
          workspaceId,
          ...cursorForActivity,
        },
      }),
      this.database.client.comment.findMany({
        orderBy: [{ createdAt: direction }, { id: direction }],
        select: COMMENT_SELECT,
        take: dto.limit + 1,
        where: { issueId, workspaceId, ...cursorForComment },
      }),
      this.database.client.apiHandoff.findMany({
        orderBy: [{ createdAt: direction }, { id: direction }],
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
          sourceTeamWorkId: true,
          targets: { orderBy: { teamWorkId: 'asc' }, select: { teamWorkId: true } },
        },
        take: dto.limit + 1,
        where: { issueId, workspaceId, ...cursorForHandoff },
      }),
    ]);

    const merged: TimelineItemResponseDto[] = [
      ...activities.map((activity): TimelineItemResponseDto => ({
        activity: {
          actor: activity.actorMembership ? toMemberResponse(activity.actorMembership) : null,
          after: activity.afterData,
          before: activity.beforeData,
          eventType: activity.eventType,
          fieldName: activity.fieldName,
          id: activity.id,
          teamWorkId: activity.teamWorkId,
          teamWorkIdentifier: activity.teamWork?.identifier ?? null,
        },
        createdAt: activity.createdAt.toISOString(),
        type: 'ACTIVITY',
      })),
      ...comments.map((comment): TimelineItemResponseDto => ({
        comment: toCommentResponse(comment),
        createdAt: comment.createdAt.toISOString(),
        type: 'COMMENT',
      })),
      ...handoffs.map((handoff): TimelineItemResponseDto => ({
        createdAt: handoff.createdAt.toISOString(),
        handoff: {
          author: toMemberResponse(handoff.authorMembership),
          bodyMarkdown: handoff.bodyMarkdown,
          createdAt: handoff.createdAt.toISOString(),
          id: handoff.id,
          issueId,
          kind: handoff.kind,
          sequenceNumber: handoff.sequenceNumber,
          sourceTeamWorkId: handoff.sourceTeamWorkId,
          targetTeamWorkIds: handoff.targets.map(({ teamWorkId }) => teamWorkId),
        },
        type: 'HANDOFF',
      })),
    ].sort((left, right) => compareTimelineItems(left, right, direction));
    const hasMore = merged.length > dto.limit;
    const items = merged.slice(0, dto.limit);

    return {
      items,
      nextCursor:
        hasMore && items.length > 0
          ? encodeTimelineCursor(items[items.length - 1]!, direction)
          : null,
    };
  }

  private async commentIssueId(workspaceId: string, commentId: string): Promise<string> {
    const comment = await this.database.client.comment.findFirst({
      select: { issueId: true },
      where: { id: commentId, workspaceId },
    });
    if (!comment) resourceNotFound('댓글을 찾을 수 없습니다.');
    return comment.issueId;
  }

  private async lockComment(
    transaction: Transaction,
    workspaceId: string,
    issueId: string,
    commentId: string,
  ): Promise<CommentLockRow> {
    const [comment] = await transaction.$queryRaw<CommentLockRow[]>`
      SELECT "id",
             "issue_id" AS "issueId",
             "team_work_id" AS "teamWorkId",
             "author_membership_id" AS "authorMembershipId",
             "body_markdown" AS "bodyMarkdown",
             "version",
             "deleted_at" AS "deletedAt"
      FROM "comments"
      WHERE "workspace_id" = ${workspaceId}::uuid
        AND "issue_id" = ${issueId}::uuid
        AND "id" = ${commentId}::uuid
      FOR UPDATE
    `;
    if (!comment) resourceNotFound('댓글을 찾을 수 없습니다.');
    return comment;
  }

  private assertCommentMutationAllowed(
    comment: CommentLockRow,
    membershipId: string,
    version: number,
  ): void {
    if (comment.deletedAt !== null || comment.bodyMarkdown === null) {
      resourceNotFound('댓글을 찾을 수 없습니다.');
    }
    if (comment.authorMembershipId !== membershipId) {
      throw new ApiError({
        code: 'FORBIDDEN',
        message: '자신이 작성한 댓글만 변경할 수 있습니다.',
        status: HttpStatus.FORBIDDEN,
      });
    }
    if (comment.version !== version) {
      conflict('VERSION_CONFLICT', '댓글이 다른 요청에서 변경되었습니다.', {
        currentVersion: comment.version,
      });
    }
  }

  private async findComment(
    transaction: Transaction,
    workspaceId: string,
    commentId: string,
  ): Promise<CommentRow> {
    const comment = await transaction.comment.findFirst({
      select: COMMENT_SELECT,
      where: { id: commentId, workspaceId },
    });
    if (!comment) resourceNotFound('댓글을 찾을 수 없습니다.');
    return comment;
  }

  private async syncCommentReferences(
    transaction: Transaction,
    context: Context,
    issueId: string,
    commentId: string,
    markdown: ParsedMarkdown,
  ): Promise<void> {
    await transaction.mention.deleteMany({
      where: { commentId, issueId, workspaceId: context.workspaceId },
    });
    if (markdown.mentionedMembershipIds.length > 0) {
      await transaction.mention.createMany({
        data: markdown.mentionedMembershipIds.map((mentionedMembershipId) => ({
          commentId,
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
      IssueFileKind.COMMENT_IMAGE,
      markdown.fileIds,
      { commentId },
    );
  }

  private async subscriberMembershipIds(
    transaction: Transaction,
    workspaceId: string,
    issueId: string,
  ): Promise<string[]> {
    return (
      await transaction.issueSubscription.findMany({
        orderBy: { membershipId: 'asc' },
        select: { membershipId: true },
        where: { issueId, workspaceId },
      })
    ).map(({ membershipId }) => membershipId);
  }

  private async lockWorkspace(transaction: Transaction, workspaceId: string): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "workspaces"
      WHERE "id" = ${workspaceId}::uuid
      FOR UPDATE
    `;
    if (rows.length === 0) {
      resourceNotFound('워크스페이스를 찾을 수 없습니다.');
    }
  }

  private async lockActiveActor(transaction: Transaction, context: Context): Promise<void> {
    const [membership] = await transaction.$queryRaw<Array<{ status: MembershipStatus }>>`
      SELECT "status"
      FROM "workspace_memberships"
      WHERE "workspace_id" = ${context.workspaceId}::uuid
        AND "id" = ${context.membershipId}::uuid
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

  private async lockIssue(
    transaction: Transaction,
    workspaceId: string,
    issueId: string,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "issues"
      WHERE "workspace_id" = ${workspaceId}::uuid AND "id" = ${issueId}::uuid AND "deleted_at" IS NULL
      FOR UPDATE
    `;
    if (rows.length === 0) resourceNotFound('이슈를 찾을 수 없습니다.');
  }

  private async lockHandoffTeamWork(
    transaction: Transaction,
    workspaceId: string,
    teamWorkId: string,
  ): Promise<HandoffTeamWorkLockRow> {
    const [row] = await transaction.$queryRaw<HandoffTeamWorkLockRow[]>`
      SELECT "work"."id", "work"."issue_id" AS "issueId", "work"."project_role" AS "projectRole", "work"."team_id" AS "teamId",
             "issue"."project_id" AS "projectId", "state"."category"
      FROM "team_works" AS "work"
      INNER JOIN "issues" AS "issue"
        ON "issue"."workspace_id" = "work"."workspace_id" AND "issue"."id" = "work"."issue_id" AND "issue"."deleted_at" IS NULL
      INNER JOIN "workflow_states" AS "state"
        ON "state"."workspace_id" = "work"."workspace_id" AND "state"."id" = "work"."workflow_state_id"
      WHERE "work"."workspace_id" = ${workspaceId}::uuid AND "work"."id" = ${teamWorkId}::uuid AND "work"."deleted_at" IS NULL
      FOR UPDATE OF "work"
    `;
    if (!row) resourceNotFound('팀 작업을 찾을 수 없습니다.');
    return row;
  }

  private async bumpTeamWorkVersions(
    transaction: Transaction,
    workspaceId: string,
    teamWorkIds: string[],
  ): Promise<void> {
    for (const teamWorkId of [...teamWorkIds].sort()) {
      const updated = await transaction.teamWork.update({
        data: { version: { increment: 1 } },
        select: { id: true, version: true },
        where: { id: teamWorkId },
      });
      await notifyResourceChanged(transaction, {
        changeType: 'UPDATED',
        resourceId: updated.id,
        resourceType: 'TEAM_WORK',
        version: updated.version,
        workspaceId,
      });
    }
  }

  private async ensureHandoffTargets(
    transaction: Transaction,
    context: Context,
    sourceTeamWorkId: string,
    issueId: string,
    projectId: string,
    requestedRoles?: (typeof ProjectRole.WEB_FRONTEND | typeof ProjectRole.APP_FRONTEND)[],
  ): Promise<string[]> {
    const roleTeams = await transaction.projectRoleTeam.findMany({
      orderBy: { role: 'asc' },
      select: { role: true, teamId: true },
      where: {
        projectId,
        role: { in: requestedRoles?.length ? requestedRoles : [...FRONTEND_ROLES] },
        workspaceId: context.workspaceId,
      },
    });
    const targets: string[] = [];
    for (const roleTeam of roleTeams) {
      const existing = await transaction.teamWork.findFirst({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
        where: {
          deletedAt: null,
          issueId,
          projectRole: roleTeam.role,
          workflowState: { category: { notIn: [...TERMINAL_CATEGORIES] } },
          workspaceId: context.workspaceId,
        },
      });
      if (existing) {
        targets.push(existing.id);
        continue;
      }
      const team = await transaction.team.findFirst({
        select: { id: true, key: true, nextIssueNumber: true },
        where: { archivedAt: null, id: roleTeam.teamId, workspaceId: context.workspaceId },
      });
      const state = await transaction.workflowState.findFirst({
        orderBy: [{ isDefault: 'desc' }, { position: 'asc' }],
        select: { id: true },
        where: {
          category: { notIn: [...TERMINAL_CATEGORIES] },
          teamId: roleTeam.teamId,
          workspaceId: context.workspaceId,
        },
      });
      if (!team || !state) resourceNotFound('전달 대상 팀 또는 워크플로 상태를 찾을 수 없습니다.');
      await transaction.team.update({
        data: { nextIssueNumber: { increment: 1 } },
        where: { id: team.id },
      });
      const created = await transaction.teamWork.create({
        data: {
          createdByMembershipId: context.membershipId,
          identifier: `${team.key}-${team.nextIssueNumber}`,
          issueId,
          projectRole: roleTeam.role,
          sequenceNumber: team.nextIssueNumber,
          teamId: team.id,
          workflowStateId: state.id,
          workspaceId: context.workspaceId,
        },
        select: { id: true, version: true },
      });
      await transaction.activityEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          afterData: {
            identifier: `${team.key}-${team.nextIssueNumber}`,
            projectRole: roleTeam.role,
          },
          eventType: 'TEAM_WORK_CREATED',
          issueId,
          teamWorkId: created.id,
          workspaceId: context.workspaceId,
        },
      });
      const eventId = randomUUID();
      await transaction.outboxEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          aggregateId: created.id,
          aggregateType: 'TEAM_WORK',
          eventType: TEAM_WORK_CREATED,
          id: eventId,
          payload: {
            assigneeMembershipId: null,
            issueId,
            schemaVersion: TEAM_WORK_CREATED_SCHEMA_VERSION,
            teamWorkId: created.id,
          } satisfies TeamWorkCreatedOutboxPayload,
          workspaceId: context.workspaceId,
        },
      });
      await notifyResourceChanged(transaction, {
        changeType: 'CREATED',
        eventId,
        resourceId: created.id,
        resourceType: 'TEAM_WORK',
        version: created.version,
        workspaceId: context.workspaceId,
      });
      targets.push(created.id);
    }
    return targets.sort();
  }
}
