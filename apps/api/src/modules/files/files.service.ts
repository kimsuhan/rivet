import { randomUUID } from 'node:crypto';

import { HttpStatus, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { FileScope, IssueFileKind, MembershipStatus, Prisma } from '@rivet/database';

import { DatabaseService } from '../../common/database/database.service';
import { notifyResourceChanged } from '../../common/realtime/notify-resource-changed';
import type {
  FileResourceResponseDto,
  FileUserSummaryResponseDto,
  IssueAttachmentResponseDto,
} from './dto/file-response.dto';
import { fileError, fileResourceNotFound } from './file.errors';
import { FileRepository } from './file.repository';
import { bodyAttachmentWhere } from './file-access.policy';
import { detectMimeType, isInlineDisplayable, sanitizeOriginalName } from './file-content.policy';
import {
  FILE_RESOURCE_SELECT,
  type FileResourceRow,
  ISSUE_ATTACHMENT_SELECT,
  toFileResource,
  toIssueAttachment,
} from './file-response.mapper';
import { FileStorageService } from './file-storage.service';

const MAX_FILE_SIZE_BYTES = 26_214_400;
const PROFILE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type Transaction = Prisma.TransactionClient;

export type UploadedTemporaryFile = {
  originalname: string;
  path: string;
  size: number;
};

type FileMutationContext = {
  membershipId: string;
  userId: string;
  workspaceId: string;
};

@Injectable()
export class FilesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly files: FileRepository,
    private readonly storage: FileStorageService,
  ) {}

  async upload(
    context: {
      membershipId: string | null;
      userId: string;
      workspaceId: string | null;
    },
    scope: FileScope,
    uploadedFile: UploadedTemporaryFile | undefined,
  ): Promise<FileResourceResponseDto> {
    if (!uploadedFile) {
      fileError('FILE_EMPTY', '업로드할 파일을 선택해 주세요.', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    const temporaryPath = this.storage.resolveTemporaryPath(uploadedFile.path);
    const discardTemporaryFile = async (): Promise<void> => {
      await this.storage.discardTemporary(temporaryPath);
    };

    if (uploadedFile.size < 1) {
      await discardTemporaryFile();
      fileError('FILE_EMPTY', '빈 파일은 업로드할 수 없습니다.', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    if (uploadedFile.size > MAX_FILE_SIZE_BYTES) {
      await discardTemporaryFile();
      fileError('FILE_TOO_LARGE', '파일은 25MB 이하여야 합니다.', HttpStatus.PAYLOAD_TOO_LARGE);
    }
    const workspaceUpload =
      context.membershipId && context.workspaceId
        ? { membershipId: context.membershipId, workspaceId: context.workspaceId }
        : null;
    if (scope === FileScope.WORKSPACE && !workspaceUpload) {
      await discardTemporaryFile();
      fileError('FORBIDDEN', '워크스페이스 파일을 업로드할 권한이 없습니다.', HttpStatus.FORBIDDEN);
    }

    const signature = await this.storage.readSignature(temporaryPath);
    const detectedMimeType = detectMimeType(signature);
    if (scope === FileScope.USER_PROFILE && !PROFILE_MIME_TYPES.has(detectedMimeType)) {
      await discardTemporaryFile();
      fileError(
        'FILE_TYPE_NOT_ALLOWED',
        '프로필 사진은 JPEG, PNG 또는 WebP 형식이어야 합니다.',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }

    const id = randomUUID();
    const storageKey = `objects/${id}`;
    await this.storage.persistTemporary(temporaryPath, storageKey);

    let file: FileResourceRow;
    try {
      file = await this.database.client.$transaction(async (transaction) => {
        if (scope === FileScope.WORKSPACE && workspaceUpload) {
          const [membership] = await transaction.$queryRaw<Array<{ id: string }>>`
            SELECT "id"
            FROM "workspace_memberships"
            WHERE "id" = ${workspaceUpload.membershipId}::uuid
              AND "workspace_id" = ${workspaceUpload.workspaceId}::uuid
              AND "user_id" = ${context.userId}::uuid
              AND "status" = ${MembershipStatus.ACTIVE}::"MembershipStatus"
            FOR SHARE
          `;
          if (!membership) {
            fileError(
              'FORBIDDEN',
              '워크스페이스 파일을 업로드할 권한이 없습니다.',
              HttpStatus.FORBIDDEN,
            );
          }
        }

        const created = await transaction.file.create({
          data: {
            detectedMimeType,
            id,
            originalName: sanitizeOriginalName(uploadedFile.originalname),
            scope,
            sizeBytes: uploadedFile.size,
            storageKey,
            uploadedByUserId: context.userId,
            workspaceId:
              scope === FileScope.WORKSPACE && workspaceUpload ? workspaceUpload.workspaceId : null,
          },
          select: FILE_RESOURCE_SELECT,
        });
        if (scope === FileScope.WORKSPACE && workspaceUpload) {
          await notifyResourceChanged(transaction, {
            changeType: 'CREATED',
            resourceId: created.id,
            resourceType: 'FILE',
            version: null,
            workspaceId: workspaceUpload.workspaceId,
          });
        }
        return created;
      });
    } catch (error) {
      await this.storage.delete(storageKey);
      throw error;
    }

    return toFileResource(file, false);
  }

  async delete(context: { userId: string }, fileId: string): Promise<void> {
    const storageKey = await this.database.client.$transaction(async (transaction) => {
      const files = await this.files.lockFiles(transaction, [fileId]);
      const file = files[0];
      if (
        !file ||
        file.uploadedByUserId !== context.userId ||
        file.avatarLinked ||
        file.attachmentId !== null
      ) {
        fileResourceNotFound();
      }

      await transaction.file.delete({ where: { id: file.id } });
      if (file.workspaceId) {
        await notifyResourceChanged(transaction, {
          changeType: 'DELETED',
          resourceId: file.id,
          resourceType: 'FILE',
          version: null,
          workspaceId: file.workspaceId,
        });
      }
      return file.storageKey;
    });

    await this.storage.delete(storageKey);
  }

  async attachToIssue(
    context: FileMutationContext,
    issueId: string,
    fileId: string,
  ): Promise<IssueAttachmentResponseDto> {
    return this.database.client.$transaction(async (transaction) => {
      await this.attachIssueFiles(transaction, context, issueId, [fileId]);
      const attachment = await transaction.issueFileAttachment.findUniqueOrThrow({
        select: ISSUE_ATTACHMENT_SELECT,
        where: { fileId },
      });
      return toIssueAttachment(attachment);
    });
  }

  async attachIssueFiles(
    transaction: Transaction,
    context: FileMutationContext,
    issueId: string,
    fileIds: string[],
  ): Promise<void> {
    const uniqueFileIds = [...new Set(fileIds)].sort();
    if (uniqueFileIds.length === 0) return;
    if (uniqueFileIds.some((fileId) => !isUUID(fileId, '4'))) {
      fileError(
        'FILE_REFERENCE_INVALID',
        '첨부파일 참조가 올바르지 않습니다.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    await this.files.lockActiveActorAndIssue(transaction, context, issueId);
    const lockedFiles = await this.files.lockFiles(transaction, uniqueFileIds);
    const filesById = new Map(lockedFiles.map((file) => [file.id, file]));
    for (const fileId of uniqueFileIds) {
      const file = filesById.get(fileId);
      if (
        !file ||
        file.scope !== FileScope.WORKSPACE ||
        file.workspaceId !== context.workspaceId ||
        file.uploadedByUserId !== context.userId
      ) {
        fileResourceNotFound();
      }
      if (file.avatarLinked || file.attachmentId !== null) {
        fileError('FILE_ALREADY_LINKED', '파일이 이미 연결되어 있습니다.', HttpStatus.CONFLICT);
      }
      await this.storage.assertAvailable(file.storageKey);
    }

    await transaction.issueFileAttachment.createMany({
      data: uniqueFileIds.map((fileId) => ({
        createdByMembershipId: context.membershipId,
        fileId,
        issueId,
        kind: IssueFileKind.ISSUE_ATTACHMENT,
        workspaceId: context.workspaceId,
      })),
    });
    await transaction.file.updateMany({
      data: { unlinkedAt: null },
      where: { id: { in: uniqueFileIds } },
    });
    for (const fileId of uniqueFileIds) {
      await notifyResourceChanged(transaction, {
        changeType: 'UPDATED',
        resourceId: fileId,
        resourceType: 'FILE',
        version: null,
        workspaceId: context.workspaceId,
      });
    }
  }

  async detachFromIssue(
    context: FileMutationContext,
    issueId: string,
    attachmentId: string,
  ): Promise<void> {
    await this.database.client.$transaction(async (transaction) => {
      await this.files.lockActiveActorAndIssue(transaction, context, issueId);
      const attachment = await transaction.issueFileAttachment.findFirst({
        select: { fileId: true, id: true },
        where: {
          id: attachmentId,
          issueId,
          kind: IssueFileKind.ISSUE_ATTACHMENT,
          workspaceId: context.workspaceId,
        },
      });
      if (!attachment) fileResourceNotFound('첨부파일을 찾을 수 없습니다.');

      await this.files.lockFiles(transaction, [attachment.fileId]);
      const removed = await transaction.issueFileAttachment.deleteMany({
        where: { id: attachment.id, fileId: attachment.fileId },
      });
      if (removed.count !== 1) fileResourceNotFound('첨부파일을 찾을 수 없습니다.');
      await transaction.file.update({
        data: { unlinkedAt: new Date() },
        where: { id: attachment.fileId },
      });
      await notifyResourceChanged(transaction, {
        changeType: 'UPDATED',
        resourceId: attachment.fileId,
        resourceType: 'FILE',
        version: null,
        workspaceId: context.workspaceId,
      });
    });
  }

  async setAvatar(
    context: { userId: string; workspaceId: string | null },
    fileId: string,
  ): Promise<FileUserSummaryResponseDto> {
    return this.database.client.$transaction(async (transaction) => {
      const [user] = await transaction.$queryRaw<
        Array<{ avatarFileId: string | null; displayName: string; id: string }>
      >`
        SELECT "id", "display_name" AS "displayName", "avatar_file_id" AS "avatarFileId"
        FROM "users"
        WHERE "id" = ${context.userId}::uuid
        FOR UPDATE
      `;
      if (!user) fileResourceNotFound('사용자를 찾을 수 없습니다.');

      const files = await this.files.lockFiles(
        transaction,
        [...new Set([fileId, ...(user.avatarFileId ? [user.avatarFileId] : [])])].sort(),
      );
      const next = files.find(({ id }) => id === fileId);
      if (
        !next ||
        next.scope !== FileScope.USER_PROFILE ||
        next.workspaceId !== null ||
        next.uploadedByUserId !== context.userId
      ) {
        fileResourceNotFound();
      }
      if (!PROFILE_MIME_TYPES.has(next.detectedMimeType)) {
        fileError(
          'FILE_TYPE_NOT_ALLOWED',
          '프로필 사진은 JPEG, PNG 또는 WebP 형식이어야 합니다.',
          HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        );
      }
      await this.storage.assertAvailable(next.storageKey);
      if (user.avatarFileId === fileId) {
        return { avatarFileId: fileId, displayName: user.displayName, id: user.id };
      }
      if (next.avatarLinked || next.attachmentId !== null) {
        fileError('FILE_ALREADY_LINKED', '파일이 이미 연결되어 있습니다.', HttpStatus.CONFLICT);
      }

      await transaction.user.update({ data: { avatarFileId: fileId }, where: { id: user.id } });
      await transaction.file.update({ data: { unlinkedAt: null }, where: { id: fileId } });
      if (user.avatarFileId) {
        await transaction.file.update({
          data: { unlinkedAt: new Date() },
          where: { id: user.avatarFileId },
        });
      }
      if (context.workspaceId) {
        for (const changedFileId of [fileId, ...(user.avatarFileId ? [user.avatarFileId] : [])]) {
          await notifyResourceChanged(transaction, {
            changeType: 'UPDATED',
            resourceId: changedFileId,
            resourceType: 'FILE',
            version: null,
            workspaceId: context.workspaceId,
          });
        }
      }

      return { avatarFileId: fileId, displayName: user.displayName, id: user.id };
    });
  }

  async clearAvatar(context: {
    userId: string;
    workspaceId: string | null;
  }): Promise<FileUserSummaryResponseDto> {
    return this.database.client.$transaction(async (transaction) => {
      const [user] = await transaction.$queryRaw<
        Array<{ avatarFileId: string | null; displayName: string; id: string }>
      >`
        SELECT "id", "display_name" AS "displayName", "avatar_file_id" AS "avatarFileId"
        FROM "users"
        WHERE "id" = ${context.userId}::uuid
        FOR UPDATE
      `;
      if (!user) fileResourceNotFound('사용자를 찾을 수 없습니다.');
      if (!user.avatarFileId) {
        return { avatarFileId: null, displayName: user.displayName, id: user.id };
      }

      await this.files.lockFiles(transaction, [user.avatarFileId]);
      await transaction.user.update({ data: { avatarFileId: null }, where: { id: user.id } });
      await transaction.file.update({
        data: { unlinkedAt: new Date() },
        where: { id: user.avatarFileId },
      });
      if (context.workspaceId) {
        await notifyResourceChanged(transaction, {
          changeType: 'UPDATED',
          resourceId: user.avatarFileId,
          resourceType: 'FILE',
          version: null,
          workspaceId: context.workspaceId,
        });
      }
      return { avatarFileId: null, displayName: user.displayName, id: user.id };
    });
  }

  async syncBodyImages(
    transaction: Transaction,
    context: FileMutationContext,
    issueId: string,
    kind:
      | typeof IssueFileKind.DESCRIPTION_IMAGE
      | typeof IssueFileKind.COMMENT_IMAGE
      | typeof IssueFileKind.HANDOFF_IMAGE,
    fileIds: string[],
    anchors: { apiHandoffId?: string; commentId?: string } = {},
  ): Promise<void> {
    if (
      fileIds.some((fileId) => !isUUID(fileId, '4')) ||
      (anchors.commentId !== undefined && !isUUID(anchors.commentId, '4')) ||
      (anchors.apiHandoffId !== undefined && !isUUID(anchors.apiHandoffId, '4'))
    ) {
      fileError(
        'FILE_REFERENCE_INVALID',
        '본문 파일 참조가 올바르지 않습니다.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    await this.files.lockActiveActorAndIssue(transaction, context, issueId);
    const targetWhere = bodyAttachmentWhere(context.workspaceId, issueId, kind, anchors);
    await this.files.lockBodyAnchor(transaction, context.workspaceId, issueId, kind, anchors);
    const current = await transaction.issueFileAttachment.findMany({
      orderBy: { fileId: 'asc' },
      select: { fileId: true, id: true },
      where: targetWhere,
    });
    const desiredIds = [...new Set(fileIds)].sort();
    const currentIds = new Set(current.map(({ fileId }) => fileId));
    const allIds = [...new Set([...desiredIds, ...currentIds])].sort();
    const files = await this.files.lockFiles(transaction, allIds);
    const filesById = new Map(files.map((file) => [file.id, file]));

    for (const fileId of desiredIds) {
      const file = filesById.get(fileId);
      if (!file) fileResourceNotFound();
      if (currentIds.has(fileId)) continue;
      if (
        file.scope !== FileScope.WORKSPACE ||
        file.workspaceId !== context.workspaceId ||
        file.uploadedByUserId !== context.userId
      ) {
        fileResourceNotFound();
      }
      if (!isInlineDisplayable(file.detectedMimeType)) {
        fileError(
          'FILE_TYPE_NOT_INLINE_DISPLAYABLE',
          '본문에는 JPEG, PNG, WebP 또는 GIF 이미지만 넣을 수 있습니다.',
          HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        );
      }
      if (file.avatarLinked || file.attachmentId !== null) {
        fileError(
          'FILE_ALREADY_LINKED',
          '파일이 이미 다른 리소스에 연결되어 있습니다.',
          HttpStatus.CONFLICT,
        );
      }
      await this.storage.assertAvailable(file.storageKey);
    }

    const removedIds = current.filter(({ fileId }) => !desiredIds.includes(fileId));
    const addedIds = desiredIds.filter((fileId) => !currentIds.has(fileId));
    if (removedIds.length > 0) {
      await transaction.issueFileAttachment.deleteMany({
        where: { id: { in: removedIds.map(({ id }) => id) } },
      });
      await transaction.file.updateMany({
        data: { unlinkedAt: new Date() },
        where: { id: { in: removedIds.map(({ fileId }) => fileId) } },
      });
    }
    if (addedIds.length > 0) {
      await transaction.issueFileAttachment.createMany({
        data: addedIds.map((fileId) => ({
          apiHandoffId: anchors.apiHandoffId ?? null,
          commentId: anchors.commentId ?? null,
          createdByMembershipId: context.membershipId,
          fileId,
          issueId,
          kind,
          workspaceId: context.workspaceId,
        })),
      });
      await transaction.file.updateMany({
        data: { unlinkedAt: null },
        where: { id: { in: addedIds } },
      });
    }
    for (const fileId of [...removedIds.map(({ fileId }) => fileId), ...addedIds]) {
      await notifyResourceChanged(transaction, {
        changeType: 'UPDATED',
        resourceId: fileId,
        resourceType: 'FILE',
        version: null,
        workspaceId: context.workspaceId,
      });
    }
  }

}
