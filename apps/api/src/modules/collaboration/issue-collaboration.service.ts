import { HttpStatus, Injectable } from '@nestjs/common';

import {
  HandoffKind,
  IssueFileKind,
  IssueType,
  MembershipRole,
  MembershipStatus,
  Prisma,
  ProjectRole,
  StateCategory,
} from '@rivet/database';
import {
  API_HANDOFF_CREATED,
  API_HANDOFF_CREATED_SCHEMA_VERSION,
  COMMENT_CREATED,
  COMMENT_CREATED_SCHEMA_VERSION,
  COMMENT_MENTIONS_ADDED,
  COMMENT_MENTIONS_ADDED_SCHEMA_VERSION,
  type CommentCreatedOutboxPayload,
  type CommentMentionsAddedOutboxPayload,
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
  CreateIssueBlockRelationDto,
  CreateIssueHandoffDto,
  IssueTimelineQueryDto,
  RemoveIssueBlockRelationDto,
  UpdateCommentDto,
} from './dto/issue-collaboration-request.dto';
import type {
  AffectedIssueResponseDto,
  CollaborationMemberSummaryResponseDto,
  CommentResourceResponseDto,
  HandoffResourceResponseDto,
  IssueBlockRelationMutationResponseDto,
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
  version: true,
} satisfies Prisma.CommentSelect;

type CommentRow = Prisma.CommentGetPayload<{ select: typeof COMMENT_SELECT }>;

interface IssueLockRow {
  category: StateCategory;
  id: string;
  identifier: string;
  projectRole: ProjectRole | null;
  title: string;
  type: IssueType;
  version: number;
}

interface AffectedIssueRow extends IssueLockRow {
  blocked: boolean;
}

interface HandoffIssueLockRow {
  id: string;
  projectRole: ProjectRole | null;
  type: IssueType;
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
  version: number;
}

const TERMINAL_CATEGORIES = [StateCategory.COMPLETED, StateCategory.CANCELED] as const;
const FRONTEND_ROLES = [ProjectRole.WEB_FRONTEND, ProjectRole.APP_FRONTEND] as const;
const HANDOFF_SECTION_TITLES = [
  '변경 요약',
  'API 명세 링크',
  '사용 가능 환경',
  '추가·변경 API',
  '요청·응답 변경',
  '오류·권한',
  '프론트 주의사항',
] as const;

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
    version: comment.version,
  };
}

function isTerminal(category: StateCategory): boolean {
  return TERMINAL_CATEGORIES.includes(category as (typeof TERMINAL_CATEGORIES)[number]);
}

function assertVersions(
  rows: Map<string, IssueLockRow>,
  dto: {
    blockedIssueId: string;
    blockedIssueVersion: number;
    blockingIssueId: string;
    blockingIssueVersion: number;
  },
): void {
  const blockingIssue = rows.get(dto.blockingIssueId);
  const blockedIssue = rows.get(dto.blockedIssueId);
  if (!blockingIssue || !blockedIssue) {
    resourceNotFound('팀 작업을 찾을 수 없습니다.');
  }
  if (
    blockingIssue.version !== dto.blockingIssueVersion ||
    blockedIssue.version !== dto.blockedIssueVersion
  ) {
    const currentVersion =
      blockingIssue.version !== dto.blockingIssueVersion
        ? blockingIssue.version
        : blockedIssue.version;
    conflict('VERSION_CONFLICT', '이슈가 다른 요청에서 변경되었습니다.', {
      currentVersion,
      details: {
        blockedIssueVersion: blockedIssue.version,
        blockingIssueVersion: blockingIssue.version,
      },
    });
  }
}

