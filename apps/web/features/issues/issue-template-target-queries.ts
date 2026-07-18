'use client';

import { useQuery } from '@tanstack/react-query';

import {
  getLabelsControllerListQueryKey,
  getProjectsControllerListQueryKey,
  labelsControllerList,
  projectsControllerList,
} from '@rivet/api-client';

async function loadAllPages<T>(
  loadPage: (cursor?: string) => Promise<{ items: T[]; nextCursor: string | null }>,
) {
  const items: T[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  do {
    const page = await loadPage(cursor);
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
    if (cursor && seenCursors.has(cursor)) {
      throw new Error('대상 목록 커서가 반복되었습니다.');
    }
    if (cursor) seenCursors.add(cursor);
  } while (cursor);

  return { items, nextCursor: null };
}

export function useIssueTemplateTargetOptions({ enabled = true }: { enabled?: boolean } = {}) {
  const labels = useQuery({
    enabled,
    queryFn: ({ signal }) =>
      loadAllPages((cursor) =>
        labelsControllerList(
          { includeArchived: false, limit: 100, ...(cursor ? { cursor } : {}) },
          { signal },
        ),
      ),
    queryKey: [...getLabelsControllerListQueryKey(), 'issue-template-all-active'],
    retry: false,
  });
  const projects = useQuery({
    enabled,
    queryFn: ({ signal }) =>
      loadAllPages((cursor) =>
        projectsControllerList(
          {
            includeArchived: false,
            limit: 100,
            sort: 'updatedAt',
            sortDirection: 'desc',
            ...(cursor ? { cursor } : {}),
          },
          { signal },
        ),
      ),
    queryKey: [...getProjectsControllerListQueryKey(), 'issue-template-all-active'],
    retry: false,
  });

  return { labels, projects };
}
