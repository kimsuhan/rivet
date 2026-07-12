import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';

import { OnboardingProfile } from '@/features/profile/onboarding-profile';

export default async function OnboardingLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const profile = await getTranslations('Profile');

  return (
    <>
      <OnboardingProfile
        labels={{
          open: profile('open'),
          dialog: {
            choose: profile('choose'),
            close: profile('close'),
            description: profile('description'),
            discard: profile('discard'),
            emptyFile: profile('emptyFile'),
            fileLimit: profile('fileLimit'),
            invalidType: profile('invalidType'),
            optimizing: profile('optimizing'),
            previewAlt: profile('previewAlt'),
            remove: profile('remove'),
            removing: profile('removing'),
            retry: profile('retry'),
            save: profile('save'),
            saving: profile('saving'),
            title: profile('title'),
            unexpectedError: profile('unexpectedError'),
            uploading: profile('uploading'),
          },
        }}
      />
      {children}
    </>
  );
}
