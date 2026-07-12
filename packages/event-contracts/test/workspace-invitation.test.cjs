const assert = require('node:assert/strict');
const test = require('node:test');

const {
  WORKSPACE_INVITATION_REQUESTED,
  validateWorkspaceInvitationEmailOutboxPayload,
} = require('../dist/workspace-invitation.js');

const validPayload = {
  schemaVersion: 1,
  invitationId: 'f57fa7be-1fe9-4744-a8db-704bf989a3cd',
  tokenId: '00112233-4455-6677-8899-aabbccddeeff',
  currentMemberCount: 3,
};

test('accepts the minimal workspace invitation payload', () => {
  assert.equal(WORKSPACE_INVITATION_REQUESTED, 'WORKSPACE_INVITATION_REQUESTED');
  assert.deepEqual(validateWorkspaceInvitationEmailOutboxPayload(validPayload), {
    payload: validPayload,
    success: true,
  });
});

test('rejects unknown schema versions separately', () => {
  assert.deepEqual(
    validateWorkspaceInvitationEmailOutboxPayload({ ...validPayload, schemaVersion: 2 }),
    {
      reason: 'UNSUPPORTED_SCHEMA_VERSION',
      success: false,
    },
  );
});

test('rejects malformed IDs, member counts, and extra data', () => {
  for (const payload of [
    { ...validPayload, invitationId: 'invalid' },
    { ...validPayload, tokenId: 'invalid' },
    { ...validPayload, currentMemberCount: 0 },
    { ...validPayload, currentMemberCount: 1.5 },
    { ...validPayload, email: 'not-allowed' },
  ]) {
    assert.deepEqual(validateWorkspaceInvitationEmailOutboxPayload(payload), {
      reason: 'INVALID_PAYLOAD',
      success: false,
    });
  }
});
