import { randomUUID } from 'node:crypto';

import {
  FeatureIssueStatus,
  IssuePriority,
  IssueType,
  MembershipRole,
  MembershipStatus,
  ProjectStatus,
  StateCategory,
} from '@rivet/database';

import { buildFeatureWorkQueueWhere, IssuesService } from './issues.service';

describe('buildFeatureWorkQueueWhere', () => {
  const activeTask = {
    deletedAt: null,
    type: IssueType.TEAM_TASK,
    workflowState: {
      category: { notIn: [StateCategory.COMPLETED, StateCategory.CANCELED] },
    },
  };

  it('keeps completed or canceled task history out of the review queue', () => {
    expect(buildFeatureWorkQueueWhere('REVIEW_REQUIRED')).toEqual({
      childIssues: { none: { deletedAt: null, type: IssueType.TEAM_TASK } },
      featureStatus: { notIn: [FeatureIssueStatus.DONE, FeatureIssueStatus.CANCELED] },
      type: IssueType.FEATURE,
    });
  });

  it('allows assignment-required and in-progress queues to overlap', () => {
    expect(buildFeatureWorkQueueWhere('ASSIGNMENT_REQUIRED')).toEqual({
      childIssues: { some: { ...activeTask, assigneeMembershipId: null } },
      type: IssueType.FEATURE,
    });
    expect(buildFeatureWorkQueueWhere('IN_PROGRESS')).toEqual({
      childIssues: { some: activeTask },
      type: IssueType.FEATURE,
    });
  });

  it('requires a non-canceled task and no unfinished target for completion review', () => {
    expect(buildFeatureWorkQueueWhere('COMPLETION_REQUIRED')).toEqual({
      AND: [
        {
          childIssues: {
            some: {
              deletedAt: null,
              type: IssueType.TEAM_TASK,
              workflowState: { category: { not: StateCategory.CANCELED } },
            },
          },
        },
        {
          childIssues: {
            none: {
              deletedAt: null,
              type: IssueType.TEAM_TASK,
              workflowState: {
                category: { notIn: [StateCategory.COMPLETED, StateCategory.CANCELED] },
              },
            },
          },
        },
      ],
      featureStatus: { notIn: [FeatureIssueStatus.DONE, FeatureIssueStatus.CANCELED] },
      type: IssueType.FEATURE,
    });
  });

  it('uses the parent feature state for completed', () => {
    expect(buildFeatureWorkQueueWhere('COMPLETED')).toEqual({
      featureStatus: FeatureIssueStatus.DONE,
      type: IssueType.FEATURE,
    });
  });
});

describe('IssuesService.list', () => {
  function featureIssue(index: number) {
    const now = new Date('2026-07-12T00:00:00.000Z');
    return {
      assigneeTeamMember: null,
      blockedRelations: [],
      blockingRelations: [],
      childIssues: [],
      createdAt: now,
      createdByMembership: {
        id: randomUUID(),
        role: MembershipRole.MEMBER,
        status: MembershipStatus.ACTIVE,
        user: { avatarFileId: null, displayName: `작성자 ${index}`, id: randomUUID() },
      },
      descriptionMarkdown: null,
      featureStatus: FeatureIssueStatus.TODO,
      fileAttachments: [],
      handoffs: [],
      id: randomUUID(),
      identifier: `F-${index + 1}`,
      labels: [],
      parentIssue: null,
      priority: IssuePriority.NONE,
      project: {
        archivedAt: null,
        id: randomUUID(),
        name: `프로젝트 ${index}`,
        status: ProjectStatus.IN_PROGRESS,
      },
      projectRole: null,
      team: null,
      title: `전역 이슈 ${index}`,
      type: IssueType.FEATURE,
      updatedAt: now,
      version: 1,
      workflowState: null,
    };
  }

  async function listDatabaseCallCount(size: number): Promise<number> {
    const issues = Array.from({ length: size }, (_, index) => featureIssue(index));
    const issueFindMany = jest.fn().mockResolvedValue(issues);
    const issueCount = jest.fn().mockResolvedValue(size);
    const roleTeamFindMany = jest.fn().mockResolvedValue([]);
    const service = new IssuesService(
      {
        client: {
          issue: { count: issueCount, findMany: issueFindMany },
          projectRoleTeam: { findMany: roleTeamFindMany },
        },
      } as never,
      {} as never,
      {} as never,
    );

    await service.list(
      { membershipId: randomUUID(), workspaceId: randomUUID() },
      { limit: 50, type: IssueType.FEATURE },
    );

    return (
      issueFindMany.mock.calls.length +
      issueCount.mock.calls.length +
      roleTeamFindMany.mock.calls.length
    );
  }

  it('페이지 행 수와 무관하게 고정된 목록·대기열 집계 쿼리만 실행한다', async () => {
    await expect(listDatabaseCallCount(1)).resolves.toBe(8);
    await expect(listDatabaseCallCount(50)).resolves.toBe(8);
  });

  it('선택한 대기열을 제외한 동일 필터로 FEATURE 대기열 전체 건수를 계산한다', async () => {
    const issue = featureIssue(0);
    const issueCount = jest
      .fn()
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(5);
    const service = new IssuesService(
      {
        client: {
          issue: { count: issueCount, findMany: jest.fn().mockResolvedValue([issue]) },
          projectRoleTeam: { findMany: jest.fn().mockResolvedValue([]) },
        },
      } as never,
      {} as never,
      {} as never,
    );
    const workspaceId = randomUUID();
    const projectId = randomUUID();

    const response = await service.list(
      { membershipId: randomUUID(), workspaceId },
      {
        limit: 50,
        projectId,
        query: '검색 대상',
        workQueue: 'ASSIGNMENT_REQUIRED',
      },
    );

    expect(response).toMatchObject({
      totalCount: 2,
      workQueueCounts: {
        ALL: 6,
        ASSIGNMENT_REQUIRED: 2,
        COMPLETED: 5,
        COMPLETION_REQUIRED: 4,
        IN_PROGRESS: 3,
        REVIEW_REQUIRED: 1,
      },
    });
    expect(issueCount).toHaveBeenCalledTimes(6);
    for (const [{ where }] of issueCount.mock.calls) {
      expect(JSON.stringify(where)).toContain(workspaceId);
      expect(JSON.stringify(where)).toContain(projectId);
      expect(JSON.stringify(where)).toContain('검색 대상');
    }
    expect(JSON.stringify(issueCount.mock.calls[0]![0].where)).not.toContain(
      'assigneeMembershipId',
    );
  });

  it('일반 팀 작업 목록 응답에는 FEATURE 대기열 건수를 추가하지 않는다', async () => {
    const issue = featureIssue(0);
    const issueCount = jest.fn().mockResolvedValue(1);
    const service = new IssuesService(
      {
        client: {
          issue: { count: issueCount, findMany: jest.fn().mockResolvedValue([issue]) },
          projectRoleTeam: { findMany: jest.fn().mockResolvedValue([]) },
        },
      } as never,
      {} as never,
      {} as never,
    );

    const response = await service.list(
      { membershipId: randomUUID(), workspaceId: randomUUID() },
      { limit: 50, type: IssueType.TEAM_TASK },
    );

    expect(response.workQueueCounts).toBeUndefined();
    expect(issueCount).toHaveBeenCalledTimes(1);
  });
});
