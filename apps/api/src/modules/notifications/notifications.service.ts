import { randomUUID } from 'node:crypto';

import { HttpStatus, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { NotificationType, Prisma } from '@rivet/database';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import { ObservabilityService } from '../../common/observability/observability.service';
import type {
  NotificationListQueryDto,
  NotificationListResponseDto,
  NotificationReadAllResponseDto,
  NotificationResponseDto,
  NotificationUnreadCountResponseDto,
  UpdateNotificationReadDto,
} from './dto/notification.dto';

const NOTIFICATION_SELECT = {
  actorMembership: {
    select: {
      user: { select: { avatarFileId: true, displayName: true, id: true } },
    },
  },
  commentId: true,
  createdAt: true,
  handoffId: true,
  id: true,
  issue: { select: { id: true, identifier: true, title: true } },
  readAt: true,
  teamWork: { select: { id: true, identifier: true } },
  type: true,
} satisfies Prisma.NotificationSelect;

type NotificationRow = Prisma.NotificationGetPayload<{ select: typeof NOTIFICATION_SELECT }>;

function invalidQuery(message: string): never {
  throw new ApiError({ code: 'INVALID_QUERY', message, status: HttpStatus.BAD_REQUEST });
}

function resourceNotFound(): never {
  throw new ApiError({
    code: 'RESOURCE_NOT_FOUND',
    message: '알림을 찾을 수 없습니다.',
    status: HttpStatus.NOT_FOUND,
  });
}

function parseCursor(value: string | undefined): { createdAt: Date; id: string } | null {
  if (value === undefined) return null;

  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) {
      return invalidQuery('커서를 확인해 주세요.');
    }

    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) {
      return invalidQuery('커서를 확인해 주세요.');
    }

    const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== 'string' ||
      typeof parsed[1] !== 'string' ||
      !isUUID(parsed[1], '4')
    ) {
      return invalidQuery('커서를 확인해 주세요.');
    }

    const createdAt = new Date(parsed[0]);
    if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== parsed[0]) {
      return invalidQuery('커서를 확인해 주세요.');
    }

    return { createdAt, id: parsed[1] };
  } catch {
    return invalidQuery('커서를 확인해 주세요.');
  }
}

function encodeCursor(row: Pick<NotificationRow, 'createdAt' | 'id'>): string {
  return Buffer.from(JSON.stringify([row.createdAt.toISOString(), row.id])).toString('base64url');
}

function parseTypes(value: string | undefined): NotificationType[] | null {
  if (value === undefined) return null;

  const allowedTypes = new Set(Object.values(NotificationType));
  const types = new Set<NotificationType>();

  for (const candidate of value.split(',')) {
    const type = candidate.trim();
    if (!allowedTypes.has(type as NotificationType)) {
      return invalidQuery('알림 유형을 확인해 주세요.');
    }
    types.add(type as NotificationType);
  }

  return [...types];
}

