import { HttpStatus } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { IssuePriority } from '@rivet/database';

import { DatabaseService } from '../../common/database/database.service';
import { IssueTemplatesService } from './issue-templates.service';

describe('IssueTemplatesService', () => {
  const workspaceId = '3dc0b213-eafa-450c-ad12-49a7d927c7b8';
  const templateId = '953685f0-4921-41cd-8422-d8a1ccc3f547';
  const labelId = '05ed9724-f207-447d-9f18-7026f493d3fd';
  const projectId = 'c5ef63e6-3f70-4caf-bb56-256486afbb84';
  const initialProjectTeamId = '9d2b632a-5ac1-493a-bcce-ec8f55043a75';
  const template = {
    archivedAt: null,
    descriptionMarkdown: '## 재현 절차',
    id: templateId,
    initialProjectTeamId,
    labels: [{ labelId }],
    name: '버그 신고',
    normalizedName: '버그 신고',
    priority: IssuePriority.HIGH,
    projectId,
    updatedAt: new Date('2026-07-17T00:00:00.000Z'),
    version: 1,
    workspaceId,
  };
  const transaction = {
    $queryRaw: jest.fn(),
    issueTemplate: {
      create: jest.fn(),
      findFirst: jest.fn(),
      updateManyAndReturn: jest.fn(),
    },
    issueTemplateLabel: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    label: { findMany: jest.fn() },
    project: { findMany: jest.fn() },
    projectTeam: { findFirst: jest.fn(), findMany: jest.fn() },
  };
  const database = {
    client: {
      $transaction: jest.fn(),
      issueTemplate: { findFirst: jest.fn(), findMany: jest.fn() },
      label: { findMany: jest.fn() },
      project: { findMany: jest.fn() },
      projectTeam: { findMany: jest.fn() },
    },
  };
  let moduleRef: TestingModule;
  let service: IssueTemplatesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    database.client.$transaction.mockImplementation(
      async (operation: (client: typeof transaction) => Promise<unknown>) => operation(transaction),
    );
    moduleRef = await Test.createTestingModule({
      providers: [IssueTemplatesService, { provide: DatabaseService, useValue: database }],
    }).compile();
    service = moduleRef.get(IssueTemplatesService);
  });

  afterEach(async () => moduleRef.close());

  it('allows active members to list only active templates and resolves availability', async () => {
    database.client.issueTemplate.findMany.mockResolvedValue([template]);
    database.client.label.findMany.mockResolvedValue([{ archivedAt: null, id: labelId }]);
    database.client.project.findMany.mockResolvedValue([
      { archivedAt: null, deletedAt: null, id: projectId },
    ]);
    database.client.projectTeam.findMany.mockResolvedValue([
      {
        id: initialProjectTeamId,
        isActive: true,
        projectId,
        team: { archivedAt: null },
      },
    ]);

    await expect(service.list(workspaceId, false, 'MEMBER')).resolves.toEqual({
      items: [
        expect.objectContaining({
          available: true,
          id: templateId,
          unavailableReason: null,
        }),
      ],
    });
    expect(database.client.issueTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { archivedAt: null, workspaceId } }),
    );
  });

  it('does not let a regular member include archived templates', async () => {
    await expect(service.list(workspaceId, true, 'MEMBER')).rejects.toMatchObject({
      response: { code: 'FORBIDDEN' },
      status: HttpStatus.FORBIDDEN,
    });
    expect(database.client.issueTemplate.findMany).not.toHaveBeenCalled();
  });

  it('normalizes and stores an independent template snapshot', async () => {
    const created = {
      ...template,
      initialProjectTeamId: null,
      labels: [],
      name: '기능 요청',
      normalizedName: '기능 요청',
      priority: IssuePriority.NONE,
      projectId: null,
    };
    transaction.issueTemplate.create.mockResolvedValue({ id: templateId });
    transaction.issueTemplate.findFirst.mockResolvedValue(created);

    await expect(
      service.create(workspaceId, {
        descriptionMarkdown: '  ## 요청 내용  ',
        name: '  기능 요청  ',
      }),
    ).resolves.toMatchObject({
      available: true,
      descriptionMarkdown: created.descriptionMarkdown,
      name: '기능 요청',
      version: 1,
    });
    expect(transaction.issueTemplate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        descriptionMarkdown: '## 요청 내용',
        name: '기능 요청',
        normalizedName: '기능 요청',
        workspaceId,
      }),
      select: { id: true },
    });
  });

  it('rejects uploaded file image references because templates do not own files', async () => {
    await expect(
      service.create(workspaceId, {
        descriptionMarkdown: `![재현 화면](/files/${labelId})`,
        name: '이미지 포함 템플릿',
      }),
    ).rejects.toMatchObject({
      response: { code: 'MARKDOWN_INVALID' },
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });
    expect(database.client.$transaction).not.toHaveBeenCalled();
  });

  it('requires a project when an initial project team is configured', async () => {
    await expect(
      service.create(workspaceId, {
        descriptionMarkdown: '## 작업 내용',
        initialProjectTeamId: projectId,
        name: '역할만 있는 템플릿',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'VALIDATION_ERROR',
        fieldErrors: { initialProjectTeamId: expect.any(Array) },
      },
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });
    expect(database.client.$transaction).not.toHaveBeenCalled();
  });

  it('does not overwrite a stale template update', async () => {
    transaction.$queryRaw.mockResolvedValue([{ archivedAt: null, version: 4 }]);

    await expect(
      service.update(workspaceId, templateId, { name: '오래된 변경', version: 3 }),
    ).rejects.toMatchObject({
      response: { code: 'VERSION_CONFLICT', currentVersion: 4 },
      status: HttpStatus.CONFLICT,
    });
    expect(transaction.issueTemplate.updateManyAndReturn).not.toHaveBeenCalled();
    expect(transaction.issueTemplateLabel.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects both no-op and changed updates at the current archived version', async () => {
    transaction.$queryRaw.mockResolvedValue([
      { archivedAt: new Date('2026-07-17T01:00:00.000Z'), version: 2 },
    ]);

    for (const name of [template.name, '보관 후 변경']) {
      await expect(
        service.update(workspaceId, templateId, { name, version: 2 }),
      ).rejects.toMatchObject({
        response: {
          code: 'ISSUE_TEMPLATE_UNAVAILABLE',
          details: { unavailableReason: 'ARCHIVED' },
        },
        status: HttpStatus.CONFLICT,
      });
    }
    expect(transaction.issueTemplate.findFirst).not.toHaveBeenCalled();
    expect(transaction.issueTemplate.updateManyAndReturn).not.toHaveBeenCalled();
    expect(transaction.issueTemplateLabel.deleteMany).not.toHaveBeenCalled();
  });

  it('reports the current version before archived state for a stale update', async () => {
    transaction.$queryRaw.mockResolvedValue([
      { archivedAt: new Date('2026-07-17T01:00:00.000Z'), version: 2 },
    ]);

    await expect(
      service.update(workspaceId, templateId, { name: '오래된 변경', version: 1 }),
    ).rejects.toMatchObject({
      response: { code: 'VERSION_CONFLICT', currentVersion: 2 },
      status: HttpStatus.CONFLICT,
    });
    expect(transaction.issueTemplate.findFirst).not.toHaveBeenCalled();
    expect(transaction.issueTemplate.updateManyAndReturn).not.toHaveBeenCalled();
    expect(transaction.issueTemplateLabel.deleteMany).not.toHaveBeenCalled();
  });

  it('restores an archived template only after revalidating its current targets', async () => {
    const archived = {
      ...template,
      archivedAt: new Date('2026-07-17T01:00:00.000Z'),
      version: 3,
    };
    const restored = { ...archived, archivedAt: null, version: 4 };
    transaction.$queryRaw
      .mockResolvedValueOnce([{ archivedAt: archived.archivedAt, version: 3 }])
      .mockResolvedValueOnce([{ id: labelId }])
      .mockResolvedValueOnce([{ id: projectId }])
      .mockResolvedValueOnce([{ teamId: initialProjectTeamId }]);
    transaction.issueTemplate.findFirst
      .mockResolvedValueOnce(archived)
      .mockResolvedValueOnce(restored);
    transaction.issueTemplate.updateManyAndReturn.mockResolvedValue([{ id: templateId }]);

    await expect(service.restore(workspaceId, templateId, { version: 3 })).resolves.toMatchObject({
      archived: false,
      available: true,
      id: templateId,
      version: 4,
    });
    expect(transaction.issueTemplate.updateManyAndReturn).toHaveBeenCalledWith({
      data: { archivedAt: null, version: { increment: 1 } },
      select: { id: true },
      where: {
        archivedAt: { not: null },
        id: templateId,
        version: 3,
        workspaceId,
      },
    });
  });

  it('does not restore an archived template with an unavailable target', async () => {
    transaction.$queryRaw
      .mockResolvedValueOnce([{ archivedAt: new Date('2026-07-17T01:00:00.000Z'), version: 3 }])
      .mockResolvedValueOnce([]);
    transaction.issueTemplate.findFirst.mockResolvedValue({
      ...template,
      archivedAt: new Date('2026-07-17T01:00:00.000Z'),
      version: 3,
    });

    await expect(service.restore(workspaceId, templateId, { version: 3 })).rejects.toMatchObject({
      response: {
        code: 'ISSUE_TEMPLATE_TARGET_UNAVAILABLE',
        details: { unavailableReason: 'LABEL_UNAVAILABLE' },
      },
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });
    expect(transaction.issueTemplate.updateManyAndReturn).not.toHaveBeenCalled();
  });

  it('does not restore a stale archived template version', async () => {
    transaction.$queryRaw.mockResolvedValue([
      { archivedAt: new Date('2026-07-17T01:00:00.000Z'), version: 4 },
    ]);

    await expect(service.restore(workspaceId, templateId, { version: 3 })).rejects.toMatchObject({
      response: { code: 'VERSION_CONFLICT', currentVersion: 4 },
      status: HttpStatus.CONFLICT,
    });
    expect(transaction.issueTemplate.findFirst).not.toHaveBeenCalled();
    expect(transaction.issueTemplate.updateManyAndReturn).not.toHaveBeenCalled();
  });

  it('returns an apply snapshot without writing server state', async () => {
    transaction.$queryRaw
      .mockResolvedValueOnce([{ archivedAt: null, version: 1 }])
      .mockResolvedValueOnce([{ id: labelId }])
      .mockResolvedValueOnce([{ id: projectId }])
      .mockResolvedValueOnce([{ teamId: initialProjectTeamId }]);
    transaction.issueTemplate.findFirst.mockResolvedValue(template);

    await expect(service.apply(workspaceId, templateId, { version: 1 })).resolves.toMatchObject({
      available: true,
      descriptionMarkdown: template.descriptionMarkdown,
      id: templateId,
      labelIds: [labelId],
      version: 1,
    });
    expect(transaction.issueTemplate.updateManyAndReturn).not.toHaveBeenCalled();
    expect(transaction.issueTemplateLabel.createMany).not.toHaveBeenCalled();
    expect(transaction.issueTemplateLabel.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects archived and currently invalid templates without losing recovery metadata', async () => {
    transaction.$queryRaw.mockResolvedValueOnce([
      { archivedAt: new Date('2026-07-17T01:00:00.000Z'), version: 2 },
    ]);
    await expect(service.apply(workspaceId, templateId, { version: 2 })).rejects.toMatchObject({
      response: {
        code: 'ISSUE_TEMPLATE_UNAVAILABLE',
        details: { unavailableReason: 'ARCHIVED' },
      },
      status: HttpStatus.CONFLICT,
    });

    transaction.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ archivedAt: null, version: 1 }])
      .mockResolvedValueOnce([]);
    transaction.issueTemplate.findFirst.mockResolvedValue(template);
    await expect(service.apply(workspaceId, templateId, { version: 1 })).rejects.toMatchObject({
      response: {
        code: 'ISSUE_TEMPLATE_TARGET_UNAVAILABLE',
        details: { unavailableReason: 'LABEL_UNAVAILABLE' },
      },
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });
  });
});
