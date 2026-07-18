import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { labelsControllerList, projectsControllerList } from '@rivet/api-client';

import { useIssueTemplateTargetOptions } from './issue-template-target-queries';

vi.mock('@rivet/api-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  labelsControllerList: vi.fn(),
  projectsControllerList: vi.fn(),
}));

describe('useIssueTemplateTargetOptions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('라벨과 프로젝트 cursor를 끝까지 순회해 101번째 활성 대상을 포함한다', async () => {
    const firstLabels = Array.from({ length: 100 }, (_, index) => ({ id: `label-${index}` }));
    const lateLabel = { id: 'label-101' };
    const firstProjects = Array.from({ length: 100 }, (_, index) => ({
      id: `project-${index}`,
    }));
    const lateProject = { id: 'project-101' };
    vi.mocked(labelsControllerList)
      .mockResolvedValueOnce({ items: firstLabels, nextCursor: 'label-cursor' } as never)
      .mockResolvedValueOnce({ items: [lateLabel], nextCursor: null } as never);
    vi.mocked(projectsControllerList)
      .mockResolvedValueOnce({ items: firstProjects, nextCursor: 'project-cursor' } as never)
      .mockResolvedValueOnce({ items: [lateProject], nextCursor: null } as never);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useIssueTemplateTargetOptions(), { wrapper });

    await waitFor(() => {
      expect(result.current.labels.isSuccess).toBe(true);
      expect(result.current.projects.isSuccess).toBe(true);
    });
    expect(result.current.labels.data?.items).toHaveLength(101);
    expect(result.current.labels.data?.items[100]).toEqual(lateLabel);
    expect(result.current.projects.data?.items).toHaveLength(101);
    expect(result.current.projects.data?.items[100]).toEqual(lateProject);
    expect(labelsControllerList).toHaveBeenLastCalledWith(
      { cursor: 'label-cursor', includeArchived: false, limit: 100 },
      { signal: expect.any(AbortSignal) },
    );
    expect(projectsControllerList).toHaveBeenLastCalledWith(
      {
        cursor: 'project-cursor',
        includeArchived: false,
        limit: 100,
        sort: 'updatedAt',
        sortDirection: 'desc',
      },
      { signal: expect.any(AbortSignal) },
    );
  });
});
