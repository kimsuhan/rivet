import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { SessionBoundary } from '@/features/auth/session-boundary';
import { TeamOnboardingScreen } from '@/features/onboarding/team-onboarding-screen';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Onboarding.team' });

  return { title: t('title') };
}

export default async function TeamOnboardingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [common, session, t] = await Promise.all([
    getTranslations('Onboarding.common'),
    getTranslations('Auth.session'),
    getTranslations('Onboarding.team'),
  ]);

  return (
    <SessionBoundary
      expectedStep="CREATE_TEAM"
      labels={{
        loading: session('loading'),
        errorTitle: session('errorTitle'),
        errorDescription: session('errorDescription'),
        retry: session('retry'),
      }}
    >
      <TeamOnboardingScreen
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
          nameLabel: t('nameLabel'),
          namePlaceholder: t('namePlaceholder'),
          nameRequired: t('nameRequired'),
          nameTooLong: t('nameTooLong'),
          nameInvalid: t('nameInvalid'),
          nameInUse: t('nameInUse'),
          keyLabel: t('keyLabel'),
          keyPlaceholder: t('keyPlaceholder'),
          keyFormat: t('keyFormat'),
          keyInUse: t('keyInUse'),
          keyImmutableDescription: t('keyImmutableDescription'),
          issueIdExampleLabel: t('issueIdExampleLabel'),
          issueIdPlaceholder: t('issueIdPlaceholder'),
          creatorTitle: t('creatorTitle'),
          creatorDescription: t('creatorDescription'),
          sessionLoadingTitle: t('sessionLoadingTitle'),
          sessionLoadingDescription: t('sessionLoadingDescription'),
          sessionErrorTitle: t('sessionErrorTitle'),
          sessionErrorDescription: t('sessionErrorDescription'),
          submit: t('submit'),
          submitting: t('submitting'),
          errorTitle: t('errorTitle'),
          errorDescription: t('errorDescription'),
        }}
      />
    </SessionBoundary>
  );
}
