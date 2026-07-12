import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ResetPasswordScreen } from '@/features/auth/reset-password-screen';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Auth.resetPassword' });

  return { referrer: 'no-referrer', title: t('title') };
}

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Auth.resetPassword');

  return (
    <ResetPasswordScreen
      forgotPasswordHref="/forgot-password"
      loginHref="/login"
      labels={{
        productName: t('productName'),
        title: t('title'),
        description: t('description'),
        password: t('password'),
        confirmPassword: t('confirmPassword'),
        passwordHelp: t('passwordHelp'),
        showPassword: t('showPassword'),
        hidePassword: t('hidePassword'),
        submit: t('submit'),
        submitting: t('submitting'),
        loading: t('loading'),
        passwordTooShort: t('passwordTooShort'),
        passwordTooLong: t('passwordTooLong'),
        passwordMismatch: t('passwordMismatch'),
        invalidTitle: t('invalidTitle'),
        invalidDescription: t('invalidDescription'),
        expiredTitle: t('expiredTitle'),
        expiredDescription: t('expiredDescription'),
        requestNewLink: t('requestNewLink'),
        completeTitle: t('completeTitle'),
        completeDescription: t('completeDescription'),
        loginLink: t('loginLink'),
        unexpectedError: t('unexpectedError'),
      }}
    />
  );
}
