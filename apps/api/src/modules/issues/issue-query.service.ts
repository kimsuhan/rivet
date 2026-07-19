import { HttpStatus, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { IssuePriority, IssueStatus, Prisma } from '@rivet/database';

import { ApiError } from '../../common/errors/api-error';
import type { IssueListQueryDto } from './dto/issue-request.dto';
import type {
  IssueDetailResponseDto,
  IssueListResponseDto,
  IssueSummaryResponseDto,
  TeamWorkListResponseDto,
  TeamWorkSummaryResponseDto,
} from './dto/issue-response.dto';
import { IssueRepository } from './issue.repository';
import {
  encodeIssueListCursor,
  issueListFilterFingerprint,
  parseIssueListCursor,
} from './issue-list.cursor';
import type { IssueListFilters } from './issue-list.policy';
import { IssueListRepository } from './issue-list.repository';
import { parseIssueSorts } from './issue-list-sort.parser';
import { toIssueDetail, toIssueSummary, toTeamWorkSummary } from './issue-response.mapper';

function csvValues(value: string | undefined): string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

@Injectable()
export class IssueQueryService {
  constructor(
    private readonly repository: IssueRepository,
    private readonly listRepository: IssueListRepository,
  ) {}

  async list(workspaceId: string, query: IssueListQueryDto): Promise<IssueListResponseDto> {
    const projectIds = csvValues(query.projectId);
    const statuses = csvValues(query.status);
    const priorities = csvValues(query.priority);
    const labelIds = csvValues(query.labelId);
    const creatorIds = csvValues(query.createdByMembershipId);
    if (
      projectIds.some((id) => !isUUID(id, '4')) ||
      labelIds.some((id) => !isUUID(id, '4')) ||
      creatorIds.some((id) => !isUUID(id, '4'))
    ) {
      throw new ApiError({
        code: 'INVALID_QUERY',
        message: 'ID 필터가 올바르지 않습니다.',
        status: HttpStatus.BAD_REQUEST,
      });
    }
    if (
      statuses.some((value) => !Object.values(IssueStatus).includes(value as IssueStatus)) ||
      priorities.some((value) => !Object.values(IssuePriority).includes(value as IssuePriority))
    ) {
      throw new ApiError({
        code: 'INVALID_QUERY',
        message: '상태 또는 우선순위 필터가 올바르지 않습니다.',
        status: HttpStatus.BAD_REQUEST,
      });
    }
    const filters: IssueListFilters = {
      ...(query.createdFrom ? { createdFrom: new Date(query.createdFrom) } : {}),
      ...(query.createdTo ? { createdTo: new Date(query.createdTo) } : {}),
      creatorIds,
      labelIds,
      priorities: priorities as IssuePriority[],
      projectIds,
      ...(query.query ? { query: query.query } : {}),
      statuses: statuses as IssueStatus[],
      ...(query.updatedFrom ? { updatedFrom: new Date(query.updatedFrom) } : {}),
      ...(query.updatedTo ? { updatedTo: new Date(query.updatedTo) } : {}),
      workspaceId,
    };
    const where: Prisma.IssueWhereInput = {
      createdAt: {
        ...(filters.createdFrom ? { gte: filters.createdFrom } : {}),
        ...(filters.createdTo ? { lte: filters.createdTo } : {}),
      },
      deletedAt: null,
      updatedAt: {
        ...(filters.updatedFrom ? { gte: filters.updatedFrom } : {}),
        ...(filters.updatedTo ? { lte: filters.updatedTo } : {}),
      },
      workspaceId,
      ...(creatorIds.length ? { createdByMembershipId: { in: creatorIds } } : {}),
      ...(labelIds.length ? { labels: { some: { labelId: { in: labelIds } } } } : {}),
      ...(priorities.length ? { priority: { in: priorities as IssuePriority[] } } : {}),
      ...(projectIds.length ? { projectId: { in: projectIds } } : {}),
      ...(statuses.length ? { status: { in: statuses as IssueStatus[] } } : {}),
      ...(query.query
        ? {
            OR: [
              { identifier: { contains: query.query, mode: 'insensitive' as const } },
              { title: { contains: query.query, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const sorts = parseIssueSorts(query);
    const filterFingerprint = issueListFilterFingerprint(filters);
    const cursor = parseIssueListCursor(query.cursor, sorts, filterFingerprint);
    const [orderRows, totalCount] = await Promise.all([
      this.listRepository.listOrderRows(filters, sorts, cursor, query.limit + 1),
      this.listRepository.count(where),
    ]);
    const hasNext = orderRows.length > query.limit;
    const pageOrderRows = hasNext ? orderRows.slice(0, query.limit) : orderRows;
    const rows = await this.repository.findIssues(
      workspaceId,
      pageOrderRows.map(({ id }) => id),
    );
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    return {
      items: pageOrderRows.flatMap(({ id }) => {
        const row = rowsById.get(id);
        return row ? [toIssueSummary(row)] : [];
      }),
      nextCursor: hasNext
        ? encodeIssueListCursor(pageOrderRows.at(-1)!, sorts, filterFingerprint)
        : null,
      totalCount,
    };
  }

  async get(workspaceId: string, issueRef: string): Promise<IssueDetailResponseDto> {
    return toIssueDetail(await this.repository.findIssueByRef(workspaceId, issueRef));
  }

  async listTeamWorks(workspaceId: string, issueId: string): Promise<TeamWorkListResponseDto> {
    const issue = await this.repository.findIssueById(workspaceId, issueId);
    return {
      items: issue.teamWorks.map(toTeamWorkSummary),
      nextCursor: null,
      totalCount: issue.teamWorks.length,
    };
  }

  async summariesByIds(
    workspaceId: string,
    issueIds: string[],
  ): Promise<Map<string, IssueSummaryResponseDto>> {
    const rows = await this.repository.findIssues(workspaceId, [...new Set(issueIds)]);
    return new Map(rows.map((row) => [row.id, toIssueSummary(row)]));
  }

  async teamWorkSummary(
    workspaceId: string,
    teamWorkId: string,
  ): Promise<TeamWorkSummaryResponseDto> {
    return toTeamWorkSummary(await this.repository.findTeamWorkByRef(workspaceId, teamWorkId));
  }
}
