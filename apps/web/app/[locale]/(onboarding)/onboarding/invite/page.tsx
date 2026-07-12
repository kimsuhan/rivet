import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { SessionBoundary } from '@/features/auth/session-boundary';
import { InviteOnboardingScreen } from '@/features/onboarding/invite-onboarding-screen';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Onboarding.invite' });

  return { title: t('title') };
}

export default async function InviteOnboardingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [common, session, t] = await Promise.all([
    getTranslations('Onboarding.common'),
    getTranslations('Auth.session'),
    getTranslations('Onboarding.invite'),
  ]);

  return (
    <SessionBoundary
      expectedStep="COMPLETE"
      labels={{
        loading: session('loading'),
        errorTitle: session('errorTitle'),
        errorDescription: session('errorDescription'),
        retry: session('retry'),
      }}
    >
      <InviteOnboardingScreen
        labels={{
          productName: common('productName'),
          stepsLabel: common('stepsLabel'),
          workspaceStep: common('workspaceStep'),
          teamStep: common('teamStep'),
          inviteStep: common('inviteStep'),
          currentStepStatus: common('currentStepStatus'),
          completedStepStatus: common('completedStepStatus'),
          title: t('title'),
          description: t('description'),
          emailLabel: t('emailLabel'),
          emailPlaceholder: t('emailPlaceholder'),
          emailDescription: t('emailDescription'),
          emailsRequired: t('emailsRequired'),
          emailInvalid: t('emailInvalid'),
          limitExceeded: t('limitExceeded'),
          sessionLoadingTitle: t('sessionLoadingTitle'),
          sessionLoadingDescription: t('sessionLoadingDescription'),
          sessionErrorTitle: t('sessionErrorTitle'),
          sessionErrorDescription: t('sessionErrorDescription'),
          submit: t('submit'),
          submitting: t('submitting'),
          skip: t('skip'),
          resultTitle: t('resultTitle'),
          retryFailed: t('retryFailed'),
          invited: t('invited'),
          alreadyMember: t('alreadyMember'),
          alreadyInvited: t('alreadyInvited'),
          failed: t('failed'),
          firstIssue: t('firstIssue'),
          toMyIssues: t('toMyIssues'),
          errorTitle: t('errorTitle'),
          errorDescription: t('errorDescription'),
        }}
      />
    </SessionBoundary>
  );
}
