export const WORKSPACE_INVITATION_EMAIL_SCHEMA_VERSION = 1 as const;
export const WORKSPACE_INVITATION_REQUESTED = 'WORKSPACE_INVITATION_REQUESTED' as const;

export type WorkspaceInvitationEmailOutboxPayload = {
  schemaVersion: typeof WORKSPACE_INVITATION_EMAIL_SCHEMA_VERSION;
  invitationId: string;
  tokenId: string;
  currentMemberCount: number;
};

export type WorkspaceInvitationEmailPayloadValidationResult =
  | { payload: WorkspaceInvitationEmailOutboxPayload; success: true }
  | { reason: 'INVALID_PAYLOAD' | 'UNSUPPORTED_SCHEMA_VERSION'; success: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateWorkspaceInvitationEmailOutboxPayload(
  value: unknown,
): WorkspaceInvitationEmailPayloadValidationResult {
  if (!isRecord(value)) {
    return { reason: 'INVALID_PAYLOAD', success: false };
  }

  if (!('schemaVersion' in value)) {
    return { reason: 'INVALID_PAYLOAD', success: false };
  }

  if (value.schemaVersion !== WORKSPACE_INVITATION_EMAIL_SCHEMA_VERSION) {
    return { reason: 'UNSUPPORTED_SCHEMA_VERSION', success: false };
  }

  const allowedKeys = new Set(['schemaVersion', 'invitationId', 'tokenId', 'currentMemberCount']);
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (
    Object.keys(value).some((key) => !allowedKeys.has(key)) ||
    typeof value.invitationId !== 'string' ||
    !uuidPattern.test(value.invitationId) ||
    typeof value.tokenId !== 'string' ||
    !uuidPattern.test(value.tokenId) ||
    typeof value.currentMemberCount !== 'number' ||
    !Number.isSafeInteger(value.currentMemberCount) ||
    value.currentMemberCount < 1
  ) {
    return { reason: 'INVALID_PAYLOAD', success: false };
  }

  return {
    payload: {
      schemaVersion: WORKSPACE_INVITATION_EMAIL_SCHEMA_VERSION,
      invitationId: value.invitationId,
      tokenId: value.tokenId,
      currentMemberCount: value.currentMemberCount,
    },
    success: true,
  };
}
