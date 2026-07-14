import { Test } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';

import {
  API_HANDOFF_CREATED,
  AUTH_EMAIL_VERIFICATION_REQUESTED,
  COMMENT_CREATED,
  COMMENT_MENTIONS_ADDED,
  ISSUE_CHANGED,
  ISSUE_CREATED,
  ISSUE_PURGE_SCHEDULED,
  PROJECT_CREATED,
  PROJECT_STATUS_CHANGED,
  TEAM_WORK_CREATED,
  WORKSPACE_CREATED,
  WORKSPACE_INVITATION_REQUESTED,
} from '@rivet/event-contracts';

import { DatabaseService } from '../../common/database/database.service';
import { ObservabilityService } from '../../common/observability/observability.service';
import { EmailDeliveryError } from '../email/email-delivery.error';
import { AccountEmailHandler } from './handlers/account-email.handler';
import { ApiHandoffNotificationHandler } from './handlers/api-handoff-notification.handler';
import { IssueCollaborationNotificationHandler } from './handlers/issue-collaboration-notification.handler';
import { ResourcePurgeHandler } from './handlers/resource-purge.handler';
import { WorkspaceInvitationEmailHandler } from './handlers/workspace-invitation-email.handler';
import { OutboxService } from './outbox.service';
import type { ClaimedOutboxEvent } from './outbox.types';
import { CanceledOutboxError, RetryableOutboxError } from './outbox-errors';
import { OutboxProcessorService } from './outbox-processor.service';

