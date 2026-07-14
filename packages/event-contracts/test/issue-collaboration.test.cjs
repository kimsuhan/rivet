const assert = require('node:assert/strict');
const test = require('node:test');

const {
  COMMENT_CREATED,
  COMMENT_MENTIONS_ADDED,
  ISSUE_CHANGED,
  ISSUE_CREATED,
  isIssueCollaborationEventType,
  validateCommentCreatedOutboxPayload,
  validateCommentMentionsAddedOutboxPayload,
  validateIssueChangedOutboxPayload,
  validateIssueCreatedOutboxPayload,
} = require('../dist/issue-collaboration.js');

const issueId = 'f57fa7be-1fe9-4744-a8db-704bf989a3cd';
const commentId = 'de9d55e4-6181-4a8a-8fdf-f8faf536dc99';
const mentionedMembershipId = '607629d0-53e6-469d-bbc8-eb86c50a0288';
const subscriberMembershipId = '553a6d42-4336-4a19-a9e4-f708f5f16468';
const teamWorkId = 'c7223ce5-74b3-4495-ae66-a3d269017f6a';

const validCases = [
  [
    ISSUE_CREATED,
    validateIssueCreatedOutboxPayload,
    {
      schemaVersion: 1,
      issueId,
      mentionedMembershipIds: [mentionedMembershipId],
    },
  ],
  [
    ISSUE_CHANGED,
    validateIssueChangedOutboxPayload,
    {
      schemaVersion: 1,
      issueId,
      changedFields: ['TITLE', 'STATUS'],
      mentionedMembershipIds: [],
      terminalCategory: 'COMPLETED',
      subscriberMembershipIds: [subscriberMembershipId],
    },
  ],
  [
    COMMENT_CREATED,
    validateCommentCreatedOutboxPayload,
    {
      schemaVersion: 1,
      issueId,
      commentId,
      teamWorkId,
      mentionedMembershipIds: [mentionedMembershipId],
      subscriberMembershipIds: [subscriberMembershipId],
      hasMention: true,
    },
  ],
  [
    COMMENT_MENTIONS_ADDED,
    validateCommentMentionsAddedOutboxPayload,
    {
      schemaVersion: 1,
      issueId,
      commentId,
      teamWorkId,
      mentionedMembershipIds: [mentionedMembershipId],
    },
  ],
];

test('accepts each strict issue collaboration payload and event type', () => {
  for (const [eventType, validate, payload] of validCases) {
    assert.equal(isIssueCollaborationEventType(eventType), true);
    assert.deepEqual(validate(payload), { payload, success: true });
  }

  assert.equal(isIssueCollaborationEventType('UNKNOWN'), false);
});

test('rejects unsupported schema versions separately', () => {
  for (const [, validate, payload] of validCases) {
    assert.deepEqual(validate({ ...payload, schemaVersion: 2 }), {
      reason: 'UNSUPPORTED_SCHEMA_VERSION',
      success: false,
    });
  }
});

test('rejects extra fields including forbidden user content', () => {
  for (const [key, value] of [
    ['bodyMarkdown', 'secret body'],
    ['title', 'secret title'],
    ['email', 'secret@example.com'],
    ['fileName', 'secret.pdf'],
  ]) {
    assert.deepEqual(validateIssueCreatedOutboxPayload({ ...validCases[0][2], [key]: value }), {
      reason: 'INVALID_PAYLOAD',
      success: false,
    });
  }
});

test('rejects invalid v4 UUIDs and duplicate membership snapshots', () => {
  assert.deepEqual(
    validateIssueCreatedOutboxPayload({ ...validCases[0][2], issueId: 'not-a-uuid' }),
    { reason: 'INVALID_PAYLOAD', success: false },
  );

  assert.deepEqual(
    validateIssueChangedOutboxPayload({
      ...validCases[1][2],
      subscriberMembershipIds: [subscriberMembershipId, subscriberMembershipId],
    }),
    { reason: 'INVALID_PAYLOAD', success: false },
  );

  assert.deepEqual(
    validateCommentCreatedOutboxPayload({
      ...validCases[2][2],
      mentionedMembershipIds: [mentionedMembershipId, mentionedMembershipId.toUpperCase()],
    }),
    { reason: 'INVALID_PAYLOAD', success: false },
  );
});

test('rejects empty, duplicate, or unsupported changed fields', () => {
  for (const changedFields of [[], ['TITLE', 'TITLE'], ['TITLE', 'BLOCK_RELATIONS']]) {
    assert.deepEqual(validateIssueChangedOutboxPayload({ ...validCases[1][2], changedFields }), {
      reason: 'INVALID_PAYLOAD',
      success: false,
    });
  }
});

test('rejects inconsistent issue-change snapshots', () => {
  for (const payload of [
    {
      ...validCases[1][2],
      assigneeMembershipId: teamWorkId,
      changedFields: ['TITLE', 'STATUS'],
    },
    {
      ...validCases[1][2],
      changedFields: ['TITLE', 'STATUS'],
      mentionedMembershipIds: [mentionedMembershipId],
    },
    {
      ...validCases[1][2],
      changedFields: ['TITLE'],
    },
    {
      ...validCases[1][2],
      changedFields: ['TITLE'],
      subscriberMembershipIds: [subscriberMembershipId],
      terminalCategory: null,
    },
  ]) {
    assert.deepEqual(validateIssueChangedOutboxPayload(payload), {
      reason: 'INVALID_PAYLOAD',
      success: false,
    });
  }
});

test('requires at least one newly added comment mention', () => {
  assert.deepEqual(
    validateCommentMentionsAddedOutboxPayload({
      ...validCases[3][2],
      mentionedMembershipIds: [],
    }),
    { reason: 'INVALID_PAYLOAD', success: false },
  );
});

test('requires hasMention to match the mentioned membership snapshot', () => {
  for (const payload of [
    { ...validCases[2][2], hasMention: false },
    { ...validCases[2][2], mentionedMembershipIds: [], hasMention: true },
  ]) {
    assert.deepEqual(validateCommentCreatedOutboxPayload(payload), {
      reason: 'INVALID_PAYLOAD',
      success: false,
    });
  }
});
