import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { VerifyEmailScreen } from '@/features/auth/verify-email-screen';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Auth.verifyEmail' });

  return { referrer: 'no-referrer', title: t('title') };
}

export default async function VerifyEmailPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Auth.verifyEmail');

  return (
    <NextIntlClientProvider
      messages={{
        Auth: {
          verifyEmail: { rateLimitedWithRetry: t.raw('rateLimitedWithRetry') },
        },
      }}
    >
      <VerifyEmailScreen
        loginHref="/login"
        signUpHref="/signup"
        labels={{
          productName: t('productName'),
          title: t('title'),
          description: t('description'),
          loading: t('loading'),
          successTitle: t('successTitle'),
          successDescription: t('successDescription'),
          alreadyUsedTitle: t('alreadyUsedTitle'),
          alreadyUsedDescription: t('alreadyUsedDescription'),
          expiredTitle: t('expiredTitle'),
          expiredDescription: t('expiredDescription'),
          invalidTitle: t('invalidTitle'),
          invalidDescription: t('invalidDescription'),
          loginLink: t('loginLink'),
          signUpLink: t('signUpLink'),
          resendEmail: t('resendEmail'),
          email: t('email'),
          emailInvalid: t('emailInvalid'),
          resend: t('resend'),
          resending: t('resending'),
          retry: t('retry'),
          resentTitle: t('resentTitle'),
          resentDescription: t('resentDescription'),
          resentEmailLabel: t('resentEmailLabel'),
          rateLimited: t('rateLimited'),
          unexpectedError: t('unexpectedError'),
        }}
      />
    </NextIntlClientProvider>
  );
}
