'use client';

import { useEffect } from 'react';

import { useProjectsControllerList } from '@rivet/api-client';

import {
  sidebarSubGroupClassName,
  sidebarSubItemClassName,
  sidebarSubItemStateClassName,
} from '@/components/layout/sidebar-section';
import { ProjectLogo } from '@/components/project-logo';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

export function ProjectSidebarNavigation({
  expanded,
  memberTeamIds,
  onHasItemsChange,
}: {
  expanded: boolean;
  memberTeamIds: string[] | null;
  onHasItemsChange?: (hasItems: boolean) => void;
}) {
  const pathname = usePathname();
  const projects = useProjectsControllerList(
    { includeArchived: false, limit: 100, sort: 'updatedAt', sortDirection: 'desc' },
    { query: { retry: false } },
  );
  const memberTeamIdSet = new Set(memberTeamIds ?? []);
  const visibleProjects =
    projects.data?.items.filter((project) =>
      project.projectTeams.some(({ active, team }) => active && memberTeamIdSet.has(team.id)),
    ) ?? [];
  const hasItems = visibleProjects.length > 0;

  useEffect(() => {
    onHasItemsChange?.(hasItems);
  }, [hasItems, onHasItemsChange]);

  if (!hasItems || !expanded) return null;

  return (
    <div role="group" aria-label="프로젝트 목록" className={sidebarSubGroupClassName}>
      {visibleProjects.map((project) => {
        const href = `/projects/${project.id}` as const;
        const active = pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            key={project.id}
            href={href}
            aria-current={active ? 'location' : undefined}
            title={`${project.name} 프로젝트 이슈 보기`}
            className={cn(sidebarSubItemClassName, sidebarSubItemStateClassName(active))}
          >
            <ProjectLogo logoFileId={project.logoFileId} name={project.name} size="xs" />
            <span className="min-w-0 flex-1 truncate">{project.name}</span>
          </Link>
        );
      })}
    </div>
  );
}
