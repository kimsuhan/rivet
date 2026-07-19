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
});
