export const API_HANDOFF_CREATED_SCHEMA_VERSION = 1 as const;
export const API_HANDOFF_CREATED = 'API_HANDOFF_CREATED' as const;

export type ApiHandoffCreatedOutboxPayload = {
  schemaVersion: typeof API_HANDOFF_CREATED_SCHEMA_VERSION;
  issueId: string;
  handoffId: string;
  kind: 'INITIAL' | 'FOLLOW_UP';
  downstreamIssueIds: string[];
  candidateRecipientMembershipIds: string[];
};

export type ApiHandoffCreatedPayloadValidationResult =
  | { payload: ApiHandoffCreatedOutboxPayload; success: true }
  | { reason: 'INVALID_PAYLOAD' | 'UNSUPPORTED_SCHEMA_VERSION'; success: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUniqueUuidV4Array(value: unknown): value is string[] {
  const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  return (
    Array.isArray(value) &&
    value.every((item): item is string => typeof item === 'string' && uuidV4Pattern.test(item)) &&
    new Set(value).size === value.length
  );
}

export function validateApiHandoffCreatedOutboxPayload(
  value: unknown,
): ApiHandoffCreatedPayloadValidationResult {
  if (!isRecord(value)) {
    return { reason: 'INVALID_PAYLOAD', success: false };
  }

  if (!('schemaVersion' in value)) {
    return { reason: 'INVALID_PAYLOAD', success: false };
  }

  if (value.schemaVersion !== API_HANDOFF_CREATED_SCHEMA_VERSION) {
    return { reason: 'UNSUPPORTED_SCHEMA_VERSION', success: false };
  }

  const allowedKeys = new Set([
    'schemaVersion',
    'issueId',
    'handoffId',
    'kind',
    'downstreamIssueIds',
    'candidateRecipientMembershipIds',
  ]);
  const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (
    Object.keys(value).some((key) => !allowedKeys.has(key)) ||
    typeof value.issueId !== 'string' ||
    !uuidV4Pattern.test(value.issueId) ||
    typeof value.handoffId !== 'string' ||
    !uuidV4Pattern.test(value.handoffId) ||
    (value.kind !== 'INITIAL' && value.kind !== 'FOLLOW_UP') ||
    !isUniqueUuidV4Array(value.downstreamIssueIds) ||
    !isUniqueUuidV4Array(value.candidateRecipientMembershipIds)
  ) {
    return { reason: 'INVALID_PAYLOAD', success: false };
  }

  return {
    payload: {
      schemaVersion: API_HANDOFF_CREATED_SCHEMA_VERSION,
      issueId: value.issueId,
      handoffId: value.handoffId,
      kind: value.kind,
      downstreamIssueIds: [...value.downstreamIssueIds],
      candidateRecipientMembershipIds: [...value.candidateRecipientMembershipIds],
    },
    success: true,
  };
}
