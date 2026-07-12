import { HttpStatus } from '@nestjs/common';

import { HandoffKind, IssueType, ProjectRole } from '@rivet/database';

import { DatabaseService } from '../../common/database/database.service';
import { FilesService } from '../files/files.service';
import {
  IssueCollaborationService,
  normalizeHandoffBodyMarkdown,
} from './issue-collaboration.service';

const context = {
  membershipId: '5a46a969-2767-498b-bf6f-6eeadd49fd41',
  userId: 'a6593d22-bd11-4274-ada8-0092f7207ac8',
  workspaceId: '3dc0b213-eafa-450c-ad12-49a7d927c7b8',
};
const blockingIssueId = '953685f0-4921-41cd-8422-d8a1ccc3f547';
const blockedIssueId = '05ed9724-f207-447d-9f18-7026f493d3fd';

function handoffBody(apiSpecification = 'https://api.example.com/openapi.json'): string {
  return [
    '## 변경 요약',
    '로그인 응답을 확장했습니다.',
    '## API 명세 링크',
    apiSpecification,
    '## 사용 가능 환경',
    '개발 환경',
    '## 추가·변경 API',
    'POST /sessions',
    '## 요청·응답 변경',
    '응답에 workspaceId를 추가했습니다.',
    '## 오류·권한',
    '401 응답은 동일합니다.',
    '## 프론트 주의사항',
    '기존 필드는 유지됩니다.',
  ].join('\n\n');
}

