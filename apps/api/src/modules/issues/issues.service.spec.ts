import { IssueStatus, StateCategory } from '@rivet/database';

import type { DatabaseService } from '../../common/database/database.service';
import type { FilesService } from '../files/files.service';
import { IssuesService } from './issues.service';

type TeamWorkFixture = { workflowState: { category: StateCategory } };

function transactionWith(status: IssueStatus, teamWorks: TeamWorkFixture[]) {
  const update = jest.fn();
  const transaction = {
    issue: {
      findFirst: jest.fn().mockResolvedValue({ status }),
      update,
    },
    teamWork: {
      findMany: jest.fn().mockResolvedValue(teamWorks),
    },
  };
  return { transaction, update };
}

function unstarted(): TeamWorkFixture {
  return { workflowState: { category: StateCategory.UNSTARTED } };
}
function started(): TeamWorkFixture {
  return { workflowState: { category: StateCategory.STARTED } };
}
function completed(): TeamWorkFixture {
  return { workflowState: { category: StateCategory.COMPLETED } };
}
function canceled(): TeamWorkFixture {
  return { workflowState: { category: StateCategory.CANCELED } };
}

describe('IssuesService.recalculateIssueStatus', () => {
  const service = new IssuesService({} as DatabaseService, {} as FilesService);

  it('팀 작업이 없으면 UNSORTED로 계산하고 0% 문맥을 유지한다', async () => {
    const { transaction, update } = transactionWith(IssueStatus.UNSORTED, []);
    const next = await service.recalculateIssueStatus(
      transaction as never,
      'workspace-1',
      'issue-1',
    );
    expect(next).toBe(IssueStatus.UNSORTED);
    expect(update).not.toHaveBeenCalled();
  });

  it('취소되지 않은 팀 작업이 모두 완료되면 REVIEW로 전이한다', async () => {
    const { transaction, update } = transactionWith(IssueStatus.IN_PROGRESS, [
      completed(),
      canceled(),
    ]);
    const next = await service.recalculateIssueStatus(
      transaction as never,
      'workspace-1',
      'issue-1',
    );
    expect(next).toBe(IssueStatus.REVIEW);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: IssueStatus.REVIEW }) }),
    );
  });

  it('PAUSED, CANCELED는 팀 작업 변화와 무관하게 항상 보존한다', async () => {
    for (const status of [IssueStatus.PAUSED, IssueStatus.CANCELED]) {
      const { transaction, update } = transactionWith(status, [unstarted()]);
      const next = await service.recalculateIssueStatus(
        transaction as never,
        'workspace-1',
        'issue-1',
      );
      expect(next).toBe(status);
      expect(update).not.toHaveBeenCalled();
    }
  });

  it('DONE 상태에서 유효 팀 작업이 여전히 모두 완료 상태면 그대로 유지한다', async () => {
    const { transaction, update } = transactionWith(IssueStatus.DONE, [completed(), canceled()]);
    const next = await service.recalculateIssueStatus(
      transaction as never,
      'workspace-1',
      'issue-1',
    );
    expect(next).toBe(IssueStatus.DONE);
    expect(update).not.toHaveBeenCalled();
  });

  it('DONE 상태 이후 새 팀 작업이 추가돼 완료 불변식이 깨지면 재계산으로 폴백한다', async () => {
    const { transaction, update } = transactionWith(IssueStatus.DONE, [completed(), unstarted()]);
    const next = await service.recalculateIssueStatus(
      transaction as never,
      'workspace-1',
      'issue-1',
    );
    expect(next).toBe(IssueStatus.IN_PROGRESS);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: IssueStatus.IN_PROGRESS }),
      }),
    );
  });

  it('DONE 상태에서 마지막 완료 팀 작업이 삭제돼 유효 작업이 0개가 되면 UNSORTED로 되돌린다', async () => {
    const { transaction, update } = transactionWith(IssueStatus.DONE, []);
    const next = await service.recalculateIssueStatus(
      transaction as never,
      'workspace-1',
      'issue-1',
    );
    expect(next).toBe(IssueStatus.UNSORTED);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: IssueStatus.UNSORTED }) }),
    );
  });

  it('시작 전 팀 작업만 있으면 TODO, 시작된 작업이 섞이면 IN_PROGRESS로 계산한다', async () => {
    const todoCase = transactionWith(IssueStatus.UNSORTED, [unstarted()]);
    expect(
      await service.recalculateIssueStatus(todoCase.transaction as never, 'workspace-1', 'issue-1'),
    ).toBe(IssueStatus.TODO);

    const progressCase = transactionWith(IssueStatus.TODO, [unstarted(), started()]);
    expect(
      await service.recalculateIssueStatus(
        progressCase.transaction as never,
        'workspace-1',
        'issue-1',
      ),
    ).toBe(IssueStatus.IN_PROGRESS);
  });
});
