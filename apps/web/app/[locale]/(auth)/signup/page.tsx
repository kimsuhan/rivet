import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { SignUpScreen } from '@/features/auth/sign-up-screen';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Auth.signUp' });

  return { title: t('title') };
}

export default async function SignUpPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Auth.signUp');

  return (
    <SignUpScreen
      forgotPasswordHref="/forgot-password"
      loginHref="/login"
      labels={{
        productName: t('productName'),
        title: t('title'),
        description: t('description'),
        displayName: t('displayName'),
        email: t('email'),
        password: t('password'),
        confirmPassword: t('confirmPassword'),
        passwordHelp: t('passwordHelp'),
        showPassword: t('showPassword'),
        hidePassword: t('hidePassword'),
        submit: t('submit'),
        submitting: t('submitting'),
        loginPrompt: t('loginPrompt'),
        loginLink: t('loginLink'),
        acceptedTitle: t('acceptedTitle'),
        acceptedDescription: t('acceptedDescription'),
        acceptedEmailLabel: t('acceptedEmailLabel'),
        passwordResetLink: t('passwordResetLink'),
        displayNameRequired: t('displayNameRequired'),
        displayNameTooLong: t('displayNameTooLong'),
        emailInvalid: t('emailInvalid'),
        passwordTooShort: t('passwordTooShort'),
        passwordTooLong: t('passwordTooLong'),
        passwordMismatch: t('passwordMismatch'),
        rateLimited: t('rateLimited'),
        unexpectedError: t('unexpectedError'),
      }}
    />
  );
}
