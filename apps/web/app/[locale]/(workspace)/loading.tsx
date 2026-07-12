'use client';

import { useTranslations } from 'next-intl';

import { ContentLoading } from '@/components/states/content-loading';

export default function Loading() {
  const t = useTranslations('States');

  return <ContentLoading label={t('loading')} />;
}
