import { describe, expect, it } from 'vitest';

import { normalizeSavedViewConfiguration, savedViewHref } from './saved-view-navigation';

describe('saved view navigation', () => {
  it('serializes structured issue sorts in their saved order', () => {
    const configuration = {
      density: 'compact',
      sorts: [
        { direction: 'desc', field: 'priority' },
        { direction: 'asc', field: 'status' },
        { direction: 'desc', field: 'updatedAt' },
      ],
    };

    expect(normalizeSavedViewConfiguration(configuration)).toEqual({
      density: 'compact',
      sorts: 'priority:desc,status:asc,updatedAt:desc',
    });
    expect(savedViewHref('/issues', { configuration, id: 'view-1' })).toBe(
      '/issues?view=view-1&sorts=priority%3Adesc%2Cstatus%3Aasc%2CupdatedAt%3Adesc&density=compact',
    );
  });

  it('keeps my-work scalar sorting unchanged', () => {
    expect(
      normalizeSavedViewConfiguration({ sort: 'executionOrder', sortDirection: 'desc' }),
    ).toEqual({ sort: 'executionOrder', sortDirection: 'desc' });
  });

  it('여러 필터와 표시 필드, 2단계 그룹 설정을 저장 보기 주소로 복원한다', () => {
    const configuration = {
      assigneeMembershipId: 'member-1,member-2',
      groupBy: 'projectId',
      projectId: 'project-1,project-2',
      status: 'DONE,IN_PROGRESS',
      subGroupBy: 'status',
      unassigned: 'true',
      visibleFields: ['updatedAt', 'createdAt', 'updatedAt'],
    };

    expect(normalizeSavedViewConfiguration(configuration)).toEqual({
      projectId: 'project-1,project-2',
      status: 'DONE,IN_PROGRESS',
      assigneeMembershipId: 'member-1,member-2',
      unassigned: 'true',
      visibleFields: 'createdAt,updatedAt',
      groupBy: 'projectId',
      subGroupBy: 'status',
    });
  });

  it('표시 필드를 모두 숨긴 설정도 잃지 않는다', () => {
    expect(normalizeSavedViewConfiguration({ visibleFields: [] })).toEqual({
      visibleFields: 'none',
    });
  });
});
