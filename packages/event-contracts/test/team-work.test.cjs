const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TEAM_WORK_CHANGED,
  TEAM_WORK_CHANGED_SCHEMA_VERSION,
  TEAM_WORK_CREATED,
  validateTeamWorkChangedOutboxPayload,
  validateTeamWorkCreatedOutboxPayload,
} = require('../dist/team-work.js');

const validPayload = {
  assigneeMembershipId: '607629d0-53e6-469d-bbc8-eb86c50a0288',
  changedFields: ['WORKFLOW_STATE', 'ASSIGNEE'],
  issueId: 'f57fa7be-1fe9-4744-a8db-704bf989a3cd',
  mentionedMembershipIds: [],
  schemaVersion: TEAM_WORK_CHANGED_SCHEMA_VERSION,
  subscriberMembershipIds: ['553a6d42-4336-4a19-a9e4-f708f5f16468'],
  teamWorkId: 'c7223ce5-74b3-4495-ae66-a3d269017f6a',
  terminalCategory: 'COMPLETED',
};

test('accepts the exact team-work change payload', () => {
  assert.equal(TEAM_WORK_CHANGED, 'TEAM_WORK_CHANGED');
  assert.deepEqual(validateTeamWorkChangedOutboxPayload(validPayload), {
    payload: validPayload,
    success: true,
  });
});

test('normalizes legacy v1 payloads without mentions', () => {
  const legacyPayload = { ...validPayload, schemaVersion: 1 };
  delete legacyPayload.mentionedMembershipIds;
  assert.deepEqual(validateTeamWorkChangedOutboxPayload(legacyPayload), {
    payload: validPayload,
    success: true,
  });
});

test('accepts unique mentions only for work-note changes', () => {
  const mentionedMembershipId = '4d34d7b1-0389-4663-8524-b24187f83268';
  const payload = {
    ...validPayload,
    changedFields: ['WORK_NOTE'],
    mentionedMembershipIds: [mentionedMembershipId],
  };

  assert.deepEqual(validateTeamWorkChangedOutboxPayload(payload), {
    payload,
    success: true,
  });

  for (const invalidPayload of [
    { ...validPayload, mentionedMembershipIds: [mentionedMembershipId] },
    {
      ...payload,
      mentionedMembershipIds: [mentionedMembershipId, mentionedMembershipId],
    },
  ]) {
    assert.deepEqual(validateTeamWorkChangedOutboxPayload(invalidPayload), {
      reason: 'INVALID_PAYLOAD',
      success: false,
    });
  }
});

test('rejects legacy issue execution fields and malformed identifiers', () => {
  for (const payload of [
    { ...validPayload, teamWorkId: 'invalid' },
    { ...validPayload, changedFields: ['TITLE'] },
    { ...validPayload, title: 'legacy content' },
  ]) {
    assert.deepEqual(validateTeamWorkChangedOutboxPayload(payload), {
      reason: 'INVALID_PAYLOAD',
      success: false,
    });
  }
});

test('accepts the team-work creation payload', () => {
  const created = {
    assigneeMembershipId: null,
    issueId: validPayload.issueId,
    schemaVersion: 1,
    teamWorkId: validPayload.teamWorkId,
  };
  assert.equal(TEAM_WORK_CREATED, 'TEAM_WORK_CREATED');
  assert.deepEqual(validateTeamWorkCreatedOutboxPayload(created), {
    payload: created,
    success: true,
  });
});
