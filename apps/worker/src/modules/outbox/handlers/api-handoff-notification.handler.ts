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
          sourceTeamWorkId: true,
          workspaceId: true,
        },
      });

      if (
        !handoff ||
        handoff.authorMembershipId !== actorMembershipId ||
        handoff.issueId !== payload.issueId ||
        handoff.sourceTeamWorkId !== payload.sourceTeamWorkId ||
        handoff.workspaceId !== workspaceId ||
        handoff.kind !== payload.kind
      ) {
        throw new PermanentOutboxError('OUTBOX_EVENT_CONTRACT_INVALID');
      }
      if (handoff.issue.deletedAt !== null) return;

      const mentionedMembershipIds = new Set(payload.mentionedMembershipIds);
      const candidateRecipientMembershipIds = [
        ...new Set([...payload.candidateRecipientMembershipIds, ...payload.mentionedMembershipIds]),
      ].filter((membershipId) => membershipId !== actorMembershipId);
      const targetTeamWorks = await transaction.teamWork.findMany({
        select: {
          assigneeMembershipId: true,
          deletedAt: true,
          id: true,
          identifier: true,
          issue: {
            select: {
              subscriptions: {
                select: { membershipId: true },
                where: { membershipId: { in: candidateRecipientMembershipIds } },
              },
            },
          },
          team: {
            select: {
              name: true,
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
        where: { id: { in: payload.targetTeamWorkIds }, issueId: payload.issueId, workspaceId },
      });
      if (targetTeamWorks.length !== payload.targetTeamWorkIds.length) {
        throw new PermanentOutboxError('OUTBOX_EVENT_CONTRACT_INVALID');
      }

      const orderedTargetTeamWorks = targetTeamWorks
        .filter(({ deletedAt }) => deletedAt === null)
        .sort((left, right) => {
          return (
            left.team.name.localeCompare(right.team.name, 'ko') ||
            left.identifier.localeCompare(right.identifier) ||
            left.id.localeCompare(right.id)
          );
        });
      const assignedTargetByMembershipId = new Map<string, string>();
      const subscribedTargetByMembershipId = new Map<string, string>();
      const teamTargetByMembershipId = new Map<string, string>();
      for (const teamWork of orderedTargetTeamWorks) {
        if (
          teamWork.assigneeMembershipId &&
          !assignedTargetByMembershipId.has(teamWork.assigneeMembershipId)
        ) {
          assignedTargetByMembershipId.set(teamWork.assigneeMembershipId, teamWork.id);
        }
        for (const { membershipId } of teamWork.issue.subscriptions) {
          if (!subscribedTargetByMembershipId.has(membershipId)) {
            subscribedTargetByMembershipId.set(membershipId, teamWork.id);
          }
        }
        for (const { membershipId } of teamWork.team.teamMembers) {
          if (!teamTargetByMembershipId.has(membershipId)) {
            teamTargetByMembershipId.set(membershipId, teamWork.id);
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
          issueId: payload.issueId,
          teamWorkId:
            assignedTargetByMembershipId.get(recipientMembershipId) ??
            subscribedTargetByMembershipId.get(recipientMembershipId) ??
            teamTargetByMembershipId.get(recipientMembershipId) ??
            null,
          recipientMembershipId,
          type: mentionedMembershipIds.has(recipientMembershipId)
            ? NotificationType.MENTIONED
            : payload.kind === 'INITIAL'
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
