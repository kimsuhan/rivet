'use client';

import { Dot, Star } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

import { useSavedViewsControllerList } from '@rivet/api-client';

import {
  sidebarSubGroupClassName,
  sidebarSubItemClassName,
  sidebarSubItemStateClassName,
} from '@/components/layout/sidebar-section';
import { captureProductEvent } from '@/features/product-events/capture-product-event';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

import { savedViewHref } from './saved-view-navigation';

export function SavedViewSidebarNavigation({
  resourceType,
  expanded,
  onHasItemsChange,
}: {
  resourceType: 'ISSUES' | 'MY_WORK';
  expanded: boolean;
  onHasItemsChange?: (hasItems: boolean) => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get('view');
  const views = useSavedViewsControllerList({ resourceType }, { query: { retry: false } });
  const viewPathname = resourceType === 'ISSUES' ? '/issues' : '/my-issues';
  const resourceLabel = resourceType === 'ISSUES' ? '이슈' : '내 작업';
  const hasItems = Boolean(views.data?.items.length);

  useEffect(() => {
    onHasItemsChange?.(hasItems);
  }, [hasItems, onHasItemsChange]);

  if (!hasItems || !expanded) return null;

  return (
    <div
      role="group"
      aria-label={`${resourceLabel} 저장된 보기`}
      className={sidebarSubGroupClassName}
    >
      {views.data!.items.map((view) => {
        const active = pathname === viewPathname && selectedId === view.id;
        return (
          <Link
            key={view.id}
            href={savedViewHref(viewPathname, view)}
            onClick={() =>
              captureProductEvent('saved_view_opened', {
                resourceType,
                savedViewId: view.id,
              })
            }
            aria-current={active ? 'location' : undefined}
            title={`${view.name} · ${resourceLabel} 개인 보기`}
            className={cn(sidebarSubItemClassName, sidebarSubItemStateClassName(active))}
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
