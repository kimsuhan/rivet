import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { MembershipStatus, NotificationType } from '@rivet/database';
import type {
  CommentCreatedOutboxPayload,
  CommentMentionsAddedOutboxPayload,
  IssueChangedOutboxPayload,
  IssueCreatedOutboxPayload,
  TeamWorkChangedOutboxPayload,
  TeamWorkCreatedOutboxPayload,
} from '@rivet/event-contracts';

import { DatabaseService } from '../../../common/database/database.service';
import type { ClaimedOutboxEvent } from '../outbox.types';
import { PermanentOutboxError } from '../outbox-errors';

@Injectable()
export class IssueCollaborationNotificationHandler {
  constructor(private readonly database: DatabaseService) {}

  async handleIssueCreated(
    event: ClaimedOutboxEvent,
    payload: IssueCreatedOutboxPayload,
  ): Promise<void> {
    const candidates = new Map<string, NotificationType>();

    for (const membershipId of payload.mentionedMembershipIds) {
      candidates.set(membershipId, NotificationType.MENTIONED);
    }

    await this.createNotifications(
      event,
      { issueId: payload.issueId, kind: 'ISSUE_CREATED' },
      candidates,
    );
  }

  async handleIssueChanged(
    event: ClaimedOutboxEvent,
    payload: IssueChangedOutboxPayload,
  ): Promise<void> {
    const candidates = new Map<string, NotificationType>();

    if (payload.terminalCategory !== null) {
      const type =
        payload.terminalCategory === 'COMPLETED'
          ? NotificationType.ISSUE_COMPLETED
          : NotificationType.ISSUE_CANCELED;
      for (const membershipId of payload.subscriberMembershipIds) {
        candidates.set(membershipId, type);
      }
    }
    for (const membershipId of payload.mentionedMembershipIds) {
      candidates.set(membershipId, NotificationType.MENTIONED);
    }

    await this.createNotifications(
      event,
      { issueId: payload.issueId, kind: 'ISSUE_CHANGED' },
      candidates,
    );
  }

  async handleTeamWorkChanged(
    event: ClaimedOutboxEvent,
    payload: TeamWorkChangedOutboxPayload,
  ): Promise<void> {
    const candidates = new Map<string, NotificationType>();
    if (payload.assigneeMembershipId !== undefined && payload.assigneeMembershipId !== null) {
      candidates.set(payload.assigneeMembershipId, NotificationType.TEAM_WORK_ASSIGNED);
    }
    for (const membershipId of payload.mentionedMembershipIds) {
      candidates.set(membershipId, NotificationType.MENTIONED);
    }
    await this.createNotifications(
      event,
      { issueId: payload.issueId, kind: 'TEAM_WORK_CHANGED', teamWorkId: payload.teamWorkId },
      candidates,
    );
  }

  async handleTeamWorkCreated(
    event: ClaimedOutboxEvent,
    payload: TeamWorkCreatedOutboxPayload,
  ): Promise<void> {
    const candidates = new Map<string, NotificationType>();
    if (payload.assigneeMembershipId !== null) {
      candidates.set(payload.assigneeMembershipId, NotificationType.TEAM_WORK_ASSIGNED);
    }
    await this.createNotifications(
      event,
      { issueId: payload.issueId, kind: 'TEAM_WORK_CHANGED', teamWorkId: payload.teamWorkId },
      candidates,
    );
  }

  async handleCommentCreated(
    event: ClaimedOutboxEvent,
    payload: CommentCreatedOutboxPayload,
  ): Promise<void> {
    const candidates = new Map<string, NotificationType>();

    for (const membershipId of payload.subscriberMembershipIds) {
      candidates.set(membershipId, NotificationType.COMMENT_ADDED);
    }
    for (const membershipId of payload.mentionedMembershipIds) {
      candidates.set(membershipId, NotificationType.MENTIONED);
    }

    await this.createNotifications(
      event,
      {
        commentId: payload.commentId,
        issueId: payload.issueId,
        kind: 'COMMENT',
        teamWorkId: payload.teamWorkId,
      },
      candidates,
    );
  }

