import { Injectable } from '@nestjs/common';

import { API_HANDOFF_CREATED, COMMENT_CREATED } from '@rivet/event-contracts';

import { DatabaseService } from '../../common/database/database.service';
import type { IssueTimelineQueryDto } from './dto/issue-collaboration-request.dto';
import type {
  TimelineItemResponseDto,
  TimelineResponseDto,
} from './dto/issue-collaboration-response.dto';
import {
  collaborationInvalidQuery,
  collaborationResourceNotFound,
} from './issue-collaboration.errors';
import {
  COMMENT_SELECT,
  toCollaborationMemberResponse,
  toCommentResponse,
} from './issue-collaboration-response.mapper';

type TimelineType = 'ACTIVITY' | 'COMMENT' | 'HANDOFF';

type TimelineCursor = {
  createdAt: Date;
  direction: 'asc' | 'desc';
  id: string;
  type: TimelineType;
};

function timelineItemId(item: TimelineItemResponseDto): string {
  if (item.type === 'ACTIVITY') return item.activity!.id;
  if (item.type === 'COMMENT') return item.comment!.id;
  return item.handoff!.id;
}

function encodeTimelineCursor(item: TimelineItemResponseDto, direction: 'asc' | 'desc'): string {
  return Buffer.from(
    JSON.stringify(['timeline-v1', direction, item.createdAt, timelineItemId(item), item.type]),
    'utf8',
  ).toString('base64url');
}

function parseTimelineCursor(
  value: string | undefined,
  direction: 'asc' | 'desc',
): TimelineCursor | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 5 ||
      parsed[0] !== 'timeline-v1' ||
      parsed[1] !== direction ||
      typeof parsed[2] !== 'string' ||
      typeof parsed[3] !== 'string' ||
      (parsed[4] !== 'ACTIVITY' && parsed[4] !== 'COMMENT' && parsed[4] !== 'HANDOFF') ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(parsed[3])
    ) {
      return collaborationInvalidQuery('타임라인 커서를 확인해 주세요.');
    }
    const createdAt = new Date(parsed[2]);
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== parsed[2]) {
      return collaborationInvalidQuery('타임라인 커서를 확인해 주세요.');
    }
    return { createdAt, direction, id: parsed[3], type: parsed[4] };
  } catch {
    return collaborationInvalidQuery('타임라인 커서를 확인해 주세요.');
  }
}

function timelineCursorWhere(
  sourceType: TimelineType,
  cursor: TimelineCursor | null,
):
  | {
      OR: Array<{
        createdAt: Date | { gt?: Date; lt?: Date };
        id?: string | { gt?: string; lt?: string };
      }>;
    }
  | undefined {
  if (!cursor) return undefined;
  const isAscending = cursor.direction === 'asc';
  const includeEqualId = isAscending
    ? sourceType.localeCompare(cursor.type) > 0
    : sourceType.localeCompare(cursor.type) < 0;
  const rows: Array<{
    createdAt: Date | { gt?: Date; lt?: Date };
    id?: string | { gt?: string; lt?: string };
  }> = [
    { createdAt: isAscending ? { gt: cursor.createdAt } : { lt: cursor.createdAt } },
    {
      createdAt: cursor.createdAt,
      id: isAscending ? { gt: cursor.id } : { lt: cursor.id },
    },
  ];
  if (includeEqualId) rows.push({ createdAt: cursor.createdAt, id: cursor.id });
  return { OR: rows };
}

function compareTimelineItems(
  left: TimelineItemResponseDto,
  right: TimelineItemResponseDto,
  direction: 'asc' | 'desc',
): number {
  const result =
    left.createdAt.localeCompare(right.createdAt) ||
    timelineItemId(left).localeCompare(timelineItemId(right)) ||
    left.type.localeCompare(right.type);
  return direction === 'asc' ? result : -result;
}

@Injectable()
export class IssueTimelineQueryService {
  constructor(private readonly database: DatabaseService) {}

