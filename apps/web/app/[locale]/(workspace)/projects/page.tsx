import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';

import { ProjectListScreen } from '@/features/projects/project-list-screen';

export default async function ProjectsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={{ Projects: messages.Projects }}>
      <ProjectListScreen />
    </NextIntlClientProvider>
  );
}
