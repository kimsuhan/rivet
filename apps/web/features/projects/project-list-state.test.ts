import { describe, expect, it } from 'vitest';

import {
  buildProjectListParams,
  clearProjectListFilters,
  readProjectListState,
  replaceProjectListParam,
} from './project-list-state';

describe('project list URL state', () => {
  it('알 수 없는 값은 안정적인 기본 정렬로 복구한다', () => {
    const state = readProjectListState(
      new URLSearchParams('status=UNKNOWN&sort=name&direction=sideways&archived=true'),
    );

    expect(state).toEqual({
      cursor: null,
      includeArchived: true,
      sort: 'updatedAt',
      sortDirection: 'desc',
      status: null,
    });
    expect(buildProjectListParams(state)).toEqual({
      includeArchived: true,
      limit: 50,
      sort: 'updatedAt',
      sortDirection: 'desc',
    });
  });

  it('필터나 정렬을 바꾸면 이전 커서를 제거한다', () => {
    expect(
      replaceProjectListParam(
        new URLSearchParams('status=PLANNED&cursor=opaque'),
        'status',
        'COMPLETED',
      ),
    ).toBe('status=COMPLETED');
  });

  it('필터 초기화는 사용자가 고른 정렬을 유지한다', () => {
    expect(
      clearProjectListFilters(
        new URLSearchParams(
          'status=PLANNED&archived=true&cursor=opaque&sort=targetDate&direction=asc',
        ),
      ),
    ).toBe('sort=targetDate&direction=asc');
  });
});
