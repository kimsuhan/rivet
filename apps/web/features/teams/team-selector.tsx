'use client';

import { Dot, RefreshCw, Users } from 'lucide-react';
import { type MouseEvent as ReactMouseEvent, useState } from 'react';

import { useTeamsControllerList } from '@rivet/api-client';

import {
  SidebarDisclosureButton,
  sidebarDisclosureRowClassName,
  SidebarSectionHeading,
  sidebarSubGroupClassName,
  sidebarSubItemClassName,
  sidebarSubItemStateClassName,
} from '@/components/layout/sidebar-section';
import { ContentEmpty } from '@/components/states/content-empty';
import { ContentError } from '@/components/states/content-error';
import { ContentLoading } from '@/components/states/content-loading';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

import { rememberTeamKey, rememberTeamView, type TeamView } from './team-selector-storage';

export type TeamSelectorLabels = {
  allTeams: string;
  close: string;
  collapseSection: string;
  collapseTeam: string;
  description: string;
  emptyDescription: string;
  emptyTitle: string;
  errorDescription: string;
  errorTitle: string;
  expandSection: string;
  expandTeam: string;
  loading: string;
  myTeams: string;
  myTeamsEmpty: string;
  otherTeams: string;
  retry: string;
  teamBoard: string;
  teamIssues: string;
  title: string;
};

function teamHref(teamKey: string, teamView: TeamView): string {
  return `/teams/${encodeURIComponent(teamKey)}/${teamView}`;
}

