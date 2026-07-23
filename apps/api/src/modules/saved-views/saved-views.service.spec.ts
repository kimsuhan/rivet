import { Test, type TestingModule } from '@nestjs/testing';

import { DatabaseService } from '../../common/database/database.service';
import { ObservabilityService } from '../../common/observability/observability.service';
import { SavedViewsService } from './saved-views.service';

const context = {
  membershipId: '3dc0b213-eafa-450c-ad12-49a7d927c7b8',
  workspaceId: '953685f0-4921-41cd-8422-d8a1ccc3f547',
};
const view = {
  configuration: {
    query: '검색',
    sorts: [{ direction: 'desc', field: 'updatedAt' }],
  },
  createdAt: new Date('2026-07-15T00:00:00.000Z'),
  id: '05ed9724-f207-447d-9f18-7026f493d3fd',
  isDefault: false,
  membershipId: context.membershipId,
  name: '최근 이슈',
  normalizedName: '최근 이슈',
  resourceType: 'ISSUES' as const,
  updatedAt: new Date('2026-07-15T00:00:00.000Z'),
  version: 1,
  workspaceId: context.workspaceId,
};

describe('SavedViewsService', () => {
  const transaction = {
    savedView: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const database = {
    client: {
      $transaction: jest.fn(),
      savedView: {
        deleteMany: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
    },
  };
  let moduleRef: TestingModule;
  let service: SavedViewsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    database.client.$transaction.mockImplementation(
      async (operation: (client: typeof transaction) => Promise<unknown>) => operation(transaction),
    );
    moduleRef = await Test.createTestingModule({
      providers: [
        SavedViewsService,
        { provide: DatabaseService, useValue: database },
        { provide: ObservabilityService, useValue: { capture: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(SavedViewsService);
  });

  afterEach(async () => moduleRef.close());

  it('stores only normalized supported list settings', async () => {
    transaction.savedView.create.mockResolvedValue(view);

    await service.create(context, {
      configuration: {
        query: '  검색  ',
        sorts: [
          { direction: 'desc', field: 'priority' },
          { direction: 'asc', field: 'status' },
        ],
      },
      name: '  최근 이슈  ',
      resourceType: 'ISSUES',
    });

    expect(transaction.savedView.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        configuration: {
          query: '검색',
          sorts: [
            { direction: 'desc', field: 'priority' },
            { direction: 'asc', field: 'status' },
          ],
        },
        normalizedName: '최근 이슈',
        workspaceId: context.workspaceId,
      }),
    });
  });

  it('normalizes legacy issue sorting into the structured sort list', async () => {
    transaction.savedView.create.mockResolvedValue(view);

    await service.create(context, {
      configuration: { sort: 'progress', sortDirection: 'asc' },
      name: '기존 정렬 보기',
      resourceType: 'ISSUES',
    });

    expect(transaction.savedView.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        configuration: { sorts: [{ direction: 'asc', field: 'progress' }] },
      }),
    });
  });

  it('normalizes multi filters, visible fields, and two-level grouping', async () => {
    transaction.savedView.create.mockResolvedValue(view);
    const firstProjectId = '05ed9724-f207-447d-9f18-7026f493d3fd';
    const secondProjectId = '3dc0b213-eafa-450c-ad12-49a7d927c7b8';

    await service.create(context, {
      configuration: {
        assigneeMembershipId: `${secondProjectId},${firstProjectId},${secondProjectId}`,
        groupBy: 'assigneeMembershipId',
        projectId: `${secondProjectId},${firstProjectId}`,
        status: 'TODO,DONE,TODO',
        subGroupBy: 'status',
        unassigned: 'true',
        visibleFields: ['updatedAt', 'createdAt', 'status'],
      },
      name: '그룹 보기',
      resourceType: 'ISSUES',
    });

    expect(transaction.savedView.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        configuration: {
          assigneeMembershipId: `${firstProjectId},${secondProjectId}`,
          groupBy: 'assigneeMembershipId',
          projectId: `${firstProjectId},${secondProjectId}`,
          status: 'DONE,TODO',
          subGroupBy: 'status',
          unassigned: 'true',
          visibleFields: ['status', 'createdAt', 'updatedAt'],
        },
      }),
    });
  });

  it('rejects arbitrary URLs and unsupported query keys', async () => {
    await expect(
      service.create(context, {
        configuration: { url: 'https://unsafe.example' },
        name: '잘못된 보기',
        resourceType: 'ISSUES',
      }),
    ).rejects.toMatchObject({ response: { code: 'SAVED_VIEW_CONFIGURATION_INVALID' } });
    expect(transaction.savedView.create).not.toHaveBeenCalled();
  });

  it.each([
    ['잘못된 이슈 상태', 'ISSUES', { status: 'ARCHIVED' }],
    ['잘못된 작업 상태', 'MY_WORK', { stateCategory: 'STARTED,UNKNOWN' }],
    ['잘못된 표시 옵션', 'ISSUES', { density: 'tiny' }],
    ['잘못된 프로젝트', 'ISSUES', { projectId: 'not-a-uuid' }],
    [
      '중복된 정렬',
      'ISSUES',
      {
        sorts: [
          { direction: 'desc', field: 'priority' },
          { direction: 'asc', field: 'priority' },
        ],
      },
    ],
    [
      '혼합된 정렬 계약',
      'ISSUES',
      { sort: 'priority', sorts: [{ direction: 'desc', field: 'status' }] },
    ],
    ['같은 메인·서브 그룹', 'ISSUES', { groupBy: 'status', subGroupBy: 'status' }],
    ['메인 그룹 없는 서브 그룹', 'ISSUES', { subGroupBy: 'status' }],
    ['지원하지 않는 표시 필드', 'ISSUES', { visibleFields: ['unknown'] }],
  ] as const)('%s 구성을 거부한다', async (_label, resourceType, configuration) => {
    await expect(
      service.create(context, { configuration, name: '잘못된 보기', resourceType }),
    ).rejects.toMatchObject({ response: { code: 'SAVED_VIEW_CONFIGURATION_INVALID' } });
  });

  it('scopes list queries to the active membership and workspace', async () => {
    database.client.savedView.findMany.mockResolvedValue([view]);

    await expect(service.list(context, 'ISSUES')).resolves.toHaveLength(1);
    expect(database.client.savedView.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          membershipId: context.membershipId,
          resourceType: 'ISSUES',
          workspaceId: context.workspaceId,
        },
      }),
    );
  });

  it('does not overwrite a stale saved view', async () => {
    database.client.savedView.findFirst.mockResolvedValue({ ...view, version: 2 });

    await expect(
      service.update(context, view.id, { name: '다른 이름', version: 1 }),
    ).rejects.toMatchObject({
      response: { code: 'SAVED_VIEW_VERSION_CONFLICT', currentVersion: 2 },
    });
    expect(database.client.savedView.updateMany).not.toHaveBeenCalled();
  });

  it('clears the previous default and updates the selected view in one transaction', async () => {
    transaction.savedView.findFirst.mockResolvedValue(view);
    transaction.savedView.update.mockResolvedValue({ ...view, isDefault: true, version: 2 });

    await expect(service.setDefault(context, view.id, 1)).resolves.toMatchObject({
      isDefault: true,
      version: 2,
    });
    expect(transaction.savedView.updateMany).toHaveBeenCalledWith({
      data: { isDefault: false },
      where: expect.objectContaining({
        isDefault: true,
        membershipId: context.membershipId,
        resourceType: 'ISSUES',
      }),
    });
  });

  it('does not delete or set a stale saved view as default', async () => {
    database.client.savedView.findFirst.mockResolvedValue({ ...view, version: 2 });
    transaction.savedView.findFirst.mockResolvedValue({ ...view, version: 2 });

    await expect(service.remove(context, view.id, 1)).rejects.toMatchObject({
      response: { code: 'SAVED_VIEW_VERSION_CONFLICT', currentVersion: 2 },
    });
    await expect(service.setDefault(context, view.id, 1)).rejects.toMatchObject({
      response: { code: 'SAVED_VIEW_VERSION_CONFLICT', currentVersion: 2 },
    });
    expect(database.client.savedView.deleteMany).not.toHaveBeenCalled();
    expect(transaction.savedView.update).not.toHaveBeenCalled();
  });
});