describe('OutboxProcessorService', () => {
  const event: ClaimedOutboxEvent = {
    actorMembershipId: null,
    aggregateId: 'e707e5a7-70b7-487e-a214-b0e7ecb23615',
    aggregateType: 'ACCOUNT',
    attemptCount: 1,
    availableAt: new Date('2026-07-11T00:00:00.000Z'),
    createdAt: new Date('2026-07-11T00:00:00.000Z'),
    eventType: 'M0_TEST_UNSUPPORTED',
    id: 'f57fa7be-1fe9-4744-a8db-704bf989a3cd',
    payload: { schemaVersion: 1 },
    workspaceId: null,
  };
  const accountEmailEvent: ClaimedOutboxEvent = {
    ...event,
    aggregateId: '9d349d04-c7d5-43fb-bb57-b768e2bf0e86',
    aggregateType: 'USER',
    eventType: AUTH_EMAIL_VERIFICATION_REQUESTED,
    payload: {
      schemaVersion: 1,
      tokenId: 'de9d55e4-6181-4a8a-8fdf-f8faf536dc99',
      userId: '9d349d04-c7d5-43fb-bb57-b768e2bf0e86',
    },
  };
  const error = jest.fn();
  const info = jest.fn();
  const warn = jest.fn();
  const accountEmailHandler = { handle: jest.fn() };
  const apiHandoffNotificationHandler = { handle: jest.fn() };
  const issueCollaborationNotificationHandler = {
    handleCommentCreated: jest.fn(),
    handleCommentMentionsAdded: jest.fn(),
    handleIssueChanged: jest.fn(),
    handleIssueCreated: jest.fn(),
    handleTeamWorkChanged: jest.fn(),
    handleTeamWorkCreated: jest.fn(),
  };
  const resourcePurgeHandler = { handleIssue: jest.fn(), handleProject: jest.fn() };
  const workspaceInvitationEmailHandler = { handle: jest.fn() };
  const observability = { alert: jest.fn(), capture: jest.fn(), captureException: jest.fn() };
  const database = {
    client: {
      issue: { count: jest.fn() },
      project: { findFirst: jest.fn() },
      workspace: { findUnique: jest.fn() },
      teamWork: { count: jest.fn() },
    },
  };
  const outbox = {
    cancel: jest.fn(),
    complete: jest.fn(),
    failPermanently: jest.fn(),
    renewLock: jest.fn(),
    scheduleRetry: jest.fn(),
  };
  let processor: OutboxProcessorService;

  beforeEach(async () => {
    jest.resetAllMocks();
    outbox.renewLock.mockResolvedValue(true);
    database.client.issue.count.mockResolvedValue(2);
    database.client.teamWork.count.mockResolvedValue(2);
    database.client.project.findFirst.mockResolvedValue({ id: event.id });
    database.client.workspace.findUnique.mockResolvedValue({ id: event.workspaceId });

    const module = await Test.createTestingModule({
      providers: [
        OutboxProcessorService,
        { provide: DatabaseService, useValue: database },
        { provide: AccountEmailHandler, useValue: accountEmailHandler },
        { provide: ApiHandoffNotificationHandler, useValue: apiHandoffNotificationHandler },
        {
          provide: IssueCollaborationNotificationHandler,
          useValue: issueCollaborationNotificationHandler,
        },
        { provide: ResourcePurgeHandler, useValue: resourcePurgeHandler },
        {
          provide: WorkspaceInvitationEmailHandler,
          useValue: workspaceInvitationEmailHandler,
        },
        { provide: OutboxService, useValue: outbox },
        { provide: ObservabilityService, useValue: observability },
        {
          provide: PinoLogger,
          useValue: { logger: { child: jest.fn().mockReturnValue({ error, info, warn }) } },
        },
      ],
    }).compile();
    processor = module.get(OutboxProcessorService);
  });

  it('logs lock_lost when a permanent failure no longer owns the row', async () => {
    outbox.failPermanently.mockResolvedValue(false);

    await processor.processBatch([event], 'worker-test');

    expect(warn).toHaveBeenCalledWith(
      {
        duration: expect.any(Number),
        errorCode: 'OUTBOX_EVENT_TYPE_UNSUPPORTED',
        result: 'lock_lost',
      },
      'Outbox 결과 저장 실패',
    );
    expect(error).not.toHaveBeenCalled();
  });

  it('logs lock_lost when a retry can no longer be scheduled', async () => {
    Object.defineProperty(processor, 'handleEvent', {
      value: jest.fn().mockRejectedValue(new Error('temporary failure')),
    });
    outbox.scheduleRetry.mockResolvedValue(false);

    await processor.processBatch([event], 'worker-test');

    expect(warn).toHaveBeenCalledWith(
      {
        duration: expect.any(Number),
        errorCode: 'OUTBOX_PROCESSING_FAILED',
        result: 'lock_lost',
      },
      'Outbox 결과 저장 실패',
    );
  });

  it('validates and dispatches a supported account email contract', async () => {
    accountEmailHandler.handle.mockResolvedValue(undefined);
    outbox.complete.mockResolvedValue(true);

    await processor.processBatch([accountEmailEvent], 'worker-test');

    expect(accountEmailHandler.handle).toHaveBeenCalledWith(
      accountEmailEvent,
      AUTH_EMAIL_VERIFICATION_REQUESTED,
      accountEmailEvent.payload,
    );
  });

  it('validates and dispatches a supported workspace invitation contract', async () => {
    const invitationEvent: ClaimedOutboxEvent = {
      ...event,
      actorMembershipId: '607629d0-53e6-469d-bbc8-eb86c50a0288',
      aggregateId: 'c7223ce5-74b3-4495-ae66-a3d269017f6a',
      aggregateType: 'WORKSPACE_INVITATION',
      eventType: WORKSPACE_INVITATION_REQUESTED,
      payload: {
        currentMemberCount: 2,
        invitationId: 'c7223ce5-74b3-4495-ae66-a3d269017f6a',
        schemaVersion: 1,
        tokenId: 'de9d55e4-6181-4a8a-8fdf-f8faf536dc99',
      },
      workspaceId: '77a49ce9-f158-4f4d-b898-bb5b309e461f',
    };
    workspaceInvitationEmailHandler.handle.mockResolvedValue(undefined);
    outbox.complete.mockResolvedValue(true);

    await processor.processBatch([invitationEvent], 'worker-test');

    expect(workspaceInvitationEmailHandler.handle).toHaveBeenCalledWith(
      invitationEvent,
      invitationEvent.payload,
    );
    expect(observability.capture).toHaveBeenCalledWith({
      distinctId: invitationEvent.actorMembershipId,
      name: 'member_invited',
      properties: { currentMemberCount: 2, workspaceId: invitationEvent.workspaceId },
    });
  });

  it.each([
    {
      aggregateId: 'c7223ce5-74b3-4495-ae66-a3d269017f6a',
      aggregateType: 'TEAM_WORK',
      eventType: TEAM_WORK_CREATED,
      payload: {
        assigneeMembershipId: '607629d0-53e6-469d-bbc8-eb86c50a0288',
        issueId: 'f57fa7be-1fe9-4744-a8db-704bf989a3cd',
        schemaVersion: 1,
        teamWorkId: 'c7223ce5-74b3-4495-ae66-a3d269017f6a',
      },
      expected: {
        name: 'team_work_created',
        properties: { hasAssignee: true, workspaceId: event.workspaceId },
      },
    },
    {
      aggregateType: 'WORKSPACE',
      eventType: WORKSPACE_CREATED,
      payload: { acquisitionSource: 'direct', schemaVersion: 1 },
      expected: {
        name: 'workspace_created',
        properties: { acquisitionSource: 'direct', workspaceId: event.workspaceId },
      },
    },
    {
      aggregateType: 'PROJECT',
      eventType: PROJECT_CREATED,
      payload: {
        hasTargetDate: true,
        roleCount: 2,
        roles: ['BACKEND', 'WEB_FRONTEND'],
        schemaVersion: 1,
      },
      expected: {
        name: 'project_created',
        properties: {
          hasTargetDate: true,
          roleCount: 2,
          roles: ['BACKEND', 'WEB_FRONTEND'],
          workspaceId: event.workspaceId,
        },
      },
    },
    {
      aggregateType: 'PROJECT',
      eventType: PROJECT_STATUS_CHANGED,
      payload: {
        fromStatus: 'PLANNED',
        progress: 50,
        schemaVersion: 1,
        toStatus: 'IN_PROGRESS',
      },
      expected: {
        name: 'project_status_changed',
        properties: {
          fromStatus: 'PLANNED',
          progress: 50,
          toStatus: 'IN_PROGRESS',
          workspaceId: event.workspaceId,
        },
      },
    },
  ])('completes and captures $eventType exactly once', async (input) => {
    const analyticsEvent: ClaimedOutboxEvent = {
      ...event,
      actorMembershipId: '607629d0-53e6-469d-bbc8-eb86c50a0288',
      aggregateId:
        input.eventType === WORKSPACE_CREATED ? event.workspaceId! : input.aggregateId ?? event.id,
      aggregateType: input.aggregateType,
      eventType: input.eventType,
      payload: input.payload,
      workspaceId: '77a49ce9-f158-4f4d-b898-bb5b309e461f',
    };
    if (input.eventType === WORKSPACE_CREATED) {
      analyticsEvent.aggregateId = analyticsEvent.workspaceId!;
    }
    outbox.complete.mockResolvedValue(true);

    await processor.processBatch([analyticsEvent], 'worker-test');

    expect(outbox.complete).toHaveBeenCalledWith(analyticsEvent.id, 'worker-test');
    expect(observability.capture).toHaveBeenCalledWith({
      distinctId: analyticsEvent.actorMembershipId,
      ...input.expected,
      properties: { ...input.expected.properties, workspaceId: analyticsEvent.workspaceId },
    });
    expect(info).toHaveBeenCalledWith(
      { duration: expect.any(Number), result: 'processed' },
      'Outbox 처리 완료',
    );
  });

  it('rejects a project aggregate outside the event workspace before analytics capture', async () => {
    const analyticsEvent: ClaimedOutboxEvent = {
      ...event,
      actorMembershipId: '607629d0-53e6-469d-bbc8-eb86c50a0288',
      aggregateId: event.id,
      aggregateType: 'PROJECT',
      eventType: PROJECT_CREATED,
      payload: {
        hasTargetDate: false,
        roleCount: 1,
        roles: ['BACKEND'],
        schemaVersion: 1,
      },
      workspaceId: '77a49ce9-f158-4f4d-b898-bb5b309e461f',
    };
    database.client.project.findFirst.mockResolvedValue(null);
    outbox.failPermanently.mockResolvedValue(true);

    await processor.processBatch([analyticsEvent], 'worker-test');

    expect(database.client.project.findFirst).toHaveBeenCalledWith({
      select: { id: true },
      where: { id: analyticsEvent.aggregateId, workspaceId: analyticsEvent.workspaceId },
    });
    expect(outbox.failPermanently).toHaveBeenCalledWith(
      analyticsEvent.id,
      'worker-test',
      'OUTBOX_EVENT_CONTRACT_INVALID',
    );
    expect(outbox.complete).not.toHaveBeenCalled();
    expect(observability.capture).not.toHaveBeenCalled();
  });

  it('does not capture an analytics Outbox event when completion loses its lock', async () => {
    const analyticsEvent: ClaimedOutboxEvent = {
      ...event,
      actorMembershipId: '607629d0-53e6-469d-bbc8-eb86c50a0288',
      aggregateId: event.workspaceId!,
      aggregateType: 'WORKSPACE',
      eventType: WORKSPACE_CREATED,
      payload: { acquisitionSource: 'direct', schemaVersion: 1 },
      workspaceId: '77a49ce9-f158-4f4d-b898-bb5b309e461f',
    };
    analyticsEvent.aggregateId = analyticsEvent.workspaceId!;
    outbox.complete.mockResolvedValue(false);

    await processor.processBatch([analyticsEvent], 'worker-test');

    expect(observability.capture).not.toHaveBeenCalled();
  });

  it('validates and dispatches a supported API handoff contract', async () => {
    const handoffEvent: ClaimedOutboxEvent = {
      ...event,
      actorMembershipId: '607629d0-53e6-469d-bbc8-eb86c50a0288',
      aggregateId: 'de9d55e4-6181-4a8a-8fdf-f8faf536dc99',
      aggregateType: 'API_HANDOFF',
      eventType: API_HANDOFF_CREATED,
      payload: {
        candidateRecipientMembershipIds: ['c7223ce5-74b3-4495-ae66-a3d269017f6a'],
        handoffId: 'de9d55e4-6181-4a8a-8fdf-f8faf536dc99',
        issueId: 'f57fa7be-1fe9-4744-a8db-704bf989a3cd',
        kind: 'INITIAL',
        schemaVersion: 1,
        sourceTeamWorkId: '98ab3a6d-0d24-484e-a36a-b8028dc00465',
        targetTeamWorkIds: ['c7223ce5-74b3-4495-ae66-a3d269017f6a'],
      },
      workspaceId: '77a49ce9-f158-4f4d-b898-bb5b309e461f',
    };
    apiHandoffNotificationHandler.handle.mockResolvedValue(undefined);
    outbox.complete.mockResolvedValue(true);

    await processor.processBatch([handoffEvent], 'worker-test');

    expect(apiHandoffNotificationHandler.handle).toHaveBeenCalledWith(
      handoffEvent,
      handoffEvent.payload,
    );
    expect(observability.capture).toHaveBeenCalledWith({
      distinctId: handoffEvent.actorMembershipId,
      name: 'api_handoff_created',
      properties: {
        isFollowUp: false,
        targetTeamWorkCount: 1,
        workspaceId: handoffEvent.workspaceId,
      },
    });
  });

  it.each([
    {
      aggregateId: 'c7223ce5-74b3-4495-ae66-a3d269017f6a',
      aggregateType: 'TEAM_WORK',
      eventType: TEAM_WORK_CREATED,
      handler: 'handleTeamWorkCreated' as const,
      payload: {
        assigneeMembershipId: '607629d0-53e6-469d-bbc8-eb86c50a0288',
        issueId: 'f57fa7be-1fe9-4744-a8db-704bf989a3cd',
        schemaVersion: 1,
        teamWorkId: 'c7223ce5-74b3-4495-ae66-a3d269017f6a',
      },
    },
    {
      aggregateId: 'f57fa7be-1fe9-4744-a8db-704bf989a3cd',
      aggregateType: 'ISSUE',
      eventType: ISSUE_CREATED,
      handler: 'handleIssueCreated' as const,
      payload: {
        issueId: 'f57fa7be-1fe9-4744-a8db-704bf989a3cd',
        mentionedMembershipIds: [],
        schemaVersion: 1,
      },
    },
    {
      aggregateId: 'f57fa7be-1fe9-4744-a8db-704bf989a3cd',
      aggregateType: 'ISSUE',
      eventType: ISSUE_CHANGED,
      handler: 'handleIssueChanged' as const,
      payload: {
        changedFields: ['TITLE'],
        issueId: 'f57fa7be-1fe9-4744-a8db-704bf989a3cd',
        mentionedMembershipIds: [],
        schemaVersion: 1,
        subscriberMembershipIds: [],
        terminalCategory: null,
      },
    },
    {
      aggregateId: 'de9d55e4-6181-4a8a-8fdf-f8faf536dc99',
      aggregateType: 'COMMENT',
      eventType: COMMENT_CREATED,
      handler: 'handleCommentCreated' as const,
      payload: {
        commentId: 'de9d55e4-6181-4a8a-8fdf-f8faf536dc99',
        hasMention: false,
        issueId: 'f57fa7be-1fe9-4744-a8db-704bf989a3cd',
        mentionedMembershipIds: [],
        schemaVersion: 1,
        subscriberMembershipIds: [],
        teamWorkId: null,
      },
    },
    {
      aggregateId: 'de9d55e4-6181-4a8a-8fdf-f8faf536dc99',
      aggregateType: 'COMMENT',
      eventType: COMMENT_MENTIONS_ADDED,
      handler: 'handleCommentMentionsAdded' as const,
      payload: {
        commentId: 'de9d55e4-6181-4a8a-8fdf-f8faf536dc99',
        issueId: 'f57fa7be-1fe9-4744-a8db-704bf989a3cd',
        mentionedMembershipIds: ['c7223ce5-74b3-4495-ae66-a3d269017f6a'],
        schemaVersion: 1,
        teamWorkId: null,
      },
    },
  ])('validates and dispatches $eventType', async (input) => {
    const collaborationEvent: ClaimedOutboxEvent = {
      ...event,
      actorMembershipId: '607629d0-53e6-469d-bbc8-eb86c50a0288',
      aggregateId: input.aggregateId,
      aggregateType: input.aggregateType,
      eventType: input.eventType,
      payload: input.payload,
      workspaceId: '77a49ce9-f158-4f4d-b898-bb5b309e461f',
    };
    outbox.complete.mockResolvedValue(true);

    await processor.processBatch([collaborationEvent], 'worker-test');

    expect(issueCollaborationNotificationHandler[input.handler]).toHaveBeenCalledWith(
      collaborationEvent,
      input.payload,
    );
    expect(observability.capture).toHaveBeenCalledTimes(
      input.eventType === COMMENT_MENTIONS_ADDED ? 0 : 1,
    );
  });

  it.each([
    ['unsupported version', { schemaVersion: 2 }, 'OUTBOX_SCHEMA_VERSION_UNSUPPORTED'],
    ['invalid payload', { schemaVersion: 1 }, 'OUTBOX_PAYLOAD_INVALID'],
  ])('permanently rejects an %s collaboration contract', async (_name, payload, code) => {
    const collaborationEvent: ClaimedOutboxEvent = {
      ...event,
      actorMembershipId: '607629d0-53e6-469d-bbc8-eb86c50a0288',
      aggregateId: 'f57fa7be-1fe9-4744-a8db-704bf989a3cd',
      aggregateType: 'ISSUE',
      eventType: ISSUE_CREATED,
      payload,
      workspaceId: '77a49ce9-f158-4f4d-b898-bb5b309e461f',
    };
    outbox.failPermanently.mockResolvedValue(true);

    await processor.processBatch([collaborationEvent], 'worker-test');

    expect(outbox.failPermanently).toHaveBeenCalledWith(collaborationEvent.id, 'worker-test', code);
    expect(issueCollaborationNotificationHandler.handleIssueCreated).not.toHaveBeenCalled();
    expect(observability.alert).toHaveBeenCalledWith({
      errorCode: code,
      jobId: `job_${collaborationEvent.id}`,
      type: 'OUTBOX_PERMANENTLY_FAILED',
    });
  });

  it('permanently rejects an inconsistent issue-change snapshot', async () => {
    const collaborationEvent: ClaimedOutboxEvent = {
      ...event,
      actorMembershipId: '607629d0-53e6-469d-bbc8-eb86c50a0288',
      aggregateId: 'f57fa7be-1fe9-4744-a8db-704bf989a3cd',
      aggregateType: 'ISSUE',
      eventType: ISSUE_CHANGED,
      payload: {
        changedFields: ['TITLE'],
        issueId: 'f57fa7be-1fe9-4744-a8db-704bf989a3cd',
        mentionedMembershipIds: [],
        schemaVersion: 1,
        subscriberMembershipIds: ['c7223ce5-74b3-4495-ae66-a3d269017f6a'],
        terminalCategory: null,
      },
      workspaceId: '77a49ce9-f158-4f4d-b898-bb5b309e461f',
    };
    outbox.failPermanently.mockResolvedValue(true);

    await processor.processBatch([collaborationEvent], 'worker-test');

    expect(outbox.failPermanently).toHaveBeenCalledWith(
      collaborationEvent.id,
      'worker-test',
      'OUTBOX_PAYLOAD_INVALID',
    );
    expect(issueCollaborationNotificationHandler.handleIssueChanged).not.toHaveBeenCalled();
  });

  it.each([
    ['workspace', { workspaceId: null }],
    ['actor', { actorMembershipId: null }],
    ['aggregate type', { aggregateType: 'ISSUE' }],
    ['aggregate ID', { aggregateId: '98ab3a6d-0d24-484e-a36a-b8028dc00465' }],
  ])('permanently rejects an invalid API handoff %s contract', async (_name, override) => {
    const handoffEvent: ClaimedOutboxEvent = {
      ...event,
      actorMembershipId: '607629d0-53e6-469d-bbc8-eb86c50a0288',
      aggregateId: 'de9d55e4-6181-4a8a-8fdf-f8faf536dc99',
      aggregateType: 'API_HANDOFF',
      eventType: API_HANDOFF_CREATED,
      payload: {
        candidateRecipientMembershipIds: [],
        handoffId: 'de9d55e4-6181-4a8a-8fdf-f8faf536dc99',
        issueId: 'f57fa7be-1fe9-4744-a8db-704bf989a3cd',
        kind: 'FOLLOW_UP',
        schemaVersion: 1,
        sourceTeamWorkId: '98ab3a6d-0d24-484e-a36a-b8028dc00465',
        targetTeamWorkIds: [],
      },
      workspaceId: '77a49ce9-f158-4f4d-b898-bb5b309e461f',
      ...override,
    };
    outbox.failPermanently.mockResolvedValue(true);

    await processor.processBatch([handoffEvent], 'worker-test');

    expect(outbox.failPermanently).toHaveBeenCalledWith(
      handoffEvent.id,
      'worker-test',
      'OUTBOX_EVENT_CONTRACT_INVALID',
    );
    expect(apiHandoffNotificationHandler.handle).not.toHaveBeenCalled();
  });

  it('permanently rejects an unsupported API handoff schema version', async () => {
    const handoffEvent: ClaimedOutboxEvent = {
      ...event,
      actorMembershipId: '607629d0-53e6-469d-bbc8-eb86c50a0288',
      aggregateId: 'de9d55e4-6181-4a8a-8fdf-f8faf536dc99',
      aggregateType: 'API_HANDOFF',
      eventType: API_HANDOFF_CREATED,
      payload: {
        candidateRecipientMembershipIds: [],
        handoffId: 'de9d55e4-6181-4a8a-8fdf-f8faf536dc99',
        issueId: 'f57fa7be-1fe9-4744-a8db-704bf989a3cd',
        kind: 'INITIAL',
        schemaVersion: 2,
        sourceTeamWorkId: '98ab3a6d-0d24-484e-a36a-b8028dc00465',
        targetTeamWorkIds: [],
      },
      workspaceId: '77a49ce9-f158-4f4d-b898-bb5b309e461f',
    };
    outbox.failPermanently.mockResolvedValue(true);

    await processor.processBatch([handoffEvent], 'worker-test');

    expect(outbox.failPermanently).toHaveBeenCalledWith(
      handoffEvent.id,
      'worker-test',
      'OUTBOX_SCHEMA_VERSION_UNSUPPORTED',
    );
    expect(apiHandoffNotificationHandler.handle).not.toHaveBeenCalled();
  });

  it('permanently rejects a workspace invitation without an actor membership', async () => {
    const invitationEvent: ClaimedOutboxEvent = {
      ...event,
      aggregateId: 'c7223ce5-74b3-4495-ae66-a3d269017f6a',
      aggregateType: 'WORKSPACE_INVITATION',
      eventType: WORKSPACE_INVITATION_REQUESTED,
      payload: {
        currentMemberCount: 2,
        invitationId: 'c7223ce5-74b3-4495-ae66-a3d269017f6a',
        schemaVersion: 1,
        tokenId: 'de9d55e4-6181-4a8a-8fdf-f8faf536dc99',
      },
      workspaceId: '77a49ce9-f158-4f4d-b898-bb5b309e461f',
    };
    outbox.failPermanently.mockResolvedValue(true);

    await processor.processBatch([invitationEvent], 'worker-test');

    expect(outbox.failPermanently).toHaveBeenCalledWith(
      invitationEvent.id,
      'worker-test',
      'OUTBOX_EVENT_CONTRACT_INVALID',
    );
    expect(workspaceInvitationEmailHandler.handle).not.toHaveBeenCalled();
  });

  it.each([
    ['workspace', { workspaceId: '607629d0-53e6-469d-bbc8-eb86c50a0288' }],
    ['actor', { actorMembershipId: '607629d0-53e6-469d-bbc8-eb86c50a0288' }],
    ['aggregate type', { aggregateType: 'ACCOUNT' }],
    ['aggregate ID', { aggregateId: '607629d0-53e6-469d-bbc8-eb86c50a0288' }],
  ])('permanently rejects an invalid account email %s contract', async (_name, override) => {
    outbox.failPermanently.mockResolvedValue(true);

    await processor.processBatch([{ ...accountEmailEvent, ...override }], 'worker-test');

    expect(outbox.failPermanently).toHaveBeenCalledWith(
      accountEmailEvent.id,
      'worker-test',
      'OUTBOX_EVENT_CONTRACT_INVALID',
    );
    expect(accountEmailHandler.handle).not.toHaveBeenCalled();
  });

  it('cancels an inactive email event and reports a lost result lock', async () => {
    Object.defineProperty(processor, 'handleEvent', {
      value: jest.fn().mockRejectedValue(new CanceledOutboxError('EMAIL_TOKEN_INACTIVE')),
    });
    outbox.cancel.mockResolvedValue(false);

    await processor.processBatch([event], 'worker-test');

    expect(outbox.cancel).toHaveBeenCalledWith(event.id, 'worker-test', 'EMAIL_TOKEN_INACTIVE');
    expect(warn).toHaveBeenCalledWith(
      {
        duration: expect.any(Number),
        errorCode: 'EMAIL_TOKEN_INACTIVE',
        result: 'lock_lost',
      },
      'Outbox 결과 저장 실패',
    );
  });

  it('retries a transient email provider error with its sanitized code', async () => {
    Object.defineProperty(processor, 'handleEvent', {
      value: jest
        .fn()
        .mockRejectedValue(new EmailDeliveryError('EMAIL_PROVIDER_RATE_LIMITED', true)),
    });
    outbox.scheduleRetry.mockResolvedValue(true);

    await processor.processBatch([event], 'worker-test');

    expect(outbox.scheduleRetry).toHaveBeenCalledWith(
      event.id,
      'worker-test',
      expect.any(Number),
      'EMAIL_PROVIDER_RATE_LIMITED',
    );
  });

  it('permanently fails and alerts for a rejected email provider configuration', async () => {
    Object.defineProperty(processor, 'handleEvent', {
      value: jest.fn().mockRejectedValue(new EmailDeliveryError('EMAIL_PROVIDER_REJECTED', false)),
    });
    outbox.failPermanently.mockResolvedValue(true);

    await processor.processBatch([accountEmailEvent], 'worker-test');

    expect(outbox.failPermanently).toHaveBeenCalledWith(
      accountEmailEvent.id,
      'worker-test',
      'EMAIL_PROVIDER_REJECTED',
    );
    expect(observability.alert).toHaveBeenCalledWith({
      errorCode: 'EMAIL_PROVIDER_REJECTED',
      jobId: `job_${accountEmailEvent.id}`,
      type: 'OUTBOX_PERMANENTLY_FAILED',
    });
  });

  it('alerts after consecutive email provider failures exhaust their retries', async () => {
    Object.defineProperty(processor, 'handleEvent', {
      value: jest
        .fn()
        .mockRejectedValue(new EmailDeliveryError('EMAIL_PROVIDER_UNAVAILABLE', true)),
    });
    outbox.failPermanently.mockResolvedValue(true);
    const exhaustedEvent = { ...accountEmailEvent, attemptCount: 7 };

    await processor.processBatch([exhaustedEvent], 'worker-test');

    expect(outbox.failPermanently).toHaveBeenCalledWith(
      exhaustedEvent.id,
      'worker-test',
      'OUTBOX_MAX_ATTEMPTS_REACHED',
    );
    expect(observability.alert).toHaveBeenCalledWith({
      errorCode: 'OUTBOX_MAX_ATTEMPTS_REACHED',
      jobId: `job_${exhaustedEvent.id}`,
      type: 'OUTBOX_PERMANENTLY_FAILED',
    });
  });

  it('validates and dispatches an issue purge contract', async () => {
    const purgeAt = '2026-08-10T00:00:00.000Z';
    const purgeEvent: ClaimedOutboxEvent = {
      ...event,
      actorMembershipId: '607629d0-53e6-469d-bbc8-eb86c50a0288',
      aggregateId: 'f57fa7be-1fe9-4744-a8db-704bf989a3cd',
      aggregateType: 'ISSUE',
      availableAt: new Date(purgeAt),
      eventType: ISSUE_PURGE_SCHEDULED,
      payload: {
        issueId: 'f57fa7be-1fe9-4744-a8db-704bf989a3cd',
        purgeAt,
        schemaVersion: 1,
      },
      workspaceId: '77a49ce9-f158-4f4d-b898-bb5b309e461f',
    };
    resourcePurgeHandler.handleIssue.mockResolvedValue(undefined);
    outbox.complete.mockResolvedValue(true);

    await processor.processBatch([purgeEvent], 'worker-test');

    expect(resourcePurgeHandler.handleIssue).toHaveBeenCalledWith(purgeEvent, purgeEvent.payload);
    expect(outbox.complete).toHaveBeenCalledWith(purgeEvent.id, 'worker-test');
  });

  it('preserves the PROJECT_PURGE_BLOCKED retry code', async () => {
    Object.defineProperty(processor, 'handleEvent', {
      value: jest.fn().mockRejectedValue(new RetryableOutboxError('PROJECT_PURGE_BLOCKED')),
    });
    outbox.scheduleRetry.mockResolvedValue(true);

    await processor.processBatch([event], 'worker-test');

    expect(outbox.scheduleRetry).toHaveBeenCalledWith(
      event.id,
      'worker-test',
      expect.any(Number),
      'PROJECT_PURGE_BLOCKED',
    );
  });
});
