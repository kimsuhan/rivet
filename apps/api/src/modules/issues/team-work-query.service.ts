import { HttpStatus, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { IssuePriority, Prisma, StateCategory } from '@rivet/database';

import { ApiError } from '../../common/errors/api-error';
import type { TeamWorkGroupQueryDto, TeamWorkListQueryDto } from './dto/issue-request.dto';
import type {
  ListGroupSummaryResponseDto,
  TeamWorkDetailResponseDto,
  TeamWorkListResponseDto,
} from './dto/issue-response.dto';
import type { IssueMutationContext } from './issue.context';
import { issueResourceNotFound } from './issue.errors';
import { IssueRepository } from './issue.repository';
import type { TeamWorkGroupField } from './issue-list.policy';
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

function teamWorkWhere(
  context: IssueMutationContext,
  query: TeamWorkListQueryDto | TeamWorkGroupQueryDto,
): Prisma.TeamWorkWhereInput {
  const teamIds = values(query.teamId);
  const projectIds = values(query.projectId);
  const projectTeamIds = values(query.projectTeamId);
  const workflowStateIds = values(query.workflowStateId);
  const categories = values(query.stateCategory);
  const priorities = values(query.priority);
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
    ) ||
    priorities.some((priority) => !Object.values(IssuePriority).includes(priority as IssuePriority))
  ) {
    throw new ApiError({
      code: 'INVALID_QUERY',
      message: '상태 또는 우선순위 필터가 올바르지 않습니다.',
      status: HttpStatus.BAD_REQUEST,
    });
  }
  return {
    deletedAt: null,
    issue: {
      deletedAt: null,
      ...(priorities.length ? { priority: { in: priorities as IssuePriority[] } } : {}),
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
}

function teamWorkGroupValue(
  row: Awaited<ReturnType<IssueRepository['listTeamWorkGroupRows']>>[number],
  field: TeamWorkGroupField,
): { imageFileId: string | null; label: string; value: string } {
  switch (field) {
    case 'priority':
      return { imageFileId: null, label: row.issue.priority, value: row.issue.priority };
    case 'projectId':
      return {
        imageFileId: row.issue.project.logoFileId,
        label: row.issue.project.name,
        value: row.issue.project.id,
      };
    case 'stateCategory':
      return {
        imageFileId: null,
        label: row.workflowState.category,
        value: row.workflowState.category,
      };
    case 'teamId':
      return { imageFileId: null, label: row.projectTeam.team.name, value: row.teamId };
    case 'workflowStateId':
      return { imageFileId: null, label: row.workflowState.name, value: row.workflowState.id };
  }
}

@Injectable()
export class TeamWorkQueryService {
  constructor(private readonly repository: IssueRepository) {}

  async list(
    context: IssueMutationContext,
    query: TeamWorkListQueryDto,
  ): Promise<TeamWorkListResponseDto> {
    const where = teamWorkWhere(context, query);
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

  async groups(
    context: IssueMutationContext,
    query: TeamWorkGroupQueryDto,
  ): Promise<ListGroupSummaryResponseDto> {
    if (query.groupBy === query.subGroupBy) {
      throw new ApiError({
        code: 'INVALID_QUERY',
        message: '메인 그룹과 서브 그룹은 서로 달라야 합니다.',
        status: HttpStatus.BAD_REQUEST,
      });
    }
    const rows = await this.repository.listTeamWorkGroupRows(teamWorkWhere(context, query));
    const groups: ListGroupSummaryResponseDto['groups'] = [];
    const groupsByValue = new Map<string, ListGroupSummaryResponseDto['groups'][number]>();
    const subGroupsByMain = new Map<
      string,
      Map<string, ListGroupSummaryResponseDto['groups'][number]['subGroups'][number]>
    >();
    for (const row of rows) {
      const main = teamWorkGroupValue(row, query.groupBy);
      let group = groupsByValue.get(main.value);
      if (!group) {
        group = { ...main, count: 0, subGroups: [] };
        groupsByValue.set(main.value, group);
        groups.push(group);
      }
      group.count += 1;
      if (query.subGroupBy) {
        const sub = teamWorkGroupValue(row, query.subGroupBy);
        let subGroups = subGroupsByMain.get(main.value);
        if (!subGroups) {
          subGroups = new Map();
          subGroupsByMain.set(main.value, subGroups);
        }
        const existing = subGroups.get(sub.value);
        if (existing) {
          existing.count += 1;
        } else {
          const created = { ...sub, count: 1 };
          subGroups.set(sub.value, created);
          group.subGroups.push(created);
        }
      }
    }
    return {
      groupBy: query.groupBy,
      groups,
      subGroupBy: query.subGroupBy ?? null,
      totalCount: rows.length,
    };
  }

  async get(workspaceId: string, teamWorkRef: string): Promise<TeamWorkDetailResponseDto> {
    return toTeamWorkDetail(await this.repository.findTeamWorkByRef(workspaceId, teamWorkRef));
  }
}
