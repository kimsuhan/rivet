export const ISSUE_CREATED = 'ISSUE_CREATED' as const;
export const ISSUE_CREATED_SCHEMA_VERSION = 1 as const;
export const ISSUE_CHANGED = 'ISSUE_CHANGED' as const;
export const ISSUE_CHANGED_SCHEMA_VERSION = 1 as const;
export const COMMENT_CREATED = 'COMMENT_CREATED' as const;
export const COMMENT_CREATED_SCHEMA_VERSION = 1 as const;
export const COMMENT_MENTIONS_ADDED = 'COMMENT_MENTIONS_ADDED' as const;
export const COMMENT_MENTIONS_ADDED_SCHEMA_VERSION = 1 as const;
export const ISSUE_CHANGED_FIELDS = [
  'TITLE',
  'DESCRIPTION',
  'STATUS',
  'PRIORITY',
  'LABELS',
] as const;

export type IssueCollaborationEventType =
  | typeof ISSUE_CREATED
  | typeof ISSUE_CHANGED
  | typeof COMMENT_CREATED
  | typeof COMMENT_MENTIONS_ADDED;

export type IssueChangedField = (typeof ISSUE_CHANGED_FIELDS)[number];

export type IssueCreatedOutboxPayload = {
  schemaVersion: typeof ISSUE_CREATED_SCHEMA_VERSION;
  issueId: string;
  mentionedMembershipIds: string[];
};

export type IssueChangedOutboxPayload = {
  schemaVersion: typeof ISSUE_CHANGED_SCHEMA_VERSION;
  issueId: string;
  changedFields: IssueChangedField[];
  mentionedMembershipIds: string[];
  terminalCategory: 'COMPLETED' | 'CANCELED' | null;
  subscriberMembershipIds: string[];
};

export type CommentCreatedOutboxPayload = {
  schemaVersion: typeof COMMENT_CREATED_SCHEMA_VERSION;
  issueId: string;
  commentId: string;
  teamWorkId: string | null;
  mentionedMembershipIds: string[];
  subscriberMembershipIds: string[];
  hasMention: boolean;
};

export type CommentMentionsAddedOutboxPayload = {
  schemaVersion: typeof COMMENT_MENTIONS_ADDED_SCHEMA_VERSION;
  issueId: string;
  commentId: string;
  teamWorkId: string | null;
  mentionedMembershipIds: string[];
};

export type IssueCollaborationOutboxPayload =
  | IssueCreatedOutboxPayload
  | IssueChangedOutboxPayload
  | CommentCreatedOutboxPayload
  | CommentMentionsAddedOutboxPayload;

export type IssueCollaborationPayloadValidationResult<
  TPayload extends IssueCollaborationOutboxPayload = IssueCollaborationOutboxPayload,
> =
  | { payload: TPayload; success: true }
  | { reason: 'INVALID_PAYLOAD' | 'UNSUPPORTED_SCHEMA_VERSION'; success: false };

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISSUE_CHANGED_FIELD_SET = new Set<string>(ISSUE_CHANGED_FIELDS);

type ValidationFailure = {
  reason: 'INVALID_PAYLOAD' | 'UNSUPPORTED_SCHEMA_VERSION';
  success: false;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuidV4(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value);
}

function isNullableUuidV4(value: unknown): value is string | null {
  return value === null || isUuidV4(value);
}

function isUniqueUuidV4Array(value: unknown, requireItem = false): value is string[] {
  if (
    !Array.isArray(value) ||
    (requireItem && value.length === 0) ||
    Object.keys(value).length !== value.length ||
    !value.every(isUuidV4)
  ) {
    return false;
  }

  return new Set(value.map((id) => id.toLowerCase())).size === value.length;
}

function isIssueChangedFieldArray(value: unknown): value is IssueChangedField[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    Object.keys(value).length !== value.length ||
    !value.every(
      (field): field is IssueChangedField =>
        typeof field === 'string' && ISSUE_CHANGED_FIELD_SET.has(field),
    )
  ) {
    return false;
  }

  return new Set(value).size === value.length;
}

function validatePayloadObject(
  value: unknown,
  allowedKeys: readonly string[],
  schemaVersion: 1,
): { value: Record<string, unknown> } | ValidationFailure {
  if (!isRecord(value) || !('schemaVersion' in value)) {
    return { reason: 'INVALID_PAYLOAD', success: false };
  }

  if (value.schemaVersion !== schemaVersion) {
    return { reason: 'UNSUPPORTED_SCHEMA_VERSION', success: false };
  }

  const allowedKeySet = new Set(allowedKeys);

  if (Object.keys(value).some((key) => !allowedKeySet.has(key))) {
    return { reason: 'INVALID_PAYLOAD', success: false };
  }

  return { value };
}

export function isIssueCollaborationEventType(
  value: unknown,
): value is IssueCollaborationEventType {
  return (
    value === ISSUE_CREATED ||
    value === ISSUE_CHANGED ||
    value === COMMENT_CREATED ||
    value === COMMENT_MENTIONS_ADDED
  );
}

