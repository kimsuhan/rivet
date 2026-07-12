import {
  ExportType,
  FeatureIssueStatus,
  HandoffKind,
  IssueFileKind,
  IssuePriority,
  IssueType,
  ProjectRole,
  ProjectStatus,
} from '@rivet/database';

import type { DatabaseService } from '../../common/database/database.service';
import { ExportsService } from './exports.service';

const AUDIT_ID = '26fe94af-b4dc-43e4-a0b1-9050f2692d95';
const MEMBERSHIP_ID = '48d7bb48-9dd9-436d-944e-2069659f9609';
const WORKSPACE_ID = '995348d4-5d68-4f7c-91d1-ad816bc88b50';
const context = { membershipId: MEMBERSHIP_ID, workspaceId: WORKSPACE_ID };

function issueRow(overrides: Record<string, unknown> = {}) {
  return {
    assigneeTeamMember: {
      membership: { id: MEMBERSHIP_ID, user: { displayName: '담당자' } },
    },
    blockedRelations: [
      {
        blockingIssue: {
          id: '8b8c4e87-c493-4634-ae1b-bf764a351566',
          identifier: 'API-1',
          title: '선행 작업',
        },
        createdAt: new Date('2026-07-10T00:00:00.000Z'),
      },
    ],
    blockingRelations: [
      {
        blockedIssue: {
          id: 'b192a0d4-3833-43d5-8834-839216eabfa1',
          identifier: 'API-3',
          title: '후속 작업',
        },
        createdAt: new Date('2026-07-10T01:00:00.000Z'),
      },
    ],
    createdAt: new Date('2026-07-10T02:00:00.000Z'),
    descriptionMarkdown: 'hello, "world"\nnext',
    featureStatus: FeatureIssueStatus.UNSORTED,
    fileAttachments: [
      {
        apiHandoffId: null,
        commentId: null,
        createdAt: new Date('2026-07-10T03:00:00.000Z'),
        file: {
          detectedMimeType: 'image/png',
          id: 'fa29715f-21e0-448f-9358-d0c46af66482',
          originalName: '@위험.png',
          sizeBytes: 1234n,
        },
        id: '2ca9b0d6-acfb-4690-95eb-9877cb64d2f8',
        kind: IssueFileKind.ISSUE_ATTACHMENT,
      },
    ],
    handoffs: [
      {
        authorMembership: {
          id: MEMBERSHIP_ID,
          user: { displayName: '작성자' },
        },
        bodyMarkdown: '=handoff()',
        createdAt: new Date('2026-07-10T04:00:00.000Z'),
        id: 'cc7825db-319b-4145-a863-4ba95a9982bf',
        kind: HandoffKind.INITIAL,
        sequenceNumber: 1,
      },
    ],
    id: '9b960d10-3c7d-4f37-914d-a42c2e61d1d2',
    identifier: 'F-2',
    labels: [
      {
        label: {
          archivedAt: null,
          color: '#123456',
          id: '2d302e4c-72f2-4423-aab2-de27ac83e30e',
          name: '+라벨',
        },
      },
    ],
    parentIssue: null,
    priority: IssuePriority.HIGH,
    project: {
      archivedAt: null,
      deletedAt: null,
      id: 'cf05ed9a-8da5-4990-ad90-6c9a137fab8c',
      name: 'Rivet',
    },
    projectRole: ProjectRole.BACKEND,
    team: null,
    title: '=1+1',
    type: IssueType.FEATURE,
    updatedAt: new Date('2026-07-10T05:00:00.000Z'),
    workflowState: null,
    ...overrides,
  };
}

function projectRow(overrides: Record<string, unknown> = {}) {
  return {
    createdAt: new Date('2026-07-09T00:00:00.000Z'),
    description: '+SUM(1,2)',
    id: '817cc00b-ef8e-42e2-bf19-dcced112fe72',
    leadMembership: {
      id: MEMBERSHIP_ID,
      user: { displayName: '리드' },
    },
    name: '@프로젝트',
    roleTeams: [
      {
        role: ProjectRole.WEB_FRONTEND,
        team: {
          archivedAt: null,
          id: '220ffb8f-46e2-4920-b0b7-415b87868489',
          key: 'WEB',
          name: '웹',
        },
      },
    ],
    startDate: new Date('2026-07-01T00:00:00.000Z'),
    status: ProjectStatus.IN_PROGRESS,
    targetDate: new Date('2026-07-31T00:00:00.000Z'),
    updatedAt: new Date('2026-07-10T00:00:00.000Z'),
    ...overrides,
  };
}

async function collect(rows: AsyncGenerator<string, void, void>): Promise<string[]> {
  const values: string[] = [];
  for await (const row of rows) values.push(row);
  return values;
}