function toResponse(notification: NotificationRow): NotificationResponseDto {
  return {
    actor: notification.actorMembership
      ? {
          avatarFileId: notification.actorMembership.user.avatarFileId,
          displayName: notification.actorMembership.user.displayName,
          id: notification.actorMembership.user.id,
        }
      : null,
    commentId: notification.commentId,
    createdAt: notification.createdAt.toISOString(),
    handoffId: notification.handoffId,
    id: notification.id,
    issue: notification.issue,
    readAt: notification.readAt?.toISOString() ?? null,
    teamWork: notification.teamWork,
    type: notification.type,
  };
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly observability: ObservabilityService,
  ) {}

  async list(
    context: { membershipId: string; workspaceId: string },
    dto: NotificationListQueryDto,
  ): Promise<NotificationListResponseDto> {
    const cursor = parseCursor(dto.cursor);
    const types = parseTypes(dto.type);
    const limit = dto.limit ?? 50;

    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      invalidQuery('조회 개수를 확인해 주세요.');
    }

    const and: Prisma.NotificationWhereInput[] = [];
    if (cursor) {
      and.push({
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ],
      });
    }

    const notifications = await this.database.client.notification.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: NOTIFICATION_SELECT,
      take: limit + 1,
      where: {
        ...(and.length > 0 ? { AND: and } : {}),
        ...(dto.read === undefined ? {} : { readAt: dto.read ? { not: null } : null }),
        ...(types === null ? {} : { type: { in: types } }),
        issue: { deletedAt: null },
        recipientMembershipId: context.membershipId,
        workspaceId: context.workspaceId,
      },
    });
    const page = notifications.slice(0, limit);

    return {
      items: page.map(toResponse),
      nextCursor:
        notifications.length > limit && page.length > 0
          ? encodeCursor(page[page.length - 1]!)
          : null,
    };
  }

  async unreadCount(context: {
    membershipId: string;
    workspaceId: string;
  }): Promise<NotificationUnreadCountResponseDto> {
    return {
      count: await this.database.client.notification.count({
        where: {
          readAt: null,
          issue: { deletedAt: null },
          recipientMembershipId: context.membershipId,
          workspaceId: context.workspaceId,
        },
      }),
    };
  }

  async updateRead(
    context: { membershipId: string; workspaceId: string },
    notificationId: string,
    dto: UpdateNotificationReadDto,
  ): Promise<NotificationResponseDto> {
    const outcome = await this.database.client.$transaction(async (transaction) => {
      const current = await transaction.notification.findFirst({
        select: NOTIFICATION_SELECT,
        where: {
          id: notificationId,
          recipientMembershipId: context.membershipId,
          workspaceId: context.workspaceId,
        },
      });
      if (!current) resourceNotFound();

      if ((current.readAt !== null) === dto.read) {
        return { didRead: false, response: toResponse(current) };
      }

      const readAt = dto.read ? new Date() : null;
      const updated = await transaction.notification.updateMany({
        data: { readAt },
        where: {
          id: notificationId,
          readAt: dto.read ? null : { not: null },
          recipientMembershipId: context.membershipId,
          workspaceId: context.workspaceId,
        },
      });

      if (updated.count === 0) {
        const latest = await transaction.notification.findFirst({
          select: NOTIFICATION_SELECT,
          where: {
            id: notificationId,
            recipientMembershipId: context.membershipId,
            workspaceId: context.workspaceId,
          },
        });
        if (!latest) resourceNotFound();
        return { didRead: false, response: toResponse(latest) };
      }

      await this.notifyChanged(transaction, context, notificationId, randomUUID());
      return { didRead: dto.read, response: toResponse({ ...current, readAt }) };
    });
    if (outcome.didRead) {
      this.observability.capture({
        distinctId: context.membershipId,
        name: 'notification_read',
        properties: {
          notificationType: outcome.response.type,
          workspaceId: context.workspaceId,
        },
      });
    }
    return outcome.response;
  }

  async readAll(context: {
    membershipId: string;
    workspaceId: string;
  }): Promise<NotificationReadAllResponseDto> {
    return this.database.client.$transaction(async (transaction) => {
      const notifications = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT notification."id"
        FROM "notifications" AS notification
        INNER JOIN "issues" AS issue
          ON issue."workspace_id" = notification."workspace_id"
         AND issue."id" = notification."issue_id"
        WHERE notification."workspace_id" = ${context.workspaceId}::uuid
          AND notification."recipient_membership_id" = ${context.membershipId}::uuid
          AND notification."read_at" IS NULL
          AND issue."deleted_at" IS NULL
        ORDER BY notification."created_at" DESC, notification."id" DESC
        FOR UPDATE
      `;
      if (notifications.length === 0) return { updatedCount: 0 };

      const notificationIds = notifications.map(({ id }) => id);
      const updated = await transaction.notification.updateMany({
        data: { readAt: new Date() },
        where: {
          id: { in: notificationIds },
          readAt: null,
          recipientMembershipId: context.membershipId,
          workspaceId: context.workspaceId,
        },
      });
      for (const notificationId of notificationIds) {
        await this.notifyChanged(transaction, context, notificationId, randomUUID());
      }

      return { updatedCount: updated.count };
    });
  }

  private async notifyChanged(
    transaction: Prisma.TransactionClient,
    context: { membershipId: string; workspaceId: string },
    notificationId: string,
    eventId: string,
  ): Promise<void> {
    await transaction.$executeRaw`
      SELECT pg_notify(
        'rivet_resource_changed_v1',
        ${JSON.stringify({
          changeType: 'UPDATED',
          eventId,
          recipientMembershipId: context.membershipId,
          resourceId: notificationId,
          resourceType: 'NOTIFICATION',
          version: null,
          workspaceId: context.workspaceId,
        })}
      )
    `;
  }
}