  async handleCommentMentionsAdded(
    event: ClaimedOutboxEvent,
    payload: CommentMentionsAddedOutboxPayload,
  ): Promise<void> {
    await this.createNotifications(
      event,
      {
        commentId: payload.commentId,
        issueId: payload.issueId,
        kind: 'COMMENT',
        teamWorkId: payload.teamWorkId,
      },
      new Map(
        payload.mentionedMembershipIds.map((membershipId) => [
          membershipId,
          NotificationType.MENTIONED,
        ]),
      ),
    );
  }

  private async createNotifications(
    event: ClaimedOutboxEvent,
    source:
      | { issueId: string; kind: 'ISSUE_CREATED' | 'ISSUE_CHANGED' }
      | { issueId: string; kind: 'TEAM_WORK_CHANGED'; teamWorkId: string }
      | { commentId: string; issueId: string; kind: 'COMMENT'; teamWorkId: string | null },
    candidates: Map<string, NotificationType>,
  ): Promise<void> {
    if (event.workspaceId === null || event.actorMembershipId === null) {
      throw new PermanentOutboxError('OUTBOX_EVENT_CONTRACT_INVALID');
    }

    const actorMembershipId = event.actorMembershipId;
    const workspaceId = event.workspaceId;

    await this.database.client.$transaction(async (transaction) => {
      if (source.kind === 'COMMENT') {
        const comment = await transaction.comment.findFirst({
          select: { authorMembershipId: true, issue: { select: { deletedAt: true } } },
          where: {
            id: source.commentId,
            issueId: source.issueId,
            workspaceId,
          },
        });

        if (!comment || comment.authorMembershipId !== actorMembershipId) {
          throw new PermanentOutboxError('OUTBOX_EVENT_CONTRACT_INVALID');
        }
        if (comment.issue.deletedAt !== null) return;
      } else if (source.kind === 'TEAM_WORK_CHANGED') {
        const teamWork = await transaction.teamWork.findFirst({
          select: { deletedAt: true, issue: { select: { deletedAt: true } } },
          where: { id: source.teamWorkId, issueId: source.issueId, workspaceId },
        });
        if (!teamWork) throw new PermanentOutboxError('OUTBOX_EVENT_CONTRACT_INVALID');
        if (teamWork.deletedAt !== null || teamWork.issue.deletedAt !== null) return;
      } else {
        const issue = await transaction.issue.findFirst({
          select: { createdByMembershipId: true, deletedAt: true },
          where: { id: source.issueId, workspaceId },
        });

        if (
          !issue ||
          (source.kind === 'ISSUE_CREATED' && issue.createdByMembershipId !== actorMembershipId)
        ) {
          throw new PermanentOutboxError('OUTBOX_EVENT_CONTRACT_INVALID');
        }
        if (issue.deletedAt !== null) return;
      }

      const candidateMembershipIds = [...candidates.keys()].filter(
        (membershipId) => membershipId !== actorMembershipId,
      );
      if (candidateMembershipIds.length === 0) {
        return;
      }

      const recipientMemberships = await transaction.workspaceMembership.findMany({
        select: { id: true },
        where: {
          id: { in: candidateMembershipIds },
          status: MembershipStatus.ACTIVE,
          workspaceId,
        },
      });
      if (recipientMemberships.length === 0) {
        return;
      }
      const activeRecipientMembershipIds = new Set(recipientMemberships.map(({ id }) => id));

      const notifications = await transaction.notification.createManyAndReturn({
        data: [...candidates.entries()]
          .filter(([membershipId]) => activeRecipientMembershipIds.has(membershipId))
          .map(([recipientMembershipId, type]) => ({
            actorMembershipId,
            commentId: source.kind === 'COMMENT' ? source.commentId : null,
            eventId: event.id,
            issueId: source.issueId,
            teamWorkId:
              source.kind === 'TEAM_WORK_CHANGED' || source.kind === 'COMMENT'
                ? source.teamWorkId
                : null,
            recipientMembershipId,
            type,
            workspaceId,
          })),
        select: { id: true, recipientMembershipId: true },
        skipDuplicates: true,
      });

      for (const notification of notifications) {
        await transaction.$executeRaw`
          SELECT pg_notify(
            'rivet_resource_changed_v1',
            ${JSON.stringify({
              changeType: 'CREATED',
              eventId: randomUUID(),
              recipientMembershipId: notification.recipientMembershipId,
              resourceId: notification.id,
              resourceType: 'NOTIFICATION',
              version: null,
              workspaceId,
            })}
          )
        `;
      }
    });
  }
}
