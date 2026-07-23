import { DeploymentStatus, IssueStatus, StateCategory } from '@rivet/database';

import { IssueStatusService } from './issue-status.service';

type TeamWorkFixture = {
  deploymentStatus: DeploymentStatus;
  workflowState: { category: StateCategory };
};

function transactionWith(status: IssueStatus, teamWorks: TeamWorkFixture[]) {
  const update = jest.fn();
  const transaction = {
    activityEvent: { create: jest.fn() },
    issue: {
      findFirst: jest.fn().mockResolvedValue({ status }),
      update,
    },
    issueSubscription: { findMany: jest.fn().mockResolvedValue([]) },
    outboxEvent: { create: jest.fn() },
    teamWork: {
      findMany: jest.fn().mockResolvedValue(teamWorks),
    },
  };
  return { transaction, update };
}

function recalculate(service: IssueStatusService, transaction: unknown) {
  return service.recalculate(transaction as never, 'workspace-1', 'issue-1', 'member-1');
}

function unstarted(): TeamWorkFixture {
  return {
    deploymentStatus: DeploymentStatus.NOT_APPLICABLE,
    workflowState: { category: StateCategory.UNSTARTED },
  };
}
function started(): TeamWorkFixture {
  return {
    deploymentStatus: DeploymentStatus.NOT_APPLICABLE,
    workflowState: { category: StateCategory.STARTED },
  };
}
function completed(
  deploymentStatus: DeploymentStatus = DeploymentStatus.NOT_APPLICABLE,
): TeamWorkFixture {
  return { deploymentStatus, workflowState: { category: StateCategory.COMPLETED } };
}
function canceled(): TeamWorkFixture {
  return {
    deploymentStatus: DeploymentStatus.NOT_APPLICABLE,
    workflowState: { category: StateCategory.CANCELED },
  };
}

describe('IssueStatusService.recalculate', () => {
  const service = new IssueStatusService();

  it('팀 작업이 없으면 UNSORTED로 계산하고 0% 문맥을 유지한다', async () => {
    const { transaction, update } = transactionWith(IssueStatus.UNSORTED, []);
    const next = await recalculate(service, transaction);
    expect(next).toBe(IssueStatus.UNSORTED);
    expect(update).not.toHaveBeenCalled();
  });

  it('팀 작업이 모두 완료돼도 운영 배포가 남아 있으면 REVIEW로 전이한다', async () => {
    const { transaction, update } = transactionWith(IssueStatus.IN_PROGRESS, [
      completed(DeploymentStatus.PENDING),
      canceled(),
    ]);
    const next = await recalculate(service, transaction);
    expect(next).toBe(IssueStatus.REVIEW);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: IssueStatus.REVIEW }) }),
    );
  });

  it('팀 작업과 운영 배포가 모두 완료되면 DONE으로 자동 전이한다', async () => {
    const { transaction, update } = transactionWith(IssueStatus.REVIEW, [
      completed(DeploymentStatus.DEPLOYED),
      completed(),
      canceled(),
    ]);
    const next = await recalculate(service, transaction);
    expect(next).toBe(IssueStatus.DONE);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: IssueStatus.DONE }) }),
    );
    expect(transaction.activityEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorMembershipId: 'member-1',
        afterData: IssueStatus.DONE,
        beforeData: IssueStatus.REVIEW,
        eventType: 'ISSUE_CHANGED',
        fieldName: 'status',
        issueId: 'issue-1',
        workspaceId: 'workspace-1',
      }),
    });
    expect(transaction.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorMembershipId: 'member-1',
        aggregateId: 'issue-1',
        aggregateType: 'ISSUE',
        eventType: 'ISSUE_CHANGED',
        payload: expect.objectContaining({
          changedFields: ['STATUS'],
          issueId: 'issue-1',
          terminalCategory: 'COMPLETED',
        }),
        workspaceId: 'workspace-1',
      }),
    });
  });

  it('PAUSED, CANCELED는 팀 작업 변화와 무관하게 항상 보존한다', async () => {
    for (const status of [IssueStatus.PAUSED, IssueStatus.CANCELED]) {
      const { transaction, update } = transactionWith(status, [unstarted()]);
      const next = await recalculate(service, transaction);
      expect(next).toBe(status);
      expect(update).not.toHaveBeenCalled();
    }
  });

  it('DONE 상태에서 유효 팀 작업이 여전히 모두 완료 상태면 그대로 유지한다', async () => {
    const { transaction, update } = transactionWith(IssueStatus.DONE, [completed(), canceled()]);
    const next = await recalculate(service, transaction);
    expect(next).toBe(IssueStatus.DONE);
    expect(update).not.toHaveBeenCalled();
  });

  it('DONE 상태의 배포가 다시 필요해지면 REVIEW로 되돌린다', async () => {
    const { transaction, update } = transactionWith(IssueStatus.DONE, [
      completed(DeploymentStatus.REDEPLOY_REQUIRED),
    ]);
    const next = await recalculate(service, transaction);
    expect(next).toBe(IssueStatus.REVIEW);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: IssueStatus.REVIEW }) }),
    );
  });

  it('DONE 상태 이후 새 팀 작업이 추가돼 완료 불변식이 깨지면 재계산으로 폴백한다', async () => {
    const { transaction, update } = transactionWith(IssueStatus.DONE, [completed(), unstarted()]);
    const next = await recalculate(service, transaction);
    expect(next).toBe(IssueStatus.IN_PROGRESS);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: IssueStatus.IN_PROGRESS }),
      }),
    );
  });

  it('DONE 상태에서 마지막 완료 팀 작업이 삭제돼 유효 작업이 0개가 되면 UNSORTED로 되돌린다', async () => {
    const { transaction, update } = transactionWith(IssueStatus.DONE, []);
    const next = await recalculate(service, transaction);
    expect(next).toBe(IssueStatus.UNSORTED);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: IssueStatus.UNSORTED }) }),
    );
  });

  it('시작 전 팀 작업만 있으면 TODO, 시작된 작업이 섞이면 IN_PROGRESS로 계산한다', async () => {
    const todoCase = transactionWith(IssueStatus.UNSORTED, [unstarted()]);
    expect(await recalculate(service, todoCase.transaction)).toBe(IssueStatus.TODO);

    const progressCase = transactionWith(IssueStatus.TODO, [unstarted(), started()]);
    expect(await recalculate(service, progressCase.transaction)).toBe(IssueStatus.IN_PROGRESS);
  });
});
