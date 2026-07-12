import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';

import { IssueListScreen } from '@/features/issues/issue-list-screen';

export default async function MyIssuesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={{ Issues: messages.Issues }}>
      <IssueListScreen mode="my" />
    </NextIntlClientProvider>
  );
}
