import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';

import { ExportSettingsScreen } from '@/features/settings/export-settings-screen';

export default async function ExportSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={{ Settings: { export: messages.Settings.export } }}>
      <ExportSettingsScreen />
    </NextIntlClientProvider>
  );
}
