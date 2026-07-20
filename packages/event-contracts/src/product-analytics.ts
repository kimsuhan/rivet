export const WORKSPACE_CREATED = 'WORKSPACE_CREATED' as const;
export const WORKSPACE_CREATED_SCHEMA_VERSION = 1 as const;
export const PROJECT_CREATED = 'PROJECT_CREATED' as const;
export const PROJECT_CREATED_SCHEMA_VERSION = 2 as const;
export const PROJECT_STATUS_CHANGED = 'PROJECT_STATUS_CHANGED' as const;
export const PROJECT_STATUS_CHANGED_SCHEMA_VERSION = 1 as const;

export const PRODUCT_ANALYTICS_PROJECT_STATUSES = [
  'PLANNED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELED',
] as const;

export type ProductAnalyticsProjectStatus = (typeof PRODUCT_ANALYTICS_PROJECT_STATUSES)[number];

export type WorkspaceCreatedOutboxPayload = {
  schemaVersion: typeof WORKSPACE_CREATED_SCHEMA_VERSION;
  acquisitionSource: 'direct';
};

export type ProjectCreatedOutboxPayload = {
  schemaVersion: typeof PROJECT_CREATED_SCHEMA_VERSION;
  hasTargetDate: boolean;
  teamCount: number;
};

export type ProjectStatusChangedOutboxPayload = {
  schemaVersion: typeof PROJECT_STATUS_CHANGED_SCHEMA_VERSION;
  fromStatus: ProductAnalyticsProjectStatus;
  progress: number;
  toStatus: ProductAnalyticsProjectStatus;
};

type ValidationResult<T> =
  | { payload: T; success: true }
  | { reason: 'INVALID_PAYLOAD' | 'UNSUPPORTED_SCHEMA_VERSION'; success: false };

const PROJECT_STATUS_SET = new Set<string>(PRODUCT_ANALYTICS_PROJECT_STATUSES);

function validateObject(
  value: unknown,
  allowedKeys: readonly string[],
  supportedSchemaVersions: readonly number[] = [1],
): { value: Record<string, unknown> } | ValidationResult<never> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { reason: 'INVALID_PAYLOAD', success: false };
  }
  const payload = value as Record<string, unknown>;
  if (!('schemaVersion' in payload)) {
    return { reason: 'INVALID_PAYLOAD', success: false };
  }
  if (
    typeof payload.schemaVersion !== 'number' ||
    !supportedSchemaVersions.includes(payload.schemaVersion)
  ) {
    return { reason: 'UNSUPPORTED_SCHEMA_VERSION', success: false };
  }
  const allowedKeySet = new Set(allowedKeys);
  if (Object.keys(payload).some((key) => !allowedKeySet.has(key))) {
    return { reason: 'INVALID_PAYLOAD', success: false };
  }
  return { value: payload };
}

export function validateWorkspaceCreatedOutboxPayload(
  value: unknown,
): ValidationResult<WorkspaceCreatedOutboxPayload> {
  const result = validateObject(value, ['schemaVersion', 'acquisitionSource']);
  if (!('value' in result)) return result;
  if (result.value.acquisitionSource !== 'direct') {
    return { reason: 'INVALID_PAYLOAD', success: false };
  }
  return {
    payload: { acquisitionSource: 'direct', schemaVersion: WORKSPACE_CREATED_SCHEMA_VERSION },
    success: true,
  };
}

export function validateProjectCreatedOutboxPayload(
  value: unknown,
): ValidationResult<ProjectCreatedOutboxPayload> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { reason: 'INVALID_PAYLOAD', success: false };
  }
  const schemaVersion = (value as Record<string, unknown>).schemaVersion;
  const result = validateObject(
    value,
    schemaVersion === 1
      ? ['schemaVersion', 'hasTargetDate', 'roleCount', 'roles']
      : ['schemaVersion', 'hasTargetDate', 'teamCount'],
    [1, PROJECT_CREATED_SCHEMA_VERSION],
  );
  if (!('value' in result)) return result;
  const payload = result.value;
  const teamCount = payload.schemaVersion === 1 ? payload.roleCount : payload.teamCount;
  if (typeof payload.hasTargetDate !== 'boolean' || !Number.isInteger(teamCount)) {
    return { reason: 'INVALID_PAYLOAD', success: false };
  }
  if (payload.schemaVersion === 1) {
    if (
      !Array.isArray(payload.roles) ||
      Object.keys(payload.roles).length !== payload.roles.length ||
      payload.roles.length < 1 ||
      payload.roles.length > 3 ||
      teamCount !== payload.roles.length ||
      !payload.roles.every(
        (role) =>
          typeof role === 'string' &&
          ['BACKEND', 'WEB_FRONTEND', 'APP_FRONTEND'].includes(role),
      ) ||
      new Set(payload.roles).size !== payload.roles.length
    ) {
      return { reason: 'INVALID_PAYLOAD', success: false };
    }
  } else if ((teamCount as number) < 0 || (teamCount as number) > 100) {
    return { reason: 'INVALID_PAYLOAD', success: false };
  }
  return {
    payload: {
      hasTargetDate: payload.hasTargetDate,
      teamCount: teamCount as number,
      schemaVersion: PROJECT_CREATED_SCHEMA_VERSION,
    },
    success: true,
  };
}

export function validateProjectStatusChangedOutboxPayload(
  value: unknown,
): ValidationResult<ProjectStatusChangedOutboxPayload> {
  const result = validateObject(value, ['schemaVersion', 'fromStatus', 'progress', 'toStatus']);
  if (!('value' in result)) return result;
  const payload = result.value;
  if (
    typeof payload.fromStatus !== 'string' ||
    !PROJECT_STATUS_SET.has(payload.fromStatus) ||
    typeof payload.toStatus !== 'string' ||
    !PROJECT_STATUS_SET.has(payload.toStatus) ||
    payload.fromStatus === payload.toStatus ||
    !Number.isInteger(payload.progress) ||
    (payload.progress as number) < 0 ||
    (payload.progress as number) > 100
  ) {
    return { reason: 'INVALID_PAYLOAD', success: false };
  }
  return {
    payload: {
      fromStatus: payload.fromStatus as ProductAnalyticsProjectStatus,
      progress: payload.progress as number,
      schemaVersion: PROJECT_STATUS_CHANGED_SCHEMA_VERSION,
      toStatus: payload.toStatus as ProductAnalyticsProjectStatus,
    },
    success: true,
  };
}
