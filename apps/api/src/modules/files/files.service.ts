import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import { HttpStatus, Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { isUUID } from 'class-validator';

import { FileScope, IssueFileKind, MembershipStatus, Prisma } from '@rivet/database';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import { notifyResourceChanged } from '../../common/realtime/notify-resource-changed';
import { apiConfig } from '../../config/api.config';
import type {
  FileResourceResponseDto,
  FileUserSummaryResponseDto,
  IssueAttachmentListResponseDto,
  IssueAttachmentResponseDto,
} from './dto/file-response.dto';
import { detectMimeType, isInlineDisplayable, sanitizeOriginalName } from './file-content';

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

type LockedFile = {
  attachmentId: string | null;
  avatarLinked: boolean;
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

const FILE_RESOURCE_SELECT = {
  createdAt: true,
  detectedMimeType: true,
  id: true,
  originalName: true,
  scope: true,
  sizeBytes: true,
} satisfies Prisma.FileSelect;

function resourceNotFound(message = '파일을 찾을 수 없습니다.'): never {
  throw new ApiError({ code: 'RESOURCE_NOT_FOUND', message, status: HttpStatus.NOT_FOUND });
}

function fileError(code: string, message: string, status: number): never {
  throw new ApiError({ code, message, status });
}

function toFileResource(
  file: Prisma.FileGetPayload<{ select: typeof FILE_RESOURCE_SELECT }>,
  linked: boolean,
): FileResourceResponseDto {
  return {
    createdAt: file.createdAt.toISOString(),
    detectedMimeType: file.detectedMimeType,
    id: file.id,
    inlineDisplayable: isInlineDisplayable(file.detectedMimeType),
    linked,
    originalName: file.originalName,
    scope: file.scope,
    sizeBytes: Number(file.sizeBytes),
  };
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

@Injectable()
export class FilesService implements OnModuleInit {
  private readonly objectsRoot: string;
  private readonly storageRoot: string;
  private readonly temporaryRoot: string;

  constructor(
    private readonly database: DatabaseService,
    @Inject(apiConfig.KEY) config: ConfigType<typeof apiConfig>,
  ) {
    this.storageRoot = resolve(config.fileStorageRoot);
    this.objectsRoot = resolve(this.storageRoot, 'objects');
    this.temporaryRoot = resolve(this.storageRoot, 'tmp');
  }

  async onModuleInit(): Promise<void> {
    await Promise.all([
      mkdir(this.objectsRoot, { mode: 0o700, recursive: true }),
      mkdir(this.temporaryRoot, { mode: 0o700, recursive: true }),
    ]);
  }

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

    const temporaryPath = this.resolveContainedTemporaryPath(uploadedFile.path);
    const discardTemporaryFile = async (): Promise<void> => {
      await unlink(temporaryPath).catch(() => undefined);
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

    const handle = await open(temporaryPath, 'r');
    const signature = Buffer.alloc(12);
    try {
      await handle.read(signature, 0, signature.length, 0);
    } finally {
      await handle.close();
    }
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
    const finalPath = this.resolveStorageKey(storageKey);

    try {
      await rename(temporaryPath, finalPath);
    } catch {
      await Promise.all([discardTemporaryFile(), unlink(finalPath).catch(() => undefined)]);
      fileError(
        'FILE_UNAVAILABLE',
        '파일 저장소를 일시적으로 사용할 수 없습니다.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    let file: Prisma.FileGetPayload<{ select: typeof FILE_RESOURCE_SELECT }>;
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
      await unlink(finalPath).catch(() => undefined);
      throw error;
    }

    return toFileResource(file, false);
  }

  async get(
    context: { userId: string; workspaceId: string | null },
    fileId: string,
  ): Promise<FileResourceResponseDto> {
    const file = await this.findAccessibleFile(context, fileId);
    await this.assertBinaryAvailable(file.storageKey);
    return toFileResource(file, file.avatarUser !== null || file.issueAttachments.length > 0);
  }

  async getBinary(
    context: { userId: string; workspaceId: string | null },
    fileId: string,
  ): Promise<{
    detectedMimeType: string;
    inlineDisplayable: boolean;
    originalName: string;
    path: string;
    sizeBytes: number;
  }> {
    const file = await this.findAccessibleFile(context, fileId);
    const path = await this.assertBinaryAvailable(file.storageKey);
    return {
      detectedMimeType: file.detectedMimeType,
      inlineDisplayable: isInlineDisplayable(file.detectedMimeType),
      originalName: file.originalName,
      path,
      sizeBytes: Number(file.sizeBytes),
    };
  }

  async delete(context: { userId: string }, fileId: string): Promise<void> {
    const storageKey = await this.database.client.$transaction(async (transaction) => {
      const files = await this.lockFiles(transaction, [fileId]);
      const file = files[0];
      if (
        !file ||
        file.uploadedByUserId !== context.userId ||
        file.avatarLinked ||
        file.attachmentId !== null
      ) {
        resourceNotFound();
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

    await unlink(this.resolveStorageKey(storageKey)).catch((error: unknown) => {
      if (!isMissingFileError(error)) throw error;
    });
  }

  async listIssueAttachments(
    context: { workspaceId: string },
    issueId: string,
  ): Promise<IssueAttachmentListResponseDto> {
    await this.requireIssue(this.database.client, context.workspaceId, issueId);
    const attachments = await this.database.client.issueFileAttachment.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        createdAt: true,
        id: true,
        kind: true,
        fileId: true,
        file: {
          select: {
            ...FILE_RESOURCE_SELECT,
            uploadedByUser: { select: { avatarFileId: true, displayName: true, id: true } },
          },
        },
      },
      where: { issueId, kind: IssueFileKind.ISSUE_ATTACHMENT, workspaceId: context.workspaceId },
    });

    return {
      items: attachments.map(({ createdAt, file, id }): IssueAttachmentResponseDto => ({
        createdAt: createdAt.toISOString(),
        file: toFileResource(file, true),
        id,
        kind: 'ISSUE_ATTACHMENT',
        uploader: {
          avatarFileId: file.uploadedByUser.avatarFileId,
          displayName: file.uploadedByUser.displayName,
          id: file.uploadedByUser.id,
        },
      })),
      nextCursor: null,
    };
  }

  async attachToIssue(
    context: FileMutationContext,
    issueId: string,
    fileId: string,
  ): Promise<IssueAttachmentResponseDto> {
    return this.database.client.$transaction(async (transaction) => {
      await this.attachIssueFiles(transaction, context, issueId, [fileId]);
      const attachment = await transaction.issueFileAttachment.findUniqueOrThrow({
        select: {
          createdAt: true,
          file: {
            select: {
              ...FILE_RESOURCE_SELECT,
              uploadedByUser: { select: { avatarFileId: true, displayName: true, id: true } },
            },
          },
          id: true,
        },
        where: { fileId },
      });

      return {
        createdAt: attachment.createdAt.toISOString(),
        file: toFileResource(attachment.file, true),
        id: attachment.id,
        kind: 'ISSUE_ATTACHMENT',
        uploader: attachment.file.uploadedByUser,
      };
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

    await this.lockActiveActorAndIssue(transaction, context, issueId);
    const lockedFiles = await this.lockFiles(transaction, uniqueFileIds);
    const filesById = new Map(lockedFiles.map((file) => [file.id, file]));
    for (const fileId of uniqueFileIds) {
      const file = filesById.get(fileId);
      if (
        !file ||
        file.scope !== FileScope.WORKSPACE ||
        file.workspaceId !== context.workspaceId ||
        file.uploadedByUserId !== context.userId
      ) {
        resourceNotFound();
      }
      if (file.avatarLinked || file.attachmentId !== null) {
        fileError('FILE_ALREADY_LINKED', '파일이 이미 연결되어 있습니다.', HttpStatus.CONFLICT);
      }
      await this.assertBinaryAvailable(file.storageKey);
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
      await this.lockActiveActorAndIssue(transaction, context, issueId);
      const attachment = await transaction.issueFileAttachment.findFirst({
        select: { fileId: true, id: true },
        where: {
          id: attachmentId,
          issueId,
          kind: IssueFileKind.ISSUE_ATTACHMENT,
          workspaceId: context.workspaceId,
        },
      });
      if (!attachment) resourceNotFound('첨부파일을 찾을 수 없습니다.');

      await this.lockFiles(transaction, [attachment.fileId]);
      const removed = await transaction.issueFileAttachment.deleteMany({
        where: { id: attachment.id, fileId: attachment.fileId },
      });
      if (removed.count !== 1) resourceNotFound('첨부파일을 찾을 수 없습니다.');
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
      if (!user) resourceNotFound('사용자를 찾을 수 없습니다.');

      const files = await this.lockFiles(
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
        resourceNotFound();
      }
      if (!PROFILE_MIME_TYPES.has(next.detectedMimeType)) {
        fileError(
          'FILE_TYPE_NOT_ALLOWED',
          '프로필 사진은 JPEG, PNG 또는 WebP 형식이어야 합니다.',
          HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        );
      }
      await this.assertBinaryAvailable(next.storageKey);
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
      if (!user) resourceNotFound('사용자를 찾을 수 없습니다.');
      if (!user.avatarFileId) {
        return { avatarFileId: null, displayName: user.displayName, id: user.id };
      }

      await this.lockFiles(transaction, [user.avatarFileId]);
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
    await this.lockActiveActorAndIssue(transaction, context, issueId);
    const targetWhere = this.bodyAttachmentWhere(context.workspaceId, issueId, kind, anchors);
    await this.lockBodyAnchor(transaction, context.workspaceId, issueId, kind, anchors);
    const current = await transaction.issueFileAttachment.findMany({
      orderBy: { fileId: 'asc' },
      select: { fileId: true, id: true },
      where: targetWhere,
    });
    const desiredIds = [...new Set(fileIds)].sort();
    const currentIds = new Set(current.map(({ fileId }) => fileId));
    const allIds = [...new Set([...desiredIds, ...currentIds])].sort();
    const files = await this.lockFiles(transaction, allIds);
    const filesById = new Map(files.map((file) => [file.id, file]));

    for (const fileId of desiredIds) {
      const file = filesById.get(fileId);
      if (!file) resourceNotFound();
      if (currentIds.has(fileId)) continue;
      if (
        file.scope !== FileScope.WORKSPACE ||
        file.workspaceId !== context.workspaceId ||
        file.uploadedByUserId !== context.userId
      ) {
        resourceNotFound();
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
      await this.assertBinaryAvailable(file.storageKey);
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

  private async findAccessibleFile(
    context: { userId: string; workspaceId: string | null },
    fileId: string,
  ): Promise<
    Prisma.FileGetPayload<{
      select: {
        avatarUser: {
          select: {
            id: true;
            membership: { select: { workspaceId: true } };
          };
        };
        createdAt: true;
        detectedMimeType: true;
        id: true;
        issueAttachments: { select: { workspaceId: true } };
        originalName: true;
        scope: true;
        sizeBytes: true;
        storageKey: true;
        uploadedByUserId: true;
      };
    }>
  > {
    const file = await this.database.client.file.findUnique({
      select: {
        avatarUser: {
          select: { id: true, membership: { select: { workspaceId: true } } },
        },
        ...FILE_RESOURCE_SELECT,
        issueAttachments: { select: { workspaceId: true } },
        storageKey: true,
        uploadedByUserId: true,
      },
      where: { id: fileId },
    });
    if (!file) resourceNotFound();

    const linkedToAvatar = file.avatarUser !== null;
    const linkedToIssue = file.issueAttachments.length > 0;
    const canAccessUnlinked =
      !linkedToAvatar && !linkedToIssue && file.uploadedByUserId === context.userId;
    const canAccessOwnAvatar = file.avatarUser?.id === context.userId;
    const canAccessWorkspaceAvatar =
      context.workspaceId !== null &&
      file.avatarUser?.membership?.workspaceId === context.workspaceId;
    const canAccessIssue =
      context.workspaceId !== null &&
      file.issueAttachments.some(({ workspaceId }) => workspaceId === context.workspaceId);

    if (!canAccessUnlinked && !canAccessOwnAvatar && !canAccessWorkspaceAvatar && !canAccessIssue) {
      resourceNotFound();
    }
    return file;
  }

  private async assertBinaryAvailable(storageKey: string): Promise<string> {
    let path: string;
    try {
      path = this.resolveStorageKey(storageKey);
      const metadata = await lstat(path);
      if (!metadata.isFile()) throw new Error('FILE_STORAGE_NOT_REGULAR');
    } catch {
      fileError(
        'FILE_UNAVAILABLE',
        '파일을 일시적으로 사용할 수 없습니다.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return path;
  }

  private resolveStorageKey(storageKey: string): string {
    if (
      isAbsolute(storageKey) ||
      !/^objects\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        storageKey,
      )
    ) {
      throw new Error('FILE_STORAGE_KEY_INVALID');
    }
    const path = resolve(this.storageRoot, storageKey);
    const pathRelativeToRoot = relative(this.storageRoot, path);
    if (
      pathRelativeToRoot.length === 0 ||
      pathRelativeToRoot.startsWith('..') ||
      isAbsolute(pathRelativeToRoot)
    ) {
      throw new Error('FILE_STORAGE_KEY_INVALID');
    }
    return path;
  }

  private resolveContainedTemporaryPath(path: string): string {
    const temporaryPath = resolve(path);
    const pathRelativeToTemporaryRoot = relative(this.temporaryRoot, temporaryPath);
    if (
      pathRelativeToTemporaryRoot.length === 0 ||
      pathRelativeToTemporaryRoot.startsWith('..') ||
      isAbsolute(pathRelativeToTemporaryRoot)
    ) {
      throw new Error('FILE_TEMPORARY_PATH_INVALID');
    }
    return temporaryPath;
  }

  private async lockFiles(transaction: Transaction, fileIds: string[]): Promise<LockedFile[]> {
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
             ) AS "avatarLinked"
      FROM "files" file
      LEFT JOIN "issue_file_attachments" attachment ON attachment."file_id" = file."id"
      WHERE file."id" IN (${Prisma.join(fileIds.map((fileId) => Prisma.sql`${fileId}::uuid`))})
      ORDER BY file."id"
      FOR UPDATE OF file
    `;
  }

  private async requireIssue(
    transaction: Transaction | typeof this.database.client,
    workspaceId: string,
    issueId: string,
  ): Promise<void> {
    const issue = await transaction.issue.findFirst({
      select: { id: true },
      where: { deletedAt: null, id: issueId, workspaceId },
    });
    if (!issue) resourceNotFound('이슈를 찾을 수 없습니다.');
  }

  private async lockActiveActorAndIssue(
    transaction: Transaction,
    context: FileMutationContext,
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
    if (!actor) resourceNotFound();
    const [issue] = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "issues"
      WHERE "workspace_id" = ${context.workspaceId}::uuid
        AND "id" = ${issueId}::uuid
        AND "deleted_at" IS NULL
      FOR UPDATE
    `;
    if (!issue) resourceNotFound('이슈를 찾을 수 없습니다.');
  }

  private bodyAttachmentWhere(
    workspaceId: string,
    issueId: string,
    kind:
      | typeof IssueFileKind.DESCRIPTION_IMAGE
      | typeof IssueFileKind.COMMENT_IMAGE
      | typeof IssueFileKind.HANDOFF_IMAGE,
    anchors: { apiHandoffId?: string; commentId?: string },
  ): Prisma.IssueFileAttachmentWhereInput {
    if (kind === IssueFileKind.DESCRIPTION_IMAGE) {
      if (anchors.commentId || anchors.apiHandoffId) {
        fileError('FILE_REFERENCE_INVALID', '본문 파일 참조가 올바르지 않습니다.', 422);
      }
      return { apiHandoffId: null, commentId: null, issueId, kind, workspaceId };
    }
    if (kind === IssueFileKind.COMMENT_IMAGE && anchors.commentId && !anchors.apiHandoffId) {
      return { apiHandoffId: null, commentId: anchors.commentId, issueId, kind, workspaceId };
    }
    if (kind === IssueFileKind.HANDOFF_IMAGE && anchors.apiHandoffId && !anchors.commentId) {
      return { apiHandoffId: anchors.apiHandoffId, commentId: null, issueId, kind, workspaceId };
    }
    return fileError('FILE_REFERENCE_INVALID', '본문 파일 참조가 올바르지 않습니다.', 422);
  }

  private async lockBodyAnchor(
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
      if (!comment) resourceNotFound('댓글을 찾을 수 없습니다.');
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
    if (!handoff) resourceNotFound('작업 전달을 찾을 수 없습니다.');
  }
}
