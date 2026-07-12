export const ACCOUNT_EMAIL_SCHEMA_VERSION = 1 as const;
export const AUTH_EMAIL_VERIFICATION_REQUESTED = 'AUTH_EMAIL_VERIFICATION_REQUESTED' as const;
export const AUTH_PASSWORD_RESET_REQUESTED = 'AUTH_PASSWORD_RESET_REQUESTED' as const;

export type AccountEmailEventType =
  typeof AUTH_EMAIL_VERIFICATION_REQUESTED | typeof AUTH_PASSWORD_RESET_REQUESTED;

export type AccountEmailOutboxPayload = {
  schemaVersion: typeof ACCOUNT_EMAIL_SCHEMA_VERSION;
  tokenId: string;
  userId: string;
};

export type AccountEmailPayloadValidationResult =
  | { payload: AccountEmailOutboxPayload; success: true }
  | { reason: 'INVALID_PAYLOAD' | 'UNSUPPORTED_SCHEMA_VERSION'; success: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isAccountEmailEventType(value: string): value is AccountEmailEventType {
  return value === AUTH_EMAIL_VERIFICATION_REQUESTED || value === AUTH_PASSWORD_RESET_REQUESTED;
}

export function validateAccountEmailOutboxPayload(
  value: unknown,
): AccountEmailPayloadValidationResult {
  if (!isRecord(value)) {
    return { reason: 'INVALID_PAYLOAD', success: false };
  }

  if (!('schemaVersion' in value)) {
    return { reason: 'INVALID_PAYLOAD', success: false };
  }

  if (value.schemaVersion !== ACCOUNT_EMAIL_SCHEMA_VERSION) {
    return { reason: 'UNSUPPORTED_SCHEMA_VERSION', success: false };
  }

  const allowedKeys = new Set(['schemaVersion', 'tokenId', 'userId']);
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (
    Object.keys(value).some((key) => !allowedKeys.has(key)) ||
    typeof value.tokenId !== 'string' ||
    !uuidPattern.test(value.tokenId) ||
    typeof value.userId !== 'string' ||
    !uuidPattern.test(value.userId)
  ) {
    return { reason: 'INVALID_PAYLOAD', success: false };
  }

  return {
    payload: {
      schemaVersion: ACCOUNT_EMAIL_SCHEMA_VERSION,
      tokenId: value.tokenId,
      userId: value.userId,
    },
    success: true,
  };
}
