import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';

import { ProjectDetailScreen } from '@/features/projects/project-detail-screen';

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>;
}) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={{ Projects: messages.Projects }}>
      <ProjectDetailScreen projectId={projectId} />
    </NextIntlClientProvider>
  );
}
