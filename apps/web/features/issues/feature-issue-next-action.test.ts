import { describe, expect, it } from 'vitest';

import { featureIssueNextAction } from './feature-issue-next-action';

const base = {
  activeRoles: ['BACKEND'] as const,
  allTargetTasksCompleted: false,
  currentUserAssignedTeamTaskCount: 0,
  currentUserTeamRoles: ['BACKEND'] as const,
  featureStatus: 'IN_PROGRESS' as const,
  teamTaskCount: 1,
  unassignedCount: 0,
};

describe('feature issue next action', () => {
  it.each([
    [{ ...base, teamTaskCount: 0 }, 'START_WORK'],
    [{ ...base, unassignedCount: 1 }, 'ASSIGN_TEAM_TASKS'],
    [
      {
        ...base,
        currentUserTeamRoles: ['BACKEND', 'WEB_FRONTEND'],
      },
      'START_FROM_MY_TEAM',
    ],
    [{ ...base, currentUserAssignedTeamTaskCount: 1 }, 'OPEN_MY_WORK'],
    [{ ...base, allTargetTasksCompleted: true }, 'COMPLETE_ISSUE'],
    [{ ...base }, 'VIEW_DETAIL'],
  ] as const)('%s 조건에서 %s 하나를 선택한다', (input, expected) => {
    expect(featureIssueNextAction(input)).toBe(expected);
  });

  it('완료 또는 취소된 이슈에는 빠른 완료를 제공하지 않는다', () => {
    expect(
      featureIssueNextAction({ ...base, allTargetTasksCompleted: true, featureStatus: 'DONE' }),
    ).toBe('VIEW_DETAIL');
    expect(
      featureIssueNextAction({ ...base, allTargetTasksCompleted: true, featureStatus: 'CANCELED' }),
    ).toBe('VIEW_DETAIL');
  });

  it('완료 후 활성 역할이 비어도 우리 팀 시작보다 이슈 완료를 우선한다', () => {
    expect(
      featureIssueNextAction({
        ...base,
        activeRoles: [],
        allTargetTasksCompleted: true,
        currentUserTeamRoles: ['BACKEND'],
        teamTaskCount: 2,
      }),
    ).toBe('COMPLETE_ISSUE');
  });
});
