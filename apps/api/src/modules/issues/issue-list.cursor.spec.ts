import { IssuePriority, IssueStatus } from '@rivet/database';

import { ApiError } from '../../common/errors/api-error';
import {
  encodeIssueListCursor,
  issueListFilterFingerprint,
  parseIssueListCursor,
} from './issue-list.cursor';
import type { IssueListFilters, IssueListOrderRow, IssueSortClause } from './issue-list.policy';

const filters: IssueListFilters = {
  creatorIds: ['3dc0b213-eafa-450c-ad12-49a7d927c7b8'],
  labelIds: [],
  priorities: [IssuePriority.HIGH],
  projectIds: ['05ed9724-f207-447d-9f18-7026f493d3fd'],
  query: '검색',
  statuses: [IssueStatus.TODO],
  workspaceId: '953685f0-4921-41cd-8422-d8a1ccc3f547',
};
const sorts: IssueSortClause[] = [
  { direction: 'desc', field: 'priority' },
  { direction: 'asc', field: 'updatedAt' },
  { direction: 'desc', field: 'progress' },
];
const row: IssueListOrderRow = {
  createdAt: new Date('2026-07-18T00:00:00.000Z'),
  id: 'b38a063f-d68f-4d9f-9bd6-5bd4993771eb',
  priorityRank: 3,
  progress: 67,
  statusRank: 1,
  updatedAt: new Date('2026-07-19T00:00:00.000Z'),
};

describe('issue list cursor', () => {
  it('round-trips every explicit sort value and the immutable id', () => {
    const fingerprint = issueListFilterFingerprint(filters);
    const encoded = encodeIssueListCursor(row, sorts, fingerprint);

    expect(parseIssueListCursor(encoded, sorts, fingerprint)).toEqual({
      id: row.id,
      values: [3, row.updatedAt, 67],
    });
  });

  it('normalizes set-like filters before fingerprinting', () => {
    expect(
      issueListFilterFingerprint({
        ...filters,
        creatorIds: [...filters.creatorIds].reverse(),
        projectIds: [...filters.projectIds].reverse(),
      }),
    ).toBe(issueListFilterFingerprint(filters));
  });

  it('rejects reuse with another filter or sort configuration', () => {
    const fingerprint = issueListFilterFingerprint(filters);
    const encoded = encodeIssueListCursor(row, sorts, fingerprint);

    expect(() =>
      parseIssueListCursor(encoded, [{ direction: 'desc', field: 'updatedAt' }], fingerprint),
    ).toThrow(ApiError);
    expect(() =>
      parseIssueListCursor(
        encoded,
        sorts,
        issueListFilterFingerprint({ ...filters, query: '다른 검색' }),
      ),
    ).toThrow(ApiError);
  });

  it('rejects non-canonical and tampered cursor values', () => {
    expect(() => parseIssueListCursor('not+a+cursor', sorts, 'fingerprint')).toThrow(ApiError);

    const invalidProgress = Buffer.from(
      JSON.stringify({
        f: 'fingerprint',
        i: row.id,
        k: [3, row.updatedAt.toISOString(), 101],
        s: 'priority:desc,updatedAt:asc,progress:desc',
        v: 1,
      }),
    ).toString('base64url');
    expect(() => parseIssueListCursor(invalidProgress, sorts, 'fingerprint')).toThrow(ApiError);
  });
});
