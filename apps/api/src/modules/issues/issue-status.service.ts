import { Injectable } from '@nestjs/common';

import { IssueStatus, Prisma, StateCategory } from '@rivet/database';

import { issueResourceNotFound } from './issue.errors';

@Injectable()
export class IssueStatusService {
  async recalculate(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    issueId: string,
  ): Promise<IssueStatus> {
    const issue = await transaction.issue.findFirst({
      select: { status: true },
      where: { deletedAt: null, id: issueId, workspaceId },
    });
    if (!issue) issueResourceNotFound();
    if (issue.status === IssueStatus.PAUSED || issue.status === IssueStatus.CANCELED) {
      return issue.status;
    }
    const teamWorks = await transaction.teamWork.findMany({
      select: { workflowState: { select: { category: true } } },
      where: { deletedAt: null, issueId, workspaceId },
    });
    const valid = teamWorks.filter(
      ({ workflowState }) => workflowState.category !== StateCategory.CANCELED,
    );
    const allValidCompleted =
      valid.length > 0 &&
      valid.every(({ workflowState }) => workflowState.category === StateCategory.COMPLETED);
    // DONE은 유효 팀 작업 전체 완료를 전제로 하는 수동 상태다. 팀 작업 변경으로 이
    // 불변식이 깨졌을 때만 자동 상태 계산으로 되돌려 진행률과 상태의 모순을 막는다.
    if (issue.status === IssueStatus.DONE && allValidCompleted) return issue.status;
    const next =
      valid.length === 0
        ? IssueStatus.UNSORTED
        : allValidCompleted
          ? IssueStatus.REVIEW
          : valid.some(
                ({ workflowState }) =>
                  workflowState.category === StateCategory.STARTED ||
                  workflowState.category === StateCategory.COMPLETED,
              )
            ? IssueStatus.IN_PROGRESS
            : IssueStatus.TODO;
    if (next !== issue.status) {
      await transaction.issue.update({
        data: { status: next, version: { increment: 1 } },
        where: { id: issueId },
      });
    }
    return next;
  }
}
