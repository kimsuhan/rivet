const RESOURCE_TYPES = [
  'ISSUE',
  'PROJECT',
  'COMMENT',
  'HANDOFF',
  'NOTIFICATION',
  'MEMBER',
  'TEAM',
  'WORKFLOW_STATE',
  'LABEL',
  'FILE',
] as const;

const CHANGE_TYPES = ['CREATED', 'UPDATED', 'DELETED', 'RESTORED'] as const;
const RESOURCE_TYPE_SET: ReadonlySet<string> = new Set(RESOURCE_TYPES);
const CHANGE_TYPE_SET: ReadonlySet<string> = new Set(CHANGE_TYPES);
const REQUIRED_KEYS = [
  'changeType',
  'eventId',
  'resourceId',
  'resourceType',
  'version',
  'workspaceId',
] as const;
const ALLOWED_KEYS = new Set([...REQUIRED_KEYS, 'recipientMembershipId']);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ResourceType = (typeof RESOURCE_TYPES)[number];
type ResourceChangeType = (typeof CHANGE_TYPES)[number];

export type ResourceChangedSignal = {
  changeType: ResourceChangeType;
  eventId: string;
  recipientMembershipId?: string;
  resourceId: string;
  resourceType: ResourceType;
  version: number | null;
  workspaceId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuidV4(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4.test(value);
}

function isResourceType(value: unknown): value is ResourceType {
  return typeof value === 'string' && RESOURCE_TYPE_SET.has(value);
}

function isResourceChangeType(value: unknown): value is ResourceChangeType {
  return typeof value === 'string' && CHANGE_TYPE_SET.has(value);
}

function isVersion(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1);
}

export function parseResourceChangedSignal(
  payload: string | undefined,
): ResourceChangedSignal | null {
  if (payload === undefined) return null;

  let value: unknown;

  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }

  if (!isRecord(value)) return null;

  const keys = Object.keys(value);

  if (
    keys.some((key) => !ALLOWED_KEYS.has(key)) ||
    REQUIRED_KEYS.some((key) => !Object.hasOwn(value, key))
  ) {
    return null;
  }

  const recipientMembershipId = value.recipientMembershipId;

  if (
    !isUuidV4(value.eventId) ||
    !isUuidV4(value.workspaceId) ||
    !isUuidV4(value.resourceId) ||
    !isResourceType(value.resourceType) ||
    !isResourceChangeType(value.changeType) ||
    !isVersion(value.version) ||
    (recipientMembershipId !== undefined && !isUuidV4(recipientMembershipId))
  ) {
    return null;
  }

  return {
    changeType: value.changeType,
    eventId: value.eventId,
    ...(recipientMembershipId === undefined ? {} : { recipientMembershipId }),
    resourceId: value.resourceId,
    resourceType: value.resourceType,
    version: value.version,
    workspaceId: value.workspaceId,
  };
}

export function serializeResourceChangedEvent(signal: ResourceChangedSignal): string {
  return [
    'event: resource.changed',
    `id: ${signal.eventId}`,
    `data: ${JSON.stringify({
      resourceType: signal.resourceType,
      resourceId: signal.resourceId,
      changeType: signal.changeType,
      version: signal.version,
    })}`,
    '',
    '',
  ].join('\n');
}
