import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['ko'],
  defaultLocale: 'ko',
  localePrefix: 'as-needed',
  localeDetection: false,
});
