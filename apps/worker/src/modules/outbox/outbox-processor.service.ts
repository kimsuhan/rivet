import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import {
  API_HANDOFF_CREATED,
  COMMENT_CREATED,
  COMMENT_MENTIONS_ADDED,
  isAccountEmailEventType,
  ISSUE_CHANGED,
  ISSUE_CREATED,
  ISSUE_PURGE_SCHEDULED,
  PRODUCT_EVENT_PAYLOAD_VERSION,
  type ProductEvent,
  type ProductEventName,
  PROJECT_CREATED,
  PROJECT_PURGE_SCHEDULED,
  PROJECT_STATUS_CHANGED,
  TEAM_WORK_CHANGED,
  TEAM_WORK_CREATED,
  validateAccountEmailOutboxPayload,
  validateApiHandoffCreatedOutboxPayload,
  validateCommentCreatedOutboxPayload,
  validateCommentMentionsAddedOutboxPayload,
  validateIssueChangedOutboxPayload,
  validateIssueCreatedOutboxPayload,
  validateIssuePurgeScheduledOutboxPayload,
  validateProjectCreatedOutboxPayload,
  validateProjectPurgeScheduledOutboxPayload,
  validateProjectStatusChangedOutboxPayload,
  validateTeamWorkChangedOutboxPayload,
  validateTeamWorkCreatedOutboxPayload,
  validateWebPushTestRequestedOutboxPayload,
  validateWorkspaceCreatedOutboxPayload,
  validateWorkspaceInvitationEmailOutboxPayload,
  WEB_PUSH_TEST_REQUESTED,
  WORKSPACE_CREATED,
  WORKSPACE_INVITATION_REQUESTED,
} from '@rivet/event-contracts';

import { DatabaseService } from '../../common/database/database.service';
import { ObservabilityService } from '../../common/observability/observability.service';
import { EmailDeliveryError } from '../email/email-delivery.error';
import { WebPushDeliveryService } from '../web-push/web-push-delivery.service';
import { AccountEmailHandler } from './handlers/account-email.handler';
import { ApiHandoffNotificationHandler } from './handlers/api-handoff-notification.handler';
import { IssueCollaborationNotificationHandler } from './handlers/issue-collaboration-notification.handler';
import { ResourcePurgeHandler } from './handlers/resource-purge.handler';
import { WorkspaceInvitationEmailHandler } from './handlers/workspace-invitation-email.handler';
import { OutboxService } from './outbox.service';
import type { ClaimedOutboxEvent } from './outbox.types';
import { CanceledOutboxError, PermanentOutboxError, RetryableOutboxError } from './outbox-errors';
import { calculateRetryDelayMs } from './outbox-retry';

const MAX_CONCURRENT_EVENTS = 5;

