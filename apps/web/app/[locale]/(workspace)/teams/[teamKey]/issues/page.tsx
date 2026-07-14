import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';

import { IssueListScreen } from '@/features/issues/issue-list-screen';

export default async function TeamIssuesPage({
  params,
}: {
  params: Promise<{ locale: string; teamKey: string }>;
}) {
  const { locale, teamKey } = await params;
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={{ Issues: messages.Issues, Markdown: messages.Markdown }}>
      <IssueListScreen mode="team" teamKey={teamKey} />
    </NextIntlClientProvider>
  );
}