describe('ExportsService', () => {
  const create = jest.fn();
  const updateMany = jest.fn();
  const issueFindMany = jest.fn();
  const projectFindMany = jest.fn();
  const database = {
    client: {
      exportAudit: { create, updateMany },
      issue: { findMany: issueFindMany },
      project: { findMany: projectFindMany },
    },
  } as unknown as DatabaseService;
  const service = new ExportsService(database);

  beforeEach(() => {
    jest.clearAllMocks();
    create.mockResolvedValue({ id: AUDIT_ID });
    updateMany.mockResolvedValue({ count: 1 });
    issueFindMany.mockResolvedValue([]);
    projectFindMany.mockResolvedValue([]);
  });

  it('exports the canonical issue fields with RFC 4180 escaping and formula protection', async () => {
    issueFindMany.mockResolvedValueOnce([issueRow()]);

    const run = await service.beginIssues(context);
    const rows = await collect(run.rows);

    expect(create).toHaveBeenCalledWith({
      data: {
        requestedByMembershipId: MEMBERSHIP_ID,
        type: ExportType.ISSUES,
        workspaceId: WORKSPACE_ID,
      },
      select: { id: true },
    });
    expect(issueFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { id: 'asc' },
        take: 100,
        where: { deletedAt: null, workspaceId: WORKSPACE_ID },
      }),
    );
    expect(issueFindMany.mock.calls[0]?.[0].select).toEqual(
      expect.objectContaining({
        blockedRelations: expect.objectContaining({
          where: { blockingIssue: { deletedAt: null } },
        }),
        blockingRelations: expect.objectContaining({
          where: { blockedIssue: { deletedAt: null } },
        }),
      }),
    );
    expect(run.header).toContain('"설명 Markdown"');
    expect(rows).toHaveLength(1);
    expect(run.header).toMatch(/^"유형","상위 이슈","표시 ID",/u);
    expect(rows[0]).toMatch(/^"FEATURE","","F-2",/u);
    expect(rows[0]).toContain('"\'=1+1"');
    expect(rows[0]).toContain('"hello, ""world""\nnext"');
    expect(rows[0]).toContain('BACKLOG');
    expect(rows[0]).toContain('BLOCKED_BY');
    expect(rows[0]).toContain('BLOCKS');
    expect(rows[0]).toContain('bodyMarkdown');
    expect(rows[0]).toContain(`/api/v1/files/${issueRow().fileAttachments[0]?.file.id}/content`);
    expect(rows[0]).toContain('sizeBytes');
    expect(rows[0]).not.toContain('storageKey');
    expect(rows[0]?.endsWith('\r\n')).toBe(true);
  });

  it('exports projects with date-only values, role teams, and dangerous leading cells escaped', async () => {
    projectFindMany.mockResolvedValueOnce([
      projectRow(),
      projectRow({
        description: null,
        id: '04b998bc-a640-48a8-a6ad-e9aad3b33ac4',
        name: '-프로젝트',
      }),
    ]);

    const run = await service.beginProjects(context);
    const rows = await collect(run.rows);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: ExportType.PROJECTS }) }),
    );
    expect(projectFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { id: 'asc' },
        take: 100,
        where: { deletedAt: null, workspaceId: WORKSPACE_ID },
      }),
    );
    expect(run.header).toContain('"역할별 팀"');
    expect(rows[0]).toContain('"\'@프로젝트"');
    expect(rows[0]).toContain('"\'+SUM(1,2)"');
    expect(rows[0]).toContain('2026-07-01');
    expect(rows[0]).toContain('2026-07-31');
    expect(rows[0]).toContain('WEB_FRONTEND');
    expect(rows[1]).toContain('"\'-프로젝트"');
  });

  it('continues with an id cursor instead of OFFSET after a full issue batch', async () => {
    const firstBatch = Array.from({ length: 100 }, (_, index) =>
      issueRow({ id: `issue-${String(index).padStart(3, '0')}` }),
    );
    issueFindMany.mockResolvedValueOnce(firstBatch).mockResolvedValueOnce([]);

    const run = await service.beginIssues(context);

    await expect(collect(run.rows)).resolves.toHaveLength(100);
    expect(issueFindMany).toHaveBeenCalledTimes(2);
    expect(issueFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: { id: 'issue-099' }, skip: 1 }),
    );
  });

  it('records completed, downloaded, and failed transitions only in the same workspace', async () => {
    await service.markCompleted(context, AUDIT_ID, 23);
    await service.markDownloaded(context, AUDIT_ID);
    await service.markFailed(context, AUDIT_ID, 'EXPORT_RESPONSE_CLOSED');

    expect(updateMany.mock.calls[0]?.[0]).toEqual({
      data: { completedAt: expect.any(Date), itemCount: 23 },
      where: {
        completedAt: null,
        downloadedAt: null,
        failedAt: null,
        id: AUDIT_ID,
        requestedByMembershipId: MEMBERSHIP_ID,
        workspaceId: WORKSPACE_ID,
      },
    });
    expect(updateMany.mock.calls[1]?.[0]).toEqual({
      data: { downloadedAt: expect.any(Date) },
      where: {
        completedAt: { not: null },
        downloadedAt: null,
        failedAt: null,
        id: AUDIT_ID,
        requestedByMembershipId: MEMBERSHIP_ID,
        workspaceId: WORKSPACE_ID,
      },
    });
    expect(updateMany.mock.calls[2]?.[0]).toEqual({
      data: { failedAt: expect.any(Date), lastErrorCode: 'EXPORT_RESPONSE_CLOSED' },
      where: {
        downloadedAt: null,
        failedAt: null,
        id: AUDIT_ID,
        requestedByMembershipId: MEMBERSHIP_ID,
        workspaceId: WORKSPACE_ID,
      },
    });
  });

  it('marks a requested audit failed when the initial query cannot start', async () => {
    issueFindMany.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(service.beginIssues(context)).rejects.toThrow('database unavailable');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          failedAt: expect.any(Date),
          lastErrorCode: 'EXPORT_GENERATION_FAILED',
        },
      }),
    );
  });

  it('rejects an impossible audit transition instead of reporting success', async () => {
    updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.markDownloaded(context, AUDIT_ID)).rejects.toThrow(
      'EXPORT_AUDIT_STATE_CONFLICT',
    );
  });
});
