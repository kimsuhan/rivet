'use client';

import {
  Bell,
  CircleDot,
  FolderKanban,
  ListTodo,
  type LucideIcon,
  Plus,
  Rocket,
  Search,
  Settings,
  Users,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import {
  useAuthControllerGetSession,
  useDeploymentsControllerList,
  useNotificationsControllerUnreadCount,
} from '@rivet/api-client';

import { RivetSymbol, RivetWordmark } from '@/components/layout/brand';
import {
  SidebarDisclosureButton,
  sidebarDisclosureRowClassName,
  SidebarSectionHeading,
} from '@/components/layout/sidebar-section';
import {
  readCollapsedSections,
  readServerCollapsedSections,
  rememberCollapsedSections,
  subscribeCollapsedSections,
} from '@/components/layout/sidebar-sections-storage';
import { WorkspaceMenu } from '@/components/layout/workspace-menu';
import { UserAvatar } from '@/components/user-avatar';
import { UserMenu, type UserMenuLabels } from '@/features/auth/user-menu';
import { FeedbackDialog } from '@/features/feedback/feedback-dialog';
import {
  GlobalIssueCreate,
  type IssueCreateLabels,
  type IssueCreateSeed,
} from '@/features/issues/global-issue-create';
import {
  rememberSavedViewNavigation,
  savedViewNavigationHref,
} from '@/features/issues/saved-view-navigation';
import { SavedViewSidebarNavigation } from '@/features/issues/saved-view-sidebar-navigation';
import { captureProductEvent } from '@/features/product-events/capture-product-event';
import { ProfileDialog, type ProfileDialogLabels } from '@/features/profile/profile-dialog';
import { ProjectSidebarNavigation } from '@/features/projects/project-sidebar-navigation';
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
  openWorkspaceMenu: string;
  skipToContent: string;
  deploymentPending: string;
  inboxUnread: string;
  expandSection: string;
  collapseSection: string;
  navigation: {
    issues: string;
    myIssues: string;
    inbox: string;
    teams: string;
    projects: string;
    deployments: string;
    search: string;
    settings: string;
    workspace: string;
  };
  issueCreate: IssueCreateLabels;
  search: GlobalSearchLabels;
  teamSelector: TeamSelectorLabels;
  profile: ProfileDialogLabels;
  userMenu: UserMenuLabels;
};