function eventId(sourceId: string, name: ProductEventName): string {
  const bytes = createHash('sha256').update(`${name}:${sourceId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function productEvent(
  event: ClaimedOutboxEvent,
  name: ProductEventName,
  properties: Record<string, unknown>,
): ProductEvent | null {
  if (!event.workspaceId || !event.actorMembershipId) return null;
  return {
    eventId: eventId(event.id, name),
    membershipId: event.actorMembershipId,
    name,
    occurredAt: event.createdAt.toISOString(),
    payloadVersion: PRODUCT_EVENT_PAYLOAD_VERSION,
    properties,
    workspaceId: event.workspaceId,
  };
}

@Injectable()
export class OutboxProcessorService {
  constructor(
    private readonly database: DatabaseService,
    private readonly outbox: OutboxService,
    private readonly accountEmailHandler: AccountEmailHandler,
    private readonly apiHandoffNotificationHandler: ApiHandoffNotificationHandler,
    private readonly issueCollaborationNotificationHandler: IssueCollaborationNotificationHandler,
    private readonly resourcePurgeHandler: ResourcePurgeHandler,
    private readonly workspaceInvitationEmailHandler: WorkspaceInvitationEmailHandler,
    private readonly webPushDelivery: WebPushDeliveryService,
    private readonly observability: ObservabilityService,
    private readonly logger: PinoLogger,
  ) {}

  async processBatch(events: ClaimedOutboxEvent[], workerId: string): Promise<void> {
    for (let index = 0; index < events.length; index += MAX_CONCURRENT_EVENTS) {
      await Promise.all(
        events
          .slice(index, index + MAX_CONCURRENT_EVENTS)
          .map((event) => this.processEvent(event, workerId)),
      );
    }
  }

  private async processEvent(event: ClaimedOutboxEvent, workerId: string): Promise<void> {
    const startedAt = Date.now();
    const jobLogger = this.logger.logger.child({
      aggregateId: event.aggregateId,
      aggregateType: event.aggregateType,
      attempt: event.attemptCount,
      eventId: event.id,
      eventType: event.eventType,
      jobId: `job_${event.id}`,
      workspaceId: event.workspaceId,
    });

    if (!(await this.outbox.renewLock(event.id, workerId))) {
      jobLogger.warn(
        { duration: Date.now() - startedAt, errorCode: 'OUTBOX_LOCK_LOST', result: 'skipped' },
        'Outbox 잠금 상실',
      );
      return;
    }

    try {
      await this.handleEvent(event);
      const completed = await this.outbox.complete(event.id, workerId);
      jobLogger.info(
        { duration: Date.now() - startedAt, result: completed ? 'processed' : 'lock_lost' },
        completed ? 'Outbox 처리 완료' : 'Outbox 결과 저장 실패',
      );
      if (completed) this.captureCompletedEvent(event);
    } catch (error) {
      if (error instanceof CanceledOutboxError) {
        const canceled = await this.outbox.cancel(event.id, workerId, error.code);

        if (!canceled) {
          jobLogger.warn(
            { duration: Date.now() - startedAt, errorCode: error.code, result: 'lock_lost' },
            'Outbox 결과 저장 실패',
          );
          return;
        }

        jobLogger.info(
          { duration: Date.now() - startedAt, errorCode: error.code, result: 'canceled' },
          'Outbox 처리 취소',
        );
        return;
      }

      if (error instanceof PermanentOutboxError) {
        const failed = await this.outbox.failPermanently(event.id, workerId, error.code);

        if (!failed) {
          jobLogger.warn(
            { duration: Date.now() - startedAt, errorCode: error.code, result: 'lock_lost' },
            'Outbox 결과 저장 실패',
          );
          return;
        }

        jobLogger.error(
          { duration: Date.now() - startedAt, errorCode: error.code, result: 'failed' },
          'Outbox 영구 실패',
        );
        this.alertPermanentFailure(event, error.code);
        return;
      }

      if (error instanceof EmailDeliveryError && !error.isRetryable) {
        const failed = await this.outbox.failPermanently(event.id, workerId, error.code);

        if (!failed) {
          jobLogger.warn(
            { duration: Date.now() - startedAt, errorCode: error.code, result: 'lock_lost' },
            'Outbox 결과 저장 실패',
          );
          return;
        }

        jobLogger.error(
          { duration: Date.now() - startedAt, errorCode: error.code, result: 'failed' },
          'Outbox 영구 실패',
        );
        this.alertPermanentFailure(event, error.code);
        return;
      }

      if (!(error instanceof EmailDeliveryError) && !(error instanceof RetryableOutboxError)) {
        this.observability.captureException(error, `job_${event.id}`);
      }

      const retryDelayMs = calculateRetryDelayMs(event.attemptCount);

      if (retryDelayMs === null) {
        const failed = await this.outbox.failPermanently(
          event.id,
          workerId,
          'OUTBOX_MAX_ATTEMPTS_REACHED',
        );

        if (!failed) {
          jobLogger.warn(
            {
              duration: Date.now() - startedAt,
              errorCode: 'OUTBOX_MAX_ATTEMPTS_REACHED',
              result: 'lock_lost',
            },
            'Outbox 결과 저장 실패',
          );
          return;
        }

        jobLogger.error(
          {
            duration: Date.now() - startedAt,
            errorCode: 'OUTBOX_MAX_ATTEMPTS_REACHED',
            result: 'failed',
          },
          'Outbox 최대 재시도 도달',
        );
        this.alertPermanentFailure(event, 'OUTBOX_MAX_ATTEMPTS_REACHED');
        return;
      }

      const errorCode =
        error instanceof EmailDeliveryError || error instanceof RetryableOutboxError
          ? error.code
          : 'OUTBOX_PROCESSING_FAILED';
      const scheduled = await this.outbox.scheduleRetry(
        event.id,
        workerId,
        retryDelayMs,
        errorCode,
      );

      if (!scheduled) {
        jobLogger.warn(
          { duration: Date.now() - startedAt, errorCode, result: 'lock_lost' },
          'Outbox 결과 저장 실패',
        );
        return;
      }

      jobLogger.warn(
        { duration: Date.now() - startedAt, errorCode, result: 'retry' },
        'Outbox 재시도 예약',
      );
    }
  }

  private async handleEvent(event: ClaimedOutboxEvent): Promise<void> {
    if (event.eventType === WORKSPACE_CREATED) {
      const validation = validateWorkspaceCreatedOutboxPayload(event.payload);
      if (!validation.success) {
        throw new PermanentOutboxError(
          validation.reason === 'UNSUPPORTED_SCHEMA_VERSION'
            ? 'OUTBOX_SCHEMA_VERSION_UNSUPPORTED'
            : 'OUTBOX_PAYLOAD_INVALID',
        );
      }
      if (
        event.workspaceId === null ||
        event.actorMembershipId === null ||
        event.aggregateType !== 'WORKSPACE' ||
        event.aggregateId !== event.workspaceId
      ) {
        throw new PermanentOutboxError('OUTBOX_EVENT_CONTRACT_INVALID');
      }
      await this.assertAnalyticsEventReferences(event);
      return;
    }

    if (event.eventType === PROJECT_CREATED) {
      const validation = validateProjectCreatedOutboxPayload(event.payload);
      if (!validation.success) {
        throw new PermanentOutboxError(
          validation.reason === 'UNSUPPORTED_SCHEMA_VERSION'
            ? 'OUTBOX_SCHEMA_VERSION_UNSUPPORTED'
            : 'OUTBOX_PAYLOAD_INVALID',
        );
      }
      if (
        event.workspaceId === null ||
        event.actorMembershipId === null ||
        event.aggregateType !== 'PROJECT'
      ) {
        throw new PermanentOutboxError('OUTBOX_EVENT_CONTRACT_INVALID');
      }
      await this.assertAnalyticsEventReferences(event);
      return;
    }

    if (event.eventType === PROJECT_STATUS_CHANGED) {
      const validation = validateProjectStatusChangedOutboxPayload(event.payload);
      if (!validation.success) {
        throw new PermanentOutboxError(
          validation.reason === 'UNSUPPORTED_SCHEMA_VERSION'
            ? 'OUTBOX_SCHEMA_VERSION_UNSUPPORTED'
            : 'OUTBOX_PAYLOAD_INVALID',
        );
      }
      if (
        event.workspaceId === null ||
        event.actorMembershipId === null ||
        event.aggregateType !== 'PROJECT'
      ) {
        throw new PermanentOutboxError('OUTBOX_EVENT_CONTRACT_INVALID');
      }
      await this.assertAnalyticsEventReferences(event);
      return;
    }

    if (event.eventType === ISSUE_PURGE_SCHEDULED) {
      const validation = validateIssuePurgeScheduledOutboxPayload(event.payload);
      if (!validation.success) {
        throw new PermanentOutboxError(
          validation.reason === 'UNSUPPORTED_SCHEMA_VERSION'
            ? 'OUTBOX_SCHEMA_VERSION_UNSUPPORTED'
            : 'OUTBOX_PAYLOAD_INVALID',
        );
      }
      if (
        event.workspaceId === null ||
        event.actorMembershipId === null ||
        event.aggregateType !== 'ISSUE' ||
        event.aggregateId !== validation.payload.issueId
      ) {
        throw new PermanentOutboxError('OUTBOX_EVENT_CONTRACT_INVALID');
      }
      await this.resourcePurgeHandler.handleIssue(event, validation.payload);
      return;
    }

    if (event.eventType === PROJECT_PURGE_SCHEDULED) {
      const validation = validateProjectPurgeScheduledOutboxPayload(event.payload);
      if (!validation.success) {
        throw new PermanentOutboxError(
          validation.reason === 'UNSUPPORTED_SCHEMA_VERSION'
            ? 'OUTBOX_SCHEMA_VERSION_UNSUPPORTED'
            : 'OUTBOX_PAYLOAD_INVALID',
        );
      }
      if (
        event.workspaceId === null ||
        event.actorMembershipId === null ||
        event.aggregateType !== 'PROJECT' ||
        event.aggregateId !== validation.payload.projectId
      ) {
        throw new PermanentOutboxError('OUTBOX_EVENT_CONTRACT_INVALID');
      }
      await this.resourcePurgeHandler.handleProject(event, validation.payload);
      return;
    }

    if (event.eventType === ISSUE_CREATED) {
      const validation = validateIssueCreatedOutboxPayload(event.payload);

      if (!validation.success) {
        throw new PermanentOutboxError(
          validation.reason === 'UNSUPPORTED_SCHEMA_VERSION'
            ? 'OUTBOX_SCHEMA_VERSION_UNSUPPORTED'
            : 'OUTBOX_PAYLOAD_INVALID',
        );
      }

      if (
        event.workspaceId === null ||
        event.actorMembershipId === null ||
        event.aggregateType !== 'ISSUE' ||
        event.aggregateId !== validation.payload.issueId
      ) {
        throw new PermanentOutboxError('OUTBOX_EVENT_CONTRACT_INVALID');
      }

      await this.issueCollaborationNotificationHandler.handleIssueCreated(
        event,
        validation.payload,
      );
      await this.webPushDelivery.deliverNotifications(event);
      return;
    }

    if (event.eventType === ISSUE_CHANGED) {
      const validation = validateIssueChangedOutboxPayload(event.payload);

      if (!validation.success) {
        throw new PermanentOutboxError(
          validation.reason === 'UNSUPPORTED_SCHEMA_VERSION'
            ? 'OUTBOX_SCHEMA_VERSION_UNSUPPORTED'
            : 'OUTBOX_PAYLOAD_INVALID',
        );
      }

      if (
        event.workspaceId === null ||
        event.actorMembershipId === null ||
        event.aggregateType !== 'ISSUE' ||
        event.aggregateId !== validation.payload.issueId
      ) {
        throw new PermanentOutboxError('OUTBOX_EVENT_CONTRACT_INVALID');
      }

      await this.issueCollaborationNotificationHandler.handleIssueChanged(
        event,
        validation.payload,
      );
      await this.webPushDelivery.deliverNotifications(event);
      return;
    }

    if (event.eventType === TEAM_WORK_CREATED) {
      const validation = validateTeamWorkCreatedOutboxPayload(event.payload);
      if (!validation.success) {
        throw new PermanentOutboxError(
          validation.reason === 'UNSUPPORTED_SCHEMA_VERSION'
            ? 'OUTBOX_SCHEMA_VERSION_UNSUPPORTED'
            : 'OUTBOX_PAYLOAD_INVALID',
        );
      }
      if (
        event.workspaceId === null ||
        event.actorMembershipId === null ||
        event.aggregateType !== 'TEAM_WORK' ||
        event.aggregateId !== validation.payload.teamWorkId
      ) {
        throw new PermanentOutboxError('OUTBOX_EVENT_CONTRACT_INVALID');
      }
      await this.issueCollaborationNotificationHandler.handleTeamWorkCreated(
        event,
        validation.payload,
      );
      await this.webPushDelivery.deliverNotifications(event);
      return;
    }

    if (event.eventType === TEAM_WORK_CHANGED) {
      const validation = validateTeamWorkChangedOutboxPayload(event.payload);
      if (!validation.success) {
        throw new PermanentOutboxError(
          validation.reason === 'UNSUPPORTED_SCHEMA_VERSION'
            ? 'OUTBOX_SCHEMA_VERSION_UNSUPPORTED'
            : 'OUTBOX_PAYLOAD_INVALID',
        );
      }
      if (
        event.workspaceId === null ||
        event.actorMembershipId === null ||
        event.aggregateType !== 'TEAM_WORK' ||
        event.aggregateId !== validation.payload.teamWorkId
      ) {
        throw new PermanentOutboxError('OUTBOX_EVENT_CONTRACT_INVALID');
      }
      await this.issueCollaborationNotificationHandler.handleTeamWorkChanged(
        event,
        validation.payload,
      );
      await this.webPushDelivery.deliverNotifications(event);
      return;
    }

    if (event.eventType === COMMENT_CREATED) {
      const validation = validateCommentCreatedOutboxPayload(event.payload);

      if (!validation.success) {
        throw new PermanentOutboxError(
          validation.reason === 'UNSUPPORTED_SCHEMA_VERSION'
            ? 'OUTBOX_SCHEMA_VERSION_UNSUPPORTED'
            : 'OUTBOX_PAYLOAD_INVALID',
        );
      }

      if (
        event.workspaceId === null ||
        event.actorMembershipId === null ||
        event.aggregateType !== 'COMMENT' ||
        event.aggregateId !== validation.payload.commentId
      ) {
        throw new PermanentOutboxError('OUTBOX_EVENT_CONTRACT_INVALID');
      }

      await this.issueCollaborationNotificationHandler.handleCommentCreated(
        event,
        validation.payload,
      );
      await this.webPushDelivery.deliverNotifications(event);
      return;
    }

    if (event.eventType === COMMENT_MENTIONS_ADDED) {
      const validation = validateCommentMentionsAddedOutboxPayload(event.payload);

      if (!validation.success) {
        throw new PermanentOutboxError(
          validation.reason === 'UNSUPPORTED_SCHEMA_VERSION'
            ? 'OUTBOX_SCHEMA_VERSION_UNSUPPORTED'
            : 'OUTBOX_PAYLOAD_INVALID',
        );
      }

      if (
        event.workspaceId === null ||
        event.actorMembershipId === null ||
        event.aggregateType !== 'COMMENT' ||
        event.aggregateId !== validation.payload.commentId
      ) {
        throw new PermanentOutboxError('OUTBOX_EVENT_CONTRACT_INVALID');
      }

      await this.issueCollaborationNotificationHandler.handleCommentMentionsAdded(
        event,
        validation.payload,
      );
      await this.webPushDelivery.deliverNotifications(event);
      return;
    }

    if (event.eventType === API_HANDOFF_CREATED) {
      const validation = validateApiHandoffCreatedOutboxPayload(event.payload);

      if (!validation.success) {
        throw new PermanentOutboxError(
          validation.reason === 'UNSUPPORTED_SCHEMA_VERSION'
            ? 'OUTBOX_SCHEMA_VERSION_UNSUPPORTED'
            : 'OUTBOX_PAYLOAD_INVALID',
        );
      }

      if (
        event.workspaceId === null ||
        event.actorMembershipId === null ||
        event.aggregateType !== 'API_HANDOFF' ||
        event.aggregateId !== validation.payload.handoffId
      ) {
        throw new PermanentOutboxError('OUTBOX_EVENT_CONTRACT_INVALID');
      }

      await this.apiHandoffNotificationHandler.handle(event, validation.payload);
      await this.webPushDelivery.deliverNotifications(event);
      return;
    }

    if (event.eventType === WEB_PUSH_TEST_REQUESTED) {
      const validation = validateWebPushTestRequestedOutboxPayload(event.payload);
      if (!validation.success) {
        throw new PermanentOutboxError(
          validation.reason === 'UNSUPPORTED_SCHEMA_VERSION'
            ? 'OUTBOX_SCHEMA_VERSION_UNSUPPORTED'
            : 'OUTBOX_PAYLOAD_INVALID',
        );
      }
      if (
        event.workspaceId === null ||
        event.actorMembershipId === null ||
        event.aggregateType !== 'WEB_PUSH_SUBSCRIPTION' ||
        event.aggregateId !== validation.payload.subscriptionId
      ) {
        throw new PermanentOutboxError('OUTBOX_EVENT_CONTRACT_INVALID');
      }
      await this.webPushDelivery.deliverTest(event, validation.payload);
      return;
    }

    if (isAccountEmailEventType(event.eventType)) {
      const validation = validateAccountEmailOutboxPayload(event.payload);

      if (!validation.success) {
        throw new PermanentOutboxError(
          validation.reason === 'UNSUPPORTED_SCHEMA_VERSION'
            ? 'OUTBOX_SCHEMA_VERSION_UNSUPPORTED'
            : 'OUTBOX_PAYLOAD_INVALID',
        );
      }

      if (
        event.workspaceId !== null ||
        event.actorMembershipId !== null ||
        event.aggregateType !== 'USER' ||
        event.aggregateId !== validation.payload.userId
      ) {
        throw new PermanentOutboxError('OUTBOX_EVENT_CONTRACT_INVALID');
      }

      await this.accountEmailHandler.handle(event, event.eventType, validation.payload);
      return;
    }

    if (event.eventType === WORKSPACE_INVITATION_REQUESTED) {
      const validation = validateWorkspaceInvitationEmailOutboxPayload(event.payload);

      if (!validation.success) {
        throw new PermanentOutboxError(
          validation.reason === 'UNSUPPORTED_SCHEMA_VERSION'
            ? 'OUTBOX_SCHEMA_VERSION_UNSUPPORTED'
            : 'OUTBOX_PAYLOAD_INVALID',
        );
      }

      if (
        event.workspaceId === null ||
        event.actorMembershipId === null ||
        event.aggregateType !== 'WORKSPACE_INVITATION' ||
        event.aggregateId !== validation.payload.invitationId
      ) {
        throw new PermanentOutboxError('OUTBOX_EVENT_CONTRACT_INVALID');
      }

      await this.workspaceInvitationEmailHandler.handle(event, validation.payload);
      return;
    }

    throw new PermanentOutboxError('OUTBOX_EVENT_TYPE_UNSUPPORTED');
  }

  private async assertAnalyticsEventReferences(event: ClaimedOutboxEvent): Promise<void> {
    if (event.workspaceId === null) {
      throw new PermanentOutboxError('OUTBOX_EVENT_CONTRACT_INVALID');
    }

    if (event.eventType === WORKSPACE_CREATED) {
      const workspace = await this.database.client.workspace.findUnique({
        select: { id: true },
        where: { id: event.workspaceId },
      });
      if (!workspace) throw new PermanentOutboxError('OUTBOX_EVENT_CONTRACT_INVALID');
      return;
    }

    if (event.eventType === PROJECT_CREATED || event.eventType === PROJECT_STATUS_CHANGED) {
      const project = await this.database.client.project.findFirst({
        select: { id: true },
        where: { id: event.aggregateId, workspaceId: event.workspaceId },
      });
      if (!project) throw new PermanentOutboxError('OUTBOX_EVENT_CONTRACT_INVALID');
      return;
    }
  }

  private alertPermanentFailure(event: ClaimedOutboxEvent, errorCode: string): void {
    this.observability.alert({
      errorCode,
      jobId: `job_${event.id}`,
      type: 'OUTBOX_PERMANENTLY_FAILED',
    });
  }

  private captureCompletedEvent(event: ClaimedOutboxEvent): void {
    if (event.workspaceId === null) return;

    void this.captureCreatedNotifications(event);

    if (event.actorMembershipId === null) return;

    const capture = (name: ProductEventName, properties: Record<string, unknown>) => {
      const analyticsEvent = productEvent(event, name, properties);
      if (analyticsEvent) this.observability.capture(analyticsEvent);
    };

    if (event.eventType === WORKSPACE_CREATED) {
      const validation = validateWorkspaceCreatedOutboxPayload(event.payload);
      if (!validation.success) return;
      capture('workspace_created', { acquisitionSource: validation.payload.acquisitionSource });
      capture('signup_completed', { method: 'DIRECT_WORKSPACE' });
      return;
    }

    if (event.eventType === PROJECT_CREATED) {
      const validation = validateProjectCreatedOutboxPayload(event.payload);
      if (!validation.success) return;
      capture('project_created', {
        hasTargetDate: validation.payload.hasTargetDate,
        roleCount: validation.payload.roleCount,
        roles: validation.payload.roles,
      });
      return;
    }

    if (event.eventType === PROJECT_STATUS_CHANGED) {
      const validation = validateProjectStatusChangedOutboxPayload(event.payload);
      if (!validation.success) return;
      capture('project_status_changed', {
        fromStatus: validation.payload.fromStatus,
        progress: validation.payload.progress,
        toStatus: validation.payload.toStatus,
      });
      return;
    }

    if (event.eventType === TEAM_WORK_CREATED) {
      const validation = validateTeamWorkCreatedOutboxPayload(event.payload);
      if (!validation.success) return;
      capture('team_work_created', {
        hasAssignee: validation.payload.assigneeMembershipId !== null,
      });
      return;
    }

    if (event.eventType === WORKSPACE_INVITATION_REQUESTED) {
      const validation = validateWorkspaceInvitationEmailOutboxPayload(event.payload);
      if (!validation.success) return;
      capture('member_invited', {
        currentMemberCount: validation.payload.currentMemberCount,
      });
      return;
    }

    if (event.eventType === ISSUE_CREATED) {
      const validation = validateIssueCreatedOutboxPayload(event.payload);
      if (!validation.success) return;
      capture('issue_created', {
        hasMention: validation.payload.mentionedMembershipIds.length > 0,
        issueId: event.aggregateId,
      });
      return;
    }

    if (event.eventType === ISSUE_CHANGED) {
      const validation = validateIssueChangedOutboxPayload(event.payload);
      if (!validation.success) return;
      capture('issue_property_changed', {
        propertyTypes: [...validation.payload.changedFields],
      });
      if (validation.payload.terminalCategory === 'COMPLETED') {
        capture('issue_completed', {});
      }
      return;
    }

    if (event.eventType === TEAM_WORK_CHANGED) {
      const validation = validateTeamWorkChangedOutboxPayload(event.payload);
      if (!validation.success) return;
      capture('team_work_property_changed', {
        propertyTypes: [...validation.payload.changedFields],
      });
      if (validation.payload.terminalCategory === 'COMPLETED') {
        capture('team_work_completed', {
          issueId: validation.payload.issueId,
          teamWorkId: event.aggregateId,
        });
      }
      return;
    }

    if (event.eventType === COMMENT_CREATED) {
      const validation = validateCommentCreatedOutboxPayload(event.payload);
      if (!validation.success) return;
      capture('comment_created', {
        hasMention: validation.payload.hasMention,
      });
      return;
    }

    if (event.eventType === API_HANDOFF_CREATED) {
      const validation = validateApiHandoffCreatedOutboxPayload(event.payload);
      if (!validation.success) return;
      capture('api_handoff_created', {
        targetTeamWorkCount: validation.payload.targetTeamWorkIds.length,
        isFollowUp: validation.payload.kind === 'FOLLOW_UP',
      });
    }
  }

  private async captureCreatedNotifications(event: ClaimedOutboxEvent): Promise<void> {
    if (!event.workspaceId) return;
    try {
      const notifications = await this.database.client.notification.findMany({
        select: { createdAt: true, id: true, recipientMembershipId: true, type: true },
        where: { eventId: event.id, workspaceId: event.workspaceId },
      });
      for (const notification of notifications) {
        this.observability.capture({
          eventId: eventId(notification.id, 'notification_created'),
          membershipId: notification.recipientMembershipId,
          name: 'notification_created',
          occurredAt: notification.createdAt.toISOString(),
          payloadVersion: PRODUCT_EVENT_PAYLOAD_VERSION,
          properties: { notificationId: notification.id, notificationType: notification.type },
          workspaceId: event.workspaceId,
        });
      }
    } catch {
      if (typeof this.logger.warn === 'function') {
        this.logger.warn(
          { errorCode: 'NOTIFICATION_ANALYTICS_QUERY_FAILED', eventId: event.id },
          '알림 생성 계측 조회 실패',
        );
      }
    }
  }
}
