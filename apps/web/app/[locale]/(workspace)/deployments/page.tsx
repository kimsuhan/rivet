import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';

import { DeploymentScreen } from '@/features/deployments/deployment-screen';

export default async function DeploymentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={{ Deployments: messages.Deployments }}>
      <DeploymentScreen />
    </NextIntlClientProvider>
  );
}
