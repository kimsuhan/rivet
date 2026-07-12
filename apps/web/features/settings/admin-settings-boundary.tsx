'use client';

import { ShieldX } from 'lucide-react';
import type { ReactNode } from 'react';

import { useAuthControllerGetSession } from '@rivet/api-client';

import { ContentEmpty } from '@/components/states/content-empty';
import { ContentError } from '@/components/states/content-error';
import { ContentLoading } from '@/components/states/content-loading';
import { buttonVariants } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

export function AdminSettingsBoundary({
  children,
  labels,
}: {
  children: ReactNode;
  labels: {
    backToWork: string;
    errorDescription: string;
    errorTitle: string;
    loading: string;
    permissionDescription: string;
    permissionTitle: string;
    retry: string;
  };
}) {
  const session = useAuthControllerGetSession({ query: { retry: false } });

  if (session.isPending) {
    return <ContentLoading label={labels.loading} />;
  }

  if (session.isError) {
    return (
      <ContentError
        title={labels.errorTitle}
        description={labels.errorDescription}
        retryLabel={labels.retry}
        onRetry={() => void session.refetch()}
        headingLevel={1}
      />
    );
  }

  const isAdmin = Boolean(
    session.data?.authenticated &&
    session.data.membership?.role === 'ADMIN' &&
    session.data.membership.status === 'ACTIVE',
  );

  if (!isAdmin) {
    return (
      <ContentEmpty
        icon={ShieldX}
        title={labels.permissionTitle}
        description={labels.permissionDescription}
        headingLevel={1}
      >
        <Link href="/my-issues" className={buttonVariants({ size: 'lg', variant: 'outline' })}>
          {labels.backToWork}
        </Link>
      </ContentEmpty>
    );
  }

  return children;
}
