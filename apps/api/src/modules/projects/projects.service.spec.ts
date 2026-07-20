import { HttpStatus } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { MembershipRole, ProjectStatus } from '@rivet/database';

import { DatabaseService } from '../../common/database/database.service';
import { ProjectRepository } from './project.repository';
import { ProjectQueryService } from './project-query.service';
import { ProjectsService } from './projects.service';

describe('ProjectsService', () => {
  const context = {
    membershipId: '2e0792d5-eac3-44c1-87c7-56f07ebaa620',
    membershipRole: MembershipRole.ADMIN,
    workspaceId: '3dc0b213-eafa-450c-ad12-49a7d927c7b8',
  };
  const projectId = '953685f0-4921-41cd-8422-d8a1ccc3f547';
  const secondProjectId = '05ed9724-f207-447d-9f18-7026f493d3fd';
  const thirdProjectId = 'c5ef63e6-3f70-4caf-bb56-256486afbb84';
  const leadMembershipId = 'dd151af4-f97e-4cf2-ab03-43be72bb2782';
  const teamId = 'fa0b2a20-4077-4e13-b04e-7ec7306cd988';
  const otherTeamId = 'd415fc6b-4531-459a-898f-82659e5f24bb';
  const projectTeamId = '22846213-d248-492b-ac7c-652873531fb2';
  const project = {
    archivedAt: null,
    createdAt: new Date('2026-07-11T01:00:00.000Z'),
    description: '결제 흐름을 개편한다.',
    id: projectId,
    leadMembership: {
      id: leadMembershipId,
      role: 'MEMBER' as const,
      status: 'ACTIVE' as const,
      user: { displayName: '프로젝트 리드', id: '896b0246-18d1-476b-b1d6-7ecfa6ea9f79' },
    },
    name: '결제 개편',
    projectTeams: [
      {
        deactivatedAt: null,
        id: projectTeamId,
        isActive: true,
        team: { archivedAt: null, id: teamId, key: 'API', name: 'API 팀' },
      },
    ],
    startDate: new Date('2026-07-15T00:00:00.000Z'),
    status: ProjectStatus.PLANNED,
    targetDate: new Date('2026-08-15T00:00:00.000Z'),
    updatedAt: new Date('2026-07-11T02:00:00.000Z'),
    version: 1,
  };
  const lockedProject = {
    archivedAt: null,
    description: project.description,
    id: projectId,
    leadMembershipId,
    name: project.name,
    startDate: project.startDate,
    status: ProjectStatus.PLANNED,
    targetDate: project.targetDate,
    version: 1,
  };
  const transaction = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    activityEvent: { create: jest.fn(), createMany: jest.fn() },
    issue: { findMany: jest.fn() },
    outboxEvent: { create: jest.fn() },
    project: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    projectTeam: {
      createMany: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
    },
    teamWork: { findMany: jest.fn() },
  };
  const database = {
    client: {
      $queryRaw: jest.fn(),
      $transaction: jest.fn(),
      project: { findFirst: jest.fn(), findMany: jest.fn() },
    },
  };
  let moduleRef: TestingModule;
  let queries: ProjectQueryService;
  let service: ProjectsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    database.client.$transaction.mockImplementation(
      async (operation: (client: typeof transaction) => Promise<unknown>) => operation(transaction),
    );
    transaction.project.create.mockResolvedValue({ id: projectId });
    transaction.project.findFirst.mockResolvedValue(project);
    transaction.project.update.mockResolvedValue({ id: projectId });
    transaction.projectTeam.findMany.mockResolvedValue([
      { id: projectTeamId, isActive: true, teamId },
    ]);
    transaction.projectTeam.createMany.mockResolvedValue({ count: 1 });
    transaction.projectTeam.updateMany.mockResolvedValue({ count: 1 });
    transaction.projectTeam.upsert.mockResolvedValue({ id: projectTeamId });
    transaction.activityEvent.create.mockResolvedValue({ id: 'activity-1' });
    transaction.activityEvent.createMany.mockResolvedValue({ count: 1 });
    transaction.issue.findMany.mockResolvedValue([]);
    transaction.teamWork.findMany.mockResolvedValue([]);
    transaction.outboxEvent.create.mockResolvedValue({ id: 'outbox-id' });

    moduleRef = await Test.createTestingModule({
      providers: [
        ProjectQueryService,
        ProjectRepository,
        ProjectsService,
        { provide: DatabaseService, useValue: database },
      ],
    }).compile();
    queries = moduleRef.get(ProjectQueryService);
    service = moduleRef.get(ProjectsService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('lists projects by updatedAt by default and emits an opaque stable cursor', async () => {
    const second = {
      ...project,
      id: secondProjectId,
      name: '두 번째 프로젝트',
      updatedAt: new Date('2026-07-11T01:30:00.000Z'),
    };
    database.client.project.findMany.mockResolvedValue([
      project,
      second,
      {
        ...project,
        id: thirdProjectId,
        name: '세 번째 프로젝트',
        updatedAt: new Date('2026-07-11T01:00:00.000Z'),
      },
    ]);
    database.client.$queryRaw.mockResolvedValue([
      { completed: 2n, projectId, total: 3n },
      { completed: 0n, projectId: secondProjectId, total: 0n },
    ]);

    const result = await queries.list(context.workspaceId, { includeArchived: false, limit: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.progress).toEqual({ completed: 2, percentage: 67, total: 3 });
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(result.nextCursor).not.toContain(secondProjectId);
    expect(database.client.project.findMany).toHaveBeenCalledWith({
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: expect.objectContaining({ id: true, projectTeams: expect.any(Object) }),
      take: 3,
      where: { archivedAt: null, deletedAt: null, workspaceId: context.workspaceId },
    });

    if (!result.nextCursor) throw new Error('다음 페이지 커서가 필요합니다.');
    database.client.project.findMany.mockResolvedValue([]);
    database.client.$queryRaw.mockResolvedValue([]);
    await queries.list(context.workspaceId, {
      cursor: result.nextCursor,
      includeArchived: true,
      limit: 2,
    });
    expect(database.client.project.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              OR: [
                { updatedAt: { lt: second.updatedAt } },
                { id: { lt: secondProjectId }, updatedAt: second.updatedAt },
              ],
            },
          ],
          deletedAt: null,
          workspaceId: context.workspaceId,
        },
      }),
    );
  });

  it('keeps targetDate null values last and paginates inside the null segment', async () => {
    const nullTarget = { ...project, id: secondProjectId, targetDate: null };
    database.client.project.findMany.mockResolvedValue([
      project,
      nullTarget,
      { ...nullTarget, id: thirdProjectId },
    ]);
    database.client.$queryRaw.mockResolvedValue([]);

    const first = await queries.list(context.workspaceId, {
      includeArchived: false,
      limit: 2,
      sort: 'targetDate',
      sortDirection: 'asc',
    });
    if (!first.nextCursor) throw new Error('다음 페이지 커서가 필요합니다.');

    database.client.project.findMany.mockResolvedValue([]);
    await queries.list(context.workspaceId, {
      cursor: first.nextCursor,
      includeArchived: false,
      limit: 2,
      sort: 'targetDate',
      sortDirection: 'asc',
    });
    expect(database.client.project.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        orderBy: [{ targetDate: { nulls: 'last', sort: 'asc' } }, { id: 'asc' }],
        where: expect.objectContaining({
          AND: [{ id: { gt: secondProjectId }, targetDate: null }],
        }),
      }),
    );
  });

  it('normalizes input and creates project teams and activity atomically', async () => {
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: context.workspaceId }])
      .mockResolvedValueOnce([{ id: leadMembershipId, status: 'ACTIVE' }])
      .mockResolvedValueOnce([{ archivedAt: null, id: teamId }]);

    const result = await service.create(context, {
      description: '  결제 흐름을 개편한다.  ',
      leadMembershipId,
      name: '  결제 개편  ',
      teamIds: [teamId],
      startDate: '2026-07-15',
      targetDate: '2026-08-15',
    });

    expect(result).toMatchObject({ name: '결제 개편', progress: { percentage: 0 }, version: 1 });
    const workspaceLock = transaction.$queryRaw.mock.calls[0]?.[0] as string[] | undefined;
    expect(workspaceLock?.join('')).toContain('FROM "workspaces"');
    expect(transaction.project.create).toHaveBeenCalledWith({
      data: {
        description: '결제 흐름을 개편한다.',
        leadMembershipId,
        name: '결제 개편',
        startDate: new Date('2026-07-15T00:00:00.000Z'),
        status: ProjectStatus.PLANNED,
        targetDate: new Date('2026-08-15T00:00:00.000Z'),
        workspaceId: context.workspaceId,
      },
      select: { id: true },
    });
    expect(transaction.projectTeam.createMany).toHaveBeenCalledWith({
      data: [{ projectId, teamId, workspaceId: context.workspaceId }],
    });
    expect(transaction.activityEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ eventType: 'PROJECT_CREATED', projectId }),
    });
    const payload = transaction.$executeRaw.mock.calls[0]?.[2] as string;
    expect(JSON.parse(payload)).toMatchObject({
      changeType: 'CREATED',
      resourceId: projectId,
      resourceType: 'PROJECT',
      version: 1,
      workspaceId: context.workspaceId,
    });
    expect(transaction.outboxEvent.create).toHaveBeenCalledWith({
      data: {
        actorMembershipId: context.membershipId,
        aggregateId: projectId,
        aggregateType: 'PROJECT',
        eventType: 'PROJECT_CREATED',
        id: expect.any(String),
        payload: {
          hasTargetDate: true,
          schemaVersion: 2,
          teamCount: 1,
        },
        workspaceId: context.workspaceId,
      },
    });
  });

  it('rejects a target date before the start date without opening a transaction', async () => {
    await expect(
      service.create(context, {
        name: '잘못된 일정',
        teamIds: [teamId],
        startDate: '2026-08-01',
        targetDate: '2026-07-31',
      }),
    ).rejects.toMatchObject({
      response: { code: 'PROJECT_DATE_INVALID' },
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });
    expect(database.client.$transaction).not.toHaveBeenCalled();
  });

  it('returns the latest version without changing a stale project', async () => {
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: context.workspaceId }])
      .mockResolvedValueOnce([{ ...lockedProject, version: 4 }]);

    await expect(
      service.update(context, projectId, { name: '새 이름', version: 3 }),
    ).rejects.toMatchObject({
      response: { code: 'VERSION_CONFLICT', currentVersion: 4 },
      status: HttpStatus.CONFLICT,
    });
    expect(transaction.project.update).not.toHaveBeenCalled();
  });

  it('returns blocking issue details when excluding an in-use project team', async () => {
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: context.workspaceId }])
      .mockResolvedValueOnce([lockedProject])
      .mockResolvedValueOnce([{ archivedAt: null, id: otherTeamId }]);
    transaction.teamWork.findMany.mockResolvedValue([
      {
        id: '33490c3c-433a-47eb-81b7-d6d7d85294cf',
        identifier: 'API-42',
        issue: { title: '결제 API' },
        projectTeamId,
        team: { id: teamId, key: 'API', name: 'API 팀' },
      },
    ]);

    await expect(
      service.update(context, projectId, {
        teamIds: [otherTeamId],
        version: 1,
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'PROJECT_TEAM_IN_USE',
        details: { issues: [expect.objectContaining({ identifier: 'API-42' })] },
      },
      status: HttpStatus.CONFLICT,
    });
    expect(transaction.projectTeam.updateMany).not.toHaveBeenCalled();
    expect(transaction.project.update).not.toHaveBeenCalled();
  });

  it('deactivates and reactivates only changed project teams and records activities atomically', async () => {
    const updatedProject = {
      ...project,
      name: '결제 전면 개편',
      projectTeams: [
        {
          deactivatedAt: null,
          id: 'project-team-other',
          isActive: true,
          team: { archivedAt: null, id: otherTeamId, key: 'BE', name: '백엔드 팀' },
        },
      ],
      status: ProjectStatus.IN_PROGRESS,
      version: 2,
    };
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: context.workspaceId }])
      .mockResolvedValueOnce([lockedProject])
      .mockResolvedValueOnce([{ archivedAt: null, id: otherTeamId }])
      .mockResolvedValueOnce([{ completed: 1n, projectId, total: 2n }]);
    transaction.project.findFirst.mockResolvedValue(updatedProject);

    const result = await service.update(context, projectId, {
      name: '결제 전면 개편',
      teamIds: [otherTeamId],
      status: ProjectStatus.IN_PROGRESS,
      version: 1,
    });

    expect(result).toMatchObject({
      name: '결제 전면 개편',
      progress: { completed: 1, percentage: 50, total: 2 },
      version: 2,
    });
    expect(transaction.projectTeam.updateMany).toHaveBeenCalledWith({
      data: { deactivatedAt: expect.any(Date), isActive: false },
      where: {
        isActive: true,
        projectId,
        teamId: { notIn: [otherTeamId] },
        workspaceId: context.workspaceId,
      },
    });
    expect(transaction.projectTeam.upsert).toHaveBeenCalledWith({
      create: { projectId, teamId: otherTeamId, workspaceId: context.workspaceId },
      update: { deactivatedAt: null, isActive: true },
      where: { projectId_teamId: { projectId, teamId: otherTeamId } },
    });
    expect(transaction.activityEvent.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ eventType: 'PROJECT_UPDATED', fieldName: 'name' }),
        expect.objectContaining({ eventType: 'PROJECT_UPDATED', fieldName: 'status' }),
        expect.objectContaining({ eventType: 'PROJECT_UPDATED', fieldName: 'projectTeams' }),
      ]),
    });
    const payload = transaction.$executeRaw.mock.calls[0]?.[2] as string;
    expect(JSON.parse(payload)).toMatchObject({
      changeType: 'UPDATED',
      resourceId: projectId,
      resourceType: 'PROJECT',
      version: 2,
      workspaceId: context.workspaceId,
    });
    expect(transaction.outboxEvent.create).toHaveBeenCalledWith({
      data: {
        actorMembershipId: context.membershipId,
        aggregateId: projectId,
        aggregateType: 'PROJECT',
        eventType: 'PROJECT_STATUS_CHANGED',
        id: expect.any(String),
        payload: {
          fromStatus: ProjectStatus.PLANNED,
          progress: 50,
          schemaVersion: 1,
          toStatus: ProjectStatus.IN_PROGRESS,
        },
        workspaceId: context.workspaceId,
      },
    });
  });

  it('does not emit a resource change for an unchanged project', async () => {
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: context.workspaceId }])
      .mockResolvedValueOnce([lockedProject])
      .mockResolvedValueOnce([]);

    await expect(
      service.update(context, projectId, { name: project.name, version: 1 }),
    ).resolves.toMatchObject({ id: projectId, version: 1 });

    expect(transaction.project.update).not.toHaveBeenCalled();
    expect(transaction.$executeRaw).not.toHaveBeenCalled();
  });

  it('hides a project from another workspace', async () => {
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: context.workspaceId }])
      .mockResolvedValueOnce([]);

    await expect(service.archive(context, projectId, { version: 1 })).rejects.toMatchObject({
      response: { code: 'RESOURCE_NOT_FOUND' },
      status: HttpStatus.NOT_FOUND,
    });
    expect(transaction.project.update).not.toHaveBeenCalled();
  });

  it('archives a project and records the activity in the same transaction', async () => {
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: context.workspaceId }])
      .mockResolvedValueOnce([lockedProject])
      .mockResolvedValueOnce([{ completed: 0n, projectId, total: 1n }]);
    transaction.project.findFirst.mockResolvedValue({
      ...project,
      archivedAt: new Date('2026-07-11T03:00:00.000Z'),
      version: 2,
    });

    await expect(service.archive(context, projectId, { version: 1 })).resolves.toMatchObject({
      archived: true,
      version: 2,
    });
    expect(transaction.project.update).toHaveBeenCalledWith({
      data: { archivedAt: expect.any(Date), version: { increment: 1 } },
      where: { workspaceId_id: { id: projectId, workspaceId: context.workspaceId } },
    });
    expect(transaction.activityEvent.create).toHaveBeenCalledWith({
      data: {
        actorMembershipId: context.membershipId,
        eventType: 'PROJECT_ARCHIVED',
        projectId,
        workspaceId: context.workspaceId,
      },
    });
    const payload = transaction.$executeRaw.mock.calls[0]?.[2] as string;
    expect(JSON.parse(payload)).toMatchObject({
      changeType: 'UPDATED',
      resourceId: projectId,
      resourceType: 'PROJECT',
      version: 2,
      workspaceId: context.workspaceId,
    });
  });

  it('does not emit another resource change for an already archived project', async () => {
    const archivedAt = new Date('2026-07-11T03:00:00.000Z');
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: context.workspaceId }])
      .mockResolvedValueOnce([{ ...lockedProject, archivedAt, version: 2 }])
      .mockResolvedValueOnce([]);
    transaction.project.findFirst.mockResolvedValue({ ...project, archivedAt, version: 2 });

    await expect(service.archive(context, projectId, { version: 2 })).resolves.toMatchObject({
      archived: true,
      version: 2,
    });

    expect(transaction.project.update).not.toHaveBeenCalled();
    expect(transaction.$executeRaw).not.toHaveBeenCalled();
  });
});
