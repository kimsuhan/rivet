'use client';

import {
  Bell,
  CircleDot,
  FolderKanban,
  ListTodo,
  type LucideIcon,
  Plus,
  Search,
  Settings,
  Users,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import {
  useAuthControllerGetSession,
  useNotificationsControllerUnreadCount,
} from '@rivet/api-client';

import { UserAvatar } from '@/components/user-avatar';
import {
  GlobalIssueCreate,
  type IssueCreateLabels,
  type IssueCreateSeed,
} from '@/features/issues/global-issue-create';
import { ProfileDialog, type ProfileDialogLabels } from '@/features/profile/profile-dialog';
import { GlobalSearch, type GlobalSearchLabels } from '@/features/search/global-search';
import {
  DesktopTeamNavigation,
  TeamSelector,
  type TeamSelectorLabels,
} from '@/features/teams/team-selector';
import {
  readLastTeamView,
  rememberTeamKey,
  rememberTeamView,
  subscribeLastTeamView,
  type TeamView,
} from '@/features/teams/team-selector-storage';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

type ShellLabels = {
  brandLabel: string;
  desktopNavigation: string;
  mobileNavigation: string;
  openIssueCreate: string;
  openSearch: string;
  openTeamSelector: string;
  openProfile: string;
  skipToContent: string;
  inboxUnread: string;
  navigation: {
    issues: string;
    myIssues: string;
    inbox: string;
    teams: string;
    projects: string;
    search: string;
    settings: string;
  };
  issueCreate: IssueCreateLabels;
  search: GlobalSearchLabels;
  teamSelector: TeamSelectorLabels;
  profile: ProfileDialogLabels;
};

type NavigationItem = {
  href: '/issues' | '/my-issues' | '/inbox' | '/projects';
  label: string;
  icon: LucideIcon;
};

function NotificationCountBadge({ className, count }: { className?: string; count: number }) {
  if (count < 1) return null;

  return (
    <span
      aria-hidden="true"
      className={cn(
        'bg-primary text-primary-foreground flex h-4 min-w-4 items-center justify-center rounded-full px-0.5 text-[10px] leading-none font-semibold tabular-nums',
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

function isCurrentPath(pathname: string, href: NavigationItem['href']): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function currentTeamLocation(pathname: string): { teamKey: string; view: TeamView } | null {
  const match = pathname.match(/^\/teams\/([^/]+)\/(issues|board)(?:\/|$)/);
  const teamKey = match?.[1];
  const view = match?.[2];

  if (!teamKey || (view !== 'issues' && view !== 'board')) return null;
  return { teamKey: decodeURIComponent(teamKey), view };
}

function defaultTeamView(): TeamView {
  return 'issues';
}

export function AppShell({ children, labels }: { children: ReactNode; labels: ShellLabels }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchOpen, setSearchOpen] = useState(false);
  const [teamSelectorOpen, setTeamSelectorOpen] = useState(false);
  const [issueCreateOpen, setIssueCreateOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [issueCreateSeed, setIssueCreateSeed] = useState<IssueCreateSeed | null>(null);
  const storedTeamView = useSyncExternalStore(
    subscribeLastTeamView,
    readLastTeamView,
    defaultTeamView,
  );
  const session = useAuthControllerGetSession({ query: { retry: false } });
  const unreadNotifications = useNotificationsControllerUnreadCount({
    query: {
      enabled: Boolean(session.data?.authenticated),
      retry: false,
    },
  });
  const lastIssueCreateTrigger = useRef<HTMLElement | null>(null);
  const lastProfileTrigger = useRef<HTMLElement | null>(null);
  const lastSearchTrigger = useRef<HTMLElement | null>(null);
  const lastTeamSelectorTrigger = useRef<HTMLElement | null>(null);
  const consumedIssueCreateRequest = useRef<string | null>(null);
  const navigationItems: NavigationItem[] = [
    { href: '/issues', label: labels.navigation.issues, icon: CircleDot },
    { href: '/my-issues', label: labels.navigation.myIssues, icon: ListTodo },
    { href: '/inbox', label: labels.navigation.inbox, icon: Bell },
    { href: '/projects', label: labels.navigation.projects, icon: FolderKanban },
  ];
  const canManageWorkspace = Boolean(
    session.data?.authenticated &&
    session.data.membership?.role === 'ADMIN' &&
    session.data.membership.status === 'ACTIVE',
  );
  const unreadNotificationCount = unreadNotifications.data?.count ?? 0;
  const inboxNavigationLabel =
    unreadNotificationCount > 0
      ? labels.inboxUnread.replace(
          '{count}',
          new Intl.NumberFormat('ko-KR').format(unreadNotificationCount),
        )
      : labels.navigation.inbox;
  const selectedTeamLocation = currentTeamLocation(pathname);
  const selectedTeamKey = selectedTeamLocation?.teamKey ?? null;
  const selectedTeamView = selectedTeamLocation?.view ?? null;
  const lastTeamView = selectedTeamView ?? storedTeamView;

  useEffect(() => {
    if (selectedTeamKey && selectedTeamView) {
      rememberTeamKey(selectedTeamKey);
      rememberTeamView(selectedTeamView);
    }
  }, [selectedTeamKey, selectedTeamView]);

  useLayoutEffect(() => {
    function openGlobalOverlay(event: KeyboardEvent) {
      const target = event.target;
      const isEditing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement &&
          (target.isContentEditable ||
            target.closest('[contenteditable]:not([contenteditable="false"])') !== null));

      const hasCommandModifier = event.metaKey || event.ctrlKey || event.altKey;

      if (
        (event.key === '/' || event.code === 'Slash') &&
        !isEditing &&
        !hasCommandModifier &&
        !issueCreateOpen &&
        !teamSelectorOpen &&
        !profileOpen
      ) {
        event.preventDefault();
        lastSearchTrigger.current =
          document.activeElement instanceof HTMLElement && document.activeElement !== document.body
            ? document.activeElement
            : null;
        setSearchOpen(true);
        return;
      }

      const isDesktop =
        typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 64rem)').matches;

      if (
        (event.key.toLowerCase() === 'c' || event.code === 'KeyC') &&
        !isEditing &&
        !hasCommandModifier &&
        isDesktop &&
        !issueCreateOpen &&
        !searchOpen &&
        !teamSelectorOpen &&
        !profileOpen
      ) {
        event.preventDefault();
        lastIssueCreateTrigger.current =
          document.activeElement instanceof HTMLElement && document.activeElement !== document.body
            ? document.activeElement
            : null;
        setIssueCreateSeed(null);
        setIssueCreateOpen(true);
      }
    }

    window.addEventListener('keydown', openGlobalOverlay);
    return () => window.removeEventListener('keydown', openGlobalOverlay);
  }, [issueCreateOpen, profileOpen, searchOpen, teamSelectorOpen]);

  useEffect(() => {
    if (searchParams.get('create') !== '1') return;

    const requestKey = `${pathname}?${searchParams.toString()}`;
    if (consumedIssueCreateRequest.current === requestKey) return;
    consumedIssueCreateRequest.current = requestKey;

    setIssueCreateSeed({
      ...(searchParams.get('projectId') ? { projectId: searchParams.get('projectId')! } : {}),
    });
    setIssueCreateOpen(true);
  }, [pathname, searchParams]);

  useEffect(() => {
    if (!issueCreateOpen || searchParams.get('create') !== '1') return;

    const nextSearchParams = new URLSearchParams(searchParams.toString());
    for (const key of ['create', 'projectId']) {
      nextSearchParams.delete(key);
    }
    const nextSearch = nextSearchParams.toString();
    router.replace(`${pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`, {
      scroll: false,
    });
  }, [issueCreateOpen, pathname, router, searchParams]);

  function openSearchFromTrigger(event: ReactMouseEvent<HTMLButtonElement>) {
    lastSearchTrigger.current = event.currentTarget;
    setSearchOpen(true);
  }

  function changeSearchOpen(open: boolean) {
    setSearchOpen(open);

    if (!open) {
      requestAnimationFrame(() => lastSearchTrigger.current?.focus());
    }
  }

  function openIssueCreateFromTrigger(event: ReactMouseEvent<HTMLButtonElement>) {
    lastIssueCreateTrigger.current = event.currentTarget;
    setIssueCreateSeed(null);
    setIssueCreateOpen(true);
  }

  function changeIssueCreateOpen(open: boolean) {
    setIssueCreateOpen(open);

    if (!open) {
      consumedIssueCreateRequest.current = null;
      requestAnimationFrame(() => lastIssueCreateTrigger.current?.focus());
    }
  }

  function openTeamSelectorFromTrigger(event: ReactMouseEvent<HTMLButtonElement>) {
    lastTeamSelectorTrigger.current = event.currentTarget;
    setTeamSelectorOpen(true);
  }

  function openProfileFromTrigger(event: ReactMouseEvent<HTMLButtonElement>) {
    lastProfileTrigger.current = event.currentTarget;
    setProfileOpen(true);
  }

  function changeProfileOpen(open: boolean) {
    setProfileOpen(open);

    if (!open) {
      requestAnimationFrame(() => lastProfileTrigger.current?.focus());
    }
  }

  function changeTeamSelectorOpen(open: boolean) {
    setTeamSelectorOpen(open);

    if (!open) {
      requestAnimationFrame(() => lastTeamSelectorTrigger.current?.focus());
    }
  }

  return (
    <div className="bg-background min-h-dvh lg:pl-14 xl:pl-60">
      <a
        href="#workspace-main-content"
        className="bg-background text-foreground focus:ring-ring app-floating-layer sr-only rounded-md px-3 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:ring-2"
      >
        {labels.skipToContent}
      </a>
      <aside
        aria-label={labels.desktopNavigation}
        className="app-sticky-layer bg-sidebar fixed inset-y-0 left-0 hidden w-14 flex-col border-r lg:flex xl:w-60"
      >
        <div className="flex h-14 shrink-0 items-center border-b px-3 xl:px-4">
          <Link
            href="/my-issues"
            aria-label={labels.brandLabel}
            className="focus-visible:ring-ring flex items-center gap-2 rounded-md outline-none focus-visible:ring-2"
          >
            <span
              aria-hidden="true"
              className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md text-sm font-semibold"
            >
              R
            </span>
            <span className="hidden text-sm font-semibold tracking-[-0.01em] xl:inline">Rivet</span>
          </Link>
        </div>

        <div className="border-b p-2">
          <button
            type="button"
            onClick={openIssueCreateFromTrigger}
            aria-label={labels.openIssueCreate}
            aria-pressed={issueCreateOpen}
            title={labels.issueCreate.submit}
            className="bg-primary text-primary-foreground hover:bg-primary/80 focus-visible:ring-sidebar-ring mb-1 flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2"
          >
            <Plus aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
            <span className="hidden xl:inline">{labels.issueCreate.submit}</span>
            <kbd className="text-primary-foreground/75 ml-auto hidden font-mono text-xs xl:inline">
              C
            </kbd>
          </button>
          <button
            type="button"
            onClick={openSearchFromTrigger}
            aria-label={labels.openSearch}
            title={labels.navigation.search}
            className="text-sidebar-foreground hover:bg-surface-2 hover:text-foreground focus-visible:ring-sidebar-ring flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm transition-colors outline-none focus-visible:ring-2"
          >
            <Search aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
            <span className="hidden xl:inline">{labels.navigation.search}</span>
            <kbd className="text-muted-foreground ml-auto hidden font-mono text-xs xl:inline">
              /
            </kbd>
          </button>
        </div>

        <nav className="flex flex-col gap-1 p-2" aria-label={labels.desktopNavigation}>
          {navigationItems.map(({ href, label, icon: Icon }) => {
            const active = isCurrentPath(pathname, href);

            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                aria-label={href === '/inbox' ? inboxNavigationLabel : label}
                title={label}
                className={cn(
                  'focus-visible:ring-sidebar-ring relative flex h-8 items-center gap-2 rounded-md border-l-2 px-2 text-sm transition-colors outline-none focus-visible:ring-2',
                  active
                    ? 'border-primary bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground hover:bg-surface-2 hover:text-foreground border-transparent',
                )}
              >
                <span className="relative shrink-0">
                  <Icon aria-hidden="true" className="size-4" strokeWidth={1.75} />
                  {href === '/inbox' ? (
                    <NotificationCountBadge
                      count={unreadNotificationCount}
                      className="absolute -top-2 left-2 xl:hidden"
                    />
                  ) : null}
                </span>
                <span className="hidden truncate xl:inline">{label}</span>
                {href === '/inbox' ? (
                  <NotificationCountBadge
                    count={unreadNotificationCount}
                    className="ml-auto hidden xl:flex"
                  />
                ) : null}
              </Link>
            );
          })}
        </nav>

        <DesktopTeamNavigation
          currentTeamKey={selectedTeamKey}
          labels={labels.teamSelector}
          teamView={lastTeamView}
        />

        {session.data?.authenticated ? (
          <div className="mt-auto flex flex-col gap-1 border-t p-2">
            <button
              type="button"
              onClick={openProfileFromTrigger}
              aria-label={labels.openProfile}
              aria-pressed={profileOpen}
              title={labels.profile.title}
              className="text-sidebar-foreground hover:bg-surface-2 hover:text-foreground focus-visible:ring-sidebar-ring flex h-8 w-full items-center gap-2 rounded-md px-1 text-left text-sm transition-colors outline-none focus-visible:ring-2"
            >
              <UserAvatar
                avatarFileId={session.data.user.avatarFileId}
                displayName={session.data.user.displayName}
                size="sm"
              />
              <span className="hidden min-w-0 flex-1 truncate xl:inline">
                {session.data.user.displayName}
              </span>
            </button>
            {canManageWorkspace ? (
              <Link
                href="/settings/members"
                aria-current={pathname.startsWith('/settings') ? 'page' : undefined}
                aria-label={labels.navigation.settings}
                title={labels.navigation.settings}
                className={cn(
                  'focus-visible:ring-sidebar-ring flex h-8 items-center gap-2 rounded-md border-l-2 px-2 text-sm transition-colors outline-none focus-visible:ring-2',
                  pathname.startsWith('/settings')
                    ? 'border-primary bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground hover:bg-surface-2 hover:text-foreground border-transparent',
                )}
              >
                <Settings aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
                <span className="hidden truncate xl:inline">{labels.navigation.settings}</span>
              </Link>
            ) : null}
          </div>
        ) : null}
      </aside>

      <header className="app-sticky-layer bg-surface-1 fixed inset-x-0 top-0 flex h-13 items-center justify-between border-b px-4 min-[361px]:px-5 lg:hidden">
        <Link
          href="/my-issues"
          aria-label={labels.brandLabel}
          className="focus-visible:ring-ring rounded-md text-sm font-semibold tracking-[-0.01em] outline-none focus-visible:ring-2"
        >
          Rivet
        </Link>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={openSearchFromTrigger}
            aria-label={labels.openSearch}
            aria-pressed={searchOpen}
            className={cn(
              'focus-visible:ring-ring flex size-10 items-center justify-center rounded-md outline-none focus-visible:ring-2',
              searchOpen ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            <Search aria-hidden="true" className="size-5" strokeWidth={1.75} />
          </button>
          {session.data?.authenticated ? (
            <button
              type="button"
              onClick={openProfileFromTrigger}
              aria-label={labels.openProfile}
              aria-pressed={profileOpen}
              title={labels.profile.title}
              className="focus-visible:ring-ring flex size-10 items-center justify-center rounded-full outline-none focus-visible:ring-2"
            >
              <UserAvatar
                avatarFileId={session.data.user.avatarFileId}
                displayName={session.data.user.displayName}
                className="size-7"
              />
            </button>
          ) : null}
        </div>
      </header>

      <main
        id="workspace-main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-[720px] px-4 pt-[68px] pb-[calc(5rem+env(safe-area-inset-bottom))] min-[361px]:px-5 lg:max-w-none lg:px-5 lg:pt-6 lg:pb-8 xl:px-6 2xl:px-8"
      >
        {children}
      </main>

      <nav
        aria-label={labels.mobileNavigation}
        className="app-sticky-layer bg-surface-1 fixed inset-x-0 bottom-0 grid h-[calc(4rem+env(safe-area-inset-bottom))] grid-cols-5 border-t pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {navigationItems.slice(0, 3).map(({ href, label, icon: Icon }) => {
          const active = isCurrentPath(pathname, href);

          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              aria-label={href === '/inbox' ? inboxNavigationLabel : label}
              className={cn(
                'focus-visible:ring-ring flex min-h-11 flex-col items-center justify-center gap-0.5 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-inset',
                active ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <span className="relative">
                <Icon aria-hidden="true" className="size-5" strokeWidth={1.75} />
                {href === '/inbox' ? (
                  <NotificationCountBadge
                    count={unreadNotificationCount}
                    className="absolute -top-2 left-3"
                  />
                ) : null}
              </span>
              <span>{label}</span>
            </Link>
          );
        })}

        {navigationItems.slice(3).map(({ href, label, icon: Icon }) => {
          const active = isCurrentPath(pathname, href);

          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'focus-visible:ring-ring flex min-h-11 flex-col items-center justify-center gap-0.5 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-inset',
                active ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <Icon aria-hidden="true" className="size-5" strokeWidth={1.75} />
              <span>{label}</span>
            </Link>
          );
        })}

        <button
          type="button"
          onClick={openTeamSelectorFromTrigger}
          aria-label={labels.openTeamSelector}
          aria-pressed={teamSelectorOpen}
          className={cn(
            'focus-visible:ring-ring flex min-h-11 flex-col items-center justify-center gap-0.5 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-inset',
            teamSelectorOpen ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          <Users aria-hidden="true" className="size-5" strokeWidth={1.75} />
          <span>{labels.navigation.teams}</span>
        </button>
      </nav>

      <GlobalSearch open={searchOpen} onOpenChange={changeSearchOpen} labels={labels.search} />
      <GlobalIssueCreate
        key={issueCreateOpen ? issueCreateSeed?.projectId ?? 'new' : 'closed'}
        currentTeamKey={selectedTeamKey}
        open={issueCreateOpen}
        onOpenChange={changeIssueCreateOpen}
        labels={labels.issueCreate}
        seed={issueCreateSeed}
      />
      <TeamSelector
        open={teamSelectorOpen}
        onOpenChange={changeTeamSelectorOpen}
        labels={labels.teamSelector}
        teamView={lastTeamView}
      />
      {session.data?.authenticated && profileOpen ? (
        <ProfileDialog
          open={profileOpen}
          onOpenChange={changeProfileOpen}
          labels={labels.profile}
          user={session.data.user}
        />
      ) : null}
    </div>
  );
}
