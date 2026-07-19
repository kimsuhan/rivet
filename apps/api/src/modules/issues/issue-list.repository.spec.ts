import { IssuePriority, IssueStatus } from '@rivet/database';

import type { DatabaseService } from '../../common/database/database.service';
import type { IssueListFilters } from './issue-list.policy';
import { IssueListRepository } from './issue-list.repository';

const filters: IssueListFilters = {
  creatorIds: [],
  labelIds: [],
  priorities: [IssuePriority.HIGH],
  projectIds: [],
  statuses: [IssueStatus.TODO],
  workspaceId: '953685f0-4921-41cd-8422-d8a1ccc3f547',
};

describe('IssueListRepository', () => {
  const queryRaw = jest.fn().mockResolvedValue([]);
  const repository = new IssueListRepository({
    client: { $queryRaw: queryRaw },
  } as unknown as DatabaseService);

  beforeEach(() => jest.clearAllMocks());

  it('keeps the default indexed ordering path free of progress aggregation', async () => {
    await repository.listOrderRows(
      filters,
      [{ direction: 'desc', field: 'updatedAt' }],
      undefined,
      51,
    );

    const statement = queryRaw.mock.calls[0]![0] as { sql: string };
    expect(statement.sql).not.toContain('FROM "team_works" tw');
    expect(statement.sql).toContain('ordered."updatedAt" DESC');
    expect(statement.sql).toContain('ordered."id" DESC');
  });

  it('calculates displayed progress only when progress participates in ordering', async () => {
    await repository.listOrderRows(
      filters,
      [{ direction: 'asc', field: 'progress' }],
      undefined,
      51,
    );

    const statement = queryRaw.mock.calls[0]![0] as { sql: string };
    const sql = statement.sql;
    expect(sql).toContain('FROM "team_works" tw');
    expect(sql).toContain(`ws."category" <> 'CANCELED'::"StateCategory"`);
    expect(sql).toContain('ordered."progress" ASC');
    expect(sql).toContain('ordered."id" ASC');
  });
});
