import type { ObservabilityService } from '../../common/observability/observability.service';
import type { AuthenticatedRequestContext } from '../auth/authentication.context';
import { SearchController } from './search.controller';
import type { SearchService } from './search.service';

const authentication = {
  session: {
    membership: {
      id: '69b38d72-6a3b-4f3c-a2e7-2b2f6941c3dc',
      role: 'MEMBER',
      status: 'ACTIVE',
      workspaceId: '7f5f6cb1-d957-438d-aafe-a9b51d01ad5b',
    },
    workspace: { id: '7f5f6cb1-d957-438d-aafe-a9b51d01ad5b' },
  },
} as unknown as AuthenticatedRequestContext;

describe('SearchController analytics', () => {
  const issues = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
  const capture = jest.fn();
  const controller = new SearchController(
    { issues } as unknown as SearchService,
    { capture } as unknown as ObservabilityService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('captures only a successful first-page search without the query text', async () => {
    await controller.issues(authentication, { limit: 20, query: 'API-42' });
    await controller.issues(authentication, { cursor: 'next', limit: 20, query: 'API-42' });

    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        membershipId: authentication.session.membership?.id,
        name: 'search_performed',
        payloadVersion: 1,
        properties: { resultCount: 0, searchType: 'IDENTIFIER' },
        workspaceId: authentication.session.workspace?.id,
      }),
    );
    expect(capture).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        name: 'search_no_results',
        properties: { searchType: 'IDENTIFIER' },
      }),
    );
    expect(JSON.stringify(capture.mock.calls)).not.toContain('API-42');
  });
});
