import { HttpStatus, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { Prisma, StateCategory } from '@rivet/database';

import { ApiError } from '../../common/errors/api-error';
import type { TeamWorkListQueryDto } from './dto/issue-request.dto';
import type { TeamWorkDetailResponseDto, TeamWorkListResponseDto } from './dto/issue-response.dto';
import type { IssueMutationContext } from './issue.context';
import { issueResourceNotFound } from './issue.errors';
import { IssueRepository } from './issue.repository';
import { toTeamWorkDetail, toTeamWorkSummary } from './issue-response.mapper';

function values(value: string | undefined): string[] {
  return value
    ? [
        ...new Set(
          value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ]
    : [];
}

const EXECUTION_CATEGORY_ORDER: Record<StateCategory, number> = {
  STARTED: 0,
  UNSTARTED: 1,
  BACKLOG: 2,
  COMPLETED: 3,
  CANCELED: 4,
};

const PRIORITY_ORDER = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3, NONE: 4 } as const;

function compareTextDescending(left: string, right: string): number {
  return right.localeCompare(left);
}

function decodeCursor(cursor: string): string {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return typeof parsed === 'object' &&
      parsed !== null &&
      'id' in parsed &&
      typeof parsed.id === 'string'
      ? parsed.id
      : cursor;
  } catch {
    return cursor;
  }
}

function encodeCursor(id: string): string {
  return Buffer.from(JSON.stringify({ id }), 'utf8').toString('base64url');
}

@Injectable()
export class TeamWorkQueryService {
  constructor(private readonly repository: IssueRepository) {}

  async list(
    context: IssueMutationContext,
    query: TeamWorkListQueryDto,
  ): Promise<TeamWorkListResponseDto> {
    const teamIds = values(query.teamId);
    const projectIds = values(query.projectId);
    const projectTeamIds = values(query.projectTeamId);
    const workflowStateIds = values(query.workflowStateId);
    const categories = values(query.stateCategory);
    const assignees = values(query.assigneeMembershipId).map((value) =>
      value === 'me' ? context.membershipId : value,
    );
    if (
      [...teamIds, ...projectIds, ...projectTeamIds, ...workflowStateIds, ...assignees].some(
        (id) => !isUUID(id, '4'),
      )
    ) {
      throw new ApiError({
        code: 'INVALID_QUERY',
        message: '팀 작업 필터가 올바르지 않습니다.',
        status: HttpStatus.BAD_REQUEST,
      });
    }
    if (
      categories.some(
        (category) => !Object.values(StateCategory).includes(category as StateCategory),
      )
    ) {
      throw new ApiError({
        code: 'INVALID_QUERY',
        message: '상태 범주 필터가 올바르지 않습니다.',
        status: HttpStatus.BAD_REQUEST,
      });
    }
    const where: Prisma.TeamWorkWhereInput = {
      deletedAt: null,
      issue: {
        deletedAt: null,
        ...(projectIds.length ? { projectId: { in: projectIds } } : {}),
      },
      workspaceId: context.workspaceId,
      ...(query.query
        ? {
            OR: [
              { identifier: { contains: query.query, mode: 'insensitive' } },
              { issue: { identifier: { contains: query.query, mode: 'insensitive' } } },
              { issue: { title: { contains: query.query, mode: 'insensitive' } } },
              { issue: { project: { name: { contains: query.query, mode: 'insensitive' } } } },
            ],
          }
        : {}),
      ...(query.unassigned === 'true'
        ? { assigneeMembershipId: null }
        : assignees.length
          ? { assigneeMembershipId: { in: assignees } }
          : {}),
      ...(projectTeamIds.length ? { projectTeamId: { in: projectTeamIds } } : {}),
      ...(teamIds.length ? { teamId: { in: teamIds } } : {}),
      ...(categories.length
        ? { workflowState: { category: { in: categories as StateCategory[] } } }
        : {}),
      ...(workflowStateIds.length ? { workflowStateId: { in: workflowStateIds } } : {}),
    };
    const rows = await this.repository.listTeamWorkOrderRows(where);
    const sort = query.sort ?? 'updatedAt';
    const direction = query.sortDirection ?? 'desc';
    rows.sort((left, right) => {
      if (sort === 'executionOrder') {
        const category =
          EXECUTION_CATEGORY_ORDER[left.workflowState.category] -
          EXECUTION_CATEGORY_ORDER[right.workflowState.category];
        if (category) return category;
        const priority = PRIORITY_ORDER[left.issue.priority] - PRIORITY_ORDER[right.issue.priority];
        if (priority) return priority;
        const position = left.workflowState.position - right.workflowState.position;
        if (position) return position;
        const updatedAt = right.updatedAt.getTime() - left.updatedAt.getTime();
        return updatedAt || compareTextDescending(left.id, right.id);
      }
      const value =
        sort === 'priority'
          ? PRIORITY_ORDER[left.issue.priority] - PRIORITY_ORDER[right.issue.priority]
          : sort === 'status'
            ? left.workflowState.position - right.workflowState.position
            : left[sort].getTime() - right[sort].getTime();
      if (value) return direction === 'asc' ? value : -value;
      return direction === 'asc'
        ? left.id.localeCompare(right.id)
        : compareTextDescending(left.id, right.id);
    });
    const cursorId = query.cursor ? decodeCursor(query.cursor) : null;
    const start =
      cursorId === null ? 0 : Math.max(0, rows.findIndex(({ id }) => id === cursorId) + 1);
    const page = rows.slice(start, start + query.limit);
    const detailed = new Map(
      (
        await this.repository.findTeamWorks(
          context.workspaceId,
          page.map(({ id }) => id),
        )
      ).map((row) => [row.id, row]),
    );
    return {
      items: page.map(({ id }) => {
        const row = detailed.get(id);
        if (!row) issueResourceNotFound('팀 작업을 찾을 수 없습니다.');
        return toTeamWorkSummary(row);
      }),
      nextCursor:
        start + page.length < rows.length && page.length ? encodeCursor(page.at(-1)!.id) : null,
      totalCount: await this.repository.countTeamWorks(where),
    };
  }

  async get(workspaceId: string, teamWorkRef: string): Promise<TeamWorkDetailResponseDto> {
    return toTeamWorkDetail(await this.repository.findTeamWorkByRef(workspaceId, teamWorkRef));
  }
}