export function DesktopTeamNavigation({
  currentTeamKey,
  currentTeamView,
  expanded,
  labels,
  memberTeamIds,
  onOpenAllTeams,
  onToggleExpanded,
  teamView,
}: {
  currentTeamKey: string | null;
  currentTeamView: TeamView | null;
  expanded: boolean;
  labels: TeamSelectorLabels;
  memberTeamIds: string[] | null;
  onOpenAllTeams: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onToggleExpanded: () => void;
  teamView: TeamView;
}) {
  const [expandedTeamKeys, setExpandedTeamKeys] = useState<Record<string, boolean>>({});
  const teams = useTeamsControllerList({ includeArchived: false }, { query: { retry: false } });
  const memberTeamIdSet = new Set(memberTeamIds ?? []);
  // 사이드바에는 소속 팀만 두고 워크스페이스의 나머지 팀은 팀 선택 대화상자에서 찾는다.
  const items = (teams.data?.items ?? []).filter(
    (team) => !team.archived && (memberTeamIds === null || memberTeamIdSet.has(team.id)),
  );

  return (
    <section
      aria-labelledby="desktop-team-navigation-title"
      className="flex flex-col gap-0.5 border-t p-2"
    >
      <SidebarSectionHeading
        id="desktop-team-navigation-title"
        collapseLabel={labels.collapseSection.replace('{section}', labels.myTeams)}
        expandLabel={labels.expandSection.replace('{section}', labels.myTeams)}
        expanded={expanded}
        onToggle={onToggleExpanded}
      >
        {labels.myTeams}
      </SidebarSectionHeading>

      {teams.isPending ? (
        <div className="flex h-8 items-center justify-center" aria-label={labels.loading}>
          <Spinner aria-label={labels.loading} />
        </div>
      ) : null}

      {teams.isError ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          aria-label={labels.retry}
          title={labels.retry}
          onClick={() => void teams.refetch()}
        >
          <RefreshCw data-icon="inline-start" aria-hidden="true" />
          <span className="hidden xl:inline">{labels.retry}</span>
        </Button>
      ) : null}

      {!teams.isPending && !teams.isError ? (
        <div className={cn('flex flex-col gap-0.5', !expanded && 'xl:hidden')}>
          {items.length === 0 ? (
            <p className="text-muted-foreground hidden px-2 py-1 text-xs xl:block">
              {labels.myTeamsEmpty}
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {items.map((team) => {
                const active = currentTeamKey === team.key;
                const teamExpanded = expandedTeamKeys[team.key] ?? active;
                const views = [
                  { label: labels.teamIssues, view: 'issues' as const },
                  { label: labels.teamBoard, view: 'board' as const },
                ];

                return (
                  <li key={team.id} className="flex flex-col gap-0.5">
                    <div className={cn('flex items-center gap-0.5', sidebarDisclosureRowClassName)}>
                      <Link
                        href={teamHref(team.key, teamView)}
                        aria-current={active ? 'page' : undefined}
                        aria-label={`${team.name} (${team.key})`}
                        title={`${team.name} (${team.key})`}
                        onClick={() => {
                          rememberTeamKey(team.key);
                          rememberTeamView(teamView);
                        }}
                        className={cn(
                          'focus-visible:ring-sidebar-ring flex h-8 flex-1 items-center gap-2 rounded-md border-l-2 px-2 text-sm transition-colors outline-none focus-visible:ring-2',
                          active
                            ? 'border-primary bg-sidebar-accent text-sidebar-accent-foreground'
                            : 'text-sidebar-foreground hover:bg-surface-2 hover:text-foreground border-transparent',
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            'w-4 shrink-0 text-center text-[11px] font-medium',
                            active ? 'text-sidebar-accent-foreground' : 'text-muted-foreground',
                          )}
                        >
                          {team.key.slice(0, 1)}
                        </span>
                        <span className="hidden min-w-0 truncate xl:inline">{team.name}</span>
                      </Link>
                      <SidebarDisclosureButton
                        className="h-8"
                        collapseLabel={labels.collapseTeam.replace('{team}', team.name)}
                        expandLabel={labels.expandTeam.replace('{team}', team.name)}
                        expanded={teamExpanded}
                        onToggle={() =>
                          setExpandedTeamKeys((current) => ({
                            ...current,
                            [team.key]: !(current[team.key] ?? active),
                          }))
                        }
                      />
                    </div>

                    {teamExpanded ? (
                      <div
                        role="group"
                        aria-label={`${team.name} ${labels.title}`}
                        className={sidebarSubGroupClassName}
                      >
                        {views.map(({ label, view }) => {
                          const viewActive = active && currentTeamView === view;

                          return (
                            <Link
                              key={view}
                              href={teamHref(team.key, view)}
                              aria-current={viewActive ? 'location' : undefined}
                              onClick={() => {
                                rememberTeamKey(team.key);
                                rememberTeamView(view);
                              }}
                              className={cn(
                                sidebarSubItemClassName,
                                sidebarSubItemStateClassName(viewActive),
                              )}
                            >
                              <Dot
                                aria-hidden="true"
                                className={cn(
                                  'size-4 shrink-0',
                                  viewActive ? 'text-primary' : 'text-transparent',
                                )}
                                strokeWidth={3}
                              />
                              <span className="min-w-0 flex-1 truncate">{label}</span>
                            </Link>
                          );
                        })}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          <button
            type="button"
            onClick={onOpenAllTeams}
            aria-label={labels.allTeams}
            title={labels.allTeams}
            className="text-muted-foreground hover:bg-surface-2 hover:text-foreground focus-visible:ring-sidebar-ring flex h-8 items-center gap-2 rounded-md border-l-2 border-transparent px-2 text-sm transition-colors outline-none focus-visible:ring-2"
          >
            <Users aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
            <span className="hidden truncate xl:inline">{labels.allTeams}</span>
          </button>
        </div>
      ) : null}
    </section>
  );
}

export function TeamSelector({
  open,
  onOpenChange,
  labels,
  memberTeamIds,
  teamView,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labels: TeamSelectorLabels;
  memberTeamIds: string[] | null;
  teamView: TeamView;
}) {
  const teams = useTeamsControllerList(
    { includeArchived: false },
    { query: { enabled: open, retry: false } },
  );
  const items = (teams.data?.items ?? []).filter((team) => !team.archived);
  const memberTeamIdSet = new Set(memberTeamIds ?? []);
  const groups =
    memberTeamIds === null
      ? [{ id: 'all', label: null, teams: items }]
      : [
          {
            id: 'mine',
            label: labels.myTeams,
            teams: items.filter((team) => memberTeamIdSet.has(team.id)),
          },
          {
            id: 'other',
            label: labels.otherTeams,
            teams: items.filter((team) => !memberTeamIdSet.has(team.id)),
          },
        ].filter((group) => group.teams.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={labels.close}
        className="inset-0 h-dvh max-w-none translate-x-0 translate-y-0 grid-rows-[auto_1fr] rounded-none border-0 lg:inset-auto lg:top-1/2 lg:left-1/2 lg:h-auto lg:max-w-lg lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-xl lg:border"
      >
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>

        {teams.isPending ? <ContentLoading label={labels.loading} /> : null}
        {teams.isError ? (
          <ContentError
            title={labels.errorTitle}
            description={labels.errorDescription}
            retryLabel={labels.retry}
            onRetry={() => void teams.refetch()}
          />
        ) : null}
        {!teams.isPending && !teams.isError && items.length === 0 ? (
          <ContentEmpty
            icon={Users}
            title={labels.emptyTitle}
            description={labels.emptyDescription}
          />
        ) : null}
        {items.length > 0 ? (
          <div className="space-y-5 overflow-y-auto">
            {groups.map((group) => (
              <section key={group.id} aria-label={group.label ?? labels.title}>
                {group.label ? (
                  <h3 className="text-muted-foreground mb-2 text-xs font-medium">{group.label}</h3>
                ) : null}
                <ul className="divide-border rounded-lg border">
                  {group.teams.map((team) => (
                    <li key={team.id} className="border-b last:border-b-0">
                      <Link
                        href={teamHref(team.key, teamView)}
                        onClick={() => {
                          rememberTeamKey(team.key);
                          rememberTeamView(teamView);
                          onOpenChange(false);
                        }}
                        className="hover:bg-surface-2 focus-visible:ring-ring flex min-h-14 items-center gap-3 px-3 outline-none focus-visible:ring-2 focus-visible:ring-inset"
                      >
                        <code className="bg-surface-2 text-muted-foreground w-12 shrink-0 rounded px-2 py-1 text-center text-xs">
                          {team.key}
                        </code>
                        <span className="min-w-0 truncate font-medium">{team.name}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
