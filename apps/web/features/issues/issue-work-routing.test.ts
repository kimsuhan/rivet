import { describe, expect, it } from 'vitest';

import { issueWorkHref, matchesRequestedTeamWork } from './issue-work-routing';

describe('통합 이슈 상세 라우팅', () => {
  it('이슈와 팀 작업 식별자를 정본 work query 주소로 인코딩한다', () => {
    expect(issueWorkHref('F 10', 'WEB/2')).toBe('/issues/F%2010?tab=work&work=WEB%2F2');
    expect(issueWorkHref('F-10')).toBe('/issues/F-10?tab=work');
  });

  it('팀 작업 딥 링크는 대소문자와 무관하게 선택한다', () => {
    expect(matchesRequestedTeamWork('WEB-12', 'web-12')).toBe(true);
    expect(matchesRequestedTeamWork('WEB-12', null)).toBe(false);
  });
});
