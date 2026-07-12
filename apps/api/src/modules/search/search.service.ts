import { createHash } from 'node:crypto';

import { HttpStatus, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { FeatureIssueStatus, IssueType, Prisma, StateCategory } from '@rivet/database';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import type {
  SearchIssueListResponseDto,
  SearchIssueMatchType,
  SearchIssuesQueryDto,
  SearchIssueSummaryResponseDto,
} from './dto/search-issues.dto';
import { SEARCH_ISSUE_MATCH_TYPES } from './dto/search-issues.dto';

const SEARCH_ISSUE_SELECT = {
  assigneeTeamMember: {
    select: {
      membership: {
        select: {
          id: true,
          role: true,
          status: true,
          user: { select: { avatarFileId: true, displayName: true, id: true } },
        },
      },
    },
  },
  blockedRelations: {
    select: {
      blockingIssue: {
        select: {
          featureStatus: true,
          workflowState: { select: { category: true } },
        },
      },
    },
    where: { blockingIssue: { deletedAt: null } },
  },
  childIssues: {
    select: { workflowState: { select: { category: true } } },
    where: { deletedAt: null, type: IssueType.TEAM_TASK },
  },
  createdAt: true,
  featureStatus: true,
  id: true,
  identifier: true,
  labels: {
    orderBy: { labelId: 'asc' },
    select: {
      label: { select: { archivedAt: true, color: true, id: true, name: true } },
    },
  },
  parentIssue: { select: { id: true, identifier: true, title: true } },
  priority: true,
  project: { select: { archivedAt: true, id: true, name: true, status: true } },
  projectRole: true,
  team: { select: { archivedAt: true, id: true, key: true, name: true } },
  title: true,
  type: true,
  updatedAt: true,
  version: true,
  workflowState: {
    select: {
      category: true,
      id: true,
      isDefault: true,
      name: true,
      position: true,
      version: true,
    },
  },
} satisfies Prisma.IssueSelect;

type SearchIssueRow = Prisma.IssueGetPayload<{ select: typeof SEARCH_ISSUE_SELECT }>;

interface SearchCursor {
  id: string;
  matchType: SearchIssueMatchType;
  updatedAt: Date;
}

const FEATURE_STATUS_CATEGORY: Record<FeatureIssueStatus, StateCategory> = {
  [FeatureIssueStatus.UNSORTED]: StateCategory.BACKLOG,
  [FeatureIssueStatus.PAUSED]: StateCategory.BACKLOG,
  [FeatureIssueStatus.TODO]: StateCategory.UNSTARTED,
  [FeatureIssueStatus.IN_PROGRESS]: StateCategory.STARTED,
  [FeatureIssueStatus.REVIEW]: StateCategory.STARTED,
  [FeatureIssueStatus.DONE]: StateCategory.COMPLETED,
  [FeatureIssueStatus.CANCELED]: StateCategory.CANCELED,
};

function invalidQuery(message: string): never {
  throw new ApiError({ code: 'INVALID_QUERY', message, status: HttpStatus.BAD_REQUEST });
}

function issueCategory(issue: {
  featureStatus: FeatureIssueStatus | null;
  workflowState: { category: StateCategory } | null;
}): StateCategory {
  if (issue.featureStatus !== null) return FEATURE_STATUS_CATEGORY[issue.featureStatus];
  if (issue.workflowState !== null) return issue.workflowState.category;
  throw new Error('ISSUE_STATUS_INVARIANT_VIOLATION');
}

function isTerminalCategory(category: StateCategory): boolean {
  return category === StateCategory.COMPLETED || category === StateCategory.CANCELED;
}

function toSummaryResponse(issue: SearchIssueRow): SearchIssueSummaryResponseDto {
  const children = issue.childIssues.filter(
    ({ workflowState }) => workflowState?.category !== StateCategory.CANCELED,
  );
  const completed = children.filter(
    ({ workflowState }) => workflowState?.category === StateCategory.COMPLETED,
  ).length;

  return {
    assignee: issue.assigneeTeamMember
      ? {
          id: issue.assigneeTeamMember.membership.id,
          role: issue.assigneeTeamMember.membership.role,
          status: issue.assigneeTeamMember.membership.status,
          user: issue.assigneeTeamMember.membership.user,
        }
      : null,
    blocked: issue.blockedRelations.some(
      ({ blockingIssue }) => !isTerminalCategory(issueCategory(blockingIssue)),
    ),
    createdAt: issue.createdAt.toISOString(),
    id: issue.id,
    identifier: issue.identifier,
    labels: issue.labels.map(({ label }) => ({
      archived: label.archivedAt !== null,
      color: label.color,
      id: label.id,
      name: label.name,
    })),
    parentIssue: issue.parentIssue,
    priority: issue.priority,
    progress:
      issue.type === IssueType.FEATURE
        ? {
            completed,
            percentage: children.length === 0 ? 0 : Math.round((completed / children.length) * 100),
            total: children.length,
          }
        : null,
    project: issue.project
      ? {
          archived: issue.project.archivedAt !== null,
          id: issue.project.id,
          name: issue.project.name,
          status: issue.project.status,
        }
      : null,
    projectRole: issue.projectRole,
    status: {
      category: issueCategory(issue),
      featureStatus: issue.featureStatus,
      workflowState: issue.workflowState,
    },
    team: issue.team
      ? {
          archived: issue.team.archivedAt !== null,
          id: issue.team.id,
          key: issue.team.key,
          name: issue.team.name,
        }
      : null,
    title: issue.title,
    type: issue.type,
    updatedAt: issue.updatedAt.toISOString(),
    version: issue.version,
  };
}

function querySignature(query: string): string {
  return createHash('sha256').update(query).digest('base64url');
}

function parseCursor(value: string | undefined, query: string): SearchCursor | null {
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
      parsed.length !== 4 ||
      parsed[0] !== querySignature(query) ||
      typeof parsed[1] !== 'string' ||
      !SEARCH_ISSUE_MATCH_TYPES.includes(parsed[1] as SearchIssueMatchType) ||
      typeof parsed[2] !== 'string' ||
      typeof parsed[3] !== 'string' ||
      !isUUID(parsed[3], '4')
    ) {
      return invalidQuery('현재 검색어에 맞는 커서를 사용해 주세요.');
    }

    const updatedAt = new Date(parsed[2]);
    if (Number.isNaN(updatedAt.getTime()) || updatedAt.toISOString() !== parsed[2]) {
      return invalidQuery('커서를 확인해 주세요.');
    }

    return {
      id: parsed[3],
      matchType: parsed[1] as SearchIssueMatchType,
      updatedAt,
    };
  } catch {
    return invalidQuery('커서를 확인해 주세요.');
  }
}

