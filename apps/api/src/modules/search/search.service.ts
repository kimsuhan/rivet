import { HttpStatus, Injectable } from '@nestjs/common';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import { IssueQueryService } from '../issues/issue-query.service';
import type { SearchIssueListResponseDto, SearchIssuesQueryDto } from './dto/search-issues.dto';

function invalidQuery(message: string): never {
  throw new ApiError({ code: 'INVALID_QUERY', message, status: HttpStatus.BAD_REQUEST });
}

@Injectable()
export class SearchService {
  constructor(
    private readonly database: DatabaseService,
    private readonly issueQueries: IssueQueryService,
  ) {}

  async issues(
    workspaceId: string,
    dto: SearchIssuesQueryDto,
  ): Promise<SearchIssueListResponseDto> {
    const query = (dto.query ?? '').normalize('NFC').trim();
    if (query.length === 0 || [...query].length > 500) invalidQuery('검색어를 확인해 주세요.');
    const limit = dto.limit ?? 20;
    const isIdentifier = /^(?:F|[A-Z]{2,5})-[1-9][0-9]*$/iu.test(query);
    const cursor = dto.cursor ? this.decodeCursor(dto.cursor, query) : null;

    const [exactIssue, exactTeamWork, partialIssues] = await Promise.all([
      isIdentifier
        ? this.database.client.issue.findFirst({
            select: { id: true },
            where: {
              deletedAt: null,
              identifier: { equals: query, mode: 'insensitive' },
              workspaceId,
            },
          })
        : null,
      isIdentifier
        ? this.database.client.teamWork.findFirst({
            select: { id: true, issueId: true },
            where: {
              deletedAt: null,
              identifier: { equals: query, mode: 'insensitive' },
              issue: { deletedAt: null },
              workspaceId,
            },
          })
        : null,
      this.database.client.issue.findMany({
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        select: { id: true, updatedAt: true },
        take: limit + 1,
        where: {
          deletedAt: null,
          title: { contains: query, mode: 'insensitive' },
          workspaceId,
          ...(cursor
            ? {
                OR: [
                  { updatedAt: { lt: cursor.updatedAt } },
                  { updatedAt: cursor.updatedAt, id: { lt: cursor.id } },
                ],
              }
            : {}),
        },
      }),
    ]);

    const [issueSummaries, exactTeamWorkSummary] = await Promise.all([
      this.issueQueries.summariesByIds(workspaceId, [
        ...(exactIssue ? [exactIssue.id] : []),
        ...(exactTeamWork ? [exactTeamWork.issueId] : []),
        ...partialIssues.map(({ id }) => id),
      ]),
      exactTeamWork
        ? this.issueQueries.teamWorkSummary(workspaceId, exactTeamWork.id)
        : Promise.resolve(null),
    ]);
    const items: SearchIssueListResponseDto['items'] = [];
    if (!cursor && exactIssue) {
      const issue = issueSummaries.get(exactIssue.id);
      if (issue) items.push({ issue, matchType: 'IDENTIFIER_EXACT', resourceType: 'ISSUE' });
    }
    if (!cursor && exactTeamWork && exactTeamWorkSummary) {
      const issue = issueSummaries.get(exactTeamWork.issueId);
      if (issue)
        items.push({
          issue,
          matchType: 'IDENTIFIER_EXACT',
          resourceType: 'TEAM_WORK',
          teamWork: exactTeamWorkSummary,
        });
    }
    for (const row of partialIssues) {
      if (items.length >= limit) break;
      const issue = issueSummaries.get(row.id);
      if (issue) items.push({ issue, matchType: 'TITLE_PARTIAL', resourceType: 'ISSUE' });
    }
    const lastPartial = partialIssues[Math.min(partialIssues.length, limit) - 1];
    return {
      items: items.slice(0, limit),
      nextCursor:
        partialIssues.length > limit && lastPartial
          ? this.encodeCursor(query, lastPartial.updatedAt, lastPartial.id)
          : null,
    };
  }

  private encodeCursor(query: string, updatedAt: Date, id: string): string {
    return Buffer.from(JSON.stringify([query, updatedAt.toISOString(), id])).toString('base64url');
  }

  private decodeCursor(value: string, query: string): { id: string; updatedAt: Date } {
    try {
      const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
      if (
        !Array.isArray(parsed) ||
        parsed.length !== 3 ||
        parsed[0] !== query ||
        typeof parsed[1] !== 'string' ||
        typeof parsed[2] !== 'string'
      )
        invalidQuery('현재 검색어에 맞는 커서를 사용해 주세요.');
      const updatedAt = new Date(parsed[1]);
      if (Number.isNaN(updatedAt.getTime())) invalidQuery('커서를 확인해 주세요.');
      return { id: parsed[2], updatedAt };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      return invalidQuery('커서를 확인해 주세요.');
    }
  }
}
