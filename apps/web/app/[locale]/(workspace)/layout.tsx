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

  const [shell, navigation, search, issueCreate, session, teamSelector, profile, realtime] =
    await Promise.all([
      getTranslations('Shell'),
      getTranslations('Navigation'),
      getTranslations('Search'),
      getTranslations('IssueCreate'),
      getTranslations('Auth.session'),
      getTranslations('TeamSelector'),
      getTranslations('Profile'),
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
              openProfile: shell('openProfile'),
              inboxUnread: shell.raw('inboxUnread') as string,
              skipToContent: shell('skipToContent'),
              navigation: {
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
                feature: search('feature'),
                teamTask: search('teamTask'),
                noProject: search('noProject'),
                roles: {
                  APP_FRONTEND: search('roles.APP_FRONTEND'),
                  BACKEND: search('roles.BACKEND'),
                  WEB_FRONTEND: search('roles.WEB_FRONTEND'),
                },
                featureStatuses: {
                  UNSORTED: search('featureStatuses.UNSORTED'),
                  TODO: search('featureStatuses.TODO'),
                  IN_PROGRESS: search('featureStatuses.IN_PROGRESS'),
                  REVIEW: search('featureStatuses.REVIEW'),
                  DONE: search('featureStatuses.DONE'),
                  PAUSED: search('featureStatuses.PAUSED'),
                  CANCELED: search('featureStatuses.CANCELED'),
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
                assigneeLabel: issueCreate('assigneeLabel'),
                assigneePlaceholder: issueCreate('assigneePlaceholder'),
                cancel: issueCreate('cancel'),
                close: issueCreate('close'),
                description: issueCreate('description'),
                discardChanges: issueCreate('discardChanges'),
                discardDescription: issueCreate('discardDescription'),
                discardTitle: issueCreate('discardTitle'),
                errorDescription: issueCreate('errorDescription'),
                errorTitle: issueCreate('errorTitle'),
                featureStatuses: {
                  UNSORTED: issueCreate('featureStatuses.UNSORTED'),
                  TODO: issueCreate('featureStatuses.TODO'),
                  IN_PROGRESS: issueCreate('featureStatuses.IN_PROGRESS'),
                  REVIEW: issueCreate('featureStatuses.REVIEW'),
                  DONE: issueCreate('featureStatuses.DONE'),
                  PAUSED: issueCreate('featureStatuses.PAUSED'),
                  CANCELED: issueCreate('featureStatuses.CANCELED'),
                },
                featureType: issueCreate('featureType'),
                initialRoleSelected: issueCreate('initialRoleSelected'),
                initialRolesDescription: issueCreate('initialRolesDescription'),
                initialRolesLabel: issueCreate('initialRolesLabel'),
                labelsLabel: issueCreate('labelsLabel'),
                labelsUnavailable: issueCreate('labelsUnavailable'),
                keepEditing: issueCreate('keepEditing'),
                mobileDescription: issueCreate('mobileDescription'),
                mobileTitle: issueCreate('mobileTitle'),
                noLabels: issueCreate('noLabels'),
                noParent: issueCreate('noParent'),
                noProject: issueCreate('noProject'),
                optionsErrorDescription: issueCreate('optionsErrorDescription'),
                optionsErrorTitle: issueCreate('optionsErrorTitle'),
                optionsLoading: issueCreate('optionsLoading'),
                parentLabel: issueCreate('parentLabel'),
                parentPlaceholder: issueCreate('parentPlaceholder'),
                priorityLabel: issueCreate('priorityLabel'),
                projectLabel: issueCreate('projectLabel'),
                projectPlaceholder: issueCreate('projectPlaceholder'),
                projectRequired: issueCreate('projectRequired'),
                projectRoleLabel: issueCreate('projectRoleLabel'),
                projectRolePlaceholder: issueCreate('projectRolePlaceholder'),
                projectRoleRequired: issueCreate('projectRoleRequired'),
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
                retry: issueCreate('retry'),
                shortcutHint: issueCreate('shortcutHint'),
                stateLabel: issueCreate('stateLabel'),
                statePlaceholder: issueCreate('statePlaceholder'),
                stateRequired: issueCreate('stateRequired'),
                submit: issueCreate('submit'),
                submitting: issueCreate('submitting'),
                teamLabel: issueCreate('teamLabel'),
                teamLockedByRole: issueCreate('teamLockedByRole'),
                teamPlaceholder: issueCreate('teamPlaceholder'),
                teamRequired: issueCreate('teamRequired'),
                teamTaskClose: issueCreate('teamTaskClose'),
                teamTaskDescription: issueCreate('teamTaskDescription'),
                teamTaskSubmit: issueCreate('teamTaskSubmit'),
                teamTaskSubmitting: issueCreate('teamTaskSubmitting'),
                teamTaskTitle: issueCreate('teamTaskTitle'),
                teamTaskType: issueCreate('teamTaskType'),
                title: issueCreate('title'),
                titleLabel: issueCreate('titleLabel'),
                titlePlaceholder: issueCreate('titlePlaceholder'),
                titleRequired: issueCreate('titleRequired'),
                titleTooLong: issueCreate('titleTooLong'),
                typeLabel: issueCreate('typeLabel'),
                unassigned: issueCreate('unassigned'),
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
                choose: profile('choose'),
                close: profile('close'),
                description: profile('description'),
                discard: profile('discard'),
                emptyFile: profile('emptyFile'),
                fileLimit: profile('fileLimit'),
                invalidType: profile('invalidType'),
                optimizing: profile('optimizing'),
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
            }}
          >
            {children}
          </AppShell>
        </RealtimeSync>
      </SessionBoundary>
    </NextIntlClientProvider>
  );
}
