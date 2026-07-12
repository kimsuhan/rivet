import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';

import { ProjectFormScreen } from '@/features/projects/project-form-screen';

export default async function EditProjectPage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>;
}) {
  const { locale, projectId } = await params;
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={{ Projects: messages.Projects }}>
      <ProjectFormScreen projectId={projectId} />
    </NextIntlClientProvider>
  );
}
