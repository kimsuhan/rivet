import { HttpStatus } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { Prisma } from '@rivet/database';

import { DatabaseService } from '../../common/database/database.service';
import { TeamsService } from './teams.service';

describe('TeamsService management', () => {
  const workspaceId = '3dc0b213-eafa-450c-ad12-49a7d927c7b8';
  const teamId = '953685f0-4921-41cd-8422-d8a1ccc3f547';
  const membershipId = 'dd151af4-f97e-4cf2-ab03-43be72bb2782';
  const stateId = '05ed9724-f207-447d-9f18-7026f493d3fd';
  const replacementStateId = 'c5ef63e6-3f70-4caf-bb56-256486afbb84';
  const workflowState = {
    category: 'BACKLOG',
    id: stateId,
    isDefault: true,
    name: '미분류',
    position: 0,
    version: 1,
  };
  const teamResponseRow = {
    archivedAt: null,
    id: teamId,
    key: 'WEB',
    name: '프론트 웹',
    teamMembers: [{ membershipId }],
    version: 2,
    workflowStates: [workflowState],
  };
  const transaction = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    activityEvent: { createMany: jest.fn() },
    teamWork: { updateManyAndReturn: jest.fn() },
    team: {
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      updateManyAndReturn: jest.fn(),
    },
    teamMember: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    workflowState: {
      delete: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateManyAndReturn: jest.fn(),
    },
    workspaceMembership: { findFirst: jest.fn() },
  };
  const client = {
    $transaction: jest.fn(),
    team: {
      findFirst: transaction.team.findFirst,
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    workflowState: {
      findFirst: jest.fn(),
      findMany: transaction.workflowState.findMany,
      updateManyAndReturn: jest.fn(),
    },
  };
  const database = { client };
  let moduleRef: TestingModule;
  let service: TeamsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    client.$transaction.mockImplementation(
      async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction),
    );

    moduleRef = await Test.createTestingModule({
      providers: [TeamsService, { provide: DatabaseService, useValue: database }],
    }).compile();
    service = moduleRef.get(TeamsService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('lists only active teams by default with current member counts', async () => {
    client.team.findMany.mockResolvedValue([
      {
        _count: { teamMembers: 2 },
        archivedAt: null,
        id: teamId,
        key: 'WEB',
        name: '프론트 웹',
        version: 3,
      },
    ]);

    await expect(service.list(workspaceId, { includeArchived: false })).resolves.toEqual({
      items: [
        {
          archived: false,
          id: teamId,
          key: 'WEB',
          memberCount: 2,
          name: '프론트 웹',
          version: 3,
        },
      ],
      nextCursor: null,
    });
    expect(client.team.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { archivedAt: null, workspaceId } }),
    );
  });

  it('returns the current version without changing a stale team update', async () => {
    transaction.team.findFirst.mockResolvedValue({
      key: 'WEB',
      name: '프론트 웹',
      nextIssueNumber: 1,
      version: 4,
    });

    await expect(
      service.update(workspaceId, teamId, { name: '웹 플랫폼', version: 3 }),
    ).rejects.toMatchObject({
      response: { code: 'VERSION_CONFLICT', currentVersion: 4 },
      status: HttpStatus.CONFLICT,
    });
    expect(transaction.team.updateManyAndReturn).not.toHaveBeenCalled();
  });

  it('does not change a team key after an issue number was issued', async () => {
    transaction.team.findFirst.mockResolvedValue({
      key: 'WEB',
      name: '프론트 웹',
      nextIssueNumber: 2,
      version: 1,
    });

    await expect(
      service.update(workspaceId, teamId, { key: 'APP', version: 1 }),
    ).rejects.toMatchObject({
      response: { code: 'TEAM_KEY_LOCKED' },
      status: HttpStatus.CONFLICT,
    });
  });

  it('rejects adding an inactive or cross-workspace membership', async () => {
    transaction.$queryRaw.mockResolvedValue([]);

    await expect(service.addMember(workspaceId, teamId, membershipId)).rejects.toMatchObject({
      response: { code: 'RESOURCE_NOT_FOUND' },
      status: HttpStatus.NOT_FOUND,
    });
    expect(transaction.teamMember.upsert).not.toHaveBeenCalled();
  });

  it('reactivates a removed team member and increments the team version', async () => {
    transaction.$queryRaw.mockResolvedValue([{ teamId }]);
    transaction.team.findFirst.mockResolvedValue(teamResponseRow);
    transaction.teamMember.findUnique.mockResolvedValue({ removedAt: new Date() });
    transaction.teamMember.upsert.mockResolvedValue({});
    transaction.team.update.mockResolvedValue({ version: 2 });

    await expect(service.addMember(workspaceId, teamId, membershipId)).resolves.toMatchObject({
      id: teamId,
      memberIds: [membershipId],
      version: 2,
    });
    expect(transaction.teamMember.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ removedAt: null }),
        where: { teamId_membershipId: { membershipId, teamId } },
      }),
    );
    expect(transaction.team.update).toHaveBeenCalledWith({
      data: { version: { increment: 1 } },
      select: { version: true },
      where: { id: teamId },
    });
  });

  it('soft-removes a current team member in the team transaction', async () => {
    transaction.$queryRaw.mockResolvedValueOnce([{ membershipId }]).mockResolvedValueOnce([]);
    transaction.teamMember.update.mockResolvedValue({});
    transaction.team.update.mockResolvedValue({ version: 3 });

    await expect(service.removeMember(workspaceId, teamId, membershipId)).resolves.toBeUndefined();
    expect(transaction.teamMember.update).toHaveBeenCalledWith({
      data: { removedAt: expect.any(Date) },
      where: { teamId_membershipId: { membershipId, teamId } },
    });
    expect(transaction.team.update).toHaveBeenCalledWith({
      data: { version: { increment: 1 } },
      select: { version: true },
      where: { id: teamId },
    });
  });

  it('does not remove a team member with an unfinished assignment', async () => {
    const issue = { id: 'team-work-1', identifier: 'WEB-1', issueId: 'issue-1', title: '첫 작업' };
    transaction.$queryRaw.mockResolvedValueOnce([{ membershipId }]).mockResolvedValueOnce([issue]);

    await expect(service.removeMember(workspaceId, teamId, membershipId)).rejects.toMatchObject({
      response: { code: 'TEAM_MEMBER_HAS_OPEN_ASSIGNMENTS', details: { issues: [issue] } },
      status: HttpStatus.CONFLICT,
    });
    expect(transaction.teamMember.update).not.toHaveBeenCalled();
  });

  it('archives an unused team with an optimistic version condition', async () => {
    transaction.$queryRaw
      .mockResolvedValueOnce([{ archivedAt: null, version: 1 }])
      .mockResolvedValueOnce([]);
    transaction.team.findFirst.mockResolvedValue({
      ...teamResponseRow,
      archivedAt: new Date(),
      version: 2,
    });
    transaction.team.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.archive(workspaceId, teamId, { version: 1 })).resolves.toMatchObject({
      archived: true,
      version: 2,
    });
    expect(transaction.team.updateMany).toHaveBeenCalledWith({
      data: { archivedAt: expect.any(Date), version: { increment: 1 } },
      where: { archivedAt: null, id: teamId, version: 1, workspaceId },
    });
    const payload = transaction.$executeRaw.mock.calls.at(-1)?.[2] as string;
    expect(JSON.parse(payload)).toMatchObject({
      changeType: 'UPDATED',
      resourceId: teamId,
      resourceType: 'TEAM',
      version: 2,
      workspaceId,
    });
  });

  it('does not archive a team with unfinished issues', async () => {
    const issue = { id: 'team-work-1', identifier: 'WEB-1', issueId: 'issue-1', title: '첫 작업' };
    transaction.$queryRaw
      .mockResolvedValueOnce([{ archivedAt: null, version: 1 }])
      .mockResolvedValueOnce([issue]);

    await expect(service.archive(workspaceId, teamId, { version: 1 })).rejects.toMatchObject({
      response: { code: 'TEAM_HAS_OPEN_ISSUES', details: { issues: [issue] } },
      status: HttpStatus.CONFLICT,
    });
    expect(transaction.team.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a stale workflow state rename with the latest version', async () => {
    client.workflowState.findFirst.mockResolvedValue({ ...workflowState, version: 5 });

    await expect(
      service.updateWorkflowState(workspaceId, stateId, { name: '접수', version: 4 }),
    ).rejects.toMatchObject({
      response: { code: 'VERSION_CONFLICT', currentVersion: 5 },
      status: HttpStatus.CONFLICT,
    });
    expect(transaction.workflowState.updateManyAndReturn).not.toHaveBeenCalled();
  });

  it('returns a field validation error for a duplicate workflow state name', async () => {
    client.workflowState.findFirst.mockResolvedValue(workflowState);
    transaction.workflowState.updateManyAndReturn.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        clientVersion: '7.8.0',
        code: 'P2002',
        meta: { target: ['team_id', 'normalized_name'] },
      }),
    );

    await expect(
      service.updateWorkflowState(workspaceId, stateId, { name: '중복 상태', version: 1 }),
    ).rejects.toMatchObject({
      response: {
        code: 'VALIDATION_ERROR',
        fieldErrors: { name: ['같은 이름의 워크플로 상태가 이미 있습니다.'] },
      },
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });
  });

  it('reorders every workflow state through a collision-free temporary range', async () => {
    transaction.team.findFirst.mockResolvedValue({ id: teamId });
    transaction.$queryRaw.mockResolvedValue([
      { id: stateId, position: 0, version: 1 },
      { id: replacementStateId, position: 1, version: 2 },
    ]);
    transaction.workflowState.update
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ ...workflowState, id: replacementStateId, position: 0, version: 3 })
      .mockResolvedValueOnce({ ...workflowState, isDefault: true, position: 1, version: 2 });

    const result = await service.reorderWorkflowStates(workspaceId, teamId, {
      states: [
        { id: replacementStateId, version: 2 },
        { id: stateId, version: 1 },
      ],
    });

    expect(result.items.map(({ id }) => id)).toEqual([replacementStateId, stateId]);
    expect(transaction.workflowState.update).toHaveBeenNthCalledWith(1, {
      data: { position: 2 },
      where: { id: replacementStateId },
    });
    expect(transaction.workflowState.update).toHaveBeenNthCalledWith(3, {
      data: { position: 0, version: { increment: 1 } },
      select: expect.any(Object),
      where: { id: replacementStateId },
    });
  });

  it('rejects an incomplete workflow state order without writing positions', async () => {
    transaction.team.findFirst.mockResolvedValue({ id: teamId });
    transaction.$queryRaw.mockResolvedValue([
      { id: stateId, position: 0, version: 1 },
      { id: replacementStateId, position: 1, version: 1 },
    ]);

    await expect(
      service.reorderWorkflowStates(workspaceId, teamId, {
        states: [{ id: stateId, version: 1 }],
      }),
    ).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR' },
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });
    expect(transaction.workflowState.update).not.toHaveBeenCalled();
  });

  it('transfers the default marker before deleting an unused default state', async () => {
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: stateId, isDefault: true, name: '미분류', teamId, version: 1 }])
      .mockResolvedValueOnce([
        { id: stateId, name: '미분류', position: 0, version: 1 },
        { id: replacementStateId, name: '할 일', position: 1, version: 1 },
      ])
      .mockResolvedValueOnce([]);
    transaction.workflowState.update.mockResolvedValue({});
    transaction.workflowState.delete.mockResolvedValue({});

    await expect(
      service.deleteWorkflowState({ membershipId, workspaceId }, stateId, {
        replacementStateId,
        version: 1,
      }),
    ).resolves.toBeUndefined();
    expect(transaction.workflowState.delete).toHaveBeenCalledWith({ where: { id: stateId } });
    expect(transaction.workflowState.update).toHaveBeenNthCalledWith(1, {
      data: { position: 2 },
      where: { id: replacementStateId },
    });
    expect(transaction.workflowState.update).toHaveBeenNthCalledWith(2, {
      data: { isDefault: true, position: 0, version: { increment: 1 } },
      where: { id: replacementStateId },
    });
  });

  it('requires a replacement before deleting a state used by issues', async () => {
    const issue = {
      id: 'team-work-1',
      identifier: 'WEB-1',
      issueId: 'issue-1',
      title: '첫 작업',
    };
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: stateId, isDefault: false, name: '보류', teamId, version: 1 }])
      .mockResolvedValueOnce([
        { id: stateId, name: '보류', position: 0, version: 1 },
        { id: replacementStateId, name: '할 일', position: 1, version: 1 },
      ])
      .mockResolvedValueOnce([issue]);

    await expect(
      service.deleteWorkflowState({ membershipId, workspaceId }, stateId, { version: 1 }),
    ).rejects.toMatchObject({
      response: { code: 'WORKFLOW_STATE_IN_USE', details: { issues: [issue] } },
      status: HttpStatus.CONFLICT,
    });
    expect(transaction.workflowState.delete).not.toHaveBeenCalled();
  });

  it('moves locked issues and records activities before deleting their state', async () => {
    const issue = {
      id: 'team-work-1',
      identifier: 'WEB-1',
      issueId: 'issue-1',
      title: '첫 작업',
    };
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: stateId, isDefault: false, name: '보류', teamId, version: 1 }])
      .mockResolvedValueOnce([
        { id: stateId, name: '보류', position: 0, version: 1 },
        { id: replacementStateId, name: '할 일', position: 1, version: 1 },
      ])
      .mockResolvedValueOnce([issue]);
    transaction.teamWork.updateManyAndReturn.mockResolvedValue([{ id: issue.id, version: 2 }]);
    transaction.activityEvent.createMany.mockResolvedValue({ count: 1 });
    transaction.workflowState.delete.mockResolvedValue({});

    await expect(
      service.deleteWorkflowState({ membershipId, workspaceId }, stateId, {
        replacementStateId,
        version: 1,
      }),
    ).resolves.toBeUndefined();
    expect(transaction.teamWork.updateManyAndReturn).toHaveBeenCalledWith({
      data: { version: { increment: 1 }, workflowStateId: replacementStateId },
      select: { id: true, version: true },
      where: { id: { in: [issue.id] }, workspaceId },
    });
    expect(transaction.activityEvent.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          actorMembershipId: membershipId,
          eventType: 'TEAM_WORK_CHANGED',
          fieldName: 'workflowStateId',
          issueId: issue.issueId,
          teamWorkId: issue.id,
          workspaceId,
        }),
      ],
    });
    const issuePayload = transaction.$executeRaw.mock.calls
      .map((call) => JSON.parse(call[2] as string) as { resourceType: string })
      .find(({ resourceType }) => resourceType === 'TEAM_WORK');
    expect(issuePayload).toMatchObject({
      changeType: 'UPDATED',
      resourceId: issue.id,
      resourceType: 'TEAM_WORK',
      version: 2,
      workspaceId,
    });
    expect(transaction.workflowState.delete).toHaveBeenCalledWith({ where: { id: stateId } });
  });
});
