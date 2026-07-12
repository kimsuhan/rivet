import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';

import { IssueBoardScreen } from '@/features/issues/issue-board-screen';

export default async function TeamBoardPage({
  params,
}: {
  params: Promise<{ locale: string; teamKey: string }>;
}) {
  const { locale, teamKey } = await params;
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={{ Issues: messages.Issues }}>
      <IssueBoardScreen teamKey={teamKey} />
    </NextIntlClientProvider>
  );
}
