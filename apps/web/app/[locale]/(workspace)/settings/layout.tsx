import { MonitorUp } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';

import { ContentEmpty } from '@/components/states/content-empty';
import { buttonVariants } from '@/components/ui/button';
import { AdminSettingsBoundary } from '@/features/settings/admin-settings-boundary';
import { SettingsShell } from '@/features/settings/settings-shell';
import { Link } from '@/i18n/navigation';

export default async function SettingsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Settings.common');

  return (
    <AdminSettingsBoundary
      labels={{
        backToWork: t('backToWork'),
        errorDescription: t('errorDescription'),
        errorTitle: t('errorTitle'),
        loading: t('loading'),
        permissionDescription: t('permissionDescription'),
        permissionTitle: t('permissionTitle'),
        retry: t('retry'),
      }}
    >
      <div className="lg:hidden">
        <ContentEmpty
          icon={MonitorUp}
          title={t('desktopTitle')}
          description={t('desktopDescription')}
          headingLevel={1}
        >
          <Link href="/my-issues" className={buttonVariants({ size: 'lg', variant: 'outline' })}>
            {t('backToWork')}
          </Link>
        </ContentEmpty>
      </div>
      <div className="hidden lg:block">
        <SettingsShell
          labels={{
            export: t('export'),
            feedback: t('feedback'),
            import: t('import'),
            labels: t('labels'),
            members: t('members'),
            navigation: t('navigation'),
            teams: t('teams'),
            templates: t('templates'),
            title: t('title'),
            trash: t('trash'),
          }}
        >
          {children}
        </SettingsShell>
      </div>
    </AdminSettingsBoundary>
  );
}