describe('IssueCollaborationService', () => {
  const transaction = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    activityEvent: { createMany: jest.fn() },
    apiHandoff: { findFirst: jest.fn(), findMany: jest.fn() },
    issue: { update: jest.fn() },
    issueBlockRelation: {
      create: jest.fn(),
      delete: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
  };
  const database = {
    client: {
      $transaction: jest.fn(),
      issue: { findFirst: jest.fn() },
    },
  };
  const files = { syncBodyImages: jest.fn() };
  const service = new IssueCollaborationService(
    database as unknown as DatabaseService,
    files as unknown as FilesService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('normalizes a complete seven-section handoff body', () => {
    expect(
      normalizeHandoffBodyMarkdown(`  ${handoffBody().replace('로그인', 'Cafe\u0301 로그인')}  `),
    ).toBe(handoffBody().replace('로그인', 'Café 로그인'));
    expect(normalizeHandoffBodyMarkdown(handoffBody('해당 없음'))).toBe(handoffBody('해당 없음'));
  });

  it('rejects empty template sections and non-HTTP API specification links', () => {
    expect(() => normalizeHandoffBodyMarkdown(handoffBody().replace('개발 환경', '** **'))).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'HANDOFF_CONTENT_REQUIRED' }),
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      }),
    );
    expect(() => normalizeHandoffBodyMarkdown(handoffBody('ftp://api.example.com/spec'))).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'MARKDOWN_INVALID' }),
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      }),
    );
  });

  it('rejects dangerous Markdown before persistence', () => {
    expect(() =>
      normalizeHandoffBodyMarkdown(
        handoffBody().replace('기존 필드는 유지됩니다.', '<script>x</script>'),
      ),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'MARKDOWN_INVALID' }),
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      }),
    );
  });

  it('관계와 알림 앨커가 없는 작업 전달 멘션을 거부한다', () => {
    expect(() =>
      normalizeHandoffBodyMarkdown(
        handoffBody().replace(
          '기존 필드는 유지됩니다.',
          `@[Kim](rivet-member:${context.membershipId})`,
        ),
      ),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'MARKDOWN_INVALID' }),
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      }),
    );
  });

  it('rejects a self relation before opening a transaction', async () => {
    await expect(
      service.createBlockRelation(context, {
        blockedIssueId: blockingIssueId,
        blockedIssueVersion: 1,
        blockingIssueId,
        blockingIssueVersion: 1,
      }),
    ).rejects.toMatchObject({
      response: { code: 'BLOCK_RELATION_SELF' },
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });
    expect(database.client.$transaction).not.toHaveBeenCalled();
  });

  it('emits a distinct updated signal for both issues changed by a block relation', async () => {
    const relation = {
      blockedIssueId,
      blockingIssueId,
      createdAt: new Date('2026-07-11T03:00:00.000Z'),
      id: 'c5ef63e6-3f70-4caf-bb56-256486afbb84',
    };
    const issueRows = [
      {
        category: 'STARTED',
        id: blockedIssueId,
        identifier: 'WEB-2',
        projectRole: ProjectRole.WEB_FRONTEND,
        title: '화면 작업',
        type: IssueType.TEAM_TASK,
        version: 1,
      },
      {
        category: 'STARTED',
        id: blockingIssueId,
        identifier: 'API-1',
        projectRole: ProjectRole.BACKEND,
        title: 'API 작업',
        type: IssueType.TEAM_TASK,
        version: 1,
      },
    ];
    database.client.$transaction.mockImplementation(
      async (operation: (client: typeof transaction) => Promise<unknown>) => operation(transaction),
    );
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: context.workspaceId }])
      .mockResolvedValueOnce([{ status: 'ACTIVE' }])
      .mockResolvedValueOnce(issueRows)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(
        issueRows.map((issue) => ({ ...issue, blocked: issue.id === blockedIssueId, version: 2 })),
      );
    transaction.issueBlockRelation.findUnique.mockResolvedValue(null);
    transaction.issueBlockRelation.create.mockResolvedValue(relation);
    transaction.issue.update.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve({ id: where.id, version: 2 }),
    );

    await service.createBlockRelation(context, {
      blockedIssueId,
      blockedIssueVersion: 1,
      blockingIssueId,
      blockingIssueVersion: 1,
    });

    const payloads = transaction.$executeRaw.mock.calls.map(
      (call) => JSON.parse(call[2] as string) as { eventId: string; resourceId: string },
    );
    expect(payloads).toHaveLength(2);
    expect(payloads.map(({ resourceId }) => resourceId).sort()).toEqual(
      [blockedIssueId, blockingIssueId].sort(),
    );
    expect(new Set(payloads.map(({ eventId }) => eventId)).size).toBe(2);
    expect(payloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          changeType: 'UPDATED',
          resourceType: 'ISSUE',
          version: 2,
          workspaceId: context.workspaceId,
        }),
      ]),
    );
  });

  it('removes the final blocker without treating the manual edit as completion analytics', async () => {
    const relation = {
      blockedIssueId,
      blockingIssueId,
      createdAt: new Date('2026-07-11T03:00:00.000Z'),
      id: 'c5ef63e6-3f70-4caf-bb56-256486afbb84',
    };
    const issueRows = [
      {
        blocked: false,
        category: 'STARTED',
        id: blockedIssueId,
        identifier: 'WEB-2',
        projectRole: ProjectRole.WEB_FRONTEND,
        title: '화면 작업',
        type: IssueType.TEAM_TASK,
        version: 2,
      },
      {
        blocked: false,
        category: 'STARTED',
        id: blockingIssueId,
        identifier: 'API-1',
        projectRole: ProjectRole.BACKEND,
        title: 'API 작업',
        type: IssueType.TEAM_TASK,
        version: 2,
      },
    ];
    database.client.$transaction.mockImplementation(
      async (operation: (client: typeof transaction) => Promise<unknown>) => operation(transaction),
    );
    transaction.issueBlockRelation.findFirst.mockResolvedValue(relation);
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: context.workspaceId }])
      .mockResolvedValueOnce([{ status: 'ACTIVE' }])
      .mockResolvedValueOnce(
        issueRows.map(({ category, id, identifier, projectRole, title, type }) => ({
          category,
          id,
          identifier,
          projectRole,
          title,
          type,
          version: 1,
        })),
      )
      .mockResolvedValueOnce(issueRows);
    transaction.issue.update.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve({ id: where.id, version: 2 }),
    );

    await service.removeBlockRelation(context, relation.id, {
      blockedIssueVersion: 1,
      blockingIssueVersion: 1,
    });

    expect(transaction.issueBlockRelation.delete).toHaveBeenCalledWith({
      where: { id: relation.id },
    });
  });

  it('does not silently discard inline handoff content when an initial handoff exists', async () => {
    transaction.$queryRaw.mockResolvedValue([
      { id: blockingIssueId, projectRole: ProjectRole.BACKEND, type: IssueType.TEAM_TASK },
    ]);
    transaction.apiHandoff.findFirst.mockResolvedValue({
      id: 'c5ef63e6-3f70-4caf-bb56-256486afbb84',
    });

    await expect(
      service.ensureInitialHandoffForCompletion(transaction as never, context, blockingIssueId, {
        bodyMarkdown: handoffBody(),
      }),
    ).rejects.toMatchObject({
      response: { code: 'INITIAL_HANDOFF_EXISTS' },
      status: HttpStatus.CONFLICT,
    });
  });

  it('rejects a cursor whose sort direction does not match the request', async () => {
    const cursor = Buffer.from(
      JSON.stringify([
        'timeline-v1',
        'desc',
        '2026-07-11T00:00:00.000Z',
        blockingIssueId,
        'HANDOFF',
      ]),
    ).toString('base64url');

    await expect(
      service.timeline(context.workspaceId, blockingIssueId, {
        cursor,
        limit: 50,
        sortDirection: 'asc',
      }),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_QUERY' },
      status: HttpStatus.BAD_REQUEST,
    });
    expect(database.client.issue.findFirst).not.toHaveBeenCalled();
  });

  it('requires an initial handoff before a follow-up at the public boundary', async () => {
    database.client.$transaction.mockImplementation(
      async (operation: (client: typeof transaction) => Promise<unknown>) => operation(transaction),
    );
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: context.workspaceId }])
      .mockResolvedValueOnce([{ status: 'ACTIVE' }])
      .mockResolvedValueOnce([
        { id: blockingIssueId, projectRole: ProjectRole.BACKEND, type: IssueType.TEAM_TASK },
      ]);
    transaction.apiHandoff.findFirst.mockResolvedValue(null);
    transaction.apiHandoff.findMany.mockResolvedValue([]);

    await expect(
      service.createHandoff(context, blockingIssueId, {
        bodyMarkdown: handoffBody(),
        kind: HandoffKind.FOLLOW_UP,
      }),
    ).rejects.toMatchObject({
      response: { code: 'INITIAL_HANDOFF_REQUIRED' },
      status: HttpStatus.CONFLICT,
    });
  });
});
