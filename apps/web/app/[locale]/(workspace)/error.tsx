'use client';

import { useTranslations } from 'next-intl';

import { ContentError } from '@/components/states/content-error';

export default function Error({
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const t = useTranslations('States');

  return (
    <ContentError
      title={t('unexpectedTitle')}
      description={t('unexpectedDescription')}
      retryLabel={t('retry')}
      onRetry={unstable_retry}
      headingLevel={1}
    />
  );
}
