import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { DeploymentStatus, IssueStatus, Prisma, StateCategory } from '@rivet/database';
import {
  ISSUE_CHANGED,
  ISSUE_CHANGED_SCHEMA_VERSION,
  type IssueChangedOutboxPayload,
} from '@rivet/event-contracts';

import { issueResourceNotFound } from './issue.errors';

@Injectable()
export class IssueStatusService {
  async recalculate(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    issueId: string,
    actorMembershipId: string,
  ): Promise<IssueStatus> {
    const issue = await transaction.issue.findFirst({
      select: { status: true },
      where: { deletedAt: null, id: issueId, workspaceId },
    });
    if (!issue) issueResourceNotFound();
    if (issue.status === IssueStatus.PAUSED || issue.status === IssueStatus.CANCELED) {
      return issue.status;
    }
    const teamWorks = await transaction.teamWork.findMany({
      select: {
        deploymentStatus: true,
        workflowState: { select: { category: true } },
      },
      where: { deletedAt: null, issueId, workspaceId },
    });
    const valid = teamWorks.filter(
      ({ workflowState }) => workflowState.category !== StateCategory.CANCELED,
    );
    const allValidCompleted =
      valid.length > 0 &&
      valid.every(({ workflowState }) => workflowState.category === StateCategory.COMPLETED);
    const allDeploymentsCompleted = valid.every(
      ({ deploymentStatus }) =>
        deploymentStatus === DeploymentStatus.NOT_APPLICABLE ||
        deploymentStatus === DeploymentStatus.DEPLOYED,
    );
    if (issue.status === IssueStatus.DONE && allValidCompleted && allDeploymentsCompleted) {
      return issue.status;
    }
    const next =
      valid.length === 0
        ? IssueStatus.UNSORTED
        : allValidCompleted
          ? allDeploymentsCompleted
            ? IssueStatus.DONE
            : IssueStatus.REVIEW
          : valid.some(
                ({ workflowState }) =>
                  workflowState.category === StateCategory.STARTED ||
                  workflowState.category === StateCategory.COMPLETED,
              )
            ? IssueStatus.IN_PROGRESS
            : IssueStatus.TODO;
    if (next !== issue.status) {
      await transaction.issue.update({
        data: { status: next, version: { increment: 1 } },
        where: { id: issueId },
      });
      if (next === IssueStatus.DONE) {
        const subscriberMembershipIds = (
          await transaction.issueSubscription.findMany({
            orderBy: { membershipId: 'asc' },
            select: { membershipId: true },
            where: { issueId, workspaceId },
          })
        ).map(({ membershipId }) => membershipId);
        await transaction.activityEvent.create({
          data: {
            actorMembershipId,
            afterData: IssueStatus.DONE,
            beforeData: issue.status,
            eventType: 'ISSUE_CHANGED',
            fieldName: 'status',
            issueId,
            workspaceId,
          },
        });
        await transaction.outboxEvent.create({
          data: {
            actorMembershipId,
            aggregateId: issueId,
            aggregateType: 'ISSUE',
            eventType: ISSUE_CHANGED,
            id: randomUUID(),
            payload: {
              changedFields: ['STATUS'],
              issueId,
              mentionedMembershipIds: [],
              schemaVersion: ISSUE_CHANGED_SCHEMA_VERSION,
              subscriberMembershipIds,
              terminalCategory: 'COMPLETED',
            } satisfies IssueChangedOutboxPayload,
            workspaceId,
          },
        });
      }
    }
    return next;
  }
}
