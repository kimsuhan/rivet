import { describe, expect, it } from 'vitest';

import type { IssueSummaryResponseDto, WorkflowStateResponseDto } from '@rivet/api-client';

import { buildTeamIssueViewHref, groupIssueBoardColumns } from './issue-board-state';

const todo = {
  category: 'UNSTARTED',
  id: 'state-todo',
  isDefault: true,
  name: '할 일',
  position: 0,
  version: 1,
} satisfies WorkflowStateResponseDto;

const doing = {
  category: 'STARTED',
  id: 'state-doing',
  isDefault: false,
  name: '진행 중',
  position: 1,
  version: 1,
} satisfies WorkflowStateResponseDto;

function issue(
  id: string,
  identifier: string,
  state: WorkflowStateResponseDto,
): IssueSummaryResponseDto {
  return {
    assignee: null,
    blocked: false,
    createdAt: '2026-07-01T00:00:00.000Z',
    createdBy: {
      id: 'membership-creator',
      role: 'MEMBER',
      status: 'ACTIVE',
      user: { avatarFileId: null, displayName: '작성자', id: 'user-creator' },
    },
    id,
    identifier,
    labels: [],
    parentIssue: null,
    priority: 'NONE',
    progress: null,
    project: null,
    projectRole: null,
    status: {
      category: state.category,
      featureStatus: null,
      workflowState: state,
    },
    team: {
      archived: false,
      id: 'team-web',
      key: 'WEB',
      name: '웹',
    },
    title: `${identifier} 제목`,
    type: 'TEAM_TASK',
    updatedAt: '2026-07-01T00:00:00.000Z',
    version: 1,
    workflowSummary: null,
  };
}

describe('issue board view model', () => {
  it('워크플로 위치 순서로 열을 만들고 API 정렬을 유지한 채 상태별로 묶는다', () => {
    const firstTodo = issue('issue-1', 'WEB-1', todo);
    const doingIssue = issue('issue-2', 'WEB-2', doing);
    const secondTodo = issue('issue-3', 'WEB-3', todo);

    const columns = groupIssueBoardColumns([doing, todo], [firstTodo, doingIssue, secondTodo]);

    expect(columns.map((column) => column.state.id)).toEqual(['state-todo', 'state-doing']);
    expect(columns[0]?.issues.map((item) => item.id)).toEqual(['issue-1', 'issue-3']);
    expect(columns[1]?.issues.map((item) => item.id)).toEqual(['issue-2']);
  });

  it('목록 전환에서 필터·탭·정렬을 유지하고 불투명 커서는 넘기지 않는다', () => {
    const searchParams = new URLSearchParams(
      'tab=progress&priority=HIGH&sort=createdAt&direction=asc&cursor=stale',
    );

    expect(buildTeamIssueViewHref('WEB APP', 'issues', searchParams)).toBe(
      '/teams/WEB%20APP/issues?tab=progress&priority=HIGH&sort=createdAt&direction=asc',
    );
  });
});
