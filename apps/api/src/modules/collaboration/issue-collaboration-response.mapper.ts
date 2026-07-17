import { MembershipRole, MembershipStatus, Prisma } from '@rivet/database';

import type {
  CollaborationMemberSummaryResponseDto,
  CommentResourceResponseDto,
} from './dto/issue-collaboration-response.dto';

export const COMMENT_SELECT = {
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

export type CommentRow = Prisma.CommentGetPayload<{ select: typeof COMMENT_SELECT }>;

export function toCollaborationMemberResponse(member: {
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

export function toCommentResponse(comment: CommentRow): CommentResourceResponseDto {
  return {
    author: toCollaborationMemberResponse(comment.authorMembership),
    bodyMarkdown: comment.bodyMarkdown,
    createdAt: comment.createdAt.toISOString(),
    deletedAt: comment.deletedAt?.toISOString() ?? null,
    editedAt: comment.editedAt?.toISOString() ?? null,
    id: comment.id,
    teamWorkId: comment.teamWorkId,
    version: comment.version,
  };
}
