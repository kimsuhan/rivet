import { HttpStatus } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { Prisma } from '@rivet/database';

import { DatabaseService } from '../../common/database/database.service';
import { LabelsService } from './labels.service';

function uniqueConflict(target: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    clientVersion: '7.8.0',
    code: 'P2002',
    meta: { target },
  });
}

describe('LabelsService', () => {
  const workspaceId = '3dc0b213-eafa-450c-ad12-49a7d927c7b8';
  const labelId = '953685f0-4921-41cd-8422-d8a1ccc3f547';
  const secondLabelId = '05ed9724-f207-447d-9f18-7026f493d3fd';
  const thirdLabelId = 'c5ef63e6-3f70-4caf-bb56-256486afbb84';
  const label = {
    archivedAt: null,
    color: '#D84A4A',
    id: labelId,
    name: '버그',
    updatedAt: new Date('2026-07-11T02:00:00.000Z'),
    version: 1,
  };
  const transaction = {
    $executeRaw: jest.fn(),
    label: {
      create: jest.fn(),
      findFirst: jest.fn(),
      updateManyAndReturn: jest.fn(),
    },
  };
  const database = {
    client: {
      $transaction: jest.fn(),
      label: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
    },
  };
  let moduleRef: TestingModule;
  let service: LabelsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    database.client.$transaction.mockImplementation(
      async (operation: (client: typeof transaction) => Promise<unknown>) => operation(transaction),
    );

    moduleRef = await Test.createTestingModule({
      providers: [LabelsService, { provide: DatabaseService, useValue: database }],
    }).compile();
    service = moduleRef.get(LabelsService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('lists active labels with an opaque updatedAt and id cursor', async () => {
    database.client.label.findMany.mockResolvedValue([
      label,
      {
        ...label,
        id: secondLabelId,
        name: '기능',
        updatedAt: new Date('2026-07-11T01:00:00.000Z'),
      },
      {
        ...label,
        id: thirdLabelId,
        name: '운영',
        updatedAt: new Date('2026-07-11T00:00:00.000Z'),
      },
    ]);

    const result = await service.list(workspaceId, {
      archivedOnly: false,
      includeArchived: false,
      limit: 2,
    });

    expect(result.items.map(({ id }) => id)).toEqual([labelId, secondLabelId]);
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(result.nextCursor).not.toContain(secondLabelId);
    expect(database.client.label.findMany).toHaveBeenCalledWith({
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: expect.objectContaining({ id: true, updatedAt: true }),
      take: 3,
      where: { archivedAt: null, workspaceId },
    });

    if (!result.nextCursor) {
      throw new Error('다음 페이지 커서가 필요합니다.');
    }
    database.client.label.findMany.mockResolvedValue([]);
    await service.list(workspaceId, {
      archivedOnly: false,
      cursor: result.nextCursor,
      includeArchived: true,
      limit: 2,
      query: '  기 능  ',
    });
    expect(database.client.label.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { name: { contains: '기 능', mode: 'insensitive' } },
            {
              OR: [
                { updatedAt: { lt: new Date('2026-07-11T01:00:00.000Z') } },
                {
                  id: { lt: secondLabelId },
                  updatedAt: new Date('2026-07-11T01:00:00.000Z'),
                },
              ],
            },
          ],
          workspaceId,
        },
      }),
    );
  });

  it('rejects a malformed cursor as INVALID_QUERY', async () => {
    await expect(
      service.list(workspaceId, {
        archivedOnly: false,
        cursor: 'not+a+cursor',
        includeArchived: false,
        limit: 50,
      }),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_QUERY' },
      status: HttpStatus.BAD_REQUEST,
    });
    expect(database.client.label.findMany).not.toHaveBeenCalled();
  });

  it('lists only archived labels when requested', async () => {
    database.client.label.findMany.mockResolvedValue([]);

    await service.list(workspaceId, {
      archivedOnly: true,
      includeArchived: true,
      limit: 20,
    });

    expect(database.client.label.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { archivedAt: { not: null }, workspaceId },
      }),
    );
  });

  it('normalizes the name and stores the color in uppercase', async () => {
    transaction.label.create.mockResolvedValue(label);

    await expect(
      service.create(workspaceId, { color: '#d84a4a', name: '  BUG  ' }),
    ).resolves.toEqual({
      archived: false,
      color: '#D84A4A',
      id: labelId,
      name: '버그',
      version: 1,
    });
    expect(transaction.label.create).toHaveBeenCalledWith({
      data: {
        color: '#D84A4A',
        name: 'BUG',
        normalizedName: 'bug',
        workspaceId,
      },
      select: expect.objectContaining({ id: true }),
    });
  });

  it('maps the active case-insensitive name constraint to LABEL_NAME_IN_USE', async () => {
    transaction.label.create.mockRejectedValue(uniqueConflict('labels_active_normalized_name_key'));

    await expect(
      service.create(workspaceId, { color: '#D84A4A', name: 'BUG' }),
    ).rejects.toMatchObject({
      response: { code: 'LABEL_NAME_IN_USE' },
      status: HttpStatus.CONFLICT,
    });
  });

  it('returns the latest version without changing a stale label update', async () => {
    transaction.label.findFirst.mockResolvedValue({ ...label, version: 4 });

    await expect(
      service.update(workspaceId, labelId, { color: '#00AAEE', version: 3 }),
    ).rejects.toMatchObject({
      response: { code: 'VERSION_CONFLICT', currentVersion: 4 },
      status: HttpStatus.CONFLICT,
    });
    expect(transaction.label.updateManyAndReturn).not.toHaveBeenCalled();
  });

  it('updates normalized fields with the version condition', async () => {
    transaction.label.findFirst.mockResolvedValue(label);
    transaction.label.updateManyAndReturn.mockResolvedValue([
      { ...label, color: '#00AAEE', name: '결함', version: 2 },
    ]);

    await expect(
      service.update(workspaceId, labelId, {
        color: '#00aaee',
        name: ' 결함 ',
        version: 1,
      }),
    ).resolves.toMatchObject({ color: '#00AAEE', name: '결함', version: 2 });
    expect(transaction.label.updateManyAndReturn).toHaveBeenCalledWith({
      data: {
        color: '#00AAEE',
        name: '결함',
        normalizedName: '결함',
        version: { increment: 1 },
      },
      select: expect.objectContaining({ id: true }),
      where: { id: labelId, version: 1, workspaceId },
    });
  });

  it('does not emit a resource change for an unchanged label', async () => {
    transaction.label.findFirst.mockResolvedValue(label);

    await expect(
      service.update(workspaceId, labelId, { color: label.color, name: label.name, version: 1 }),
    ).resolves.toMatchObject({ id: labelId, version: 1 });

    expect(transaction.label.updateManyAndReturn).not.toHaveBeenCalled();
    expect(transaction.$executeRaw).not.toHaveBeenCalled();
  });

  it('does not expose a label ID from another workspace', async () => {
    transaction.label.findFirst.mockResolvedValue(null);

    await expect(service.archive(workspaceId, labelId, { version: 1 })).rejects.toMatchObject({
      response: { code: 'RESOURCE_NOT_FOUND' },
      status: HttpStatus.NOT_FOUND,
    });
    expect(transaction.label.updateManyAndReturn).not.toHaveBeenCalled();
  });

  it('archives a label with an optimistic version condition', async () => {
    transaction.label.findFirst.mockResolvedValue(label);
    transaction.label.updateManyAndReturn.mockResolvedValue([
      { ...label, archivedAt: new Date('2026-07-11T03:00:00.000Z'), version: 2 },
    ]);

    await expect(service.archive(workspaceId, labelId, { version: 1 })).resolves.toMatchObject({
      archived: true,
      version: 2,
    });
    expect(transaction.label.updateManyAndReturn).toHaveBeenCalledWith({
      data: { archivedAt: expect.any(Date), version: { increment: 1 } },
      select: expect.objectContaining({ id: true }),
      where: { archivedAt: null, id: labelId, version: 1, workspaceId },
    });
    const payload = transaction.$executeRaw.mock.calls.at(-1)?.[2] as string;
    expect(JSON.parse(payload)).toMatchObject({
      changeType: 'UPDATED',
      resourceId: labelId,
      resourceType: 'LABEL',
      version: 2,
      workspaceId,
    });
  });
});
