import { describe, expect, it } from 'vitest';

import {
  isExcludedFromMyWork,
  issueWorkHref,
  matchesRequestedTeamWork,
  myWorkHref,
} from './issue-work-routing';

describe('통합 이슈 상세 라우팅', () => {
  it('이슈와 팀 작업 식별자를 정본 work query 주소로 인코딩한다', () => {
    expect(issueWorkHref('F 10', 'WEB/2')).toBe('/issues/F%2010?tab=work&work=WEB%2F2');
    expect(issueWorkHref('F-10')).toBe('/issues/F-10?tab=work');
  });

  it('팀 작업 딥 링크는 대소문자와 무관하게 선택한다', () => {
    expect(matchesRequestedTeamWork('WEB-12', 'web-12')).toBe(true);
    expect(matchesRequestedTeamWork('WEB-12', null)).toBe(false);
  });

  it('내 작업 상세는 팀 작업 표시 ID를 경로에 유지한다', () => {
    expect(myWorkHref('WEB/2')).toBe('/my-issues/WEB%2F2?tab=work');
    expect(myWorkHref('WEB-2', 'activity')).toBe('/my-issues/WEB-2?tab=activity');
  });

  it('재배정·완료·취소 작업을 내 작업 큐 제외 상태로 판단한다', () => {
    expect(isExcludedFromMyWork('STARTED', 'member-2', 'member-1')).toBe(true);
    expect(isExcludedFromMyWork('COMPLETED', 'member-1', 'member-1')).toBe(true);
    expect(isExcludedFromMyWork('CANCELED', 'member-1', 'member-1')).toBe(true);
    expect(isExcludedFromMyWork('UNSTARTED', 'member-1', 'member-1')).toBe(false);
  });
});
