import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ISSUE_VISIBLE_FIELDS,
  DEFAULT_MY_WORK_VISIBLE_FIELDS,
  parseCsv,
  serializeCsv,
  visibleFieldsFromSearch,
} from './issue-view-configuration';

describe('issue view configuration', () => {
  it('여러 필터 값을 중복 없이 안정적인 순서로 직렬화한다', () => {
    expect(parseCsv('DONE,TODO,DONE,')).toEqual(['DONE', 'TODO']);
    expect(serializeCsv(['TODO', 'DONE', 'TODO'])).toBe('DONE,TODO');
  });

  it('필드 설정이 없으면 보기별 기본 표시 필드를 사용한다', () => {
    expect(visibleFieldsFromSearch(null, 'ISSUES')).toEqual(DEFAULT_ISSUE_VISIBLE_FIELDS);
    expect(visibleFieldsFromSearch(null, 'MY_WORK')).toEqual(DEFAULT_MY_WORK_VISIBLE_FIELDS);
  });

  it('저장된 표시 필드는 지원하는 필드만 정의된 순서로 복원한다', () => {
    expect(visibleFieldsFromSearch('updatedAt,unknown,createdAt', 'ISSUES')).toEqual([
      'createdAt',
      'updatedAt',
    ]);
    expect(visibleFieldsFromSearch('none', 'MY_WORK')).toEqual([]);
  });
});
