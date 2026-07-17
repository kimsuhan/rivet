import { HttpStatus, Injectable } from '@nestjs/common';

import { IssueFileKind, Prisma } from '@rivet/database';
import {
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
import type { CreateCommentDto, UpdateCommentDto } from './dto/issue-collaboration-request.dto';
import type { CommentResourceResponseDto } from './dto/issue-collaboration-response.dto';
import type { IssueCollaborationContext as Context } from './issue-collaboration.context';
import {
  collaborationConflict as conflict,
  collaborationResourceNotFound as resourceNotFound,
} from './issue-collaboration.errors';
import { IssueCollaborationLockService } from './issue-collaboration-lock.service';
import {
  COMMENT_SELECT,
  type CommentRow,
  toCommentResponse,
} from './issue-collaboration-response.mapper';

type Transaction = Prisma.TransactionClient;

interface CommentLockRow {
  authorMembershipId: string;
  bodyMarkdown: string | null;
  deletedAt: Date | null;
  id: string;
  issueId: string;
  teamWorkId: string | null;
  version: number;
}

@Injectable()
export class IssueCommentService {
  constructor(
    private readonly database: DatabaseService,
    private readonly files: FilesService,
    private readonly locks: IssueCollaborationLockService,
  ) {}

  async createComment(
    context: Context,
    issueId: string,
    dto: CreateCommentDto,
  ): Promise<CommentResourceResponseDto> {
    const markdown = parseMarkdown(dto.bodyMarkdown, 50_000);

    return this.database.client.$transaction(async (transaction) => {
      await this.locks.lockWorkspace(transaction, context.workspaceId);
      await this.locks.lockActiveActor(transaction, context);
      await assertActiveMentionMemberships(
        transaction,
        context.workspaceId,
        markdown.mentionedMembershipIds,
      );
      await this.locks.lockIssue(transaction, context.workspaceId, issueId);
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
      await this.locks.lockWorkspace(transaction, context.workspaceId);
      await this.locks.lockActiveActor(transaction, context);
      await assertActiveMentionMemberships(
        transaction,
        context.workspaceId,
        markdown.mentionedMembershipIds,
      );
      await this.locks.lockIssue(transaction, context.workspaceId, issueId);
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
      await this.locks.lockWorkspace(transaction, context.workspaceId);
      await this.locks.lockActiveActor(transaction, context);
      await this.locks.lockIssue(transaction, context.workspaceId, issueId);
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
}
