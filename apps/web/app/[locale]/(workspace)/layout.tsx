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
        Feedback: messages.Feedback,
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
              openWorkspaceMenu: shell('openWorkspaceMenu'),
              inboxUnread: shell.raw('inboxUnread') as string,
              deploymentPending: shell.raw('deploymentPending') as string,
              skipToContent: shell('skipToContent'),
              expandSection: shell.raw('expandSection') as string,
              collapseSection: shell.raw('collapseSection') as string,
              navigation: {
                issues: navigation('issues'),
                myIssues: navigation('myIssues'),
                inbox: navigation('inbox'),
                teams: navigation('teams'),
                projects: navigation('projects'),
                deployments: navigation('deployments'),
                search: navigation('search'),
                settings: navigation('settings'),
                workspace: navigation('workspace'),
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
                discardChanges: issueCreate('discardChanges'),
                discardDescription: issueCreate('discardDescription'),
                discardTitle: issueCreate('discardTitle'),
                errorDescription: issueCreate('errorDescription'),
                errorTitle: issueCreate('errorTitle'),
                initialTeamsDescription: issueCreate('initialTeamsDescription'),
                initialTeamsEmpty: issueCreate('initialTeamsEmpty'),
                initialTeamsLabel: issueCreate('initialTeamsLabel'),
                initialTeamsNoProject: issueCreate('initialTeamsNoProject'),
                initialTeamsToolbarLabel: issueCreate('initialTeamsToolbarLabel'),
                labelsLabel: issueCreate('labelsLabel'),
                noLabels: issueCreate('noLabels'),
                optionsErrorDescription: issueCreate('optionsErrorDescription'),
                optionsErrorTitle: issueCreate('optionsErrorTitle'),
                optionsLoading: issueCreate('optionsLoading'),
                overwriteCancel: issueCreate('overwriteCancel'),
                overwriteConfirm: issueCreate('overwriteConfirm'),
                overwriteDescription: issueCreate.raw('overwriteDescription') as string,
                overwriteFields: {
                  description: issueCreate('overwriteFields.description'),
                  initialTeams: issueCreate('overwriteFields.initialTeams'),
                  labels: issueCreate('overwriteFields.labels'),
                  priority: issueCreate('overwriteFields.priority'),
                  project: issueCreate('overwriteFields.project'),
                },
                overwriteTitle: issueCreate('overwriteTitle'),
                priorityLabel: issueCreate('priorityLabel'),
                projectLabel: issueCreate('projectLabel'),
                projectPlaceholder: issueCreate('projectPlaceholder'),
                projectRequired: issueCreate('projectRequired'),
                priorities: {
                  NONE: issueCreate('priorities.NONE'),
                  LOW: issueCreate('priorities.LOW'),
                  MEDIUM: issueCreate('priorities.MEDIUM'),
                  HIGH: issueCreate('priorities.HIGH'),
                  URGENT: issueCreate('priorities.URGENT'),
                },
                submit: issueCreate('submit'),
                submitting: issueCreate('submitting'),
                templateApplying: issueCreate('templateApplying'),
                templateEmpty: issueCreate('templateEmpty'),
                templateLabel: issueCreate('templateLabel'),
                templateNone: issueCreate('templateNone'),
                templateNoticeDescription: issueCreate('templateNoticeDescription'),
                templateNoticeTitle: issueCreate('templateNoticeTitle'),
                templateUnavailableNoticeDescription: issueCreate(
                  'templateUnavailableNoticeDescription',
                ),
                templateUnavailableNoticeTitle: issueCreate('templateUnavailableNoticeTitle'),
                templatePlaceholder: issueCreate('templatePlaceholder'),
                templateTrigger: issueCreate('templateTrigger'),
                templateUnavailable: issueCreate('templateUnavailable'),
                title: issueCreate('title'),
                titleLabel: issueCreate('titleLabel'),
                titlePlaceholder: issueCreate('titlePlaceholder'),
                titleRequired: issueCreate('titleRequired'),
              },
              teamSelector: {
                title: teamSelector('title'),
                allTeams: teamSelector('allTeams'),
                collapseSection: teamSelector.raw('collapseSection') as string,
                collapseTeam: teamSelector.raw('collapseTeam') as string,
                expandSection: teamSelector.raw('expandSection') as string,
                expandTeam: teamSelector.raw('expandTeam') as string,
                myTeamsEmpty: teamSelector('myTeamsEmpty'),
                teamBoard: teamSelector('teamBoard'),
                teamIssues: teamSelector('teamIssues'),
                description: teamSelector('description'),
                emptyTitle: teamSelector('emptyTitle'),
                emptyDescription: teamSelector('emptyDescription'),
                errorTitle: teamSelector('errorTitle'),
                errorDescription: teamSelector('errorDescription'),
                loading: teamSelector('loading'),
                myTeams: teamSelector('myTeams'),
                otherTeams: teamSelector('otherTeams'),
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
                feedback: userMenu('feedback'),
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
