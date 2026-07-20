export const PRODUCT_EVENT_PAYLOAD_VERSION = 1 as const;

export const PRODUCT_EVENT_NAMES = [
  'invitation_accepted',
  'signup_completed',
  'login_completed',
  'csv_import_started',
  'csv_import_validated',
  'csv_import_completed',
  'csv_import_failed',
  'issue_created',
  'team_work_started',
  'team_work_completed',
  'saved_view_created',
  'saved_view_opened',
  'issue_template_created',
  'issue_template_applied',
  'template_issue_created',
  'push_permission_result',
  'push_test_requested',
  'push_delivery_succeeded',
  'push_delivery_failed',
  'push_notification_clicked',
  'search_performed',
  'search_no_results',
  'search_result_selected',
  'notification_created',
  'notification_read',
  'feedback_submitted',
  'workspace_created',
  'member_invited',
  'project_created',
  'project_status_changed',
  'team_work_created',
  'issue_property_changed',
  'team_work_property_changed',
  'issue_completed',
  'comment_created',
  'api_handoff_created',
  'inbox_opened',
  'csv_exported',
] as const;

export type ProductEventName = (typeof PRODUCT_EVENT_NAMES)[number];

export type ProductEvent = {
  eventId: string;
  membershipId: string;
  name: ProductEventName;
  occurredAt: string;
  payloadVersion: typeof PRODUCT_EVENT_PAYLOAD_VERSION;
  properties: Record<string, unknown>;
  workspaceId: string;
};

export type ProductEventValidationResult =
  | { event: ProductEvent; success: true }
  | { reason: 'INVALID_EVENT' | 'UNSUPPORTED_PAYLOAD_VERSION'; success: false };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,99}$/;
const EVENT_NAME_SET = new Set<string>(PRODUCT_EVENT_NAMES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isSafeCodeArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every((code) => typeof code === 'string' && SAFE_CODE_PATTERN.test(code))
  );
}

function isEnum(value: unknown, allowed: readonly string[]): value is string {
  return typeof value === 'string' && allowed.includes(value);
}

