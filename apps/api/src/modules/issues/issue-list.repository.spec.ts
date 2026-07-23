import { IssuePriority, IssueStatus } from '@rivet/database';

import type { DatabaseService } from '../../common/database/database.service';
import type { IssueListFilters } from './issue-list.policy';
import { IssueListRepository } from './issue-list.repository';

const filters: IssueListFilters = {
  assigneeIds: [],
  creatorIds: [],
  labelIds: [],
  priorities: [IssuePriority.HIGH],
  projectIds: [],
  statuses: [IssueStatus.TODO],
  unassigned: false,
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

  it('applies selected assignees and unassigned work to list and group queries', async () => {
    const assigneeFilters = {
      ...filters,
      assigneeIds: ['3dc0b213-eafa-450c-ad12-49a7d927c7b8'],
      unassigned: true,
    };

    await repository.listOrderRows(
      assigneeFilters,
      [{ direction: 'desc', field: 'updatedAt' }],
      undefined,
      51,
    );
    await repository.groupRows(assigneeFilters, 'projectId', 'status');

    for (const [statement] of queryRaw.mock.calls as Array<[{ sql: string }]>) {
      expect(statement.sql).toContain('assignee_tw."assignee_membership_id" IN');
      expect(statement.sql).toContain('unassigned_tw."assignee_membership_id" IS NULL');
      expect(statement.sql).toContain(' OR ');
    }
    const groupStatement = queryRaw.mock.calls[1]![0] as { sql: string };
    expect(groupStatement.sql).toContain('COUNT(DISTINCT i."id")::bigint');
    expect(groupStatement.sql).toContain('i."project_id"::text');
    expect(groupStatement.sql).toContain('project."logo_file_id"');
    expect(groupStatement.sql).toContain('i."status"::text');
  });

  it('groups issues by distinct assignees and includes an unassigned group', async () => {
    await repository.groupRows(filters, 'assigneeMembershipId', 'status');

    const statement = queryRaw.mock.calls[0]![0] as { sql: string };
    expect(statement.sql).toContain('JOIN LATERAL');
    expect(statement.sql).toContain(`'__unassigned__'`);
    expect(statement.sql).toContain('assignee_user."display_name"');
    expect(statement.sql).toContain('assignee_user."avatar_file_id"');
    expect(statement.sql).toContain('COUNT(DISTINCT i."id")::bigint');
  });
});
