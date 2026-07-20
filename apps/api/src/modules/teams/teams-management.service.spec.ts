import { HttpStatus } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { Prisma, StateCategory, TeamMemberRole, WorkflowStateColor } from '@rivet/database';

import { DatabaseService } from '../../common/database/database.service';
import { TeamRepository } from './team.repository';
import { TeamManagementPolicy } from './team-management.policy';
import { TeamQueryService } from './team-query.service';
import { TeamsService } from './teams.service';
import { WorkflowStatesService } from './workflow-states.service';

describe('TeamsService management', () => {
  const workspaceId = '3dc0b213-eafa-450c-ad12-49a7d927c7b8';
  const teamId = '953685f0-4921-41cd-8422-d8a1ccc3f547';
  const membershipId = 'dd151af4-f97e-4cf2-ab03-43be72bb2782';
  const adminContext = { membershipId, role: 'ADMIN' as const, workspaceId };
  const stateId = '05ed9724-f207-447d-9f18-7026f493d3fd';
  const replacementStateId = 'c5ef63e6-3f70-4caf-bb56-256486afbb84';
  const workflowState = {
    category: 'BACKLOG',
    color: null,
    disabledAt: null,
    id: stateId,
    isDefault: true,
    name: '미분류',
    position: 0,
    version: 1,
  };
  const teamResponseRow = {
    archivedAt: null,
    description: null,
    id: teamId,
    key: 'WEB',
    name: '프론트 웹',
    teamMembers: [{ membershipId, role: 'MEMBER' }],
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
      create: jest.fn(),
      delete: jest.fn(),
      findFirst: jest.fn(),
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
  const management = { assertCanManageTeam: jest.fn() };
  let moduleRef: TestingModule;
  let queries: TeamQueryService;
  let service: TeamsService;
  let workflowStates: WorkflowStatesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    client.$transaction.mockImplementation(
      async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction),
    );
    management.assertCanManageTeam.mockResolvedValue(undefined);

    moduleRef = await Test.createTestingModule({
      providers: [
        TeamQueryService,
        TeamRepository,
        TeamsService,
        WorkflowStatesService,
        { provide: DatabaseService, useValue: database },
        { provide: TeamManagementPolicy, useValue: management },
      ],
    }).compile();
    queries = moduleRef.get(TeamQueryService);
    service = moduleRef.get(TeamsService);
    workflowStates = moduleRef.get(WorkflowStatesService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('lists only active teams by default with current member counts', async () => {
    client.team.findMany.mockResolvedValue([
      {
        _count: { teamMembers: 2 },
        archivedAt: null,
        description: null,
        id: teamId,
        key: 'WEB',
        name: '프론트 웹',
        teamMembers: [{ membershipId, role: 'MEMBER' }],
        version: 3,
      },
    ]);

    await expect(queries.list(adminContext, { includeArchived: false })).resolves.toEqual({
      items: [
        {
          archived: false,
          canManage: true,
          description: null,
          id: teamId,
          key: 'WEB',
          leaderCount: 0,
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
      service.update(adminContext, teamId, { name: '웹 플랫폼', version: 3 }),
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
      service.update(adminContext, teamId, { key: 'APP', version: 1 }),
    ).rejects.toMatchObject({
      response: { code: 'TEAM_KEY_LOCKED' },
      status: HttpStatus.CONFLICT,
    });
  });

  it('rejects adding an inactive or cross-workspace membership', async () => {
    transaction.$queryRaw.mockResolvedValue([]);

    await expect(service.addMember(adminContext, teamId, membershipId)).rejects.toMatchObject({
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

    await expect(service.addMember(adminContext, teamId, membershipId)).resolves.toMatchObject({
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

    await expect(service.removeMember(adminContext, teamId, membershipId)).resolves.toBeUndefined();
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

    await expect(service.removeMember(adminContext, teamId, membershipId)).rejects.toMatchObject({
      response: { code: 'TEAM_MEMBER_HAS_OPEN_ASSIGNMENTS', details: { issues: [issue] } },
      status: HttpStatus.CONFLICT,
    });
    expect(transaction.teamMember.update).not.toHaveBeenCalled();
  });

  it('lets an admin designate an active team member as a team lead', async () => {
    transaction.$queryRaw.mockResolvedValue([{ role: TeamMemberRole.MEMBER }]);
    transaction.team.update.mockResolvedValue({ version: 3 });
    transaction.team.findFirst.mockResolvedValue({
      ...teamResponseRow,
      teamMembers: [{ membershipId, role: TeamMemberRole.LEAD }],
      version: 3,
    });

    await expect(service.setLeader(adminContext, teamId, membershipId)).resolves.toMatchObject({
      leaderIds: [membershipId],
      version: 3,
    });
    expect(transaction.teamMember.update).toHaveBeenCalledWith({
      data: { role: TeamMemberRole.LEAD },
      where: { teamId_membershipId: { membershipId, teamId } },
    });
  });

  it('does not let a team lead designate another team lead', async () => {
    await expect(
      service.setLeader({ membershipId, role: 'MEMBER', workspaceId }, teamId, replacementStateId),
    ).rejects.toMatchObject({ response: { code: 'FORBIDDEN' }, status: HttpStatus.FORBIDDEN });
    expect(management.assertCanManageTeam).not.toHaveBeenCalled();
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

    await expect(service.archive(adminContext, teamId, { version: 1 })).resolves.toMatchObject({
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

    await expect(service.archive(adminContext, teamId, { version: 1 })).rejects.toMatchObject({
      response: { code: 'TEAM_HAS_OPEN_ISSUES', details: { issues: [issue] } },
      status: HttpStatus.CONFLICT,
    });
    expect(transaction.team.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a stale workflow state rename with the latest version', async () => {
    transaction.workflowState.findFirst.mockResolvedValue({
      ...workflowState,
      teamId,
      version: 5,
    });

    await expect(
      workflowStates.updateWorkflowState(adminContext, stateId, { name: '접수', version: 4 }),
    ).rejects.toMatchObject({
      response: { code: 'VERSION_CONFLICT', currentVersion: 5 },
      status: HttpStatus.CONFLICT,
    });
    expect(transaction.workflowState.updateManyAndReturn).not.toHaveBeenCalled();
  });

  it('returns a field validation error for a duplicate workflow state name', async () => {
    transaction.workflowState.findFirst.mockResolvedValue({ ...workflowState, teamId });
    transaction.workflowState.updateManyAndReturn.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        clientVersion: '7.8.0',
        code: 'P2002',
        meta: { target: ['team_id', 'normalized_name'] },
      }),
    );

    await expect(
      workflowStates.updateWorkflowState(adminContext, stateId, { name: '중복 상태', version: 1 }),
    ).rejects.toMatchObject({
      response: {
        code: 'VALIDATION_ERROR',
        fieldErrors: { name: ['같은 이름의 워크플로 상태가 이미 있습니다.'] },
      },
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });
  });

  it('inserts a workflow state at the end of its system category and shifts later states', async () => {
    transaction.$queryRaw.mockResolvedValue([{ id: teamId }]);
    transaction.workflowState.findMany.mockResolvedValue([
      { category: StateCategory.BACKLOG, id: stateId, position: 0, version: 1 },
      { category: StateCategory.BACKLOG, id: 'state-paused', position: 1, version: 2 },
      { category: StateCategory.UNSTARTED, id: 'state-todo', position: 2, version: 3 },
      { category: StateCategory.STARTED, id: 'state-doing', position: 3, version: 4 },
      { category: StateCategory.STARTED, id: 'state-review', position: 4, version: 5 },
      { category: StateCategory.COMPLETED, id: 'state-done', position: 5, version: 6 },
      { category: StateCategory.CANCELED, id: 'state-canceled', position: 6, version: 7 },
    ]);
    transaction.workflowState.update
      .mockResolvedValueOnce({
        ...workflowState,
        category: StateCategory.CANCELED,
        id: 'state-canceled',
        name: '취소',
        position: 7,
        version: 8,
      })
      .mockResolvedValueOnce({
        ...workflowState,
        category: StateCategory.COMPLETED,
        id: 'state-done',
        name: '완료',
        position: 6,
        version: 7,
      });
    transaction.workflowState.create.mockResolvedValue({
      category: StateCategory.STARTED,
      color: WorkflowStateColor.INDIGO,
      id: replacementStateId,
      isDefault: false,
      name: 'QA 중',
      position: 5,
      version: 1,
    });

    await expect(
      workflowStates.createWorkflowState(adminContext, teamId, {
        category: StateCategory.STARTED,
        color: WorkflowStateColor.INDIGO,
        name: ' QA 중 ',
      }),
    ).resolves.toMatchObject({
      category: StateCategory.STARTED,
      name: 'QA 중',
      position: 5,
    });
    expect(transaction.workflowState.update).toHaveBeenNthCalledWith(1, {
      data: { position: { increment: 1 }, version: { increment: 1 } },
      select: expect.any(Object),
      where: { id: 'state-canceled' },
    });
    expect(transaction.workflowState.update).toHaveBeenNthCalledWith(2, {
      data: { position: { increment: 1 }, version: { increment: 1 } },
      select: expect.any(Object),
      where: { id: 'state-done' },
    });
    expect(transaction.workflowState.create).toHaveBeenCalledWith({
      data: {
        category: StateCategory.STARTED,
        color: WorkflowStateColor.INDIGO,
        name: 'QA 중',
        normalizedName: 'qa 중',
        position: 5,
        teamId,
        workspaceId,
      },
      select: expect.any(Object),
    });
  });

  it('keeps the name and updates only the workflow state color', async () => {
    transaction.workflowState.findFirst.mockResolvedValue({ ...workflowState, teamId });
    transaction.workflowState.updateManyAndReturn.mockResolvedValue([
      { ...workflowState, color: WorkflowStateColor.TEAL, version: 2 },
    ]);

    await expect(
      workflowStates.updateWorkflowState(adminContext, stateId, {
        color: WorkflowStateColor.TEAL,
        name: workflowState.name,
        version: 1,
      }),
    ).resolves.toMatchObject({ color: WorkflowStateColor.TEAL, version: 2 });
    expect(transaction.workflowState.updateManyAndReturn).toHaveBeenCalledWith({
      data: {
        color: WorkflowStateColor.TEAL,
        name: workflowState.name,
        normalizedName: workflowState.name,
        version: { increment: 1 },
      },
      select: expect.any(Object),
      where: {
        id: stateId,
        team: { archivedAt: null },
        version: 1,
        workspaceId,
      },
    });
  });

  it('moves the default marker to a state in any category atomically', async () => {
    transaction.$queryRaw.mockResolvedValue([
      { id: replacementStateId, isDefault: false, teamId, version: 3 },
    ]);
    transaction.workflowState.updateManyAndReturn.mockResolvedValue([
      { ...workflowState, isDefault: false, version: 2 },
    ]);
    transaction.workflowState.update.mockResolvedValue({
      ...workflowState,
      category: StateCategory.COMPLETED,
      id: replacementStateId,
      isDefault: true,
      name: '완료',
      position: 4,
      version: 4,
    });
    transaction.workflowState.findMany.mockResolvedValue([
      { ...workflowState, isDefault: false, version: 2 },
      {
        ...workflowState,
        category: StateCategory.COMPLETED,
        id: replacementStateId,
        isDefault: true,
        name: '완료',
        position: 4,
        version: 4,
      },
    ]);

    await expect(
      workflowStates.setDefaultWorkflowState(adminContext, replacementStateId, { version: 3 }),
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({ id: stateId, isDefault: false }),
        expect.objectContaining({
          category: StateCategory.COMPLETED,
          id: replacementStateId,
          isDefault: true,
        }),
      ],
    });
    expect(transaction.workflowState.updateManyAndReturn).toHaveBeenCalledWith({
      data: { isDefault: false, version: { increment: 1 } },
      select: expect.any(Object),
      where: { isDefault: true, teamId, workspaceId },
    });
    expect(transaction.workflowState.update).toHaveBeenCalledWith({
      data: { isDefault: true, version: { increment: 1 } },
      select: expect.any(Object),
      where: { id: replacementStateId },
    });
  });

  it('rejects a stale default workflow state request', async () => {
    transaction.$queryRaw.mockResolvedValue([
      { id: replacementStateId, isDefault: false, teamId, version: 4 },
    ]);

    await expect(
      workflowStates.setDefaultWorkflowState(adminContext, replacementStateId, { version: 3 }),
    ).rejects.toMatchObject({
      response: { code: 'VERSION_CONFLICT', currentVersion: 4 },
      status: HttpStatus.CONFLICT,
    });
    expect(transaction.workflowState.updateManyAndReturn).not.toHaveBeenCalled();
  });

  it('disables a non-default workflow state without changing existing issue links', async () => {
    const disabledAt = new Date('2026-07-20T00:00:00.000Z');
    transaction.$queryRaw.mockResolvedValue([
      {
        category: StateCategory.BACKLOG,
        disabledAt: null,
        id: stateId,
        isDefault: false,
        teamId,
        version: 1,
      },
    ]);
    transaction.workflowState.update.mockResolvedValue({
      ...workflowState,
      disabledAt,
      isDefault: false,
      version: 2,
    });

    await expect(
      workflowStates.disableWorkflowState(adminContext, stateId, { version: 1 }),
    ).resolves.toMatchObject({ disabledAt, version: 2 });
    expect(transaction.workflowState.update).toHaveBeenCalledWith({
      data: { disabledAt: expect.any(Date), version: { increment: 1 } },
      select: expect.any(Object),
      where: { id: stateId },
    });
  });

  it('keeps the default workflow state enabled', async () => {
    transaction.$queryRaw.mockResolvedValue([
      {
        category: StateCategory.BACKLOG,
        disabledAt: null,
        id: stateId,
        isDefault: true,
        teamId,
        version: 1,
      },
    ]);

    await expect(
      workflowStates.disableWorkflowState(adminContext, stateId, { version: 1 }),
    ).rejects.toMatchObject({
      response: { code: 'WORKFLOW_STATE_DEFAULT_REQUIRED' },
      status: HttpStatus.CONFLICT,
    });
    expect(transaction.workflowState.update).not.toHaveBeenCalled();
  });

  it('reorders every workflow state through a collision-free temporary range', async () => {
    transaction.team.findFirst.mockResolvedValue({ id: teamId });
    transaction.$queryRaw.mockResolvedValue([
      { category: StateCategory.STARTED, id: stateId, position: 0, version: 1 },
      { category: StateCategory.STARTED, id: replacementStateId, position: 1, version: 2 },
    ]);
    transaction.workflowState.update
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ ...workflowState, id: replacementStateId, position: 0, version: 3 })
      .mockResolvedValueOnce({ ...workflowState, isDefault: true, position: 1, version: 2 });

    const result = await workflowStates.reorderWorkflowStates(adminContext, teamId, {
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
      { category: StateCategory.BACKLOG, id: stateId, position: 0, version: 1 },
      { category: StateCategory.UNSTARTED, id: replacementStateId, position: 1, version: 1 },
    ]);

    await expect(
      workflowStates.reorderWorkflowStates(adminContext, teamId, {
        states: [{ id: stateId, version: 1 }],
      }),
    ).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR' },
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });
    expect(transaction.workflowState.update).not.toHaveBeenCalled();
  });

  it('rejects workflow state reordering across system category boundaries', async () => {
    transaction.$queryRaw.mockResolvedValue([
      { category: StateCategory.BACKLOG, id: stateId, position: 0, version: 1 },
      { category: StateCategory.UNSTARTED, id: replacementStateId, position: 1, version: 2 },
    ]);

    await expect(
      workflowStates.reorderWorkflowStates(adminContext, teamId, {
        states: [
          { id: replacementStateId, version: 2 },
          { id: stateId, version: 1 },
        ],
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'VALIDATION_ERROR',
        fieldErrors: { states: ['상태는 같은 시스템 범주 안에서만 순서를 바꿀 수 있습니다.'] },
      },
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });
    expect(transaction.workflowState.update).not.toHaveBeenCalled();
  });

  it('keeps the last unstarted state for a team in an active project', async () => {
    transaction.$queryRaw
      .mockResolvedValueOnce([
        {
          category: StateCategory.UNSTARTED,
          id: stateId,
          isDefault: false,
          name: '할 일',
          teamId,
          version: 1,
        },
      ])
      .mockResolvedValueOnce([{ activeProjectCount: 1, unstartedCount: 1 }]);

    await expect(
      workflowStates.deleteWorkflowState(adminContext, stateId, { version: 1 }),
    ).rejects.toMatchObject({
      response: { code: 'TEAM_UNSTARTED_STATE_REQUIRED' },
      status: HttpStatus.CONFLICT,
    });
    const usageQuery = (transaction.$queryRaw.mock.calls[1]?.[0] as string[] | undefined)?.join('');
    expect(usageQuery).toContain('FROM "project_teams" project_team');
    expect(usageQuery).not.toContain('FROM "project_role_teams"');
    expect(transaction.workflowState.delete).not.toHaveBeenCalled();
  });

  it('allows the last unstarted state to be deleted when the team has no active project', async () => {
    transaction.$queryRaw
      .mockResolvedValueOnce([
        {
          category: StateCategory.UNSTARTED,
          id: stateId,
          isDefault: false,
          name: '할 일',
          teamId,
          version: 1,
        },
      ])
      .mockResolvedValueOnce([{ activeProjectCount: 0, unstartedCount: 1 }])
      .mockResolvedValueOnce([{ id: stateId, name: '할 일', position: 0, version: 1 }])
      .mockResolvedValueOnce([]);
    transaction.workflowState.delete.mockResolvedValue({});

    await expect(
      workflowStates.deleteWorkflowState(adminContext, stateId, { version: 1 }),
    ).resolves.toBeUndefined();
    expect(transaction.workflowState.delete).toHaveBeenCalledWith({ where: { id: stateId } });
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
      workflowStates.deleteWorkflowState(adminContext, stateId, {
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
      workflowStates.deleteWorkflowState(adminContext, stateId, { version: 1 }),
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
      workflowStates.deleteWorkflowState(adminContext, stateId, {
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
