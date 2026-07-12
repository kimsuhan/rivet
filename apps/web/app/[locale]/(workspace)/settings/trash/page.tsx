import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';

import { TrashSettingsScreen } from '@/features/settings/trash-settings-screen';

export default async function TrashSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={{ Settings: { trash: messages.Settings.trash } }}>
      <TrashSettingsScreen />
    </NextIntlClientProvider>
  );
}
