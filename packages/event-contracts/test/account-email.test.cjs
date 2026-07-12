const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AUTH_EMAIL_VERIFICATION_REQUESTED,
  isAccountEmailEventType,
  validateAccountEmailOutboxPayload,
} = require('../dist/account-email.js');

const validPayload = {
  schemaVersion: 1,
  tokenId: '00112233-4455-6677-8899-aabbccddeeff',
  userId: 'f57fa7be-1fe9-4744-a8db-704bf989a3cd',
};

test('accepts the minimal account email payload', () => {
  assert.equal(isAccountEmailEventType(AUTH_EMAIL_VERIFICATION_REQUESTED), true);
  assert.deepEqual(validateAccountEmailOutboxPayload(validPayload), {
    payload: validPayload,
    success: true,
  });
});

test('rejects unknown schema versions separately', () => {
  assert.deepEqual(validateAccountEmailOutboxPayload({ ...validPayload, schemaVersion: 2 }), {
    reason: 'UNSUPPORTED_SCHEMA_VERSION',
    success: false,
  });
});

test('rejects malformed IDs and extra payload data', () => {
  assert.deepEqual(validateAccountEmailOutboxPayload({ ...validPayload, email: 'not-allowed' }), {
    reason: 'INVALID_PAYLOAD',
    success: false,
  });
  assert.deepEqual(validateAccountEmailOutboxPayload({ ...validPayload, tokenId: 'invalid' }), {
    reason: 'INVALID_PAYLOAD',
    success: false,
  });
});
