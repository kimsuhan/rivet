export const TEAM_WORK_CREATED = 'TEAM_WORK_CREATED' as const;
export const TEAM_WORK_CREATED_SCHEMA_VERSION = 1 as const;
export const TEAM_WORK_CHANGED = 'TEAM_WORK_CHANGED' as const;
export const TEAM_WORK_CHANGED_SCHEMA_VERSION = 1 as const;

export const TEAM_WORK_CHANGED_FIELDS = ['WORKFLOW_STATE', 'ASSIGNEE', 'WORK_NOTE'] as const;
export const TEAM_WORK_PROJECT_ROLES = ['BACKEND', 'WEB_FRONTEND', 'APP_FRONTEND'] as const;

export type TeamWorkChangedField = (typeof TEAM_WORK_CHANGED_FIELDS)[number];
export type TeamWorkProjectRole = (typeof TEAM_WORK_PROJECT_ROLES)[number];

export type TeamWorkCreatedOutboxPayload = {
  schemaVersion: typeof TEAM_WORK_CREATED_SCHEMA_VERSION;
  issueId: string;
  teamWorkId: string;
  assigneeMembershipId: string | null;
};

export type TeamWorkChangedOutboxPayload = {
  schemaVersion: typeof TEAM_WORK_CHANGED_SCHEMA_VERSION;
  issueId: string;
  teamWorkId: string;
  changedFields: TeamWorkChangedField[];
  assigneeMembershipId?: string | null;
  terminalCategory: 'COMPLETED' | 'CANCELED' | null;
  subscriberMembershipIds: string[];
};

type ValidationFailure = {
  reason: 'INVALID_PAYLOAD' | 'UNSUPPORTED_SCHEMA_VERSION';
  success: false;
};

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasOnly(payload: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(payload).every((key) => keys.includes(key));
}

function uuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4.test(value);
}

function validateVersion(
  payload: Record<string, unknown> | null,
  version: number,
): ValidationFailure | null {
  if (!payload || !('schemaVersion' in payload)) {
    return { reason: 'INVALID_PAYLOAD', success: false };
  }
  return payload.schemaVersion === version
    ? null
    : { reason: 'UNSUPPORTED_SCHEMA_VERSION', success: false };
}

export function validateTeamWorkCreatedOutboxPayload(
  value: unknown,
): { payload: TeamWorkCreatedOutboxPayload; success: true } | ValidationFailure {
  const payload = record(value);
  const versionFailure = validateVersion(payload, TEAM_WORK_CREATED_SCHEMA_VERSION);
  if (versionFailure) return versionFailure;
  if (
    !hasOnly(payload!, ['schemaVersion', 'issueId', 'teamWorkId', 'assigneeMembershipId']) ||
    !uuid(payload!.issueId) ||
    !uuid(payload!.teamWorkId) ||
    (payload!.assigneeMembershipId !== null && !uuid(payload!.assigneeMembershipId))
  ) {
    return { reason: 'INVALID_PAYLOAD', success: false };
  }
  return {
    payload: {
      assigneeMembershipId: payload!.assigneeMembershipId as string | null,
      issueId: payload!.issueId,
      schemaVersion: TEAM_WORK_CREATED_SCHEMA_VERSION,
      teamWorkId: payload!.teamWorkId,
    },
    success: true,
  };
}

export function validateTeamWorkChangedOutboxPayload(
  value: unknown,
): { payload: TeamWorkChangedOutboxPayload; success: true } | ValidationFailure {
  const payload = record(value);
  const versionFailure = validateVersion(payload, TEAM_WORK_CHANGED_SCHEMA_VERSION);
  if (versionFailure) return versionFailure;
  const fields = payload!.changedFields;
  const subscribers = payload!.subscriberMembershipIds;
  if (
    !hasOnly(payload!, [
      'schemaVersion',
      'issueId',
      'teamWorkId',
      'changedFields',
      'assigneeMembershipId',
      'terminalCategory',
      'subscriberMembershipIds',
    ]) ||
    !uuid(payload!.issueId) ||
    !uuid(payload!.teamWorkId) ||
    !Array.isArray(fields) ||
    fields.length === 0 ||
    fields.some(
      (field) =>
        typeof field !== 'string' ||
        !(TEAM_WORK_CHANGED_FIELDS as readonly string[]).includes(field),
    ) ||
    new Set(fields).size !== fields.length ||
    (payload!.assigneeMembershipId !== undefined &&
      payload!.assigneeMembershipId !== null &&
      !uuid(payload!.assigneeMembershipId)) ||
    (payload!.terminalCategory !== null &&
      payload!.terminalCategory !== 'COMPLETED' &&
      payload!.terminalCategory !== 'CANCELED') ||
    !Array.isArray(subscribers) ||
    subscribers.some((id) => !uuid(id)) ||
    new Set(subscribers).size !== subscribers.length
  ) {
    return { reason: 'INVALID_PAYLOAD', success: false };
  }
  return {
    payload: {
      ...(payload!.assigneeMembershipId !== undefined
        ? { assigneeMembershipId: payload!.assigneeMembershipId as string | null }
        : {}),
      changedFields: [...fields] as TeamWorkChangedField[],
      issueId: payload!.issueId,
      schemaVersion: TEAM_WORK_CHANGED_SCHEMA_VERSION,
      subscriberMembershipIds: [...subscribers] as string[],
      teamWorkId: payload!.teamWorkId,
      terminalCategory: payload!.terminalCategory as 'COMPLETED' | 'CANCELED' | null,
    },
    success: true,
  };
}
