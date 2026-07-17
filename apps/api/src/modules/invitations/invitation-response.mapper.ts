import type { InvitationResponseDto } from './dto/invitation.dto';

export type InvitationRow = {
  acceptedAt: Date | null;
  canceledAt: Date | null;
  createdAt: Date;
  email: string;
  expiresAt: Date;
  id: string;
  invitedByDisplayName: string;
  invitedByMembershipId: string;
};

export function toInvitationResponse(invitation: InvitationRow): InvitationResponseDto {
  return {
    acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
    canceledAt: invitation.canceledAt?.toISOString() ?? null,
    createdAt: invitation.createdAt.toISOString(),
    email: invitation.email,
    expiresAt: invitation.expiresAt.toISOString(),
    id: invitation.id,
    invitedByDisplayName: invitation.invitedByDisplayName,
    invitedByMembershipId: invitation.invitedByMembershipId,
    status: invitation.acceptedAt
      ? 'ACCEPTED'
      : invitation.canceledAt
        ? 'CANCELED'
        : invitation.expiresAt <= new Date()
          ? 'EXPIRED'
          : 'PENDING',
  };
}
