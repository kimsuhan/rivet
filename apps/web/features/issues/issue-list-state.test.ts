import { describe, expect, it } from 'vitest';

import {
  buildIssueListParams,
  clearIssueFilters,
  readIssueListState,
  replaceSearchParam,
} from './issue-list-state';

describe('issue list URL state', () => {
  it('내 이슈 기본 조회 조건을 API 파라미터로 만든다', () => {
    const state = readIssueListState(new URLSearchParams(), 'my');

    expect(buildIssueListParams(state, { mode: 'my' })).toEqual({
      assigneeMembershipId: 'me',
      limit: 50,
      sort: 'updatedAt',
      sortDirection: 'desc',
      stateCategory: 'BACKLOG,UNSTARTED,STARTED',
      type: 'TEAM_TASK',
    });
  });

  it('URL의 다중 필터, 정렬, 팀 탭을 복원한다', () => {
    const state = readIssueListState(
      new URLSearchParams(
        'tab=progress&status=state-1,state-2&assignee=member-1&priority=HIGH,URGENT&label=label-1&sort=status&direction=asc',
      ),
      'team',
    );

    expect(state).toMatchObject({
      assigneeIds: ['member-1'],
      labelIds: ['label-1'],
      priority: ['HIGH', 'URGENT'],
      sort: 'status',
      sortDirection: 'asc',
      stateIds: ['state-1', 'state-2'],
      tab: 'progress',
    });
    expect(buildIssueListParams(state, { mode: 'team', teamId: 'team-id' })).toEqual({
      assigneeMembershipId: 'member-1',
      labelId: 'label-1',
      limit: 50,
      priority: 'HIGH,URGENT',
      sort: 'status',
      sortDirection: 'asc',
      stateCategory: 'UNSTARTED,STARTED',
      teamId: 'team-id',
      type: 'TEAM_TASK',
      workflowStateId: 'state-1,state-2',
    });
  });

  it('내 이슈에서 명시적 상태 필터는 기본 미완료 범주를 대체한다', () => {
    const state = readIssueListState(new URLSearchParams('status=completed'), 'my');

    expect(buildIssueListParams(state, { mode: 'my' })).not.toHaveProperty('stateCategory');
    expect(buildIssueListParams(state, { mode: 'my' })).toHaveProperty(
      'workflowStateId',
      'completed',
    );
  });

  it('필터 또는 정렬 변경 시 커서를 버리고 나머지 URL 상태를 보존한다', () => {
    const current = new URLSearchParams('tab=backlog&sort=priority&cursor=stale');

    expect(replaceSearchParam(current, 'priority', ['HIGH', 'URGENT'])).toBe(
      'tab=backlog&sort=priority&priority=HIGH%2CURGENT',
    );
    expect(
      clearIssueFilters(new URLSearchParams('tab=backlog&team=one&label=two&sort=status')),
    ).toBe('tab=backlog&sort=status');
  });
});