function meaningfulSectionContent(content: string): boolean {
  if (content === '해당 없음') {
    return true;
  }

  return content.replace(/[`*_>#\-[\](){}]/g, '').trim().length > 0;
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

  const headings = [...bodyMarkdown.matchAll(/^##[ \t]+(.+?)[ \t]*$/gmu)];
  if (
    headings.length !== HANDOFF_SECTION_TITLES.length ||
    headings.some((heading, index) => heading[1] !== HANDOFF_SECTION_TITLES[index])
  ) {
    unprocessable('HANDOFF_CONTENT_REQUIRED', '작업 전달 템플릿의 일곱 항목을 작성해 주세요.');
  }

  const sections = headings.map((heading, index) => {
    const contentStart = (heading.index ?? 0) + heading[0].length;
    const contentEnd = headings[index + 1]?.index ?? bodyMarkdown.length;
    return bodyMarkdown.slice(contentStart, contentEnd).trim();
  });
  if (sections.some((section) => !meaningfulSectionContent(section))) {
    unprocessable(
      'HANDOFF_CONTENT_REQUIRED',
      '각 작업 전달 항목에 내용 또는 해당 없음을 입력해 주세요.',
    );
  }

  const apiSpecification = sections[1];
  if (apiSpecification !== '해당 없음') {
    const candidates = apiSpecification?.match(/https?:\/\/[^\s<>\])]+/giu) ?? [];
    const hasValidUrl = candidates.some((candidate) => {
      try {
        const url = new URL(candidate);
        return (
          (url.protocol === 'http:' || url.protocol === 'https:') &&
          url.hostname.length > 0 &&
          url.username.length === 0 &&
          url.password.length === 0
        );
      } catch {
        return false;
      }
    });
    if (!hasValidUrl) {
      unprocessable('MARKDOWN_INVALID', 'API 명세 링크는 HTTP(S) URL이어야 합니다.');
    }
  }
  const parsed = parseMarkdown(bodyMarkdown, 50_000);
  if (parsed.mentionedMembershipIds.length > 0) {
    unprocessable('MARKDOWN_INVALID', '작업 전달에는 멘션을 사용할 수 없습니다.');
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

  async createBlockRelation(
    context: Context,
    dto: CreateIssueBlockRelationDto,
  ): Promise<IssueBlockRelationMutationResponseDto> {
    if (dto.blockingIssueId === dto.blockedIssueId) {
      unprocessable('BLOCK_RELATION_SELF', '작업이 자기 자신을 차단할 수 없습니다.');
    }

    return this.database.client.$transaction(async (transaction) => {
      await this.lockWorkspace(transaction, context.workspaceId);
      await this.lockActiveActor(transaction, context);
      const issues = await this.lockIssues(transaction, context.workspaceId, [
        dto.blockingIssueId,
        dto.blockedIssueId,
      ]);
      assertVersions(issues, dto);

      const duplicate = await transaction.issueBlockRelation.findUnique({
        select: { id: true },
        where: {
          blockingIssueId_blockedIssueId: {
            blockedIssueId: dto.blockedIssueId,
            blockingIssueId: dto.blockingIssueId,
          },
        },
      });
      if (duplicate) {
        conflict('BLOCK_RELATION_DUPLICATE', '이미 등록된 차단 관계입니다.');
      }

      const cycle = await transaction.$queryRaw<Array<{ found: number }>>`
        WITH RECURSIVE "reachable"("issueId") AS (
          SELECT "blocked_issue_id"
          FROM "issue_block_relations"
          WHERE "workspace_id" = ${context.workspaceId}::uuid
            AND "blocking_issue_id" = ${dto.blockedIssueId}::uuid
          UNION
          SELECT "relation"."blocked_issue_id"
          FROM "issue_block_relations" AS "relation"
          INNER JOIN "reachable"
            ON "reachable"."issueId" = "relation"."blocking_issue_id"
          WHERE "relation"."workspace_id" = ${context.workspaceId}::uuid
        )
        SELECT 1 AS "found"
        FROM "reachable"
        WHERE "issueId" = ${dto.blockingIssueId}::uuid
        LIMIT 1
      `;
      if (cycle.length > 0) {
        conflict('BLOCK_RELATION_CYCLE', '순환 차단 관계는 등록할 수 없습니다.');
      }

      const relation = await transaction.issueBlockRelation.create({
        data: {
          blockedIssueId: dto.blockedIssueId,
          blockingIssueId: dto.blockingIssueId,
          createdByMembershipId: context.membershipId,
          workspaceId: context.workspaceId,
        },
      });
      await this.bumpIssueVersions(transaction, context.workspaceId, [
        dto.blockingIssueId,
        dto.blockedIssueId,
      ]);
      await this.recordRelationActivities(transaction, context, relation, 'ADDED');

      return this.relationMutationResponse(
        transaction,
        context.workspaceId,
        relation,
        isTerminal(issues.get(dto.blockingIssueId)!.category),
      );
    });
  }

  async removeBlockRelation(
    context: Context,
    relationId: string,
    dto: RemoveIssueBlockRelationDto,
  ): Promise<IssueBlockRelationMutationResponseDto> {
    return this.database.client.$transaction(async (transaction) => {
      await this.lockWorkspace(transaction, context.workspaceId);
      await this.lockActiveActor(transaction, context);
      const relation = await transaction.issueBlockRelation.findFirst({
        where: { id: relationId, workspaceId: context.workspaceId },
      });
      if (!relation) {
        resourceNotFound('차단 관계를 찾을 수 없습니다.');
      }

      const issues = await this.lockIssues(transaction, context.workspaceId, [
        relation.blockingIssueId,
        relation.blockedIssueId,
      ]);
      assertVersions(issues, {
        ...dto,
        blockedIssueId: relation.blockedIssueId,
        blockingIssueId: relation.blockingIssueId,
      });
      await transaction.issueBlockRelation.delete({ where: { id: relation.id } });
      await this.bumpIssueVersions(transaction, context.workspaceId, [
        relation.blockingIssueId,
        relation.blockedIssueId,
      ]);
      await this.recordRelationActivities(transaction, context, relation, 'REMOVED');

      return this.relationMutationResponse(
        transaction,
        context.workspaceId,
        relation,
        isTerminal(issues.get(relation.blockingIssueId)!.category),
      );
    });
  }

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
      await this.lockHandoffIssue(transaction, context.workspaceId, issueId);

      const comment = await transaction.comment.create({
        data: {
          authorMembershipId: context.membershipId,
          bodyMarkdown: markdown.bodyMarkdown,
          issueId,
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
      await this.lockHandoffIssue(transaction, context.workspaceId, issueId);
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
      await this.lockHandoffIssue(transaction, context.workspaceId, issueId);
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
    issueId: string,
    dto: CreateIssueHandoffDto,
  ): Promise<HandoffResourceResponseDto> {
    return this.database.client.$transaction(async (transaction) => {
      await this.lockWorkspace(transaction, context.workspaceId);
      await this.lockActiveActor(transaction, context);
      return this.createHandoffInTransaction(transaction, context, issueId, dto);
    });
  }

  async createHandoffInTransaction(
    transaction: Transaction,
    context: Context,
    issueId: string,
    dto: { bodyMarkdown: string; kind: HandoffKind },
  ): Promise<HandoffResourceResponseDto> {
    const markdown = parseHandoffMarkdown(dto.bodyMarkdown);
    const issue = await this.lockHandoffIssue(transaction, context.workspaceId, issueId);
    if (issue.type !== IssueType.TEAM_TASK || issue.projectRole !== ProjectRole.BACKEND) {
      unprocessable(
        'HANDOFF_NOT_ALLOWED',
        '백엔드 역할의 팀 작업에만 작업 전달을 작성할 수 있습니다.',
      );
    }

    const handoffs = await transaction.apiHandoff.findMany({
      orderBy: { sequenceNumber: 'desc' },
      select: { kind: true, sequenceNumber: true },
      where: { issueId, workspaceId: context.workspaceId },
    });
    const hasInitial = handoffs.some(({ kind }) => kind === HandoffKind.INITIAL);
    if (dto.kind === HandoffKind.INITIAL && hasInitial) {
      conflict('INITIAL_HANDOFF_EXISTS', '최초 작업 전달이 이미 존재합니다.');
    }
    if (dto.kind === HandoffKind.FOLLOW_UP && !hasInitial) {
      conflict('INITIAL_HANDOFF_REQUIRED', '최초 작업 전달을 먼저 작성해 주세요.');
    }

    const created = await transaction.apiHandoff.create({
      data: {
        authorMembershipId: context.membershipId,
        bodyMarkdown: markdown.bodyMarkdown,
        issueId,
        kind: dto.kind,
        sequenceNumber: (handoffs[0]?.sequenceNumber ?? 0) + 1,
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
    await this.files.syncBodyImages(
      transaction,
      context,
      issueId,
      IssueFileKind.HANDOFF_IMAGE,
      markdown.fileIds,
      { apiHandoffId: created.id },
    );
    const downstream = await this.downstreamTargets(transaction, context.workspaceId, issueId);
    const downstreamIssueIds = downstream.map(({ blockedIssue }) => blockedIssue.id);
    const candidateRecipientMembershipIds = [
      ...new Set(
        downstream.flatMap(({ blockedIssue }) => [
          ...(blockedIssue.assigneeMembershipId ? [blockedIssue.assigneeMembershipId] : []),
          ...blockedIssue.subscriptions.map(({ membershipId }) => membershipId),
        ]),
      ),
    ].sort();

    await transaction.activityEvent.create({
      data: {
        actorMembershipId: context.membershipId,
        afterData: {
          handoffId: created.id,
          kind: created.kind,
          sequenceNumber: created.sequenceNumber,
        },
        beforeData: Prisma.JsonNull,
        eventType: API_HANDOFF_CREATED,
        fieldName: 'handoff',
        issueId,
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
          downstreamIssueIds,
          handoffId: created.id,
          issueId,
          kind: created.kind,
          schemaVersion: API_HANDOFF_CREATED_SCHEMA_VERSION,
        },
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
      kind: created.kind,
      sequenceNumber: created.sequenceNumber,
    };
  }

  async ensureInitialHandoffForCompletion(
    transaction: Transaction,
    context: Context,
    issueId: string,
    handoff?: { bodyMarkdown: string },
  ): Promise<HandoffResourceResponseDto | null> {
    const issue = await this.lockHandoffIssue(transaction, context.workspaceId, issueId);
    if (issue.type !== IssueType.TEAM_TASK || issue.projectRole !== ProjectRole.BACKEND) {
      if (handoff) {
        unprocessable(
          'HANDOFF_NOT_ALLOWED',
          '백엔드 역할의 팀 작업에만 작업 전달을 작성할 수 있습니다.',
        );
      }
      return null;
    }

    const initial = await transaction.apiHandoff.findFirst({
      select: { id: true },
      where: { issueId, kind: HandoffKind.INITIAL, workspaceId: context.workspaceId },
    });
    if (initial) {
      if (handoff) {
        conflict('INITIAL_HANDOFF_EXISTS', '최초 작업 전달이 이미 존재합니다.');
      }
      return null;
    }
    if (handoff) {
      return this.createHandoffInTransaction(transaction, context, issueId, {
        bodyMarkdown: handoff.bodyMarkdown,
        kind: HandoffKind.INITIAL,
      });
    }

    if ((await this.downstreamTargets(transaction, context.workspaceId, issueId)).length > 0) {
      conflict('HANDOFF_REQUIRED', '후행 프론트 작업을 위해 최초 작업 전달이 필요합니다.');
    }
    return null;
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
          kind: handoff.kind,
          sequenceNumber: handoff.sequenceNumber,
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

  private async lockIssues(
    transaction: Transaction,
    workspaceId: string,
    issueIds: string[],
  ): Promise<Map<string, IssueLockRow>> {
    const stableIds = [...new Set(issueIds)].sort();
    const rows = await transaction.$queryRaw<IssueLockRow[]>(Prisma.sql`
      SELECT
        "issue"."id",
        "issue"."identifier",
        "issue"."title",
        "issue"."type",
        "issue"."project_role" AS "projectRole",
        "issue"."version",
        "state"."category"
      FROM "issues" AS "issue"
      INNER JOIN "workflow_states" AS "state"
        ON "state"."id" = "issue"."workflow_state_id"
        AND "state"."workspace_id" = "issue"."workspace_id"
      WHERE "issue"."workspace_id" = ${workspaceId}::uuid
        AND "issue"."type" = 'TEAM_TASK'::"IssueType"
        AND "issue"."deleted_at" IS NULL
        AND "issue"."id" IN (${Prisma.join(
          stableIds.map((issueId) => Prisma.sql`${issueId}::uuid`),
        )})
      ORDER BY "issue"."id"
      FOR UPDATE OF "issue"
    `);
    if (rows.length !== stableIds.length) {
      resourceNotFound('팀 작업을 찾을 수 없습니다.');
    }
    return new Map(rows.map((issue) => [issue.id, issue]));
  }

  private async lockHandoffIssue(
    transaction: Transaction,
    workspaceId: string,
    issueId: string,
  ): Promise<HandoffIssueLockRow> {
    const [issue] = await transaction.$queryRaw<HandoffIssueLockRow[]>`
      SELECT "id", "type", "project_role" AS "projectRole"
      FROM "issues"
      WHERE "workspace_id" = ${workspaceId}::uuid
        AND "id" = ${issueId}::uuid
        AND "deleted_at" IS NULL
      FOR UPDATE
    `;
    if (!issue) {
      resourceNotFound('이슈를 찾을 수 없습니다.');
    }
    return issue;
  }

  private async bumpIssueVersions(
    transaction: Transaction,
    workspaceId: string,
    issueIds: string[],
  ): Promise<void> {
    for (const issueId of [...issueIds].sort()) {
      const updated = await transaction.issue.update({
        data: { version: { increment: 1 } },
        select: { id: true, version: true },
        where: { id: issueId },
      });
      await notifyResourceChanged(transaction, {
        changeType: 'UPDATED',
        resourceId: updated.id,
        resourceType: 'ISSUE',
        version: updated.version,
        workspaceId,
      });
    }
  }

  private async recordRelationActivities(
    transaction: Transaction,
    context: Context,
    relation: {
      blockedIssueId: string;
      blockingIssueId: string;
      id: string;
    },
    action: 'ADDED' | 'REMOVED',
  ): Promise<void> {
    const snapshots = [
      {
        direction: 'BLOCKING',
        issueId: relation.blockingIssueId,
        targetIssueId: relation.blockedIssueId,
      },
      {
        direction: 'BLOCKED_BY',
        issueId: relation.blockedIssueId,
        targetIssueId: relation.blockingIssueId,
      },
    ];
    await transaction.activityEvent.createMany({
      data: snapshots.map(({ direction, issueId, targetIssueId }) => ({
        actorMembershipId: context.membershipId,
        afterData:
          action === 'ADDED'
            ? { direction, issueId: targetIssueId, relationId: relation.id }
            : Prisma.JsonNull,
        beforeData:
          action === 'REMOVED'
            ? { direction, issueId: targetIssueId, relationId: relation.id }
            : Prisma.JsonNull,
        eventType: `ISSUE_BLOCK_RELATION_${action}`,
        fieldName: 'blockRelations',
        issueId,
        workspaceId: context.workspaceId,
      })),
    });
  }

  private async relationMutationResponse(
    transaction: Transaction,
    workspaceId: string,
    relation: {
      blockedIssueId: string;
      blockingIssueId: string;
      createdAt: Date;
      id: string;
    },
    resolved: boolean,
  ): Promise<IssueBlockRelationMutationResponseDto> {
    const rows = await transaction.$queryRaw<AffectedIssueRow[]>(Prisma.sql`
      SELECT
        "issue"."id",
        "issue"."identifier",
        "issue"."title",
        "issue"."type",
        "issue"."project_role" AS "projectRole",
        "issue"."version",
        "state"."category",
        EXISTS (
          SELECT 1
          FROM "issue_block_relations" AS "incoming"
          INNER JOIN "issues" AS "blocker"
            ON "blocker"."id" = "incoming"."blocking_issue_id"
            AND "blocker"."workspace_id" = "incoming"."workspace_id"
          INNER JOIN "workflow_states" AS "blocker_state"
            ON "blocker_state"."id" = "blocker"."workflow_state_id"
            AND "blocker_state"."workspace_id" = "blocker"."workspace_id"
          WHERE "incoming"."workspace_id" = "issue"."workspace_id"
            AND "incoming"."blocked_issue_id" = "issue"."id"
            AND "blocker"."deleted_at" IS NULL
            AND "blocker_state"."category" NOT IN (
              'COMPLETED'::"StateCategory",
              'CANCELED'::"StateCategory"
            )
        ) AS "blocked"
      FROM "issues" AS "issue"
      INNER JOIN "workflow_states" AS "state"
        ON "state"."id" = "issue"."workflow_state_id"
        AND "state"."workspace_id" = "issue"."workspace_id"
      WHERE "issue"."workspace_id" = ${workspaceId}::uuid
        AND "issue"."deleted_at" IS NULL
        AND "issue"."id" IN (
          ${relation.blockingIssueId}::uuid,
          ${relation.blockedIssueId}::uuid
        )
    `);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const response = (issueId: string): AffectedIssueResponseDto => {
      const issue = byId.get(issueId);
      if (!issue) {
        return resourceNotFound('팀 작업을 찾을 수 없습니다.');
      }
      return {
        blocked: issue.blocked,
        category: issue.category,
        id: issue.id,
        identifier: issue.identifier,
        projectRole: issue.projectRole,
        title: issue.title,
        version: issue.version,
      };
    };

    return {
      blockedIssue: response(relation.blockedIssueId),
      blockingIssue: response(relation.blockingIssueId),
      relation: {
        blockedIssueId: relation.blockedIssueId,
        blockingIssueId: relation.blockingIssueId,
        createdAt: relation.createdAt.toISOString(),
        id: relation.id,
        resolved,
      },
    };
  }

  private downstreamTargets(transaction: Transaction, workspaceId: string, issueId: string) {
    return transaction.issueBlockRelation.findMany({
      orderBy: { blockedIssueId: 'asc' },
      select: {
        blockedIssue: {
          select: {
            assigneeMembershipId: true,
            id: true,
            subscriptions: {
              orderBy: { membershipId: 'asc' },
              select: { membershipId: true },
            },
          },
        },
      },
      where: {
        blockedIssue: {
          deletedAt: null,
          projectRole: { in: [...FRONTEND_ROLES] },
          type: IssueType.TEAM_TASK,
          workflowState: { category: { notIn: [...TERMINAL_CATEGORIES] } },
        },
        blockingIssueId: issueId,
        workspaceId,
      },
    });
  }
}
