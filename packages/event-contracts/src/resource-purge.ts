export const ISSUE_PURGE_SCHEDULED = 'ISSUE_PURGE_SCHEDULED' as const;
export const ISSUE_PURGE_SCHEDULED_SCHEMA_VERSION = 1 as const;
export const PROJECT_PURGE_SCHEDULED = 'PROJECT_PURGE_SCHEDULED' as const;
export const PROJECT_PURGE_SCHEDULED_SCHEMA_VERSION = 1 as const;

export type IssuePurgeScheduledOutboxPayload = {
  schemaVersion: typeof ISSUE_PURGE_SCHEDULED_SCHEMA_VERSION;
  issueId: string;
  purgeAt: string;
};

export type ProjectPurgeScheduledOutboxPayload = {
  schemaVersion: typeof PROJECT_PURGE_SCHEDULED_SCHEMA_VERSION;
  projectId: string;
  purgeAt: string;
};

export type ResourcePurgePayloadValidationResult<TPayload> =
  | { payload: TPayload; success: true }
  | { reason: 'INVALID_PAYLOAD' | 'UNSUPPORTED_SCHEMA_VERSION'; success: false };

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validate(
  value: unknown,
  resourceKey: 'issueId' | 'projectId',
): ResourcePurgePayloadValidationResult<
  Record<'purgeAt' | typeof resourceKey, string> & {
    schemaVersion: 1;
  }
> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { reason: 'INVALID_PAYLOAD', success: false };
  }

  const payload = value as Record<string, unknown>;
  if (!('schemaVersion' in payload)) {
    return { reason: 'INVALID_PAYLOAD', success: false };
  }
  if (payload.schemaVersion !== 1) {
    return { reason: 'UNSUPPORTED_SCHEMA_VERSION', success: false };
  }
  if (
    Object.keys(payload).length !== 3 ||
    !['schemaVersion', resourceKey, 'purgeAt'].every((key) => key in payload) ||
    typeof payload[resourceKey] !== 'string' ||
    !UUID_V4_PATTERN.test(payload[resourceKey]) ||
    typeof payload.purgeAt !== 'string'
  ) {
    return { reason: 'INVALID_PAYLOAD', success: false };
  }

  const purgeAt = new Date(payload.purgeAt);
  if (Number.isNaN(purgeAt.getTime()) || purgeAt.toISOString() !== payload.purgeAt) {
    return { reason: 'INVALID_PAYLOAD', success: false };
  }

  return {
    payload: {
      schemaVersion: 1,
      [resourceKey]: payload[resourceKey],
      purgeAt: payload.purgeAt,
    } as Record<'purgeAt' | typeof resourceKey, string> & { schemaVersion: 1 },
    success: true,
  };
}

export function validateIssuePurgeScheduledOutboxPayload(
  value: unknown,
): ResourcePurgePayloadValidationResult<IssuePurgeScheduledOutboxPayload> {
  return validate(value, 'issueId');
}

export function validateProjectPurgeScheduledOutboxPayload(
  value: unknown,
): ResourcePurgePayloadValidationResult<ProjectPurgeScheduledOutboxPayload> {
  return validate(value, 'projectId');
}
