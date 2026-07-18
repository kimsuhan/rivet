import { getTranslations, setRequestLocale } from 'next-intl/server';

import {
  type IssueTemplateSettingsLabels,
  IssueTemplateSettingsScreen,
} from '@/features/settings/issue-template-settings-screen';

export default async function IssueTemplateSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Settings.templates');
  const labels: IssueTemplateSettingsLabels = {
    activeTab: t('activeTab'),
    archive: t('archive'),
    archiveAction: t('archiveAction'),
    archiveDescription: t.raw('archiveDescription') as string,
    archiveErrorDescription: t('archiveErrorDescription'),
    archiveErrorTitle: t('archiveErrorTitle'),
    archiveTitle: t('archiveTitle'),
    archivedTab: t('archivedTab'),
    archiving: t('archiving'),
    cancel: t('cancel'),
    conflictDescription: t('conflictDescription'),
    conflictTitle: t('conflictTitle'),
    createDescription: t('createDescription'),
    createTemplate: t('createTemplate'),
    createTitle: t('createTitle'),
    description: t('description'),
    descriptionHelp: t('descriptionHelp'),
    descriptionLabel: t('descriptionLabel'),
    descriptionRequired: t('descriptionRequired'),
    discardChanges: t('discardChanges'),
    discardDescription: t('discardDescription'),
    discardTitle: t('discardTitle'),
    edit: t('edit'),
    editDescription: t('editDescription'),
    editTitle: t('editTitle'),
    emptyActiveDescription: t('emptyActiveDescription'),
    emptyActiveTitle: t('emptyActiveTitle'),
    emptyArchivedDescription: t('emptyArchivedDescription'),
    emptyArchivedTitle: t('emptyArchivedTitle'),
    errorDescription: t('errorDescription'),
    errorTitle: t('errorTitle'),
    initialRoleLabel: t('initialRoleLabel'),
    initialRoleNone: t('initialRoleNone'),
    labelsLabel: t('labelsLabel'),
    loading: t('loading'),
    nameLabel: t('nameLabel'),
    namePlaceholder: t('namePlaceholder'),
    nameRequired: t('nameRequired'),
    nameTooLong: t('nameTooLong'),
    noLabels: t('noLabels'),
    noProject: t('noProject'),
    optionsErrorDescription: t('optionsErrorDescription'),
    optionsErrorTitle: t('optionsErrorTitle'),
    permissionDescription: t('permissionDescription'),
    permissionTitle: t('permissionTitle'),
    priorities: {
      HIGH: t('priorities.HIGH'),
      LOW: t('priorities.LOW'),
      MEDIUM: t('priorities.MEDIUM'),
      NONE: t('priorities.NONE'),
      URGENT: t('priorities.URGENT'),
    },
    priorityLabel: t('priorityLabel'),
    projectLabel: t('projectLabel'),
    projectRoles: {
      APP_FRONTEND: t('projectRoles.APP_FRONTEND'),
      BACKEND: t('projectRoles.BACKEND'),
      WEB_FRONTEND: t('projectRoles.WEB_FRONTEND'),
    },
    repairDescription: t('repairDescription'),
    reloadLatest: t('reloadLatest'),
    restore: t('restore'),
    restoreAction: t('restoreAction'),
    restoreConflictDescription: t('restoreConflictDescription'),
    restoreDescription: t.raw('restoreDescription') as string,
    restoreErrorDescription: t('restoreErrorDescription'),
    restoreErrorTitle: t('restoreErrorTitle'),
    restoreTitle: t('restoreTitle'),
    restoring: t('restoring'),
    retry: t('retry'),
    save: t('save'),
    saveErrorDescription: t('saveErrorDescription'),
    saveErrorTitle: t('saveErrorTitle'),
    saving: t('saving'),
    tabsLabel: t('tabsLabel'),
    title: t('title'),
    unavailable: t('unavailable'),
  };

  return <IssueTemplateSettingsScreen labels={labels} />;
}
