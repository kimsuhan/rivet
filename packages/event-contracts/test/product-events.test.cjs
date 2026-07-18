const assert = require('node:assert/strict');
const test = require('node:test');

const { calculateAlphaObservation } = require('../dist/alpha-observation.js');
const { validateProductEvent } = require('../dist/product-events.js');

const workspaceId = '11111111-1111-4111-8111-111111111111';
const membershipId = '22222222-2222-4222-8222-222222222222';
const otherMembershipId = '99999999-9999-4999-8999-999999999999';

function event(index, name, properties, minute = index) {
  return {
    eventId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    membershipId,
    name,
    occurredAt: new Date(Date.UTC(2026, 6, 18, 0, minute)).toISOString(),
    payloadVersion: 1,
    properties,
    workspaceId,
  };
}

test('accepts exact allowlisted events and rejects unsupported versions and sensitive fields', () => {
  const accepted = event(1, 'feedback_submitted', { category: 'USABILITY' });
  assert.equal(validateProductEvent(accepted).success, true);
  assert.equal(
    validateProductEvent(
      event(3, 'push_delivery_failed', {
        errorCode: 'WEB_PUSH_PROVIDER_410',
        notificationId: '33333333-3333-4333-8333-333333333333',
      }),
    ).success,
    true,
  );

  assert.deepEqual(validateProductEvent({ ...accepted, payloadVersion: 2 }), {
    reason: 'UNSUPPORTED_PAYLOAD_VERSION',
    success: false,
  });

  for (const forbiddenField of [
    'body',
    'feedbackBody',
    'email',
    'token',
    'fileName',
    'endpoint',
    'title',
    'descriptionMarkdown',
    'commentBody',
    'handoffBody',
    'attachmentId',
  ]) {
    const rejected = event(2, 'feedback_submitted', {
      category: 'BUG',
      [forbiddenField]: '민감 데이터',
    });
    assert.deepEqual(validateProductEvent(rejected), {
      reason: 'INVALID_EVENT',
      success: false,
    });
  }
});

test('calculates documented Alpha observations from sample events without double counting retries', () => {
  const notificationId = '33333333-3333-4333-8333-333333333333';
  const issueId = '88888888-8888-4888-8888-888888888888';
  const executionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const samples = [
    event(1, 'invitation_accepted', { invitationId: '44444444-4444-4444-8444-444444444444' }, 0),
    event(2, 'login_completed', {}, 1),
    event(3, 'issue_created', { hasMention: false, issueId }, 5),
    {
      ...event(
        4,
        'team_work_started',
        { issueId, teamWorkId: '55555555-5555-4555-8555-555555555555' },
        15,
      ),
      membershipId: otherMembershipId,
    },
    {
      ...event(
        5,
        'team_work_completed',
        { issueId, teamWorkId: '55555555-5555-4555-8555-555555555555' },
        45,
      ),
      membershipId: otherMembershipId,
    },
    event(6, 'saved_view_created', { resourceType: 'MY_WORK' }, 20),
    event(
      7,
      'saved_view_opened',
      { resourceType: 'MY_WORK', savedViewId: '66666666-6666-4666-8666-666666666666' },
      21,
    ),
    event(8, 'issue_template_applied', { templateId: '77777777-7777-4777-8777-777777777777' }, 22),
    event(9, 'template_issue_created', { templateId: '77777777-7777-4777-8777-777777777777' }, 23),
    event(10, 'issue_template_created', { templateId: '77777777-7777-4777-8777-777777777777' }, 23),
    event(11, 'push_permission_result', { result: 'GRANTED' }, 24),
    event(12, 'push_delivery_succeeded', { notificationId }, 25),
    event(17, 'push_delivery_succeeded', { notificationId }, 25),
    event(13, 'push_notification_clicked', { notificationId }, 26),
    event(14, 'notification_created', { notificationId, notificationType: 'MENTIONED' }, 25),
    event(15, 'notification_read', { notificationId, notificationType: 'MENTIONED' }, 30),
    event(16, 'feedback_submitted', { category: 'USABILITY' }, 31),
    event(18, 'push_permission_result', { result: 'UNSUPPORTED' }, 32),
    event(
      19,
      'csv_import_validated',
      {
        attemptId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        canExecute: false,
        errorCodes: ['IMPORT_MAPPING_REQUIRED'],
        executionId,
      },
      33,
    ),
    event(
      20,
      'csv_import_validated',
      {
        attemptId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        canExecute: true,
        errorCodes: [],
        executionId,
      },
      34,
    ),
  ];
  samples.push(event(21, 'saved_view_opened', samples[6].properties, 22));
  samples.push(event(22, 'issue_template_applied', samples[7].properties, 23));
  samples.push(event(23, 'push_notification_clicked', { notificationId }, 27));
  samples.push(event(24, 'push_permission_result', { result: 'UNSUPPORTED' }, 35));
  samples.push({ ...samples[16] });
  samples.push({ ...samples[0], eventId: 'not-a-uuid' });

  const result = calculateAlphaObservation(samples);
  assert.equal(result.validatedEventCount, 24);
  assert.equal(result.duplicateEventCount, 1);
  assert.equal(result.semanticDuplicateEventCount, 4);
  assert.equal(result.rejectedEventCount, 1);
  assert.equal(result.uniqueSavedViewCreators, 1);
  assert.equal(result.issueTemplatesCreated, 1);
  assert.equal(result.templateApplications, 1);
  assert.equal(result.templateIssuesCreated, 1);
  assert.equal(result.pushPermissionResults.GRANTED, 0);
  assert.equal(result.pushPermissionResults.UNSUPPORTED, 1);
  assert.equal(result.pushPermissionTransitionCount, 1);
  assert.deepEqual(result.pushDeliveryResults, { FAILED: 0, SUCCEEDED: 2 });
  assert.equal(result.pushClickRate, 1);
  assert.equal(result.feedbackByCategory.USABILITY, 1);
  assert.deepEqual(result.notificationReadDurationsMinutes, [5]);
  assert.deepEqual(result.firstFlowDurationsMinutes, [
    {
      firstIssueToFirstWorkCompleted: 40,
      firstIssueToFirstWorkStarted: 10,
      completedByMembershipId: otherMembershipId,
      createdByMembershipId: membershipId,
      issueId,
      startedByMembershipId: otherMembershipId,
      workspaceId,
    },
  ]);
  assert.deepEqual(result.csvValidationByExecution, [
    {
      errorCodes: { IMPORT_MAPPING_REQUIRED: 1 },
      executionId,
      retryCount: 1,
      validationAttemptCount: 2,
    },
  ]);
  assert.deepEqual(result.onboardingFlows, [
    {
      csvImportCompletedAt: null,
      invitationAcceptedAt: samples[0].occurredAt,
      membershipId,
      signupCompletedAt: null,
      workspaceCreatedAt: null,
      workspaceId,
    },
  ]);
});
