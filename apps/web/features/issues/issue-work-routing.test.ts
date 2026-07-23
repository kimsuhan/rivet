import { describe, expect, it } from 'vitest';

import {
  isExcludedFromMyWork,
  issueNotificationHref,
  issueWorkHref,
  matchesRequestedTeamWork,
  myWorkHref,
  projectIssueWorkHref,
} from './issue-work-routing';

describe('통합 이슈 상세 라우팅', () => {
  it('이슈와 팀 작업 식별자를 정본 work query 주소로 인코딩한다', () => {
    expect(issueWorkHref('F 10', 'WEB/2')).toBe('/issues/F%2010?tab=work&work=WEB%2F2');
    expect(issueWorkHref('F-10')).toBe('/issues/F-10?tab=work');
    expect(issueWorkHref('F-10', 'WEB-2', 'view/1')).toBe(
      '/issues/F-10?tab=work&work=WEB-2&view=view%2F1',
    );
  });

  it('프로젝트 진입 주소는 프로젝트 문맥과 탭을 유지한다', () => {
    expect(projectIssueWorkHref('project/1', 'F 10', 'WEB/2')).toBe(
      '/projects/project%2F1/issues/F%2010?tab=work&work=WEB%2F2',
    );
    expect(projectIssueWorkHref('project-1', 'F-10', undefined, 'activity')).toBe(
      '/projects/project-1/issues/F-10?tab=activity',
    );
  });

  it.each([
    {
      anchors: { commentId: null, handoffId: null, teamWorkIdentifier: 'WEB/2' },
      expected: '/issues/F%2010?tab=work&work=WEB%2F2',
    },
    {
      anchors: {
        commentId: '5cb38c29-d14f-4451-bd11-af837a6ac598',
        handoffId: null,
        teamWorkIdentifier: 'WEB/2',
      },
      expected: '/issues/F%2010?tab=work&work=WEB%2F2#comment-5cb38c29-d14f-4451-bd11-af837a6ac598',
    },
    {
      anchors: {
        commentId: null,
        handoffId: '5cb38c29-d14f-4451-bd11-af837a6ac598',
        teamWorkIdentifier: 'WEB/2',
      },
      expected:
        '/issues/F%2010?tab=work&work=WEB%2F2&handoff=5cb38c29-d14f-4451-bd11-af837a6ac598#handoff-5cb38c29-d14f-4451-bd11-af837a6ac598',
    },
  ])('알림 앵커를 정본 work 주소에 유지한다', ({ anchors, expected }) => {
    expect(issueNotificationHref('F 10', anchors)).toBe(expected);
  });

  it('팀 작업 딥 링크는 대소문자와 무관하게 선택한다', () => {
    expect(matchesRequestedTeamWork('WEB-12', 'web-12')).toBe(true);
    expect(matchesRequestedTeamWork('WEB-12', null)).toBe(false);
  });

  it('내 작업 상세는 팀 작업 표시 ID를 경로에 유지한다', () => {
    expect(myWorkHref('WEB/2')).toBe('/my-issues/WEB%2F2?tab=work');
    expect(myWorkHref('WEB-2', 'activity')).toBe('/my-issues/WEB-2?tab=activity');
    expect(myWorkHref('WEB-2', 'work', 'view/1')).toBe(
      '/my-issues/WEB-2?tab=work&view=view%2F1',
    );
  });

  it('재배정·완료·취소 작업을 내 작업 큐 제외 상태로 판단한다', () => {
    expect(isExcludedFromMyWork('STARTED', 'member-2', 'member-1')).toBe(true);
    expect(isExcludedFromMyWork('COMPLETED', 'member-1', 'member-1')).toBe(true);
    expect(isExcludedFromMyWork('CANCELED', 'member-1', 'member-1')).toBe(true);
    expect(isExcludedFromMyWork('UNSTARTED', 'member-1', 'member-1')).toBe(false);
  });
});
