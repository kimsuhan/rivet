import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';

import { AppShell } from '@/components/layout/app-shell';
import { SessionBoundary } from '@/features/auth/session-boundary';
import { RealtimeSync } from '@/features/realtime/realtime-sync';

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const messages = await getMessages();

  const [
    shell,
    navigation,
    search,
    issueCreate,
    session,
    teamSelector,
    profile,
    userMenu,
    realtime,
  ] = await Promise.all([
    getTranslations('Shell'),
    getTranslations('Navigation'),
    getTranslations('Search'),
    getTranslations('IssueCreate'),
    getTranslations('Auth.session'),
    getTranslations('TeamSelector'),
    getTranslations('Profile'),
    getTranslations('UserMenu'),
    getTranslations('Realtime'),
  ]);

  return (
    <NextIntlClientProvider
      messages={{
        Files: messages.Files,
        IssueCreate: messages.IssueCreate,
        Markdown: messages.Markdown,
        States: messages.States,
      }}
    >
      <SessionBoundary
        expectedStep="COMPLETE"
        labels={{
          loading: session('loading'),
          errorTitle: session('errorTitle'),
          errorDescription: session('errorDescription'),
          retry: session('retry'),
        }}
      >
        <RealtimeSync
          labels={{
            disconnected: realtime('disconnected'),
            reconnecting: realtime('reconnecting'),
          }}
        >
          <AppShell
            labels={{
              brandLabel: shell('brandLabel'),
              desktopNavigation: shell('desktopNavigation'),
              mobileNavigation: shell('mobileNavigation'),
              openIssueCreate: shell('openIssueCreate'),
              openSearch: shell('openSearch'),
              openTeamSelector: shell('openTeamSelector'),
              inboxUnread: shell.raw('inboxUnread') as string,
              skipToContent: shell('skipToContent'),
              navigation: {
                issues: navigation('issues'),
                myIssues: navigation('myIssues'),
                inbox: navigation('inbox'),
                teams: navigation('teams'),
                projects: navigation('projects'),
                search: navigation('search'),
                settings: navigation('settings'),
              },
              search: {
                title: search('title'),
                description: search('description'),
                inputLabel: search('label'),
                placeholder: search('placeholder'),
                emptyTitle: search('emptyTitle'),
                emptyDescription: search('emptyDescription'),
                minimumTitle: search('minimumTitle'),
                minimumDescription: search('minimumDescription'),
                loading: search('loading'),
                noResultsTitle: search('noResultsTitle'),
                noResultsDescription: search('noResultsDescription'),
                errorTitle: search('errorTitle'),
                errorDescription: search('errorDescription'),
                retry: search('retry'),
                results: search('results'),
                resultCount: search.raw('resultCount') as string,
                loadMore: search('loadMore'),
                loadingMore: search('loadingMore'),
                loadMoreError: search('loadMoreError'),
                exactMatch: search('exactMatch'),
                issue: search('issue'),
                teamWork: search('teamWork'),
                noProject: search('noProject'),
                roles: {
                  APP_FRONTEND: search('roles.APP_FRONTEND'),
                  BACKEND: search('roles.BACKEND'),
                  WEB_FRONTEND: search('roles.WEB_FRONTEND'),
                },
                issueStatuses: {
                  UNSORTED: search('issueStatuses.UNSORTED'),
                  TODO: search('issueStatuses.TODO'),
                  IN_PROGRESS: search('issueStatuses.IN_PROGRESS'),
                  REVIEW: search('issueStatuses.REVIEW'),
                  DONE: search('issueStatuses.DONE'),
                  PAUSED: search('issueStatuses.PAUSED'),
                  CANCELED: search('issueStatuses.CANCELED'),
                },
                stateCategories: {
                  BACKLOG: search('stateCategories.BACKLOG'),
                  UNSTARTED: search('stateCategories.UNSTARTED'),
                  STARTED: search('stateCategories.STARTED'),
                  COMPLETED: search('stateCategories.COMPLETED'),
                  CANCELED: search('stateCategories.CANCELED'),
                },
                close: search('close'),
              },
              issueCreate: {
                cancel: issueCreate('cancel'),
                close: issueCreate('close'),
                description: issueCreate('description'),
                descriptionLabel: issueCreate('descriptionLabel'),
                errorDescription: issueCreate('errorDescription'),
                errorTitle: issueCreate('errorTitle'),
                initialRolesDescription: issueCreate('initialRolesDescription'),
                initialRolesEmpty: issueCreate('initialRolesEmpty'),
                initialRolesLabel: issueCreate('initialRolesLabel'),
                initialRolesNoProject: issueCreate('initialRolesNoProject'),
                labelsLabel: issueCreate('labelsLabel'),
                noLabels: issueCreate('noLabels'),
                optionsErrorDescription: issueCreate('optionsErrorDescription'),
                optionsErrorTitle: issueCreate('optionsErrorTitle'),
                optionsLoading: issueCreate('optionsLoading'),
                priorityLabel: issueCreate('priorityLabel'),
                projectLabel: issueCreate('projectLabel'),
                projectPlaceholder: issueCreate('projectPlaceholder'),
                projectRequired: issueCreate('projectRequired'),
                projectRoles: {
                  BACKEND: issueCreate('projectRoles.BACKEND'),
                  WEB_FRONTEND: issueCreate('projectRoles.WEB_FRONTEND'),
                  APP_FRONTEND: issueCreate('projectRoles.APP_FRONTEND'),
                },
                priorities: {
                  NONE: issueCreate('priorities.NONE'),
                  LOW: issueCreate('priorities.LOW'),
                  MEDIUM: issueCreate('priorities.MEDIUM'),
                  HIGH: issueCreate('priorities.HIGH'),
                  URGENT: issueCreate('priorities.URGENT'),
                },
                submit: issueCreate('submit'),
                submitting: issueCreate('submitting'),
                title: issueCreate('title'),
                titleLabel: issueCreate('titleLabel'),
                titlePlaceholder: issueCreate('titlePlaceholder'),
                titleRequired: issueCreate('titleRequired'),
              },
              teamSelector: {
                title: teamSelector('title'),
                description: teamSelector('description'),
                emptyTitle: teamSelector('emptyTitle'),
                emptyDescription: teamSelector('emptyDescription'),
                errorTitle: teamSelector('errorTitle'),
                errorDescription: teamSelector('errorDescription'),
                loading: teamSelector('loading'),
                retry: teamSelector('retry'),
                close: teamSelector('close'),
              },
              profile: {
                cancel: profile('cancel'),
                choose: profile('choose'),
                close: profile('close'),
                description: profile('description'),
                discard: profile('discard'),
                emailDescription: profile('emailDescription'),
                emailLabel: profile('emailLabel'),
                emptyFile: profile('emptyFile'),
                fileLimit: profile('fileLimit'),
                invalidType: profile('invalidType'),
                nameDescription: profile('nameDescription'),
                nameLabel: profile('nameLabel'),
                nameRequired: profile('nameRequired'),
                nameTooLong: profile('nameTooLong'),
                optimizing: profile('optimizing'),
                photoDescription: profile('photoDescription'),
                photoLabel: profile('photoLabel'),
                previewAlt: profile('previewAlt'),
                remove: profile('remove'),
                removing: profile('removing'),
                retry: profile('retry'),
                save: profile('save'),
                saving: profile('saving'),
                title: profile('title'),
                unexpectedError: profile('unexpectedError'),
                uploading: profile('uploading'),
              },
              userMenu: {
                loggingOut: userMenu('loggingOut'),
                logout: userMenu('logout'),
                logoutError: userMenu('logoutError'),
                open: userMenu('open'),
                profile: userMenu('profile'),
              },
            }}
          >
            {children}
          </AppShell>
        </RealtimeSync>
      </SessionBoundary>
    </NextIntlClientProvider>
  );
}
