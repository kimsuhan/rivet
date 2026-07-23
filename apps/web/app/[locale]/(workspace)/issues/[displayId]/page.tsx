import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';

import { IssueDetailScreen } from '@/features/issues/issue-detail-screen';

export default async function IssueDetailPage({
  params,
}: {
  params: Promise<{ displayId: string; locale: string }>;
}) {
  const { displayId, locale } = await params;
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <NextIntlClientProvider
      messages={{
        Deployments: messages.Deployments,
        Files: messages.Files,
        IssueDetail: messages.IssueDetail,
        Markdown: messages.Markdown,
      }}
    >
      <IssueDetailScreen issueRef={displayId} />
    </NextIntlClientProvider>
  );
}
