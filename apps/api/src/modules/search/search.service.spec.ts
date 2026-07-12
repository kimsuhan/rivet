import { IssuePriority, IssueType, StateCategory } from '@rivet/database';

import type { DatabaseService } from '../../common/database/database.service';
import { SearchService } from './search.service';

const EXACT_ISSUE_ID = '1b321d69-9c41-4b58-af9c-81fc725697c3';
const PARTIAL_ISSUE_ID = 'c37c79e5-812a-4301-9d02-89d006e86385';
const SECOND_PARTIAL_ISSUE_ID = '2bad279a-7b8e-401b-b38e-bcb40d455506';
const TEAM_ID = 'bd2792ef-ded3-4991-a745-4a74c9b7bb84';
const WORKFLOW_STATE_ID = '080d6d3c-1e3e-4aa8-88dd-1b2fc2a565ca';
const WORKSPACE_ID = '4a70e202-b412-4f5f-9c12-f82a0871fb16';

function issueRow(
  overrides: Partial<{
    id: string;
    identifier: string;
    title: string;
    updatedAt: Date;
  }> = {},
) {
  return {
    assigneeTeamMember: null,
    blockedRelations: [],
    childIssues: [],
    createdAt: new Date('2026-07-11T00:00:00.000Z'),
    featureStatus: null,
    id: EXACT_ISSUE_ID,
    identifier: 'API-42',
    labels: [],
    parentIssue: null,
    priority: IssuePriority.NONE,
    project: null,
    projectRole: null,
    team: {
      archivedAt: null,
      id: TEAM_ID,
      key: 'API',
      name: 'API 팀',
    },
    title: '정확한 표시 ID 이슈',
    type: IssueType.TEAM_TASK,
    updatedAt: new Date('2026-07-11T01:00:00.000Z'),
    version: 1,
    workflowState: {
      category: StateCategory.BACKLOG,
      id: WORKFLOW_STATE_ID,
      isDefault: true,
      name: '미분류',
      position: 0,
      version: 1,
    },
    ...overrides,
  };
}

