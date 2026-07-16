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
            cancel: profile('cancel'),
            choose: profile('choose'),
            close: profile('close'),
            description: profile('description'),
            discard: profile('discard'),
            emailDescription: profile('emailDescription'),
            emailLabel: profile('emailLabel'),
            emptyFile: profile('emptyFile'),
            fileLimit: profile('fileLimit'),
            invalidType: profile('invalidType'),
            nameDescription: profile('nameDescription'),
            nameLabel: profile('nameLabel'),
            nameRequired: profile('nameRequired'),
            nameTooLong: profile('nameTooLong'),
            optimizing: profile('optimizing'),
            photoDescription: profile('photoDescription'),
            photoLabel: profile('photoLabel'),
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
