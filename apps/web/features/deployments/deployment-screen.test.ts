import { describe, expect, it } from 'vitest';

import type { TeamWorkSummaryResponseDto } from '@rivet/api-client';

import { deploymentProjectGroups, projectCompletableWorks } from './deployment-groups';

function teamWork(
  id: string,
  teamId: string,
  projectId: string,
  issueId: string,
  overrides: Partial<TeamWorkSummaryResponseDto> = {},
): TeamWorkSummaryResponseDto {
  return {
    assignee: null,
    createdAt: '2026-07-23T00:00:00.000Z',
    deployedAt: null,
    deployedBy: null,
    deploymentGroupId: null,
    deploymentPredecessorTeamWorkIds: [],
    deploymentStatus: 'PENDING',
    id,
    identifier: `${teamId}-${id}`,
    issue: {
      id: issueId,
      identifier: `F-${issueId}`,
      labels: [],
      priority: 'MEDIUM',
      project: {
        archived: false,
        id: projectId,
        logoFileId: null,
        name: `프로젝트 ${projectId}`,
        status: 'IN_PROGRESS',
      },
      status: 'REVIEW',
      title: `이슈 ${issueId}`,
    },
    projectTeam: {
      active: true,
      deploymentTrackingEnabled: true,
      id: `project-team-${id}`,
      team: { archived: false, id: teamId, key: teamId, name: teamId },
    },
    stateCategory: 'COMPLETED',
    stateProgress: 1,
    updatedAt: '2026-07-23T00:00:00.000Z',
    version: 1,
    workflowState: {
      category: 'COMPLETED',
      color: 'GREEN',
      id: 'state-1',
      isDefault: false,
      name: '완료',
      position: 3,
      version: 1,
    },
    workNoteMarkdown: null,
    ...overrides,
  };
}

describe('배포 현황 그룹', () => {
  it('내 팀 보기는 소속 팀 배포만 남기고 프로젝트와 이슈로 묶는다', () => {
    const items = [
      teamWork('api-1', 'api-team', 'project-1', 'issue-1'),
      teamWork('web-1', 'web-team', 'project-1', 'issue-1'),
      teamWork('api-2', 'api-team', 'project-2', 'issue-2'),
    ];

    const groups = deploymentProjectGroups(items, ['api-team'], 'MY_TEAMS', 'PENDING');

    expect(groups).toHaveLength(2);
    expect(groups[0]?.issues[0]?.visibleWorks.map(({ id }) => id)).toEqual(['api-1']);
    expect(groups[0]?.issues[0]?.allWorks.map(({ id }) => id)).toEqual(['api-1', 'web-1']);
    expect(groups[1]?.issues[0]?.visibleWorks.map(({ id }) => id)).toEqual(['api-2']);
  });

  it('같은 프로젝트 일괄 완료에는 함께 선택한 선행 배포 체인도 포함한다', () => {
    const api = teamWork('api', 'api-team', 'project-1', 'issue-1');
    const web = teamWork('web', 'web-team', 'project-1', 'issue-1', {
      deploymentPredecessorTeamWorkIds: ['api'],
    });
    const [group] = deploymentProjectGroups([api, web], [], 'ALL', 'PENDING');

    expect(group && projectCompletableWorks(group).map(({ id }) => id)).toEqual(['api', 'web']);
  });

  it('현재 범위 밖의 선행 배포가 남아 있으면 일괄 완료 대상에서 제외한다', () => {
    const api = teamWork('api', 'api-team', 'project-1', 'issue-1');
    const web = teamWork('web', 'web-team', 'project-1', 'issue-1', {
      deploymentPredecessorTeamWorkIds: ['api'],
    });
    const [group] = deploymentProjectGroups([api, web], ['web-team'], 'MY_TEAMS', 'PENDING');

    expect(group && projectCompletableWorks(group)).toEqual([]);
  });
});
