import { Injectable } from '@nestjs/common';

import { FileScope, IssueFileKind, MembershipStatus, Prisma } from '@rivet/database';

import { DatabaseService } from '../../common/database/database.service';
import { fileResourceNotFound } from './file.errors';
import {
  FILE_ACCESS_SELECT,
  type FileAccessRow,
  ISSUE_ATTACHMENT_SELECT,
  type IssueAttachmentRow,
} from './file-response.mapper';

type Transaction = Prisma.TransactionClient;
type DatabaseClient = Transaction | DatabaseService['client'];

export type LockedFile = {
  attachmentId: string | null;
  avatarLinked: boolean;
  projectLogoLinked: boolean;
  createdAt: Date;
  detectedMimeType: string;
  id: string;
  originalName: string;
  scope: FileScope;
  sizeBytes: bigint;
  storageKey: string;
  uploadedByUserId: string;
  workspaceId: string | null;
};

@Injectable()
export class FileRepository {
  constructor(private readonly database: DatabaseService) {}

  async findAccessRow(fileId: string): Promise<FileAccessRow> {
    const file = await this.database.client.file.findUnique({
      select: FILE_ACCESS_SELECT,
      where: { id: fileId },
    });
    return file ?? fileResourceNotFound();
  }

  async findIssueAttachments(
    workspaceId: string,
    issueId: string,
  ): Promise<IssueAttachmentRow[]> {
    await this.requireIssue(this.database.client, workspaceId, issueId);
    return this.database.client.issueFileAttachment.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: ISSUE_ATTACHMENT_SELECT,
      where: { issueId, kind: IssueFileKind.ISSUE_ATTACHMENT, workspaceId },
    });
  }

  async lockFiles(transaction: Transaction, fileIds: string[]): Promise<LockedFile[]> {
    if (fileIds.length === 0) return [];
    return transaction.$queryRaw<LockedFile[]>`
      SELECT file."id",
             file."scope",
             file."workspace_id" AS "workspaceId",
             file."uploaded_by_user_id" AS "uploadedByUserId",
             file."storage_key" AS "storageKey",
             file."original_name" AS "originalName",
             file."detected_mime_type" AS "detectedMimeType",
             file."size_bytes" AS "sizeBytes",
             file."created_at" AS "createdAt",
             attachment."id" AS "attachmentId",
             EXISTS (
               SELECT 1 FROM "users" account WHERE account."avatar_file_id" = file."id"
             ) AS "avatarLinked",
             EXISTS (
               SELECT 1 FROM "projects" project WHERE project."logo_file_id" = file."id"
             ) AS "projectLogoLinked"
      FROM "files" file
      LEFT JOIN "issue_file_attachments" attachment ON attachment."file_id" = file."id"
      WHERE file."id" IN (${Prisma.join(fileIds.map((fileId) => Prisma.sql`${fileId}::uuid`))})
      ORDER BY file."id"
      FOR UPDATE OF file
    `;
  }

  async requireIssue(
    client: DatabaseClient,
    workspaceId: string,
    issueId: string,
  ): Promise<void> {
    const issue = await client.issue.findFirst({
      select: { id: true },
      where: { deletedAt: null, id: issueId, workspaceId },
    });
    if (!issue) fileResourceNotFound('이슈를 찾을 수 없습니다.');
  }

  async lockActiveActorAndIssue(
    transaction: Transaction,
    context: { membershipId: string; userId: string; workspaceId: string },
    issueId: string,
  ): Promise<void> {
    const [actor] = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "workspace_memberships"
      WHERE "workspace_id" = ${context.workspaceId}::uuid
        AND "id" = ${context.membershipId}::uuid
        AND "user_id" = ${context.userId}::uuid
        AND "status" = ${MembershipStatus.ACTIVE}::"MembershipStatus"
      FOR UPDATE
    `;
    if (!actor) fileResourceNotFound();
    const [issue] = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "issues"
      WHERE "workspace_id" = ${context.workspaceId}::uuid
        AND "id" = ${issueId}::uuid
        AND "deleted_at" IS NULL
      FOR UPDATE
    `;
    if (!issue) fileResourceNotFound('이슈를 찾을 수 없습니다.');
  }

  async lockBodyAnchor(
    transaction: Transaction,
    workspaceId: string,
    issueId: string,
    kind:
      | typeof IssueFileKind.DESCRIPTION_IMAGE
      | typeof IssueFileKind.COMMENT_IMAGE
      | typeof IssueFileKind.HANDOFF_IMAGE,
    anchors: { apiHandoffId?: string; commentId?: string },
  ): Promise<void> {
    if (kind === IssueFileKind.DESCRIPTION_IMAGE) return;
    if (kind === IssueFileKind.COMMENT_IMAGE) {
      const [comment] = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "comments"
        WHERE "workspace_id" = ${workspaceId}::uuid
          AND "issue_id" = ${issueId}::uuid
          AND "id" = ${anchors.commentId}::uuid
        FOR UPDATE
      `;
      if (!comment) fileResourceNotFound('댓글을 찾을 수 없습니다.');
      return;
    }
    const [handoff] = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "api_handoffs"
      WHERE "workspace_id" = ${workspaceId}::uuid
        AND "issue_id" = ${issueId}::uuid
        AND "id" = ${anchors.apiHandoffId}::uuid
      FOR UPDATE
    `;
    if (!handoff) fileResourceNotFound('작업 전달을 찾을 수 없습니다.');
  }
}
