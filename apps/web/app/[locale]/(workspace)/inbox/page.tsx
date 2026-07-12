import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';

import { NotificationInboxScreen } from '@/features/notifications/notification-inbox-screen';

export default async function InboxPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={{ Notifications: messages.Notifications }}>
      <NotificationInboxScreen />
    </NextIntlClientProvider>
  );
}
