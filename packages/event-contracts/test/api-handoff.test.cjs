const assert = require('node:assert/strict');
const test = require('node:test');

const {
  API_HANDOFF_CREATED,
  API_HANDOFF_CREATED_SCHEMA_VERSION,
  validateApiHandoffCreatedOutboxPayload,
} = require('../dist/api-handoff.js');

const validPayload = {
  schemaVersion: API_HANDOFF_CREATED_SCHEMA_VERSION,
  issueId: 'f57fa7be-1fe9-4744-a8db-704bf989a3cd',
  handoffId: 'de9d55e4-6181-4a8a-8fdf-f8faf536dc99',
  kind: 'INITIAL',
  sourceTeamWorkId: 'c7223ce5-74b3-4495-ae66-a3d269017f6a',
  targetTeamWorkIds: ['553a6d42-4336-4a19-a9e4-f708f5f16468'],
  candidateRecipientMembershipIds: ['607629d0-53e6-469d-bbc8-eb86c50a0288'],
  mentionedMembershipIds: ['4d34d7b1-0389-4663-8524-b24187f83268'],
};

test('accepts the exact API handoff payload for both kinds', () => {
  assert.equal(API_HANDOFF_CREATED, 'API_HANDOFF_CREATED');

  for (const kind of ['INITIAL', 'FOLLOW_UP']) {
    const payload = { ...validPayload, kind };
    assert.deepEqual(validateApiHandoffCreatedOutboxPayload(payload), {
      payload,
      success: true,
    });
  }
});

test('normalizes legacy v1 payloads without mentions', () => {
  const legacyPayload = { ...validPayload, schemaVersion: 1 };
  delete legacyPayload.mentionedMembershipIds;
  assert.deepEqual(validateApiHandoffCreatedOutboxPayload(legacyPayload), {
    payload: { ...validPayload, mentionedMembershipIds: [] },
    success: true,
  });
});

test('rejects unknown schema versions separately', () => {
  assert.deepEqual(validateApiHandoffCreatedOutboxPayload({ ...validPayload, schemaVersion: 3 }), {
    reason: 'UNSUPPORTED_SCHEMA_VERSION',
    success: false,
  });
});

test('rejects non-v4 IDs, duplicate IDs, invalid kinds, and extra fields', () => {
  for (const payload of [
    { ...validPayload, issueId: '00112233-4455-6677-8899-aabbccddeeff' },
    { ...validPayload, handoffId: 'invalid' },
    {
      ...validPayload,
      targetTeamWorkIds: [validPayload.issueId, validPayload.issueId],
    },
    {
      ...validPayload,
      candidateRecipientMembershipIds: [validPayload.handoffId, validPayload.handoffId],
    },
    {
      ...validPayload,
      mentionedMembershipIds: [validPayload.handoffId, validPayload.handoffId],
    },
    { ...validPayload, candidateRecipientMembershipIds: 'not-an-array' },
    { ...validPayload, kind: 'UNKNOWN' },
    { ...validPayload, bodyMarkdown: 'not-allowed' },
  ]) {
    assert.deepEqual(validateApiHandoffCreatedOutboxPayload(payload), {
      reason: 'INVALID_PAYLOAD',
      success: false,
    });
  }
});