function validateProperties(name: ProductEventName, value: Record<string, unknown>): boolean {
  switch (name) {
    case 'login_completed':
    case 'push_test_requested':
    case 'issue_completed':
      return exactKeys(value, []);
    case 'invitation_accepted':
      return exactKeys(value, ['invitationId']) && isUuid(value.invitationId);
    case 'signup_completed':
      return exactKeys(value, ['method']) && value.method === 'DIRECT_WORKSPACE';
    case 'csv_import_started':
      return exactKeys(value, ['executionId']) && isUuid(value.executionId);
    case 'csv_import_validated':
      return (
        exactKeys(value, ['attemptId', 'canExecute', 'errorCodes', 'executionId']) &&
        isUuid(value.attemptId) &&
        typeof value.canExecute === 'boolean' &&
        isSafeCodeArray(value.errorCodes) &&
        isUuid(value.executionId)
      );
    case 'csv_import_completed':
      return (
        exactKeys(value, ['executionId', 'issueCreatedCount', 'projectCreatedCount']) &&
        isUuid(value.executionId) &&
        isNonNegativeInteger(value.issueCreatedCount) &&
        isNonNegativeInteger(value.projectCreatedCount)
      );
    case 'csv_import_failed':
      return (
        exactKeys(value, ['attemptId', 'errorCode', 'executionId', 'phase']) &&
        isUuid(value.attemptId) &&
        isUuid(value.executionId) &&
        isEnum(value.phase, ['VALIDATION', 'EXECUTION']) &&
        typeof value.errorCode === 'string' &&
        SAFE_CODE_PATTERN.test(value.errorCode)
      );
    case 'issue_created':
      return (
        exactKeys(value, ['hasMention', 'issueId']) &&
        typeof value.hasMention === 'boolean' &&
        isUuid(value.issueId)
      );
    case 'team_work_started':
    case 'team_work_completed':
      return (
        exactKeys(value, ['issueId', 'teamWorkId']) &&
        isUuid(value.issueId) &&
        isUuid(value.teamWorkId)
      );
    case 'saved_view_created':
      return (
        exactKeys(value, ['resourceType']) && isEnum(value.resourceType, ['ISSUES', 'MY_WORK'])
      );
    case 'saved_view_opened':
      return (
        exactKeys(value, ['resourceType', 'savedViewId']) &&
        isEnum(value.resourceType, ['ISSUES', 'MY_WORK']) &&
        isUuid(value.savedViewId)
      );
    case 'issue_template_created':
    case 'issue_template_applied':
    case 'template_issue_created':
      return exactKeys(value, ['templateId']) && isUuid(value.templateId);
    case 'push_permission_result':
      return (
        exactKeys(value, ['result']) &&
        isEnum(value.result, ['GRANTED', 'DENIED', 'DISMISSED', 'UNSUPPORTED'])
      );
    case 'push_delivery_succeeded':
      return exactKeys(value, ['notificationId']) && isUuid(value.notificationId);
    case 'push_delivery_failed':
      return (
        exactKeys(value, ['errorCode', 'notificationId']) &&
        typeof value.errorCode === 'string' &&
        SAFE_CODE_PATTERN.test(value.errorCode) &&
        isUuid(value.notificationId)
      );
    case 'push_notification_clicked':
      return exactKeys(value, ['notificationId']) && isUuid(value.notificationId);
    case 'search_performed':
      return (
        exactKeys(value, ['resultCount', 'searchType']) &&
        isNonNegativeInteger(value.resultCount) &&
        isEnum(value.searchType, ['IDENTIFIER', 'TITLE'])
      );
    case 'search_no_results':
      return exactKeys(value, ['searchType']) && isEnum(value.searchType, ['IDENTIFIER', 'TITLE']);
    case 'search_result_selected':
      return (
        exactKeys(value, ['resourceId', 'resultType']) &&
        isUuid(value.resourceId) &&
        isEnum(value.resultType, ['ISSUE', 'TEAM_WORK'])
      );
    case 'notification_created':
    case 'notification_read':
      return (
        exactKeys(value, ['notificationId', 'notificationType']) &&
        isUuid(value.notificationId) &&
        typeof value.notificationType === 'string' &&
        SAFE_CODE_PATTERN.test(value.notificationType)
      );
    case 'feedback_submitted':
      return (
        exactKeys(value, ['category']) &&
        isEnum(value.category, ['BUG', 'USABILITY', 'IDEA', 'OTHER'])
      );
    case 'workspace_created':
      return exactKeys(value, ['acquisitionSource']) && value.acquisitionSource === 'direct';
    case 'member_invited':
      return (
        exactKeys(value, ['currentMemberCount']) && isNonNegativeInteger(value.currentMemberCount)
      );
    case 'project_created':
      return (
        exactKeys(value, ['hasTargetDate', 'teamCount']) &&
        typeof value.hasTargetDate === 'boolean' &&
        isNonNegativeInteger(value.teamCount)
      );
    case 'project_status_changed':
      return (
        exactKeys(value, ['fromStatus', 'progress', 'toStatus']) &&
        isEnum(value.fromStatus, ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELED']) &&
        isNonNegativeInteger(value.progress) &&
        (value.progress as number) <= 100 &&
        isEnum(value.toStatus, ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELED'])
      );
    case 'team_work_created':
      return exactKeys(value, ['hasAssignee']) && typeof value.hasAssignee === 'boolean';
    case 'issue_property_changed':
    case 'team_work_property_changed':
      return (
        exactKeys(value, ['propertyTypes']) &&
        Array.isArray(value.propertyTypes) &&
        value.propertyTypes.every(
          (property) => typeof property === 'string' && SAFE_CODE_PATTERN.test(property),
        )
      );
    case 'comment_created':
      return exactKeys(value, ['hasMention']) && typeof value.hasMention === 'boolean';
    case 'api_handoff_created':
      return (
        exactKeys(value, ['isFollowUp', 'targetTeamWorkCount']) &&
        typeof value.isFollowUp === 'boolean' &&
        isNonNegativeInteger(value.targetTeamWorkCount)
      );
    case 'inbox_opened':
      return exactKeys(value, ['unreadCount']) && isNonNegativeInteger(value.unreadCount);
    case 'csv_exported':
      return (
        exactKeys(value, ['exportType', 'itemCount']) &&
        isEnum(value.exportType, ['ISSUES', 'PROJECTS']) &&
        isNonNegativeInteger(value.itemCount)
      );
  }
}

export function validateProductEvent(value: unknown): ProductEventValidationResult {
  if (!isRecord(value)) return { reason: 'INVALID_EVENT', success: false };
  if (value.payloadVersion !== PRODUCT_EVENT_PAYLOAD_VERSION) {
    return { reason: 'UNSUPPORTED_PAYLOAD_VERSION', success: false };
  }
  if (
    !exactKeys(value, [
      'eventId',
      'membershipId',
      'name',
      'occurredAt',
      'payloadVersion',
      'properties',
      'workspaceId',
    ]) ||
    !isUuid(value.eventId) ||
    !isUuid(value.membershipId) ||
    typeof value.name !== 'string' ||
    !EVENT_NAME_SET.has(value.name) ||
    typeof value.occurredAt !== 'string' ||
    Number.isNaN(Date.parse(value.occurredAt)) ||
    new Date(value.occurredAt).toISOString() !== value.occurredAt ||
    !isRecord(value.properties) ||
    !isUuid(value.workspaceId)
  ) {
    return { reason: 'INVALID_EVENT', success: false };
  }
  const name = value.name as ProductEventName;
  if (!validateProperties(name, value.properties)) {
    return { reason: 'INVALID_EVENT', success: false };
  }
  return { event: value as ProductEvent, success: true };
}
