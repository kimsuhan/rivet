const assert = require('node:assert/strict');
const test = require('node:test');

const {
  WEB_PUSH_TEST_REQUESTED,
  validateWebPushTestRequestedOutboxPayload,
} = require('../dist/web-push.js');

const subscriptionId = 'f57fa7be-1fe9-4744-a8db-704bf989a3cd';

test('accepts only the minimal Web Push test payload', () => {
  assert.equal(WEB_PUSH_TEST_REQUESTED, 'WEB_PUSH_TEST_REQUESTED');
  assert.deepEqual(
    validateWebPushTestRequestedOutboxPayload({ schemaVersion: 1, subscriptionId }),
    { payload: { schemaVersion: 1, subscriptionId }, success: true },
  );
});

test('rejects unsupported versions, extra data, and invalid identifiers', () => {
  assert.deepEqual(
    validateWebPushTestRequestedOutboxPayload({ schemaVersion: 2, subscriptionId }),
    { reason: 'UNSUPPORTED_SCHEMA_VERSION', success: false },
  );

  for (const payload of [
    null,
    { schemaVersion: 1, subscriptionId: 'not-a-uuid' },
    { schemaVersion: 1, subscriptionId, endpoint: 'must-not-leak' },
  ]) {
    assert.deepEqual(validateWebPushTestRequestedOutboxPayload(payload), {
      reason: 'INVALID_PAYLOAD',
      success: false,
    });
  }
});
