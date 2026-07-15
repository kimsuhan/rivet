import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';

import { CsvImportSettingsScreen } from '@/features/settings/csv-import-settings-screen';

export default async function CsvImportSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={{ Settings: { import: messages.Settings.import } }}>
      <CsvImportSettingsScreen />
    </NextIntlClientProvider>
  );
}
