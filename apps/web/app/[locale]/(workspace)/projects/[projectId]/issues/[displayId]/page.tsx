import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';

import { IssueDetailScreen } from '@/features/issues/issue-detail-screen';

export default async function ProjectIssueDetailPage({
  params,
}: {
  params: Promise<{ displayId: string; locale: string; projectId: string }>;
}) {
  const { displayId, locale, projectId } = await params;
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
      <IssueDetailScreen entry="project" issueRef={displayId} projectId={projectId} />
    </NextIntlClientProvider>
  );
}
