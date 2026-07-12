const assert = require('node:assert/strict');
const test = require('node:test');

const {
  validateIssuePurgeScheduledOutboxPayload,
  validateProjectPurgeScheduledOutboxPayload,
} = require('../dist/resource-purge.js');

const issueId = 'f57fa7be-1fe9-4744-a8db-704bf989a3cd';
const projectId = 'de9d55e4-6181-4a8a-8fdf-f8faf536dc99';
const purgeAt = '2026-08-10T04:00:00.000Z';

test('accepts exact issue and project purge payloads', () => {
  assert.deepEqual(
    validateIssuePurgeScheduledOutboxPayload({ schemaVersion: 1, issueId, purgeAt }),
    { payload: { schemaVersion: 1, issueId, purgeAt }, success: true },
  );
  assert.deepEqual(
    validateProjectPurgeScheduledOutboxPayload({ schemaVersion: 1, projectId, purgeAt }),
    { payload: { schemaVersion: 1, projectId, purgeAt }, success: true },
  );
});

test('rejects extra fields and malformed identifiers or timestamps', () => {
  for (const payload of [
    { schemaVersion: 1, issueId, purgeAt, title: 'secret' },
    { schemaVersion: 1, issueId: 'not-a-uuid', purgeAt },
    { schemaVersion: 1, issueId, purgeAt: '2026-08-10' },
    { schemaVersion: 1, issueId },
  ]) {
    assert.deepEqual(validateIssuePurgeScheduledOutboxPayload(payload), {
      reason: 'INVALID_PAYLOAD',
      success: false,
    });
  }
});

test('rejects unsupported schema versions separately', () => {
  assert.deepEqual(
    validateProjectPurgeScheduledOutboxPayload({ schemaVersion: 2, projectId, purgeAt }),
    { reason: 'UNSUPPORTED_SCHEMA_VERSION', success: false },
  );
});
