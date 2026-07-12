import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ForgotPasswordScreen } from '@/features/auth/forgot-password-screen';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Auth.forgotPassword' });

  return { title: t('title') };
}

export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Auth.forgotPassword');

  return (
    <ForgotPasswordScreen
      loginHref="/login"
      labels={{
        productName: t('productName'),
        title: t('title'),
        description: t('description'),
        email: t('email'),
        submit: t('submit'),
        submitting: t('submitting'),
        loginLink: t('loginLink'),
        completeTitle: t('completeTitle'),
        completeDescription: t('completeDescription'),
        emailInvalid: t('emailInvalid'),
        rateLimited: t('rateLimited'),
        unexpectedError: t('unexpectedError'),
      }}
    />
  );
}
