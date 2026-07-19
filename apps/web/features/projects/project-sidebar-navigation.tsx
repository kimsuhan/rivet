'use client';

import { Dot } from 'lucide-react';
import { useEffect } from 'react';

import { useProjectsControllerList } from '@rivet/api-client';

import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

export function ProjectSidebarNavigation({
  expanded,
  onHasItemsChange,
}: {
  expanded: boolean;
  onHasItemsChange?: (hasItems: boolean) => void;
}) {
  const pathname = usePathname();
  const projects = useProjectsControllerList(
    { includeArchived: false, limit: 100, sort: 'updatedAt', sortDirection: 'desc' },
    { query: { retry: false } },
  );
  const hasItems = Boolean(projects.data?.items.length);

  useEffect(() => {
    onHasItemsChange?.(hasItems);
  }, [hasItems, onHasItemsChange]);

  if (!hasItems || !expanded) return null;

  return (
    <div
      role="group"
      aria-label="프로젝트 목록"
      className="ml-4 hidden flex-col gap-0.5 border-l pl-2 xl:flex"
    >
      {projects.data!.items.map((project) => {
        const href = `/projects/${project.id}` as const;
        const active = pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            key={project.id}
            href={href}
            aria-current={active ? 'location' : undefined}
            title={`${project.name} 프로젝트 이슈 보기`}
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
            <span className="min-w-0 flex-1 truncate">{project.name}</span>
          </Link>
        );
      })}
    </div>
  );
}
