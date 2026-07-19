import { ApiError } from '../../common/errors/api-error';
import { parseIssueSorts, serializeIssueSorts } from './issue-list-sort.parser';

describe('issue list sort parser', () => {
  it('uses updatedAt descending by default and keeps legacy query compatibility', () => {
    expect(parseIssueSorts({})).toEqual([{ direction: 'desc', field: 'updatedAt' }]);
    expect(parseIssueSorts({ sort: 'status', sortDirection: 'asc' })).toEqual([
      { direction: 'asc', field: 'status' },
    ]);
    expect(parseIssueSorts({ sortDirection: 'asc' })).toEqual([
      { direction: 'asc', field: 'updatedAt' },
    ]);
  });

  it('parses and serializes up to three unique sort clauses in order', () => {
    const sorts = parseIssueSorts({
      sorts: 'priority:desc,status:asc,updatedAt:desc',
    });

    expect(sorts).toEqual([
      { direction: 'desc', field: 'priority' },
      { direction: 'asc', field: 'status' },
      { direction: 'desc', field: 'updatedAt' },
    ]);
    expect(serializeIssueSorts(sorts)).toBe('priority:desc,status:asc,updatedAt:desc');
  });

  it.each([
    { sorts: '' },
    { sorts: 'priority:sideways' },
    { sorts: 'priority:desc,priority:asc' },
    { sorts: 'priority:desc,status:asc,updatedAt:desc,createdAt:asc' },
    { sort: 'priority' as const, sorts: 'status:asc' },
    { sortDirection: 'desc' as const, sorts: 'status:asc' },
  ])('rejects malformed, duplicate, oversized, or mixed conditions: %o', (query) => {
    expect(() => parseIssueSorts(query)).toThrow(ApiError);
  });
});
