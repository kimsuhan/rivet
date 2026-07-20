'use client';

import { RefreshCw, Users } from 'lucide-react';

import { useTeamsControllerList } from '@rivet/api-client';

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
  close: string;
  description: string;
  emptyDescription: string;
  emptyTitle: string;
  errorDescription: string;
  errorTitle: string;
  loading: string;
  myTeams: string;
  otherTeams: string;
  retry: string;
  title: string;
};

function teamHref(teamKey: string, teamView: TeamView): string {
  return `/teams/${encodeURIComponent(teamKey)}/${teamView}`;
}

export function DesktopTeamNavigation({
  currentTeamKey,
  labels,
  memberTeamIds,
  teamView,
}: {
  currentTeamKey: string | null;
  labels: TeamSelectorLabels;
  memberTeamIds: string[] | null;
  teamView: TeamView;
}) {
  const teams = useTeamsControllerList({ includeArchived: false }, { query: { retry: false } });
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
    <section
      aria-labelledby="desktop-team-navigation-title"
      className="flex min-h-0 flex-1 flex-col border-t p-2"
    >
      <h2
        id="desktop-team-navigation-title"
        className="text-muted-foreground mb-1 hidden px-2 text-xs font-medium xl:block"
      >
        {labels.title}
      </h2>

      {teams.isPending ? (
        <div className="flex h-9 items-center justify-center" aria-label={labels.loading}>
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

      {!teams.isPending && !teams.isError && items.length === 0 ? (
        <p className="text-muted-foreground hidden px-2 py-2 text-xs xl:block">
          {labels.emptyTitle}
        </p>
      ) : null}

      {items.length > 0 ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          {groups.map((group) => (
            <div key={group.id}>
              {group.label ? (
                <h3 className="text-muted-foreground mb-1 hidden px-2 text-[11px] font-medium xl:block">
                  {group.label}
                </h3>
              ) : null}
              <ul className="flex flex-col gap-1">
                {group.teams.map((team) => {
                  const active = currentTeamKey === team.key;

                  return (
                    <li key={team.id}>
                      <Link
                        href={teamHref(team.key, teamView)}
                        aria-current={active ? 'page' : undefined}
                        aria-label={`${team.name} (${team.key})`}
                        title={`${team.name} (${team.key})${memberTeamIdSet.has(team.id) ? ` · ${labels.myTeams}` : ''}`}
                        onClick={() => {
                          rememberTeamKey(team.key);
                          rememberTeamView(teamView);
                        }}
                        className={cn(
                          'focus-visible:ring-sidebar-ring flex h-8 items-center gap-2 rounded-md border-l-2 px-2 text-sm transition-colors outline-none focus-visible:ring-2',
                          active
                            ? 'border-primary bg-sidebar-accent text-sidebar-accent-foreground'
                            : 'text-sidebar-foreground hover:bg-surface-2 hover:text-foreground border-transparent',
                        )}
                      >
                        <code
                          className={cn(
                            'w-4 shrink-0 truncate rounded text-center text-xs xl:w-8',
                            active
                              ? 'text-sidebar-accent-foreground'
                              : 'bg-surface-2 text-muted-foreground',
                          )}
                        >
                          <span className="xl:hidden">{team.key.slice(0, 1)}</span>
                          <span className="hidden xl:inline">{team.key}</span>
                        </code>
                        <span className="hidden min-w-0 truncate xl:inline">{team.name}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
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
