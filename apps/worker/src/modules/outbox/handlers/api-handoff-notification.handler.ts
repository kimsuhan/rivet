import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { MembershipStatus, NotificationType } from '@rivet/database';
import type { ApiHandoffCreatedOutboxPayload } from '@rivet/event-contracts';

import { DatabaseService } from '../../../common/database/database.service';
import type { ClaimedOutboxEvent } from '../outbox.types';
import { PermanentOutboxError } from '../outbox-errors';

@Injectable()
export class ApiHandoffNotificationHandler {
  constructor(private readonly database: DatabaseService) {}

  async handle(event: ClaimedOutboxEvent, payload: ApiHandoffCreatedOutboxPayload): Promise<void> {
    if (event.workspaceId === null || event.actorMembershipId === null) {
      throw new PermanentOutboxError('OUTBOX_EVENT_CONTRACT_INVALID');
    }

    const actorMembershipId = event.actorMembershipId;
    const workspaceId = event.workspaceId;

    await this.database.client.$transaction(async (transaction) => {
      const handoff = await transaction.apiHandoff.findFirst({
        where: {
          id: payload.handoffId,
          issue: { is: { id: payload.issueId, workspaceId } },
          workspaceId,
        },
        select: {
          authorMembershipId: true,
          issueId: true,
          issue: { select: { deletedAt: true } },
          kind: true,
          workspaceId: true,
        },
      });

      if (
        !handoff ||
        handoff.authorMembershipId !== actorMembershipId ||
        handoff.issueId !== payload.issueId ||
        handoff.workspaceId !== workspaceId ||
        handoff.kind !== payload.kind
      ) {
        throw new PermanentOutboxError('OUTBOX_EVENT_CONTRACT_INVALID');
      }
      if (handoff.issue.deletedAt !== null) return;

      const downstreamIssues = await transaction.issue.findMany({
        select: { id: true },
        where: { id: { in: payload.downstreamIssueIds }, workspaceId },
      });
      if (downstreamIssues.length !== payload.downstreamIssueIds.length) {
        throw new PermanentOutboxError('OUTBOX_EVENT_CONTRACT_INVALID');
      }

      const recipientMemberships = await transaction.workspaceMembership.findMany({
        where: {
          id: {
            in: payload.candidateRecipientMembershipIds.filter(
              (membershipId) => membershipId !== event.actorMembershipId,
            ),
          },
          status: MembershipStatus.ACTIVE,
          workspaceId,
        },
        select: { id: true },
      });

      if (recipientMemberships.length === 0) {
        return;
      }

      const notifications = await transaction.notification.createManyAndReturn({
        data: recipientMemberships.map(({ id: recipientMembershipId }) => ({
          actorMembershipId,
          eventId: event.id,
          handoffId: payload.handoffId,
          issueId: payload.issueId,
          recipientMembershipId,
          type:
            payload.kind === 'INITIAL'
              ? NotificationType.API_HANDOFF_CREATED
              : NotificationType.API_HANDOFF_FOLLOW_UP_CREATED,
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
