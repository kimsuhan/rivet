import { HttpStatus } from '@nestjs/common';

import { IssueFileKind, Prisma } from '@rivet/database';

import { fileError } from './file.errors';
import type { FileAccessRow } from './file-response.mapper';

export function canAccessFile(
  file: FileAccessRow,
  context: { userId: string; workspaceId: string | null },
): boolean {
  const linkedToAvatar = file.avatarUser !== null;
  const linkedToIssue = file.issueAttachments.length > 0;
  const linkedToProject = file.logoProject !== null;
  const canAccessUnlinked =
    !linkedToAvatar &&
    !linkedToIssue &&
    !linkedToProject &&
    file.uploadedByUserId === context.userId;
  const canAccessOwnAvatar = file.avatarUser?.id === context.userId;
  const canAccessWorkspaceAvatar =
    context.workspaceId !== null &&
    file.avatarUser?.membership?.workspaceId === context.workspaceId;
  const canAccessIssue =
    context.workspaceId !== null &&
    file.issueAttachments.some(({ workspaceId }) => workspaceId === context.workspaceId);
  const canAccessProject =
    context.workspaceId !== null && file.logoProject?.workspaceId === context.workspaceId;

  return (
    canAccessUnlinked ||
    canAccessOwnAvatar ||
    canAccessWorkspaceAvatar ||
    canAccessIssue ||
    canAccessProject
  );
}

export function bodyAttachmentWhere(
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
      fileError(
        'FILE_REFERENCE_INVALID',
        '본문 파일 참조가 올바르지 않습니다.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return { apiHandoffId: null, commentId: null, issueId, kind, workspaceId };
  }
  if (kind === IssueFileKind.COMMENT_IMAGE && anchors.commentId && !anchors.apiHandoffId) {
    return { apiHandoffId: null, commentId: anchors.commentId, issueId, kind, workspaceId };
  }
  if (kind === IssueFileKind.HANDOFF_IMAGE && anchors.apiHandoffId && !anchors.commentId) {
    return { apiHandoffId: anchors.apiHandoffId, commentId: null, issueId, kind, workspaceId };
  }
  return fileError(
    'FILE_REFERENCE_INVALID',
    '본문 파일 참조가 올바르지 않습니다.',
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}
