const assert = require('node:assert/strict');
const test = require('node:test');

const {
  API_HANDOFF_CREATED,
  validateApiHandoffCreatedOutboxPayload,
} = require('../dist/api-handoff.js');

const validPayload = {
  schemaVersion: 1,
  issueId: 'f57fa7be-1fe9-4744-a8db-704bf989a3cd',
  handoffId: 'de9d55e4-6181-4a8a-8fdf-f8faf536dc99',
  kind: 'INITIAL',
  downstreamIssueIds: ['c7223ce5-74b3-4495-ae66-a3d269017f6a'],
  candidateRecipientMembershipIds: ['607629d0-53e6-469d-bbc8-eb86c50a0288'],
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

test('rejects unknown schema versions separately', () => {
  assert.deepEqual(validateApiHandoffCreatedOutboxPayload({ ...validPayload, schemaVersion: 2 }), {
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
      downstreamIssueIds: [validPayload.issueId, validPayload.issueId],
    },
    {
      ...validPayload,
      candidateRecipientMembershipIds: [validPayload.handoffId, validPayload.handoffId],
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
