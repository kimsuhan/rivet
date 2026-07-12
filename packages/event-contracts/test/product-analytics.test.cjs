const assert = require('node:assert/strict');
const test = require('node:test');

const {
  validateProjectCreatedOutboxPayload,
  validateProjectStatusChangedOutboxPayload,
  validateWorkspaceCreatedOutboxPayload,
} = require('../dist/product-analytics.js');

test('accepts exact workspace and project analytics payloads', () => {
  assert.deepEqual(
    validateWorkspaceCreatedOutboxPayload({ acquisitionSource: 'direct', schemaVersion: 1 }),
    { payload: { acquisitionSource: 'direct', schemaVersion: 1 }, success: true },
  );
  assert.deepEqual(
    validateProjectCreatedOutboxPayload({
      hasTargetDate: true,
      roleCount: 2,
      roles: ['BACKEND', 'WEB_FRONTEND'],
      schemaVersion: 1,
    }),
    {
      payload: {
        hasTargetDate: true,
        roleCount: 2,
        roles: ['BACKEND', 'WEB_FRONTEND'],
        schemaVersion: 1,
      },
      success: true,
    },
  );
  assert.deepEqual(
    validateProjectStatusChangedOutboxPayload({
      fromStatus: 'PLANNED',
      progress: 50,
      schemaVersion: 1,
      toStatus: 'IN_PROGRESS',
    }),
    {
      payload: {
        fromStatus: 'PLANNED',
        progress: 50,
        schemaVersion: 1,
        toStatus: 'IN_PROGRESS',
      },
      success: true,
    },
  );
});

test('rejects unsupported versions, extra properties, and unsafe enum values', () => {
  for (const payload of [
    { acquisitionSource: 'direct', schemaVersion: 2 },
    { acquisitionSource: 'campaign-name', schemaVersion: 1 },
    { acquisitionSource: 'direct', email: 'secret@example.com', schemaVersion: 1 },
  ]) {
    const result = validateWorkspaceCreatedOutboxPayload(payload);
    assert.equal(result.success, false);
  }

  for (const payload of [
    { hasTargetDate: false, roleCount: 2, roles: ['BACKEND'], schemaVersion: 1 },
    { hasTargetDate: false, roleCount: 2, roles: ['BACKEND', 'BACKEND'], schemaVersion: 1 },
    { hasTargetDate: false, roleCount: 1, roles: ['DESIGN'], schemaVersion: 1 },
  ]) {
    assert.deepEqual(validateProjectCreatedOutboxPayload(payload), {
      reason: 'INVALID_PAYLOAD',
      success: false,
    });
  }

  for (const payload of [
    { fromStatus: 'PLANNED', progress: 101, schemaVersion: 1, toStatus: 'IN_PROGRESS' },
    { fromStatus: 'PLANNED', progress: 0, schemaVersion: 1, toStatus: 'PLANNED' },
    { fromStatus: 'UNKNOWN', progress: 0, schemaVersion: 1, toStatus: 'PLANNED' },
  ]) {
    assert.deepEqual(validateProjectStatusChangedOutboxPayload(payload), {
      reason: 'INVALID_PAYLOAD',
      success: false,
    });
  }
});
