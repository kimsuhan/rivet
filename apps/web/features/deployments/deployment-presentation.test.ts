import { describe, expect, it } from 'vitest';

import type { TeamWorkSummaryResponseDto } from '@rivet/api-client';

import {
  deploymentCondition,
  deploymentProgress,
  deploymentReadiness,
} from './deployment-presentation';

function teamWork(
  id: string,
  teamName: string,
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
    identifier: `${teamName}-${id}`,
    issue: {
      id: 'issue-1',
      identifier: 'F-1',
      labels: [],
      priority: 'MEDIUM',
      project: {
        archived: false,
        id: 'project-1',
        logoFileId: null,
        name: 'Rivet',
        status: 'IN_PROGRESS',
      },
      status: 'REVIEW',
      title: '운영 배포 관리',
    },
    projectTeam: {
      active: true,
      deploymentTrackingEnabled: true,
      id: `project-team-${id}`,
      team: { archived: false, id: `team-${id}`, key: teamName, name: teamName },
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

describe('배포 표시 상태', () => {
  it('선행 배포 조건을 실제 팀 이름으로 표시한다', () => {
    const api = teamWork('api', 'API', { deploymentStatus: 'DEPLOYED' });
    const web = teamWork('web', 'WEB', {
      deploymentPredecessorTeamWorkIds: [api.id],
    });

    expect(deploymentCondition(web, [api, web])).toEqual({
      kind: 'AFTER',
      predecessorTeamNames: ['API'],
    });
    expect(deploymentReadiness(web, [api, web])).toEqual({ kind: 'READY' });
  });

  it('선행 팀이 아직 배포되지 않았으면 해당 팀 배포를 기다린다', () => {
    const api = teamWork('api', 'API');
    const web = teamWork('web', 'WEB', {
      deploymentPredecessorTeamWorkIds: [api.id],
    });

    expect(deploymentReadiness(web, [api, web])).toEqual({
      kind: 'WAITING_FOR_PREDECESSOR',
      predecessorTeamNames: ['API'],
    });
  });

  it('팀 작업과 함께 배포 그룹의 준비 상태를 구분한다', () => {
    const api = teamWork('api', 'API', { deploymentGroupId: 'group-1' });
    const web = teamWork('web', 'WEB', {
      deploymentGroupId: 'group-1',
      stateCategory: 'STARTED',
      stateProgress: 0.5,
      workflowState: {
        category: 'STARTED',
        color: 'INDIGO',
        id: 'state-2',
        isDefault: false,
        name: '진행 중',
        position: 2,
        version: 1,
      },
    });

    expect(deploymentReadiness(web, [api, web])).toEqual({
      kind: 'WAITING_FOR_WORK',
      workflowStateName: '진행 중',
    });
    expect(deploymentReadiness(api, [api, web])).toEqual({
      completedCount: 1,
      kind: 'WAITING_FOR_TOGETHER',
      totalCount: 2,
    });
  });

  it('이슈 전체 팀 배포 완료 수를 계산한다', () => {
    expect(
      deploymentProgress([
        teamWork('api', 'API', { deploymentStatus: 'DEPLOYED' }),
        teamWork('web', 'WEB'),
      ]),
    ).toEqual({ completed: 1, total: 2 });
  });
});
