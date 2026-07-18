import { getTranslations, setRequestLocale } from 'next-intl/server';

import {
  type FeedbackSettingsLabels,
  FeedbackSettingsScreen,
} from '@/features/settings/feedback-settings-screen';

export default async function FeedbackSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Settings.feedback');
  const labels: FeedbackSettingsLabels = {
    allCategories: t('allCategories'),
    allStatuses: t('allStatuses'),
    categories: {
      BUG: t('categories.BUG'),
      USABILITY: t('categories.USABILITY'),
      IDEA: t('categories.IDEA'),
      OTHER: t('categories.OTHER'),
    },
    categoryFilter: t('categoryFilter'),
    description: t('description'),
    emptyDescription: t('emptyDescription'),
    emptyTitle: t('emptyTitle'),
    errorDescription: t('errorDescription'),
    errorTitle: t('errorTitle'),
    loadMore: t('loadMore'),
    loading: t('loading'),
    path: t('path'),
    release: t('release'),
    retry: t('retry'),
    statusError: t('statusError'),
    statuses: {
      RECEIVED: t('statuses.RECEIVED'),
      IN_REVIEW: t('statuses.IN_REVIEW'),
      IMPLEMENTED: t('statuses.IMPLEMENTED'),
      DEFERRED: t('statuses.DEFERRED'),
    },
    statusFilter: t('statusFilter'),
    submittedAt: t('submittedAt'),
    title: t('title'),
  };
  return <FeedbackSettingsScreen labels={labels} />;
}
