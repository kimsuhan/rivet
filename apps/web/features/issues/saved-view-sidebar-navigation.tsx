'use client';

import { Dot, Star } from 'lucide-react';
import { useSearchParams } from 'next/navigation';

import { useSavedViewsControllerList } from '@rivet/api-client';

import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

import { savedViewHref } from './saved-view-navigation';

export function SavedViewSidebarNavigation({
  resourceType,
}: {
  resourceType: 'ISSUES' | 'MY_WORK';
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get('view');
  const views = useSavedViewsControllerList({ resourceType }, { query: { retry: false } });
  const viewPathname = resourceType === 'ISSUES' ? '/issues' : '/my-issues';
  const resourceLabel = resourceType === 'ISSUES' ? '이슈' : '내 작업';

  if (!views.data?.items.length) return null;

  return (
    <div
      role="group"
      aria-label={`${resourceLabel} 저장된 보기`}
      className="ml-4 hidden flex-col gap-0.5 border-l pl-2 xl:flex"
    >
      {views.data.items.map((view) => {
        const active = pathname === viewPathname && selectedId === view.id;
        return (
          <Link
            key={view.id}
            href={savedViewHref(viewPathname, view)}
            aria-current={active ? 'location' : undefined}
            title={`${view.name} · ${resourceLabel} 개인 보기`}
            className={cn(
              'focus-visible:ring-sidebar-ring flex h-7 items-center gap-1.5 rounded-md px-1.5 text-xs transition-colors outline-none focus-visible:ring-2',
              active
                ? 'text-sidebar-accent-foreground font-medium'
                : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
            )}
          >
            <Dot
              aria-hidden="true"
              className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-transparent')}
              strokeWidth={3}
            />
            <span className="min-w-0 flex-1 truncate">{view.name}</span>
            {view.isDefault ? (
              <Star aria-label="기본 보기" className="text-muted-foreground size-3.5 shrink-0" />
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}
