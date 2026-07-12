export const WORKSPACE_CREATED = 'WORKSPACE_CREATED' as const;
export const WORKSPACE_CREATED_SCHEMA_VERSION = 1 as const;
export const PROJECT_CREATED = 'PROJECT_CREATED' as const;
export const PROJECT_CREATED_SCHEMA_VERSION = 1 as const;
export const PROJECT_STATUS_CHANGED = 'PROJECT_STATUS_CHANGED' as const;
export const PROJECT_STATUS_CHANGED_SCHEMA_VERSION = 1 as const;

export const PRODUCT_ANALYTICS_PROJECT_ROLES = ['BACKEND', 'WEB_FRONTEND', 'APP_FRONTEND'] as const;

export const PRODUCT_ANALYTICS_PROJECT_STATUSES = [
  'PLANNED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELED',
] as const;

export type ProductAnalyticsProjectRole = (typeof PRODUCT_ANALYTICS_PROJECT_ROLES)[number];
export type ProductAnalyticsProjectStatus = (typeof PRODUCT_ANALYTICS_PROJECT_STATUSES)[number];

export type WorkspaceCreatedOutboxPayload = {
  schemaVersion: typeof WORKSPACE_CREATED_SCHEMA_VERSION;
  acquisitionSource: 'direct';
};

export type ProjectCreatedOutboxPayload = {
  schemaVersion: typeof PROJECT_CREATED_SCHEMA_VERSION;
  hasTargetDate: boolean;
  roleCount: number;
  roles: ProductAnalyticsProjectRole[];
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

const PROJECT_ROLE_SET = new Set<string>(PRODUCT_ANALYTICS_PROJECT_ROLES);
const PROJECT_STATUS_SET = new Set<string>(PRODUCT_ANALYTICS_PROJECT_STATUSES);

function validateObject(
  value: unknown,
  allowedKeys: readonly string[],
): { value: Record<string, unknown> } | ValidationResult<never> {
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
  const result = validateObject(value, ['schemaVersion', 'hasTargetDate', 'roleCount', 'roles']);
  if (!('value' in result)) return result;
  const payload = result.value;
  if (
    typeof payload.hasTargetDate !== 'boolean' ||
    !Number.isInteger(payload.roleCount) ||
    !Array.isArray(payload.roles) ||
    Object.keys(payload.roles).length !== payload.roles.length ||
    payload.roles.length < 1 ||
    payload.roles.length > PRODUCT_ANALYTICS_PROJECT_ROLES.length ||
    payload.roleCount !== payload.roles.length ||
    !payload.roles.every((role) => typeof role === 'string' && PROJECT_ROLE_SET.has(role)) ||
    new Set(payload.roles).size !== payload.roles.length
  ) {
    return { reason: 'INVALID_PAYLOAD', success: false };
  }
  return {
    payload: {
      hasTargetDate: payload.hasTargetDate,
      roleCount: payload.roleCount,
      roles: [...payload.roles] as ProductAnalyticsProjectRole[],
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