function encodeCursor(
  query: string,
  matchType: SearchIssueMatchType,
  issue: Pick<SearchIssueRow, 'id' | 'updatedAt'>,
): string {
  return Buffer.from(
    JSON.stringify([querySignature(query), matchType, issue.updatedAt.toISOString(), issue.id]),
  ).toString('base64url');
}

@Injectable()
export class SearchService {
  constructor(private readonly database: DatabaseService) {}

  async issues(
    workspaceId: string,
    dto: SearchIssuesQueryDto,
  ): Promise<SearchIssueListResponseDto> {
    const query = (dto.query ?? '').normalize('NFC').trim();
    const queryLength = [...query].length;
    if (queryLength === 0 || queryLength > 500) {
      invalidQuery('검색어를 확인해 주세요.');
    }

    const limit = dto.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      invalidQuery('조회 개수를 확인해 주세요.');
    }

    const cursor = parseCursor(dto.cursor, query);
    const isIdentifierQuery = /^(?:F|[A-Z]{2,5})-[1-9][0-9]*$/i.test(query);
    if (cursor?.matchType === 'IDENTIFIER_EXACT' && !isIdentifierQuery) {
      invalidQuery('현재 검색어에 맞는 커서를 사용해 주세요.');
    }
    if (queryLength < 2) {
      if (cursor) invalidQuery('현재 검색어에 맞는 커서를 사용해 주세요.');
      return { items: [], nextCursor: null };
    }

    const identifierFilter = { equals: query, mode: 'insensitive' as const };
    const partialWhere = {
      ...(isIdentifierQuery ? { NOT: { identifier: identifierFilter } } : {}),
      title: { contains: query, mode: 'insensitive' as const },
      deletedAt: null,
      workspaceId,
    } satisfies Prisma.IssueWhereInput;

    if (cursor) {
      const cursorIssue = await this.database.client.issue.findFirst({
        select: { id: true },
        where: {
          id: cursor.id,
          deletedAt: null,
          updatedAt: cursor.updatedAt,
          workspaceId,
          ...(cursor.matchType === 'IDENTIFIER_EXACT'
            ? { identifier: identifierFilter }
            : partialWhere),
        },
      });
      if (!cursorIssue) {
        invalidQuery('목록이 변경되었습니다. 첫 페이지부터 다시 조회해 주세요.');
      }
    }

    const exactIssue =
      isIdentifierQuery && cursor === null
        ? await this.database.client.issue.findFirst({
            select: SEARCH_ISSUE_SELECT,
            where: { deletedAt: null, identifier: identifierFilter, workspaceId },
          })
        : null;
    const partialIssues = await this.database.client.issue.findMany({
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: SEARCH_ISSUE_SELECT,
      take: limit + 1,
      where: {
        ...partialWhere,
        ...(cursor?.matchType === 'TITLE_PARTIAL'
          ? {
              OR: [
                { updatedAt: { lt: cursor.updatedAt } },
                { updatedAt: cursor.updatedAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
    });
    const matches: Array<{ matchType: SearchIssueMatchType; issue: SearchIssueRow }> = [];
    if (exactIssue) matches.push({ issue: exactIssue, matchType: 'IDENTIFIER_EXACT' });
    matches.push(...partialIssues.map((issue) => ({ issue, matchType: 'TITLE_PARTIAL' as const })));

    const page = matches.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(({ issue, matchType }) => ({
        issue: toSummaryResponse(issue),
        matchType,
      })),
      nextCursor:
        matches.length > limit && last ? encodeCursor(query, last.matchType, last.issue) : null,
    };
  }
}