export function validateIssueCreatedOutboxPayload(
  value: unknown,
): IssueCollaborationPayloadValidationResult<IssueCreatedOutboxPayload> {
  const result = validatePayloadObject(
    value,
    ['schemaVersion', 'issueId', 'mentionedMembershipIds'],
    ISSUE_CREATED_SCHEMA_VERSION,
  );

  if (!('value' in result)) {
    return result;
  }

  const payload = result.value;

  if (
    !isUuidV4(payload.issueId) ||
    !isUniqueUuidV4Array(payload.mentionedMembershipIds)
  ) {
    return { reason: 'INVALID_PAYLOAD', success: false };
  }

  return {
    payload: {
      schemaVersion: ISSUE_CREATED_SCHEMA_VERSION,
      issueId: payload.issueId,
      mentionedMembershipIds: [...payload.mentionedMembershipIds],
    },
    success: true,
  };
}

export function validateIssueChangedOutboxPayload(
  value: unknown,
): IssueCollaborationPayloadValidationResult<IssueChangedOutboxPayload> {
  const result = validatePayloadObject(
    value,
    [
      'schemaVersion',
      'issueId',
      'changedFields',
      'mentionedMembershipIds',
      'terminalCategory',
      'subscriberMembershipIds',
    ],
    ISSUE_CHANGED_SCHEMA_VERSION,
  );

  if (!('value' in result)) {
    return result;
  }

  const payload = result.value;

  if (
    !isUuidV4(payload.issueId) ||
    !isIssueChangedFieldArray(payload.changedFields) ||
    !isUniqueUuidV4Array(payload.mentionedMembershipIds) ||
    (payload.terminalCategory !== null &&
      payload.terminalCategory !== 'COMPLETED' &&
      payload.terminalCategory !== 'CANCELED') ||
    !isUniqueUuidV4Array(payload.subscriberMembershipIds)
  ) {
    return { reason: 'INVALID_PAYLOAD', success: false };
  }

  if (
    (payload.mentionedMembershipIds.length > 0 && !payload.changedFields.includes('DESCRIPTION')) ||
    (payload.terminalCategory !== null &&
      !payload.changedFields.some(
        (field) => field === 'STATUS',
      )) ||
    (payload.terminalCategory === null && payload.subscriberMembershipIds.length > 0)
  ) {
    return { reason: 'INVALID_PAYLOAD', success: false };
  }

  return {
    payload: {
      schemaVersion: ISSUE_CHANGED_SCHEMA_VERSION,
      issueId: payload.issueId,
      changedFields: [...payload.changedFields],
      mentionedMembershipIds: [...payload.mentionedMembershipIds],
      terminalCategory: payload.terminalCategory,
      subscriberMembershipIds: [...payload.subscriberMembershipIds],
    },
    success: true,
  };
}

export function validateCommentCreatedOutboxPayload(
  value: unknown,
): IssueCollaborationPayloadValidationResult<CommentCreatedOutboxPayload> {
  const result = validatePayloadObject(
    value,
    [
      'schemaVersion',
      'issueId',
      'commentId',
      'teamWorkId',
      'mentionedMembershipIds',
      'subscriberMembershipIds',
      'hasMention',
    ],
    COMMENT_CREATED_SCHEMA_VERSION,
  );

  if (!('value' in result)) {
    return result;
  }

  const payload = result.value;

  if (
    !isUuidV4(payload.issueId) ||
    !isUuidV4(payload.commentId) ||
    !isNullableUuidV4(payload.teamWorkId) ||
    !isUniqueUuidV4Array(payload.mentionedMembershipIds) ||
    !isUniqueUuidV4Array(payload.subscriberMembershipIds) ||
    typeof payload.hasMention !== 'boolean' ||
    payload.hasMention !== payload.mentionedMembershipIds.length > 0
  ) {
    return { reason: 'INVALID_PAYLOAD', success: false };
  }

  return {
    payload: {
      schemaVersion: COMMENT_CREATED_SCHEMA_VERSION,
      issueId: payload.issueId,
      commentId: payload.commentId,
      teamWorkId: payload.teamWorkId,
      mentionedMembershipIds: [...payload.mentionedMembershipIds],
      subscriberMembershipIds: [...payload.subscriberMembershipIds],
      hasMention: payload.hasMention,
    },
    success: true,
  };
}

export function validateCommentMentionsAddedOutboxPayload(
  value: unknown,
): IssueCollaborationPayloadValidationResult<CommentMentionsAddedOutboxPayload> {
  const result = validatePayloadObject(
    value,
    ['schemaVersion', 'issueId', 'commentId', 'teamWorkId', 'mentionedMembershipIds'],
    COMMENT_MENTIONS_ADDED_SCHEMA_VERSION,
  );

  if (!('value' in result)) {
    return result;
  }

  const payload = result.value;

  if (
    !isUuidV4(payload.issueId) ||
    !isUuidV4(payload.commentId) ||
    !isNullableUuidV4(payload.teamWorkId) ||
    !isUniqueUuidV4Array(payload.mentionedMembershipIds, true)
  ) {
    return { reason: 'INVALID_PAYLOAD', success: false };
  }

  return {
    payload: {
      schemaVersion: COMMENT_MENTIONS_ADDED_SCHEMA_VERSION,
      issueId: payload.issueId,
      commentId: payload.commentId,
      teamWorkId: payload.teamWorkId,
      mentionedMembershipIds: [...payload.mentionedMembershipIds],
    },
    success: true,
  };
}