type NavigationItem = {
  href: '/issues' | '/my-issues' | '/inbox' | '/projects' | '/deployments';
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

const WORKSPACE_SECTION = 'group:workspace';
const TEAMS_SECTION = 'group:teams';

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
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [teamSelectorOpen, setTeamSelectorOpen] = useState(false);
  const [issueCreateOpen, setIssueCreateOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState<'desktop' | 'mobile' | null>(null);
  const [issueCreateSeed, setIssueCreateSeed] = useState<IssueCreateSeed | null>(null);
  const [sectionsWithItems, setSectionsWithItems] = useState<Record<string, boolean>>({});
  const collapsedSections = useSyncExternalStore(
    subscribeCollapsedSections,
    readCollapsedSections,
    readServerCollapsedSections,
  );
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
  const myTeamDeployments = useDeploymentsControllerList(
    {
      limit: 1,
      readyOnly: true,
      scope: 'MY_TEAMS',
      status: ['PENDING', 'REDEPLOY_REQUIRED'],
    },
    {
      query: {
        enabled: Boolean(session.data?.authenticated),
        retry: false,
      },
    },
  );
  const lastFeedbackTrigger = useRef<HTMLElement | null>(null);
  const lastIssueCreateTrigger = useRef<HTMLElement | null>(null);
  const lastProfileTrigger = useRef<HTMLElement | null>(null);
  const lastSearchTrigger = useRef<HTMLElement | null>(null);
  const lastTeamSelectorTrigger = useRef<HTMLElement | null>(null);
  const workspaceMenuTrigger = useRef<HTMLButtonElement>(null);
  const desktopUserMenuTrigger = useRef<HTMLButtonElement>(null);
  const mobileUserMenuTrigger = useRef<HTMLButtonElement>(null);
  const consumedIssueCreateRequest = useRef<string | null>(null);
  const inboxItem: NavigationItem = {
    href: '/inbox',
    label: labels.navigation.inbox,
    icon: Bell,
  };
  const myIssuesItem: NavigationItem = {
    href: '/my-issues',
    label: labels.navigation.myIssues,
    icon: ListTodo,
  };
  const issuesItem: NavigationItem = {
    href: '/issues',
    label: labels.navigation.issues,
    icon: CircleDot,
  };
  const projectsItem: NavigationItem = {
    href: '/projects',
    label: labels.navigation.projects,
    icon: FolderKanban,
  };
  const deploymentsItem: NavigationItem = {
    href: '/deployments',
    label: labels.navigation.deployments,
    icon: Rocket,
  };
  // 모바일 하단 탭은 기존 순서를 유지하고, 데스크톱만 개인·워크스페이스 구역으로 나눈다.
  const navigationItems: NavigationItem[] = [myIssuesItem, inboxItem, issuesItem, projectsItem];
  const personalItems: NavigationItem[] = [inboxItem, myIssuesItem];
  const workspaceItems: NavigationItem[] = [issuesItem, deploymentsItem, projectsItem];
  const isWorkspaceAdmin = Boolean(
    session.data?.authenticated &&
    session.data.membership?.role === 'ADMIN' &&
    session.data.membership.status === 'ACTIVE',
  );
  const canAccessSettings = Boolean(
    isWorkspaceAdmin ||
    (session.data?.authenticated &&
      session.data.membership?.status === 'ACTIVE' &&
      (session.data.membership.ledTeamIds?.length ?? 0) > 0),
  );
  const settingsHref = canAccessSettings
    ? isWorkspaceAdmin
      ? '/settings/members'
      : '/settings/teams'
    : null;
  const settingsActive = pathname === '/settings' || pathname.startsWith('/settings/');
  const workspace = session.data?.authenticated ? session.data.workspace : null;
  const unreadNotificationCount = unreadNotifications.data?.count ?? 0;
  const myTeamDeploymentCount = myTeamDeployments.data?.totalCount ?? 0;
  const inboxNavigationLabel =
    unreadNotificationCount > 0
      ? labels.inboxUnread.replace(
          '{count}',
          new Intl.NumberFormat('ko-KR').format(unreadNotificationCount),
        )
      : labels.navigation.inbox;
  const deploymentsNavigationLabel =
    myTeamDeploymentCount > 0
      ? labels.deploymentPending.replace(
          '{count}',
          new Intl.NumberFormat('ko-KR').format(myTeamDeploymentCount),
        )
      : labels.navigation.deployments;
  const selectedTeamLocation = currentTeamLocation(pathname);
  const selectedTeamKey = selectedTeamLocation?.teamKey ?? null;
  const selectedTeamView = selectedTeamLocation?.view ?? null;
  const lastTeamView = selectedTeamView ?? storedTeamView;
  const membershipId = session.data?.authenticated ? session.data.membership?.id : undefined;
  const memberTeamIds = session.data?.authenticated
    ? (session.data.membership?.teamIds ?? [])
    : null;
  const currentSearch = searchParams.toString();

  useEffect(() => {
    if (selectedTeamKey && selectedTeamView) {
      rememberTeamKey(selectedTeamKey);
      rememberTeamView(selectedTeamView);
    }
  }, [selectedTeamKey, selectedTeamView]);

  useEffect(() => {
    rememberSavedViewNavigation(membershipId, pathname, currentSearch);
  }, [currentSearch, membershipId, pathname]);

  function navigationHref(href: NavigationItem['href']): string {
    if (href !== '/issues' && href !== '/my-issues') return href;
    return savedViewNavigationHref(membershipId, href, pathname, currentSearch);
  }

  function toggleSection(section: string) {
    rememberCollapsedSections({
      ...collapsedSections,
      [section]: !collapsedSections[section],
    });
  }

  const setSectionHasItems = useCallback((href: string, hasItems: boolean) => {
    setSectionsWithItems((current) =>
      current[href] === hasItems ? current : { ...current, [href]: hasItems },
    );
  }, []);

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
        !profileOpen &&
        !workspaceMenuOpen &&
        !userMenuOpen
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
        !profileOpen &&
        !workspaceMenuOpen &&
        !userMenuOpen
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
  }, [issueCreateOpen, profileOpen, searchOpen, teamSelectorOpen, userMenuOpen, workspaceMenuOpen]);

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

  useEffect(() => {
    const notificationId = searchParams.get('rivetPushClick');
    if (!notificationId || !/^[0-9a-f-]{36}$/i.test(notificationId)) return;
    captureProductEvent('push_notification_clicked', { notificationId });
    const nextSearchParams = new URLSearchParams(searchParams.toString());
    nextSearchParams.delete('rivetPushClick');
    const nextSearch = nextSearchParams.toString();
    router.replace(`${pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`, {
      scroll: false,
    });
  }, [pathname, router, searchParams]);

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

  function openProfileFromUserMenu(trigger: HTMLButtonElement | null) {
    lastProfileTrigger.current = trigger;
    setProfileOpen(true);
  }

  function openFeedbackFromUserMenu(trigger: HTMLButtonElement | null) {
    lastFeedbackTrigger.current = trigger;
    setFeedbackOpen(true);
  }

  function changeFeedbackOpen(open: boolean) {
    setFeedbackOpen(open);

    if (!open) {
      requestAnimationFrame(() => lastFeedbackTrigger.current?.focus());
    }
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

  function renderNavigationItem({ href, label, icon: Icon }: NavigationItem) {
    const active = isCurrentPath(pathname, href);
    const sectionExpanded = !collapsedSections[href];
    const showSectionToggle = Boolean(sectionsWithItems[href]);

    return (
      <div key={href} className="flex flex-col gap-0.5">
        <div className={cn('flex items-center gap-0.5', sidebarDisclosureRowClassName)}>
          <Link
            href={navigationHref(href)}
            aria-current={active ? 'page' : undefined}
            aria-label={
              href === '/inbox'
                ? inboxNavigationLabel
                : href === '/deployments'
                  ? deploymentsNavigationLabel
                  : label
            }
            title={label}
            className={cn(
              'focus-visible:ring-sidebar-ring relative flex h-8 flex-1 items-center gap-2 rounded-md border-l-2 px-2 text-sm transition-colors outline-none focus-visible:ring-2',
              active
                ? 'border-primary bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-sidebar-foreground hover:bg-surface-2 hover:text-foreground border-transparent',
            )}
          >
            <span className="relative shrink-0">
              <Icon aria-hidden="true" className="size-4" strokeWidth={1.75} />
              {href === '/inbox' || href === '/deployments' ? (
                <NotificationCountBadge
                  count={href === '/inbox' ? unreadNotificationCount : myTeamDeploymentCount}
                  className="absolute -top-2 left-2 xl:hidden"
                />
              ) : null}
            </span>
            <span className="hidden truncate xl:inline">{label}</span>
            {href === '/inbox' || href === '/deployments' ? (
              <NotificationCountBadge
                count={href === '/inbox' ? unreadNotificationCount : myTeamDeploymentCount}
                className="ml-auto hidden xl:flex"
              />
            ) : null}
          </Link>
          {showSectionToggle ? (
            <SidebarDisclosureButton
              className="h-8"
              collapseLabel={labels.collapseSection.replace('{section}', label)}
              expandLabel={labels.expandSection.replace('{section}', label)}
              expanded={sectionExpanded}
              onToggle={() => toggleSection(href)}
            />
          ) : null}
        </div>
        {session.data?.authenticated && href === '/issues' ? (
          <SavedViewSidebarNavigation
            resourceType="ISSUES"
            expanded={sectionExpanded}
            onHasItemsChange={(hasItems) => setSectionHasItems(href, hasItems)}
          />
        ) : null}
        {session.data?.authenticated && href === '/my-issues' ? (
          <SavedViewSidebarNavigation
            resourceType="MY_WORK"
            expanded={sectionExpanded}
            onHasItemsChange={(hasItems) => setSectionHasItems(href, hasItems)}
          />
        ) : null}
        {session.data?.authenticated && href === '/projects' ? (
          <ProjectSidebarNavigation
            expanded={sectionExpanded}
            memberTeamIds={memberTeamIds}
            onHasItemsChange={(hasItems) => setSectionHasItems(href, hasItems)}
          />
        ) : null}
      </div>
    );
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
        <div className="flex h-14 shrink-0 items-center border-b px-2 xl:px-3">
          {workspace ? (
            <WorkspaceMenu
              labels={{ open: labels.openWorkspaceMenu }}
              open={workspaceMenuOpen}
              onOpenChange={setWorkspaceMenuOpen}
              triggerRef={workspaceMenuTrigger}
              workspace={workspace}
            />
          ) : (
            <Link
              href="/my-issues"
              aria-label={labels.brandLabel}
              className="focus-visible:ring-ring flex items-center gap-2 rounded-md px-1 outline-none focus-visible:ring-2"
            >
              <RivetSymbol className="xl:hidden" />
              <RivetWordmark className="hidden xl:block" />
            </Link>
          )}
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

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <nav className="flex flex-col gap-2 p-2" aria-label={labels.desktopNavigation}>
            <div className="flex flex-col gap-0.5">{personalItems.map(renderNavigationItem)}</div>
            <div className="flex flex-col gap-0.5">
              <SidebarSectionHeading
                collapseLabel={labels.collapseSection.replace(
                  '{section}',
                  labels.navigation.workspace,
                )}
                expandLabel={labels.expandSection.replace('{section}', labels.navigation.workspace)}
                expanded={!collapsedSections[WORKSPACE_SECTION]}
                onToggle={() => toggleSection(WORKSPACE_SECTION)}
              >
                {labels.navigation.workspace}
              </SidebarSectionHeading>
              <div
                className={cn(
                  'flex flex-col gap-0.5',
                  collapsedSections[WORKSPACE_SECTION] && 'xl:hidden',
                )}
              >
                {workspaceItems.map(renderNavigationItem)}
              </div>
            </div>
          </nav>

          <DesktopTeamNavigation
            currentTeamKey={selectedTeamKey}
            currentTeamView={selectedTeamView}
            expanded={!collapsedSections[TEAMS_SECTION]}
            labels={labels.teamSelector}
            memberTeamIds={memberTeamIds}
            onOpenAllTeams={openTeamSelectorFromTrigger}
            onToggleExpanded={() => toggleSection(TEAMS_SECTION)}
            teamView={lastTeamView}
          />
        </div>

        {session.data?.authenticated ? (
          <div className="mt-auto flex flex-col gap-1 border-t p-2">
            {settingsHref ? (
              <Link
                href={settingsHref}
                aria-current={settingsActive ? 'page' : undefined}
                aria-label={labels.navigation.settings}
                title={labels.navigation.settings}
                className={cn(
                  'focus-visible:ring-sidebar-ring relative flex h-8 items-center gap-2 rounded-md border-l-2 px-2 text-sm transition-colors outline-none focus-visible:ring-2',
                  settingsActive
                    ? 'border-primary bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                    : 'text-sidebar-foreground hover:bg-surface-2 hover:text-foreground border-transparent',
                )}
              >
                <Settings aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
                <span className="hidden truncate xl:inline">{labels.navigation.settings}</span>
              </Link>
            ) : null}
            <UserMenu
              align="start"
              side="top"
              labels={labels.userMenu}
              open={userMenuOpen === 'desktop'}
              onOpenChange={(open) => setUserMenuOpen(open ? 'desktop' : null)}
              onOpenFeedback={() => openFeedbackFromUserMenu(desktopUserMenuTrigger.current)}
              onOpenProfile={() => openProfileFromUserMenu(desktopUserMenuTrigger.current)}
              triggerRef={desktopUserMenuTrigger}
              user={session.data.user}
              className="text-sidebar-foreground hover:bg-surface-2 hover:text-foreground focus-visible:ring-sidebar-ring aria-expanded:bg-surface-2 flex h-8 w-full items-center gap-2 rounded-md px-1 text-left text-sm transition-colors outline-none focus-visible:ring-2"
            >
              <UserAvatar
                avatarFileId={session.data.user.avatarFileId}
                displayName={session.data.user.displayName}
                size="sm"
              />
              <span className="hidden min-w-0 flex-1 truncate xl:inline">
                {session.data.user.displayName}
              </span>
            </UserMenu>
          </div>
        ) : null}
      </aside>

      <header className="app-sticky-layer bg-surface-1 fixed inset-x-0 top-0 flex h-13 items-center justify-between border-b px-4 min-[361px]:px-5 lg:hidden">
        <Link
          href="/my-issues"
          aria-label={labels.brandLabel}
          className="focus-visible:ring-ring flex items-center rounded-md outline-none focus-visible:ring-2"
        >
          <RivetWordmark />
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
            <UserMenu
              align="end"
              side="bottom"
              labels={labels.userMenu}
              open={userMenuOpen === 'mobile'}
              onOpenChange={(open) => setUserMenuOpen(open ? 'mobile' : null)}
              onOpenFeedback={() => openFeedbackFromUserMenu(mobileUserMenuTrigger.current)}
              onOpenProfile={() => openProfileFromUserMenu(mobileUserMenuTrigger.current)}
              triggerRef={mobileUserMenuTrigger}
              user={session.data.user}
              className="focus-visible:ring-ring flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-2"
            >
              <UserAvatar
                avatarFileId={session.data.user.avatarFileId}
                displayName={session.data.user.displayName}
                className="size-7"
              />
            </UserMenu>
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
              href={navigationHref(href)}
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
              href={navigationHref(href)}
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
      {session.data?.authenticated ? (
        <FeedbackDialog open={feedbackOpen} onOpenChange={changeFeedbackOpen} />
      ) : null}
      <GlobalIssueCreate
        key={issueCreateOpen ? (issueCreateSeed?.projectId ?? 'new') : 'closed'}
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
        memberTeamIds={memberTeamIds}
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
