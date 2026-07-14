import { HttpStatus, Injectable } from '@nestjs/common';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import { IssuesService, toIssueSummary, toTeamWorkSummary } from '../issues/issues.service';
import type {
  SearchIssueListResponseDto,
  SearchIssuesQueryDto,
} from './dto/search-issues.dto';

function invalidQuery(message: string): never {
  throw new ApiError({ code: 'INVALID_QUERY', message, status: HttpStatus.BAD_REQUEST });
}

@Injectable()
export class SearchService {
  constructor(
    private readonly database: DatabaseService,
    private readonly issueService: IssuesService,
  ) {}

  async issues(workspaceId: string, dto: SearchIssuesQueryDto): Promise<SearchIssueListResponseDto> {
    const query = (dto.query ?? '').normalize('NFC').trim();
    if (query.length === 0 || [...query].length > 500) invalidQuery('검색어를 확인해 주세요.');
    const limit = dto.limit ?? 20;
    const isIdentifier = /^(?:F|[A-Z]{2,5})-[1-9][0-9]*$/iu.test(query);
    const cursor = dto.cursor ? this.decodeCursor(dto.cursor, query) : null;

    const [exactIssue, exactTeamWork, partialIssues] = await Promise.all([
      isIdentifier
        ? this.database.client.issue.findFirst({ select: { id: true }, where: { deletedAt: null, identifier: { equals: query, mode: 'insensitive' }, workspaceId } })
        : null,
      isIdentifier
        ? this.database.client.teamWork.findFirst({ select: { id: true }, where: { deletedAt: null, identifier: { equals: query, mode: 'insensitive' }, issue: { deletedAt: null }, workspaceId } })
        : null,
      this.database.client.issue.findMany({
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
        take: limit + 1,
        where: {
          deletedAt: null,
          title: { contains: query, mode: 'insensitive' },
          workspaceId,
          ...(cursor ? { OR: [{ updatedAt: { lt: cursor.updatedAt } }, { updatedAt: cursor.updatedAt, id: { lt: cursor.id } }] } : {}),
        },
      }),
    ]);

    const items: SearchIssueListResponseDto['items'] = [];
    if (!cursor && exactIssue) {
      items.push({ issue: toIssueSummary(await this.issueService.findIssue(this.database.client, workspaceId, exactIssue.id)), matchType: 'IDENTIFIER_EXACT', resourceType: 'ISSUE' });
    }
    if (!cursor && exactTeamWork) {
      const teamWork = await this.issueService.findTeamWork(this.database.client, workspaceId, exactTeamWork.id);
      const issue = await this.issueService.findIssue(this.database.client, workspaceId, teamWork.issue.id);
      items.push({ issue: toIssueSummary(issue), matchType: 'IDENTIFIER_EXACT', resourceType: 'TEAM_WORK', teamWork: toTeamWorkSummary(teamWork) });
    }
    for (const row of partialIssues) {
      if (items.length >= limit) break;
      items.push({ issue: toIssueSummary(await this.issueService.findIssue(this.database.client, workspaceId, row.id)), matchType: 'TITLE_PARTIAL', resourceType: 'ISSUE' });
    }
    const lastPartial = partialIssues[Math.min(partialIssues.length, limit) - 1];
    const lastIssue = lastPartial ? await this.database.client.issue.findUnique({ select: { id: true, updatedAt: true }, where: { id: lastPartial.id } }) : null;
    return {
      items: items.slice(0, limit),
      nextCursor: partialIssues.length > limit && lastIssue ? this.encodeCursor(query, lastIssue.updatedAt, lastIssue.id) : null,
    };
  }

  private encodeCursor(query: string, updatedAt: Date, id: string): string {
    return Buffer.from(JSON.stringify([query, updatedAt.toISOString(), id])).toString('base64url');
  }

  private decodeCursor(value: string, query: string): { id: string; updatedAt: Date } {
    try {
      const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
      if (!Array.isArray(parsed) || parsed.length !== 3 || parsed[0] !== query || typeof parsed[1] !== 'string' || typeof parsed[2] !== 'string') invalidQuery('현재 검색어에 맞는 커서를 사용해 주세요.');
      const updatedAt = new Date(parsed[1]);
      if (Number.isNaN(updatedAt.getTime())) invalidQuery('커서를 확인해 주세요.');
      return { id: parsed[2], updatedAt };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      return invalidQuery('커서를 확인해 주세요.');
    }
  }
}