  async timeline(
    workspaceId: string,
    issueId: string,
    dto: IssueTimelineQueryDto,
  ): Promise<TimelineResponseDto> {
    const direction = dto.sortDirection ?? 'asc';
    const cursor = parseTimelineCursor(dto.cursor, direction);
    const exists = await this.database.client.issue.findFirst({
      select: { id: true },
      where: { deletedAt: null, id: issueId, workspaceId },
    });
    if (!exists) collaborationResourceNotFound('이슈를 찾을 수 없습니다.');

    const [activities, comments, handoffs] = await Promise.all([
      this.database.client.activityEvent.findMany({
        orderBy: [{ createdAt: direction }, { id: direction }],
        select: {
          actorMembership: {
            select: {
              id: true,
              role: true,
              status: true,
              user: { select: { avatarFileId: true, displayName: true, id: true } },
            },
          },
          afterData: true,
          beforeData: true,
          createdAt: true,
          eventType: true,
          fieldName: true,
          id: true,
          teamWork: { select: { identifier: true } },
          teamWorkId: true,
        },
        take: dto.limit + 1,
        where: {
          eventType: {
            notIn: [API_HANDOFF_CREATED, COMMENT_CREATED, 'COMMENT_DELETED', 'COMMENT_UPDATED'],
          },
          issueId,
          workspaceId,
          ...timelineCursorWhere('ACTIVITY', cursor),
        },
      }),
      this.database.client.comment.findMany({
        orderBy: [{ createdAt: direction }, { id: direction }],
        select: COMMENT_SELECT,
        take: dto.limit + 1,
        where: { issueId, workspaceId, ...timelineCursorWhere('COMMENT', cursor) },
      }),
      this.database.client.apiHandoff.findMany({
        orderBy: [{ createdAt: direction }, { id: direction }],
        select: {
          authorMembership: {
            select: {
              id: true,
              role: true,
              status: true,
              user: { select: { avatarFileId: true, displayName: true, id: true } },
            },
          },
          bodyMarkdown: true,
          createdAt: true,
          id: true,
          kind: true,
          sequenceNumber: true,
          sourceTeamWorkId: true,
          targets: { orderBy: { teamWorkId: 'asc' }, select: { teamWorkId: true } },
        },
        take: dto.limit + 1,
        where: { issueId, workspaceId, ...timelineCursorWhere('HANDOFF', cursor) },
      }),
    ]);

    const merged: TimelineItemResponseDto[] = [
      ...activities.map((activity): TimelineItemResponseDto => ({
        activity: {
          actor: activity.actorMembership
            ? toCollaborationMemberResponse(activity.actorMembership)
            : null,
          after: activity.afterData,
          before: activity.beforeData,
          eventType: activity.eventType,
          fieldName: activity.fieldName,
          id: activity.id,
          teamWorkId: activity.teamWorkId,
          teamWorkIdentifier: activity.teamWork?.identifier ?? null,
        },
        createdAt: activity.createdAt.toISOString(),
        type: 'ACTIVITY',
      })),
      ...comments.map((comment): TimelineItemResponseDto => ({
        comment: toCommentResponse(comment),
        createdAt: comment.createdAt.toISOString(),
        type: 'COMMENT',
      })),
      ...handoffs.map((handoff): TimelineItemResponseDto => ({
        createdAt: handoff.createdAt.toISOString(),
        handoff: {
          author: toCollaborationMemberResponse(handoff.authorMembership),
          bodyMarkdown: handoff.bodyMarkdown,
          createdAt: handoff.createdAt.toISOString(),
          id: handoff.id,
          issueId,
          kind: handoff.kind,
          sequenceNumber: handoff.sequenceNumber,
          sourceTeamWorkId: handoff.sourceTeamWorkId,
          targetTeamWorkIds: handoff.targets.map(({ teamWorkId }) => teamWorkId),
        },
        type: 'HANDOFF',
      })),
    ].sort((left, right) => compareTimelineItems(left, right, direction));
    const hasMore = merged.length > dto.limit;
    const items = merged.slice(0, dto.limit);
    return {
      items,
      nextCursor:
        hasMore && items.length > 0
          ? encodeTimelineCursor(items[items.length - 1]!, direction)
          : null,
    };
  }
}
