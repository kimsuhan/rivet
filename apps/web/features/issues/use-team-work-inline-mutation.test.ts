import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTeamWorkInlineMutation } from './use-team-work-inline-mutation';

const reactQueryMocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn().mockResolvedValue(undefined),
  mutationOptions: null as null | { onSettled: () => void },
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: (options: { onSettled: () => void }) => {
    reactQueryMocks.mutationOptions = options;
    return { mutate: vi.fn() };
  },
  useQueryClient: () => ({
    invalidateQueries: reactQueryMocks.invalidateQueries,
  }),
}));

describe('useTeamWorkInlineMutation', () => {
  beforeEach(() => {
    reactQueryMocks.invalidateQueries.mockClear();
    reactQueryMocks.mutationOptions = null;
  });

  it('팀 작업 변경이 끝나면 목록과 그룹 요약 캐시를 함께 무효화한다', () => {
    useTeamWorkInlineMutation(
      {
        id: 'team-work-id',
        version: 1,
      } as never,
      'workflowState',
    );

    reactQueryMocks.mutationOptions?.onSettled();

    expect(reactQueryMocks.invalidateQueries).toHaveBeenCalledTimes(4);
    expect(reactQueryMocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['/api/v1/team-works'],
    });
    expect(reactQueryMocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['/api/v1/team-works/groups'],
    });
    expect(reactQueryMocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['/api/v1/issues'],
    });
    expect(reactQueryMocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['/api/v1/issues/groups'],
    });
  });
});
