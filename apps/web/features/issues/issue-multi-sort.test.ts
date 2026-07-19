import { describe, expect, it } from 'vitest';

import {
  issueSortsFromSearchParams,
  normalizeIssueSorts,
  parseIssueSortsParameter,
  serializeIssueSorts,
} from './issue-multi-sort';

describe('issue multi sort', () => {
  it('parses and serializes an ordered three-clause URL value', () => {
    const sorts = parseIssueSortsParameter('priority:desc,status:asc,updatedAt:desc');

    expect(sorts).toEqual([
      { direction: 'desc', field: 'priority' },
      { direction: 'asc', field: 'status' },
      { direction: 'desc', field: 'updatedAt' },
    ]);
    expect(serializeIssueSorts(sorts!)).toBe('priority:desc,status:asc,updatedAt:desc');
  });

  it('uses legacy scalar values when the new parameter is absent', () => {
    expect(
      issueSortsFromSearchParams(new URLSearchParams('sort=progress&sortDirection=asc')),
    ).toEqual([{ direction: 'asc', field: 'progress' }]);
  });

  it('falls back to the default when URL sorting is malformed', () => {
    expect(issueSortsFromSearchParams(new URLSearchParams('sorts=priority:sideways'))).toEqual([
      { direction: 'desc', field: 'updatedAt' },
    ]);
  });

  it('rejects duplicate and oversized structured saved-view values', () => {
    expect(
      normalizeIssueSorts([
        { direction: 'desc', field: 'priority' },
        { direction: 'asc', field: 'priority' },
      ]),
    ).toBeNull();
    expect(
      normalizeIssueSorts([
        { direction: 'desc', field: 'priority' },
        { direction: 'asc', field: 'status' },
        { direction: 'desc', field: 'updatedAt' },
        { direction: 'asc', field: 'createdAt' },
      ]),
    ).toBeNull();
  });
});
