import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { Prisma } from '@rivet/database';
import type {
  IssuePurgeScheduledOutboxPayload,
  ProjectPurgeScheduledOutboxPayload,
} from '@rivet/event-contracts';

import { DatabaseService } from '../../../common/database/database.service';
import type { ClaimedOutboxEvent } from '../outbox.types';
import { CanceledOutboxError, PermanentOutboxError, RetryableOutboxError } from '../outbox-errors';

type Transaction = Prisma.TransactionClient;

interface PurgeLockRow {
  databaseNow: Date;
  deletedAt: Date | null;
  purgeAt: Date | null;
}

@Injectable()
export class ResourcePurgeHandler {
  constructor(private readonly database: DatabaseService) {}

  async handleIssue(
    event: ClaimedOutboxEvent,
    payload: IssuePurgeScheduledOutboxPayload,
  ): Promise<void> {
    const workspaceId = this.workspaceId(event);
    await this.database.client.$transaction(async (transaction) => {
      const [issue] = await transaction.$queryRaw<PurgeLockRow[]>`
        SELECT "deleted_at" AS "deletedAt",
               "purge_at" AS "purgeAt",
               CURRENT_TIMESTAMP AS "databaseNow"
        FROM "issues"
        WHERE "workspace_id" = ${workspaceId}::uuid
          AND "id" = ${payload.issueId}::uuid
        FOR UPDATE
      `;
      if (!issue) return;
      this.assertDue(event, payload.purgeAt, issue);

      const attachments = await transaction.issueFileAttachment.findMany({
        orderBy: { fileId: 'asc' },
        select: { fileId: true },
        where: { issueId: payload.issueId, workspaceId },
      });
      if (attachments.length > 0) {
        await transaction.file.updateMany({
          data: { unlinkedAt: issue.databaseNow },
          where: { id: { in: attachments.map(({ fileId }) => fileId) }, workspaceId },
        });
      }

      await transaction.notification.deleteMany({
        where: { issueId: payload.issueId, workspaceId },
      });
      await transaction.issueFileAttachment.deleteMany({
        where: { issueId: payload.issueId, workspaceId },
      });
      await transaction.mention.deleteMany({
        where: { issueId: payload.issueId, workspaceId },
      });
      await transaction.issueSubscription.deleteMany({
        where: { issueId: payload.issueId, workspaceId },
      });
      await transaction.issueLabel.deleteMany({
        where: { issueId: payload.issueId, workspaceId },
      });
      await transaction.issueBlockRelation.deleteMany({
        where: {
          OR: [{ blockedIssueId: payload.issueId }, { blockingIssueId: payload.issueId }],
          workspaceId,
        },
      });
      await transaction.comment.deleteMany({
        where: { issueId: payload.issueId, workspaceId },
      });
      await transaction.apiHandoff.deleteMany({
        where: { issueId: payload.issueId, workspaceId },
      });
      await transaction.activityEvent.deleteMany({
        where: { issueId: payload.issueId, workspaceId },
      });
      const deleted = await transaction.issue.deleteMany({
        where: {
          deletedAt: { not: null },
          id: payload.issueId,
          purgeAt: issue.purgeAt,
          workspaceId,
        },
      });
      if (deleted.count !== 1) {
        throw new RetryableOutboxError('ISSUE_PURGE_STATE_CHANGED');
      }
      await this.notifyDeleted(transaction, workspaceId, 'ISSUE', payload.issueId);
    });
  }

  async handleProject(
    event: ClaimedOutboxEvent,
    payload: ProjectPurgeScheduledOutboxPayload,
  ): Promise<void> {
    const workspaceId = this.workspaceId(event);
    await this.database.client.$transaction(async (transaction) => {
      const [project] = await transaction.$queryRaw<PurgeLockRow[]>`
        SELECT "deleted_at" AS "deletedAt",
               "purge_at" AS "purgeAt",
               CURRENT_TIMESTAMP AS "databaseNow"
        FROM "projects"
        WHERE "workspace_id" = ${workspaceId}::uuid
          AND "id" = ${payload.projectId}::uuid
        FOR UPDATE
      `;
      if (!project) return;
      this.assertDue(event, payload.purgeAt, project);

      const linkedIssue = await transaction.issue.findFirst({
        select: { id: true },
        where: { projectId: payload.projectId, workspaceId },
      });
      if (linkedIssue) {
        throw new RetryableOutboxError('PROJECT_PURGE_BLOCKED');
      }

      await transaction.projectRoleTeam.deleteMany({
        where: { projectId: payload.projectId, workspaceId },
      });
      await transaction.activityEvent.deleteMany({
        where: { projectId: payload.projectId, workspaceId },
      });
      const deleted = await transaction.project.deleteMany({
        where: {
          deletedAt: { not: null },
          id: payload.projectId,
          purgeAt: project.purgeAt,
          workspaceId,
        },
      });
      if (deleted.count !== 1) {
        throw new RetryableOutboxError('PROJECT_PURGE_STATE_CHANGED');
      }
      await this.notifyDeleted(transaction, workspaceId, 'PROJECT', payload.projectId);
    });
  }

  private workspaceId(event: ClaimedOutboxEvent): string {
    if (event.workspaceId === null) {
      throw new PermanentOutboxError('OUTBOX_EVENT_CONTRACT_INVALID');
    }
    return event.workspaceId;
  }

  private assertDue(event: ClaimedOutboxEvent, payloadPurgeAt: string, row: PurgeLockRow): void {
    if (event.availableAt.toISOString() !== payloadPurgeAt) {
      throw new PermanentOutboxError('OUTBOX_EVENT_CONTRACT_INVALID');
    }
    if (
      row.deletedAt === null ||
      row.purgeAt === null ||
      row.purgeAt.toISOString() !== payloadPurgeAt ||
      row.databaseNow < row.purgeAt
    ) {
      throw new CanceledOutboxError('RESOURCE_PURGE_CANCELED');
    }
  }

  private async notifyDeleted(
    transaction: Transaction,
    workspaceId: string,
    resourceType: 'ISSUE' | 'PROJECT',
    resourceId: string,
  ): Promise<void> {
    await transaction.$executeRaw`
      SELECT pg_notify(
        'rivet_resource_changed_v1',
        ${JSON.stringify({
          changeType: 'DELETED',
          eventId: randomUUID(),
          resourceId,
          resourceType,
          version: null,
          workspaceId,
        })}
      )
    `;
  }
}
