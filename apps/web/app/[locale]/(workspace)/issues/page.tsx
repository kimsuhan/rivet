import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';

import { FeatureIssueListScreen } from '@/features/issues/feature-issue-list-screen';

export default async function IssuesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={{ FeatureIssues: messages.FeatureIssues }}>
      <FeatureIssueListScreen />
    </NextIntlClientProvider>
  );
}
