import { DeploymentStatus, MembershipRole, StateCategory } from '@rivet/database';

import { DatabaseService } from '../../common/database/database.service';
import { DeploymentsService } from './deployments.service';
import { IssueRepository } from './issue.repository';

describe('DeploymentsService', () => {
  const context = {
    membershipId: '2e0792d5-eac3-44c1-87c7-56f07ebaa620',
    membershipRole: MembershipRole.ADMIN,
    workspaceId: '3dc0b213-eafa-450c-ad12-49a7d927c7b8',
  };
  const issueId = '953685f0-4921-41cd-8422-d8a1ccc3f547';
  const firstTeamWorkId = 'fa0b2a20-4077-4e13-b04e-7ec7306cd988';
  const secondTeamWorkId = 'd415fc6b-4531-459a-898f-82659e5f24bb';
  const transaction = {
    $executeRaw: jest.fn(),
    activityEvent: { create: jest.fn() },
    issue: { findFirst: jest.fn(), findMany: jest.fn() },
    teamMember: { findMany: jest.fn() },
    teamWork: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    teamWorkDeploymentDependency: { findFirst: jest.fn() },
  };
  const database = {
    client: {
      $transaction: jest.fn(),
      teamMember: { findMany: jest.fn() },
    },
  };
  const repository = {
    countDeploymentTeamWorks: jest.fn(),
    findTeamWorksInTransaction: jest.fn(),
    listDeploymentTeamWorks: jest.fn(),
  };
  const statuses = { recalculate: jest.fn() };
  let service: DeploymentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    database.client.$transaction.mockImplementation(
      async (operation: (client: typeof transaction) => Promise<unknown>) => operation(transaction),
    );
    repository.listDeploymentTeamWorks.mockResolvedValue([]);
    repository.countDeploymentTeamWorks.mockResolvedValue(0);
    repository.findTeamWorksInTransaction.mockResolvedValue([]);
    transaction.issue.findMany.mockResolvedValue([]);
    service = new DeploymentsService(
      database as unknown as DatabaseService,
      repository as unknown as IssueRepository,
      statuses as never,
    );
  });

  it('배포 현황은 기본적으로 배포 대기와 재배포 필요 작업을 조회한다', async () => {
    await expect(service.list(context, { limit: 100, readyOnly: false })).resolves.toEqual({
      items: [],
      totalCount: 0,
    });
    expect(repository.listDeploymentTeamWorks).toHaveBeenCalledWith(
      context.workspaceId,
      [DeploymentStatus.PENDING, DeploymentStatus.REDEPLOY_REQUIRED],
      100,
      undefined,
      false,
    );
    expect(repository.countDeploymentTeamWorks).toHaveBeenCalledWith(
      context.workspaceId,
      [DeploymentStatus.PENDING, DeploymentStatus.REDEPLOY_REQUIRED],
      undefined,
      false,
    );
  });

  it('내 팀 범위는 현재 멤버가 속한 팀의 배포만 조회하고 집계한다', async () => {
    database.client.teamMember.findMany.mockResolvedValue([
      { teamId: 'c5ef63e6-3f70-4caf-bb56-256486afbb84' },
    ]);

    await service.list(context, { limit: 1, readyOnly: false, scope: 'MY_TEAMS' });

    expect(repository.listDeploymentTeamWorks).toHaveBeenCalledWith(
      context.workspaceId,
      [DeploymentStatus.PENDING, DeploymentStatus.REDEPLOY_REQUIRED],
      1,
      ['c5ef63e6-3f70-4caf-bb56-256486afbb84'],
      false,
    );
    expect(repository.countDeploymentTeamWorks).toHaveBeenCalledWith(
      context.workspaceId,
      [DeploymentStatus.PENDING, DeploymentStatus.REDEPLOY_REQUIRED],
      ['c5ef63e6-3f70-4caf-bb56-256486afbb84'],
      false,
    );
  });

  it('준비된 배포만 요청하면 목록과 집계에 같은 준비 조건을 적용한다', async () => {
    database.client.teamMember.findMany.mockResolvedValue([
      { teamId: 'c5ef63e6-3f70-4caf-bb56-256486afbb84' },
    ]);

    await service.list(context, { limit: 1, readyOnly: true, scope: 'MY_TEAMS' });

    expect(repository.listDeploymentTeamWorks).toHaveBeenCalledWith(
      context.workspaceId,
      [DeploymentStatus.PENDING, DeploymentStatus.REDEPLOY_REQUIRED],
      1,
      ['c5ef63e6-3f70-4caf-bb56-256486afbb84'],
      true,
    );
    expect(repository.countDeploymentTeamWorks).toHaveBeenCalledWith(
      context.workspaceId,
      [DeploymentStatus.PENDING, DeploymentStatus.REDEPLOY_REQUIRED],
      ['c5ef63e6-3f70-4caf-bb56-256486afbb84'],
      true,
    );
  });

  it('팀 작업이 완료되지 않으면 운영 배포를 완료할 수 없다', async () => {
    transaction.teamWork.findFirst.mockResolvedValue({
      deploymentGroupId: null,
      deploymentStatus: DeploymentStatus.PENDING,
      id: firstTeamWorkId,
      issue: { id: issueId, project: { leadMembershipId: null } },
      projectTeam: { deploymentTrackingEnabled: true },
      teamId: 'c5ef63e6-3f70-4caf-bb56-256486afbb84',
      version: 1,
      workflowState: { category: StateCategory.STARTED },
    });

    await expect(
      service.updateTeamWork(context, firstTeamWorkId, {
        action: 'MARK_DEPLOYED',
        version: 1,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'DEPLOYMENT_WORK_NOT_COMPLETED' }),
    });
  });

  it('프로젝트에서 준비된 팀 배포를 한 트랜잭션으로 완료한다', async () => {
    transaction.teamWork.findMany.mockResolvedValue([
      {
        deploymentGroupId: null,
        deploymentStatus: DeploymentStatus.PENDING,
        id: firstTeamWorkId,
        issue: { id: issueId, project: { id: 'project-1', leadMembershipId: null } },
        teamId: 'c5ef63e6-3f70-4caf-bb56-256486afbb84',
        version: 1,
        workflowState: { category: StateCategory.COMPLETED },
      },
    ]);
    transaction.teamWorkDeploymentDependency.findFirst.mockResolvedValue(null);
    transaction.teamWork.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.completeProjectDeployments(context, 'project-1', {
        teamWorks: [{ id: firstTeamWorkId, version: 1 }],
      }),
    ).resolves.toEqual({ items: [], totalCount: 0 });

    expect(transaction.teamWork.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deploymentStatus: DeploymentStatus.DEPLOYED }),
        where: { id: firstTeamWorkId, version: 1 },
      }),
    );
    expect(transaction.activityEvent.create).toHaveBeenCalledTimes(1);
    expect(statuses.recalculate).toHaveBeenCalledWith(
      transaction,
      context.workspaceId,
      issueId,
      context.membershipId,
    );
  });

  it('일반 멤버는 자신이 속하지 않은 팀을 프로젝트 일괄 완료에 포함할 수 없다', async () => {
    const memberContext = { ...context, membershipRole: MembershipRole.MEMBER };
    transaction.teamWork.findMany.mockResolvedValue([
      {
        deploymentGroupId: null,
        deploymentStatus: DeploymentStatus.PENDING,
        id: firstTeamWorkId,
        issue: {
          id: issueId,
          project: { id: 'project-1', leadMembershipId: 'another-membership' },
        },
        teamId: 'c5ef63e6-3f70-4caf-bb56-256486afbb84',
        version: 1,
        workflowState: { category: StateCategory.COMPLETED },
      },
    ]);
    transaction.teamMember.findMany.mockResolvedValue([]);

    await expect(
      service.completeProjectDeployments(memberContext, 'project-1', {
        teamWorks: [{ id: firstTeamWorkId, version: 1 }],
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'DEPLOYMENT_MANAGE_FORBIDDEN' }),
    });
    expect(transaction.teamWork.updateMany).not.toHaveBeenCalled();
  });

  it('서로를 선행 작업으로 지정하는 순환 배포 조건을 거부한다', async () => {
    transaction.issue.findFirst.mockResolvedValue({
      id: issueId,
      project: { leadMembershipId: null },
      version: 1,
    });
    transaction.teamWork.findMany.mockResolvedValue([
      { deploymentStatus: DeploymentStatus.PENDING, id: firstTeamWorkId },
      { deploymentStatus: DeploymentStatus.PENDING, id: secondTeamWorkId },
    ]);

    await expect(
      service.updatePlan(context, issueId, {
        dependencies: [
          {
            dependentTeamWorkId: firstTeamWorkId,
            predecessorTeamWorkId: secondTeamWorkId,
          },
          {
            dependentTeamWorkId: secondTeamWorkId,
            predecessorTeamWorkId: firstTeamWorkId,
          },
        ],
        togetherGroups: [],
        version: 1,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'DEPLOYMENT_DEPENDENCY_CYCLE' }),
    });
  });
});
