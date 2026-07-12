import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { MembershipStatus, NotificationType, ProjectRole } from '@rivet/database';
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
          issue: { select: { deletedAt: true, parentIssueId: true } },
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

      const candidateRecipientMembershipIds = payload.candidateRecipientMembershipIds.filter(
        (membershipId) => membershipId !== actorMembershipId,
      );
      const downstreamIssues = await transaction.issue.findMany({
        select: {
          assigneeMembershipId: true,
          deletedAt: true,
          id: true,
          identifier: true,
          projectRole: true,
          subscriptions: {
            select: { membershipId: true },
            where: { membershipId: { in: candidateRecipientMembershipIds } },
          },
          team: {
            select: {
              teamMembers: {
                select: { membershipId: true },
                where: {
                  membershipId: { in: candidateRecipientMembershipIds },
                  removedAt: null,
                },
              },
            },
          },
        },
        where: { id: { in: payload.downstreamIssueIds }, workspaceId },
      });
      if (downstreamIssues.length !== payload.downstreamIssueIds.length) {
        throw new PermanentOutboxError('OUTBOX_EVENT_CONTRACT_INVALID');
      }

      const projectRoleOrder = new Map([
        [ProjectRole.BACKEND, 0],
        [ProjectRole.WEB_FRONTEND, 1],
        [ProjectRole.APP_FRONTEND, 2],
      ]);
      const orderedDownstreamIssues = downstreamIssues
        .filter(({ deletedAt }) => deletedAt === null)
        .sort((left, right) => {
          const roleOrder =
            (left.projectRole === null
              ? projectRoleOrder.size
              : projectRoleOrder.get(left.projectRole)) ?? projectRoleOrder.size;
          const otherRoleOrder =
            (right.projectRole === null
              ? projectRoleOrder.size
              : projectRoleOrder.get(right.projectRole)) ?? projectRoleOrder.size;
          return (
            roleOrder - otherRoleOrder ||
            left.identifier.localeCompare(right.identifier) ||
            left.id.localeCompare(right.id)
          );
        });
      const assignedTargetByMembershipId = new Map<string, string>();
      const subscribedTargetByMembershipId = new Map<string, string>();
      const teamTargetByMembershipId = new Map<string, string>();
      for (const issue of orderedDownstreamIssues) {
        if (
          issue.assigneeMembershipId &&
          !assignedTargetByMembershipId.has(issue.assigneeMembershipId)
        ) {
          assignedTargetByMembershipId.set(issue.assigneeMembershipId, issue.id);
        }
        for (const { membershipId } of issue.subscriptions) {
          if (!subscribedTargetByMembershipId.has(membershipId)) {
            subscribedTargetByMembershipId.set(membershipId, issue.id);
          }
        }
        for (const { membershipId } of issue.team?.teamMembers ?? []) {
          if (!teamTargetByMembershipId.has(membershipId)) {
            teamTargetByMembershipId.set(membershipId, issue.id);
          }
        }
      }

      const recipientMemberships = await transaction.workspaceMembership.findMany({
        where: {
          id: { in: candidateRecipientMembershipIds },
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
          issueId:
            assignedTargetByMembershipId.get(recipientMembershipId) ??
            subscribedTargetByMembershipId.get(recipientMembershipId) ??
            teamTargetByMembershipId.get(recipientMembershipId) ??
            handoff.issue.parentIssueId ??
            payload.issueId,
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
