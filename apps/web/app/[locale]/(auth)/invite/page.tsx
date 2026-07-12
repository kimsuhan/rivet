import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { InviteScreen } from '@/features/auth/invite-screen';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Auth.invite' });

  return { referrer: 'no-referrer', title: t('title') };
}

export default async function InvitePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Auth.invite');

  return (
    <InviteScreen
      loginHref="/login"
      signUpHref="/signup"
      labels={{
        productName: t('productName'),
        title: t('title'),
        description: t('description'),
        loading: t('loading'),
        workspaceLabel: t('workspaceLabel'),
        invitedByLabel: t('invitedByLabel'),
        inviteEmailLabel: t('inviteEmailLabel'),
        currentAccountLabel: t('currentAccountLabel'),
        sessionLoading: t('sessionLoading'),
        sessionErrorTitle: t('sessionErrorTitle'),
        sessionErrorDescription: t('sessionErrorDescription'),
        loginRequiredTitle: t('loginRequiredTitle'),
        loginRequiredDescription: t('loginRequiredDescription'),
        reopenLinkDescription: t('reopenLinkDescription'),
        loginLink: t('loginLink'),
        signUpLink: t('signUpLink'),
        accept: t('accept'),
        accepting: t('accepting'),
        emailMismatchTitle: t('emailMismatchTitle'),
        emailMismatchDescription: t('emailMismatchDescription'),
        accountSwitchLink: t('accountSwitchLink'),
        workspaceLimitTitle: t('workspaceLimitTitle'),
        workspaceLimitDescription: t('workspaceLimitDescription'),
        currentWorkspace: t('currentWorkspace'),
        usedTitle: t('usedTitle'),
        usedDescription: t('usedDescription'),
        expiredTitle: t('expiredTitle'),
        expiredDescription: t('expiredDescription'),
        invalidTitle: t('invalidTitle'),
        invalidDescription: t('invalidDescription'),
        unexpectedTitle: t('unexpectedTitle'),
        unexpectedDescription: t('unexpectedDescription'),
        retry: t('retry'),
      }}
    />
  );
}