describe('SearchService', () => {
  const findFirst = jest.fn();
  const findMany = jest.fn();
  const database = {
    client: { issue: { findFirst, findMany } },
  } as unknown as DatabaseService;
  const service = new SearchService(database);

  beforeEach(() => {
    findFirst.mockReset();
    findMany.mockReset();
    findFirst.mockResolvedValue(null);
    findMany.mockResolvedValue([]);
  });

  it('searches titles only inside the active workspace and returns an empty page', async () => {
    await expect(service.issues(WORKSPACE_ID, { limit: 20, query: '없는 이슈' })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });

    expect(findFirst).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: 21,
        where: expect.objectContaining({
          deletedAt: null,
          title: { contains: '없는 이슈', mode: 'insensitive' },
          workspaceId: WORKSPACE_ID,
        }),
      }),
    );
  });

  it('puts a case-insensitive identifier match before newer title matches', async () => {
    const exact = issueRow();
    const partial = issueRow({
      id: PARTIAL_ISSUE_ID,
      identifier: 'WEB-9',
      title: 'api-42 연동 화면',
      updatedAt: new Date('2026-07-11T05:00:00.000Z'),
    });
    findFirst.mockResolvedValue(exact);
    findMany.mockResolvedValue([partial]);

    const result = await service.issues(WORKSPACE_ID, { limit: 20, query: 'api-42' });

    expect(result.items.map(({ matchType, issue }) => [matchType, issue.id])).toEqual([
      ['IDENTIFIER_EXACT', EXACT_ISSUE_ID],
      ['TITLE_PARTIAL', PARTIAL_ISSUE_ID],
    ]);
    expect(result.items[0]?.issue).toEqual(
      expect.objectContaining({
        blocked: false,
        identifier: 'API-42',
        progress: null,
        status: expect.objectContaining({ category: StateCategory.BACKLOG }),
      }),
    );
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          identifier: { equals: 'api-42', mode: 'insensitive' },
          workspaceId: WORKSPACE_ID,
        },
      }),
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          NOT: { identifier: { equals: 'api-42', mode: 'insensitive' } },
          workspaceId: WORKSPACE_ID,
        }),
      }),
    );
  });

  it('recognizes a feature display ID with the single-letter F prefix', async () => {
    const feature = issueRow({ identifier: 'F-1', title: '기능 이슈' });
    findFirst.mockResolvedValue(feature);

    const result = await service.issues(WORKSPACE_ID, { limit: 20, query: 'f-1' });

    expect(result.items).toEqual([
      expect.objectContaining({
        issue: expect.objectContaining({ identifier: 'F-1' }),
        matchType: 'IDENTIFIER_EXACT',
      }),
    ]);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          identifier: { equals: 'f-1', mode: 'insensitive' },
          workspaceId: WORKSPACE_ID,
        },
      }),
    );
  });

  it('does not run a one-codepoint title search', async () => {
    await expect(service.issues(WORKSPACE_ID, { limit: 20, query: '가' })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });

    expect(findFirst).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it.each([
    [{ limit: 20, query: '   ' }, 'INVALID_QUERY'],
    [{ limit: 51, query: '검색' }, 'INVALID_QUERY'],
    [{ cursor: 'not-a-cursor', limit: 20, query: '검색' }, 'INVALID_QUERY'],
  ])('rejects invalid search input %#', async (query, code) => {
    await expect(service.issues(WORKSPACE_ID, query)).rejects.toMatchObject({
      response: expect.objectContaining({ code }),
      status: 400,
    });
    expect(findFirst).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('continues from exact to title results with a query-bound stable cursor', async () => {
    const exact = issueRow();
    const firstPartial = issueRow({
      id: PARTIAL_ISSUE_ID,
      identifier: 'WEB-9',
      title: 'API-42 첫 번째 제목 결과',
      updatedAt: new Date('2026-07-11T03:00:00.000Z'),
    });
    const secondPartial = issueRow({
      id: SECOND_PARTIAL_ISSUE_ID,
      identifier: 'WEB-8',
      title: 'API-42 두 번째 제목 결과',
      updatedAt: new Date('2026-07-11T02:00:00.000Z'),
    });

    findFirst.mockResolvedValueOnce(exact);
    findMany.mockResolvedValueOnce([firstPartial, secondPartial]);
    const first = await service.issues(WORKSPACE_ID, { limit: 1, query: 'api-42' });
    expect(first.items[0]).toEqual(expect.objectContaining({ matchType: 'IDENTIFIER_EXACT' }));
    expect(first.nextCursor).toEqual(expect.any(String));
    if (!first.nextCursor) throw new Error('첫 페이지 커서가 없습니다.');

    findFirst.mockResolvedValueOnce({ id: exact.id });
    findMany.mockResolvedValueOnce([firstPartial, secondPartial]);
    const second = await service.issues(WORKSPACE_ID, {
      cursor: first.nextCursor,
      limit: 1,
      query: 'api-42',
    });
    expect(second.items[0]).toEqual(
      expect.objectContaining({
        issue: expect.objectContaining({ id: PARTIAL_ISSUE_ID }),
        matchType: 'TITLE_PARTIAL',
      }),
    );
    if (!second.nextCursor) throw new Error('두 번째 페이지 커서가 없습니다.');

    findFirst.mockResolvedValueOnce({ id: firstPartial.id });
    findMany.mockResolvedValueOnce([secondPartial]);
    const third = await service.issues(WORKSPACE_ID, {
      cursor: second.nextCursor,
      limit: 1,
      query: 'api-42',
    });
    expect(third.items.map(({ issue }) => issue.id)).toEqual([SECOND_PARTIAL_ISSUE_ID]);
    expect(third.nextCursor).toBeNull();
    expect(findMany.mock.calls[2]?.[0]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          OR: [
            { updatedAt: { lt: firstPartial.updatedAt } },
            { updatedAt: firstPartial.updatedAt, id: { lt: firstPartial.id } },
          ],
          workspaceId: WORKSPACE_ID,
        }),
      }),
    );

    await expect(
      service.issues(WORKSPACE_ID, {
        cursor: first.nextCursor,
        limit: 1,
        query: '다른 검색어',
      }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'INVALID_QUERY' }) });
  });
});
