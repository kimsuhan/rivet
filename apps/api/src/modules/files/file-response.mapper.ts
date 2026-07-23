import { Prisma } from '@rivet/database';

import type {
  FileResourceResponseDto,
  IssueAttachmentResponseDto,
} from './dto/file-response.dto';
import { isInlineDisplayable } from './file-content.policy';

export const FILE_RESOURCE_SELECT = {
  createdAt: true,
  detectedMimeType: true,
  id: true,
  originalName: true,
  scope: true,
  sizeBytes: true,
} satisfies Prisma.FileSelect;

export const FILE_ACCESS_SELECT = {
  avatarUser: {
    select: { id: true, membership: { select: { workspaceId: true } } },
  },
  ...FILE_RESOURCE_SELECT,
  issueAttachments: { select: { workspaceId: true } },
  logoProject: { select: { workspaceId: true } },
  storageKey: true,
  uploadedByUserId: true,
} satisfies Prisma.FileSelect;

export const ISSUE_ATTACHMENT_SELECT = {
  createdAt: true,
  file: {
    select: {
      ...FILE_RESOURCE_SELECT,
      uploadedByUser: { select: { avatarFileId: true, displayName: true, id: true } },
    },
  },
  id: true,
  kind: true,
} satisfies Prisma.IssueFileAttachmentSelect;

export type FileResourceRow = Prisma.FileGetPayload<{ select: typeof FILE_RESOURCE_SELECT }>;
export type FileAccessRow = Prisma.FileGetPayload<{ select: typeof FILE_ACCESS_SELECT }>;
export type IssueAttachmentRow = Prisma.IssueFileAttachmentGetPayload<{
  select: typeof ISSUE_ATTACHMENT_SELECT;
}>;

export function toFileResource(
  file: FileResourceRow,
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

export function toIssueAttachment(attachment: IssueAttachmentRow): IssueAttachmentResponseDto {
  return {
    createdAt: attachment.createdAt.toISOString(),
    file: toFileResource(attachment.file, true),
    id: attachment.id,
    kind: 'ISSUE_ATTACHMENT',
    uploader: attachment.file.uploadedByUser,
  };
}
