'use client';

import { Search, SearchX } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useSearchControllerIssues } from '@rivet/api-client';

import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useRouter } from '@/i18n/navigation';

import { issueWorkHref } from '../issues/issue-work-routing';

export type GlobalSearchLabels = {
  title: string; description: string; inputLabel: string; placeholder: string;
  emptyTitle: string; emptyDescription: string; minimumTitle: string; minimumDescription: string;
  loading: string; noResultsTitle: string; noResultsDescription: string; errorTitle: string;
  errorDescription: string; retry: string; results: string; resultCount: string; loadMore: string;
  loadingMore: string; loadMoreError: string; exactMatch: string; issue: string; teamWork: string;
  noProject: string; roles: Record<'APP_FRONTEND' | 'BACKEND' | 'WEB_FRONTEND', string>;
  issueStatuses: Record<'UNSORTED' | 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE' | 'PAUSED' | 'CANCELED', string>;
  stateCategories: Record<'BACKLOG' | 'UNSTARTED' | 'STARTED' | 'COMPLETED' | 'CANCELED', string>;
  close: string;
};

export function GlobalSearch({ open, onOpenChange, labels }: { open: boolean; onOpenChange: (open: boolean) => void; labels: GlobalSearchLabels }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { if (!open) return; const timeout = window.setTimeout(() => setDebounced(query.trim()), 200); return () => window.clearTimeout(timeout); }, [open, query]);
  const search = useSearchControllerIssues(
    { limit: 50, query: debounced },
    { query: { enabled: open && debounced.length >= 2, retry: false } },
  );
  const results = search.data?.items ?? [];

  function openResult(result: (typeof results)[number]) {
    onOpenChange(false);
    router.push(issueWorkHref(
      result.issue.identifier,
      result.resourceType === 'TEAM_WORK' ? result.teamWork?.identifier : undefined,
    ));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={labels.close} className="gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b p-4"><DialogTitle>{labels.title}</DialogTitle><DialogDescription>{labels.description}</DialogDescription></DialogHeader>
        <div className="relative border-b p-4"><Search className="text-muted-foreground absolute top-1/2 left-7 size-4 -translate-y-1/2" /><Input autoFocus aria-label={labels.inputLabel} className="pl-9" placeholder={labels.placeholder} value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        <div role="listbox" aria-label={labels.results} className="max-h-[60dvh] overflow-y-auto">
          {query.trim().length < 2 ? <Empty className="min-h-64"><EmptyHeader><EmptyMedia variant="icon"><Search /></EmptyMedia><EmptyTitle>{labels.minimumTitle}</EmptyTitle><EmptyDescription>{labels.minimumDescription}</EmptyDescription></EmptyHeader></Empty> : null}
          {search.isPending && debounced.length >= 2 ? <div aria-label={labels.loading} className="divide-y">{Array.from({ length: 4 }, (_, index) => <div key={index} className="p-4"><Skeleton className="h-4 w-3/4" /><Skeleton className="mt-2 h-3 w-1/2" /></div>)}</div> : null}
          {search.isError ? <Empty className="min-h-64"><EmptyHeader><EmptyMedia variant="icon"><SearchX /></EmptyMedia><EmptyTitle>{labels.errorTitle}</EmptyTitle><EmptyDescription>{labels.errorDescription}</EmptyDescription></EmptyHeader></Empty> : null}
          {search.data && results.length === 0 ? <Empty className="min-h-64"><EmptyHeader><EmptyMedia variant="icon"><SearchX /></EmptyMedia><EmptyTitle>{labels.noResultsTitle}</EmptyTitle><EmptyDescription>{labels.noResultsDescription}</EmptyDescription></EmptyHeader></Empty> : null}
          {results.map((result) => { const work = result.teamWork; return <button key={`${result.resourceType}-${work?.id ?? result.issue.id}`} type="button" role="option" aria-selected="false" className="hover:bg-muted/40 flex min-h-18 w-full items-center gap-3 border-b px-4 py-3 text-left" onClick={() => openResult(result)}><Badge variant="outline">{result.resourceType === 'TEAM_WORK' ? labels.teamWork : labels.issue}</Badge><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium"><span className="text-muted-foreground mr-2 font-mono text-xs">{work?.identifier ?? result.issue.identifier}</span>{result.issue.title}</span><span className="text-muted-foreground mt-1 block truncate text-xs">{result.issue.project.name}{work ? ` · ${labels.roles[work.projectRole]} · ${work.team.name}` : ` · ${labels.issueStatuses[result.issue.status]}`}</span></span>{result.matchType === 'IDENTIFIER_EXACT' ? <Badge variant="secondary">{labels.exactMatch}</Badge> : null}</button>; })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
