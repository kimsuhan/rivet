import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { LoginScreen } from '@/features/auth/login-screen';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Auth.login' });

  return { title: t('title') };
}

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const t = await getTranslations('Auth.login');

  return (
    <LoginScreen
      forgotPasswordHref="/forgot-password"
      signUpHref="/signup"
      verifyEmailHref="/verify-email"
      returnTo={typeof query.returnTo === 'string' ? query.returnTo : null}
      labels={{
        productName: t('productName'),
        title: t('title'),
        description: t('description'),
        email: t('email'),
        password: t('password'),
        showPassword: t('showPassword'),
        hidePassword: t('hidePassword'),
        submit: t('submit'),
        submitting: t('submitting'),
        forgotPassword: t('forgotPassword'),
        signUpPrompt: t('signUpPrompt'),
        signUpLink: t('signUpLink'),
        emailInvalid: t('emailInvalid'),
        passwordRequired: t('passwordRequired'),
        invalidCredentialsTitle: t('invalidCredentialsTitle'),
        invalidCredentialsDescription: t('invalidCredentialsDescription'),
        emailNotVerifiedTitle: t('emailNotVerifiedTitle'),
        emailNotVerifiedDescription: t('emailNotVerifiedDescription'),
        verifyEmailLink: t('verifyEmailLink'),
        membershipInactiveTitle: t('membershipInactiveTitle'),
        membershipInactiveDescription: t('membershipInactiveDescription'),
        rateLimited: t('rateLimited'),
        unexpectedError: t('unexpectedError'),
      }}
    />
  );
}
