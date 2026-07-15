'use client';

import { FileDown, FileUp, GitBranch, Tags, Trash2, UsersRound } from 'lucide-react';
import type { ReactNode } from 'react';

import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

type SettingsShellLabels = {
  export: string;
  import: string;
  labels: string;
  members: string;
  navigation: string;
  teams: string;
  title: string;
  trash: string;
};

const links = [
  { href: '/settings/members' as const, icon: UsersRound, label: 'members' as const },
  { href: '/settings/teams' as const, icon: GitBranch, label: 'teams' as const },
  { href: '/settings/labels' as const, icon: Tags, label: 'labels' as const },
  { href: '/settings/export' as const, icon: FileDown, label: 'export' as const },
  { href: '/settings/import' as const, icon: FileUp, label: 'import' as const },
  { href: '/settings/trash' as const, icon: Trash2, label: 'trash' as const },
];

export function SettingsShell({
  children,
  labels,
}: {
  children: ReactNode;
  labels: SettingsShellLabels;
}) {
  const pathname = usePathname();

  return (
    <div className="grid min-h-[calc(100dvh-3rem)] grid-cols-[12rem_minmax(0,1fr)] gap-8">
      <aside className="border-r pr-5">
        <p className="px-2 text-lg font-semibold tracking-[-0.015em]">{labels.title}</p>
        <nav aria-label={labels.navigation} className="mt-4 flex flex-col gap-1">
          {links.map(({ href, icon: Icon, label }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);

            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'focus-visible:ring-ring flex min-h-9 items-center gap-2 rounded-md px-2 text-sm outline-none focus-visible:ring-2',
                  active
                    ? 'bg-surface-2 text-foreground font-medium'
                    : 'text-muted-foreground hover:bg-surface-1 hover:text-foreground',
                )}
              >
                <Icon aria-hidden="true" className="size-4" strokeWidth={1.75} />
                <span>{labels[label]}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
      <section className="min-w-0 pb-10">{children}</section>
    </div>
  );
}
