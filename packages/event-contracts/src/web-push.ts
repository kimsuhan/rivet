export const WEB_PUSH_TEST_REQUESTED_SCHEMA_VERSION = 1 as const;
export const WEB_PUSH_TEST_REQUESTED = 'WEB_PUSH_TEST_REQUESTED' as const;

export type WebPushTestRequestedOutboxPayload = {
  schemaVersion: typeof WEB_PUSH_TEST_REQUESTED_SCHEMA_VERSION;
  subscriptionId: string;
};

export type WebPushTestRequestedPayloadValidationResult =
  | { payload: WebPushTestRequestedOutboxPayload; success: true }
  | { reason: 'INVALID_PAYLOAD' | 'UNSUPPORTED_SCHEMA_VERSION'; success: false };

export function validateWebPushTestRequestedOutboxPayload(
  value: unknown,
): WebPushTestRequestedPayloadValidationResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { reason: 'INVALID_PAYLOAD', success: false };
  }

  const payload = value as Record<string, unknown>;
  if (!('schemaVersion' in payload)) {
    return { reason: 'INVALID_PAYLOAD', success: false };
  }
  if (payload.schemaVersion !== WEB_PUSH_TEST_REQUESTED_SCHEMA_VERSION) {
    return { reason: 'UNSUPPORTED_SCHEMA_VERSION', success: false };
  }

  const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    Object.keys(payload).some((key) => key !== 'schemaVersion' && key !== 'subscriptionId') ||
    typeof payload.subscriptionId !== 'string' ||
    !uuidV4Pattern.test(payload.subscriptionId)
  ) {
    return { reason: 'INVALID_PAYLOAD', success: false };
  }

  return {
    payload: {
      schemaVersion: WEB_PUSH_TEST_REQUESTED_SCHEMA_VERSION,
      subscriptionId: payload.subscriptionId,
    },
    success: true,
  };
}
