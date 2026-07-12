import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { SessionBoundary } from '@/features/auth/session-boundary';
import { WorkspaceOnboardingScreen } from '@/features/onboarding/workspace-onboarding-screen';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Onboarding.workspace' });

  return { title: t('title') };
}

export default async function WorkspaceOnboardingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [common, session, t] = await Promise.all([
    getTranslations('Onboarding.common'),
    getTranslations('Auth.session'),
    getTranslations('Onboarding.workspace'),
  ]);

  return (
    <SessionBoundary
      expectedStep="CREATE_WORKSPACE"
      labels={{
        loading: session('loading'),
        errorTitle: session('errorTitle'),
        errorDescription: session('errorDescription'),
        retry: session('retry'),
      }}
    >
      <WorkspaceOnboardingScreen
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
          slugLabel: t('slugLabel'),
          slugPlaceholder: t('slugPlaceholder'),
          slugDescription: t('slugDescription'),
          slugExample: t('slugExample'),
          slugTooShort: t('slugTooShort'),
          slugTooLong: t('slugTooLong'),
          slugFormat: t('slugFormat'),
          slugInvalid: t('slugInvalid'),
          slugInUse: t('slugInUse'),
          addressPreviewLabel: t('addressPreviewLabel'),
          addressPrefix: t('addressPrefix'),
          submit: t('submit'),
          submitting: t('submitting'),
          errorTitle: t('errorTitle'),
          errorDescription: t('errorDescription'),
        }}
      />
    </SessionBoundary>
  );
}
