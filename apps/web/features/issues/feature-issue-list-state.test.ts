import { describe, expect, it } from 'vitest';

import {
  buildFeatureIssueListParams,
  clearFeatureIssueDetailFilters,
  clearFeatureIssueListState,
  hasFeatureIssueDetailFilters,
  hasFeatureIssueFilters,
  readFeatureIssueListState,
  replaceFeatureIssueSearchParam,
} from './feature-issue-list-state';

describe('feature issue list state', () => {
  it('전체와 최근 수정일 내림차순을 기본으로 FEATURE만 조회한다', () => {
    const state = readFeatureIssueListState(new URLSearchParams());

    expect(state).toMatchObject({
      sort: 'updatedAt',
      sortDirection: 'desc',
      workQueue: 'ALL',
    });
    expect(buildFeatureIssueListParams(state)).toEqual({
      limit: 50,
      sort: 'updatedAt',
      sortDirection: 'desc',
      type: 'FEATURE',
    });
    expect(hasFeatureIssueFilters(state)).toBe(false);
  });

  it('빠른 필터와 같은 종류 OR 조건을 URL에서 복원해 API AND 파라미터로 만든다', () => {
    const state = readFeatureIssueListState(
      new URLSearchParams({
        activeProjectRole: 'BACKEND,WEB_FRONTEND,BAD_ROLE',
        createdByMembershipId: 'member-1,member-2',
        createdFrom: '2026-07-01',
        createdTo: '2026-07-12',
        cursor: 'opaque-cursor',
        featureStatus: 'TODO,IN_PROGRESS',
        labelId: 'label-1,label-2',
        priority: 'HIGH,URGENT',
        projectId: 'project-1,project-2',
        query: '  F-12  ',
        sort: 'progress',
        sortDirection: 'asc',
        unassigned: 'true',
        updatedFrom: '2026-07-02',
        updatedTo: '2026-07-11',
        workQueue: 'ASSIGNMENT_REQUIRED',
      }),
    );

    expect(buildFeatureIssueListParams(state)).toEqual({
      activeProjectRole: 'BACKEND,WEB_FRONTEND',
      createdByMembershipId: 'member-1,member-2',
      createdFrom: new Date(2026, 6, 1, 0, 0, 0, 0).toISOString(),
      createdTo: new Date(2026, 6, 12, 23, 59, 59, 999).toISOString(),
      cursor: 'opaque-cursor',
      featureStatus: 'TODO,IN_PROGRESS',
      labelId: 'label-1,label-2',
      limit: 50,
      priority: 'HIGH,URGENT',
      projectId: 'project-1,project-2',
      query: 'F-12',
      sort: 'progress',
      sortDirection: 'asc',
      type: 'FEATURE',
      unassigned: 'true',
      updatedFrom: new Date(2026, 6, 2, 0, 0, 0, 0).toISOString(),
      updatedTo: new Date(2026, 6, 11, 23, 59, 59, 999).toISOString(),
      workQueue: 'ASSIGNMENT_REQUIRED',
    });
    expect(hasFeatureIssueFilters(state)).toBe(true);
  });

  it('날짜 범위 입력값은 브라우저 로컬 날짜의 시작과 끝으로 변환한다', () => {
    const state = readFeatureIssueListState(
      new URLSearchParams('createdFrom=2026-01-10&updatedTo=2026-01-20'),
    );

    expect(buildFeatureIssueListParams(state)).toEqual(
      expect.objectContaining({
        createdFrom: new Date(2026, 0, 10, 0, 0, 0, 0).toISOString(),
        updatedTo: new Date(2026, 0, 20, 23, 59, 59, 999).toISOString(),
      }),
    );
  });

  it('잘못된 enum과 날짜는 기본값 또는 빈 필터로 복구한다', () => {
    const state = readFeatureIssueListState(
      new URLSearchParams({
        createdFrom: '07/12/2026',
        featureStatus: 'UNKNOWN',
        priority: 'CRITICAL',
        sort: 'random',
        sortDirection: 'sideways',
        workQueue: 'UNKNOWN',
      }),
    );

    expect(state).toMatchObject({
      createdFrom: '',
      featureStatuses: [],
      priorities: [],
      sort: 'updatedAt',
      sortDirection: 'desc',
      workQueue: 'ALL',
    });
  });

  it('필터나 정렬 변경 시 커서를 제거하고 커서 이동만 보존한다', () => {
    const current = new URLSearchParams('workQueue=IN_PROGRESS&cursor=old&query=login');

    expect(replaceFeatureIssueSearchParam(current, 'priority', ['HIGH', 'URGENT'])).toBe(
      'workQueue=IN_PROGRESS&query=login&priority=HIGH%2CURGENT',
    );
    expect(replaceFeatureIssueSearchParam(current, 'cursor', 'next')).toBe(
      'workQueue=IN_PROGRESS&cursor=next&query=login',
    );
  });

  it('초기화는 목록 상태만 제거하고 관계없는 URL 상태는 유지한다', () => {
    const current = new URLSearchParams(
      'workQueue=COMPLETED&projectId=project-1&sort=progress&cursor=next&debug=1',
    );

    expect(clearFeatureIssueListState(current)).toBe('debug=1');
  });

  it('세부 필터 초기화는 검색·빠른 필터·정렬을 보존한다', () => {
    const current = new URLSearchParams(
      'workQueue=IN_PROGRESS&query=login&priority=HIGH&projectId=project-1&sort=progress&cursor=next&debug=1',
    );

    expect(clearFeatureIssueDetailFilters(current)).toBe(
      'workQueue=IN_PROGRESS&query=login&sort=progress&debug=1',
    );
  });

  it('세부 필터 활성 여부를 검색과 빠른 필터와 분리한다', () => {
    const queueOnly = readFeatureIssueListState(
      new URLSearchParams('workQueue=REVIEW_REQUIRED&query=login'),
    );
    const detailed = readFeatureIssueListState(new URLSearchParams('priority=HIGH'));

    expect(hasFeatureIssueDetailFilters(queueOnly)).toBe(false);
    expect(hasFeatureIssueDetailFilters(detailed)).toBe(true);
  });
});
