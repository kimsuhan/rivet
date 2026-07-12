'use client';

import { AlertCircleIcon, RotateCwIcon } from 'lucide-react';
import { type ReactNode, useEffect } from 'react';

import { setCsrfToken, useAuthControllerGetSession } from '@rivet/api-client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useRouter } from '@/i18n/navigation';

import { getSessionRedirect, type RequiredSessionStep } from './session-routing';

type SessionBoundaryLabels = {
  errorDescription: string;
  errorTitle: string;
  loading: string;
  retry: string;
};

function SessionLoading({ label }: { label: string }) {
  return (
    <div
      className="flex min-h-dvh items-center justify-center px-4"
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">{label}</span>
      <div className="flex w-full max-w-md flex-col gap-4" aria-hidden="true">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-72 max-w-full" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    </div>
  );
}

export function SessionBoundary({
  children,
  expectedStep,
  labels,
}: {
  children: ReactNode;
  expectedStep: RequiredSessionStep;
  labels: SessionBoundaryLabels;
}) {
  const router = useRouter();
  const session = useAuthControllerGetSession({ query: { retry: false } });
  const redirectTarget = session.data ? getSessionRedirect(session.data, expectedStep) : null;

  useEffect(() => {
    if (session.isError) {
      setCsrfToken(null);
      return;
    }

    if (!session.data) {
      return;
    }

    setCsrfToken(session.data.authenticated ? session.data.csrfToken : null);

    if (redirectTarget) {
      const target =
        redirectTarget === '/login'
          ? `/login?returnTo=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`
          : redirectTarget;
      router.replace(target);
    }
  }, [redirectTarget, router, session.data, session.isError]);

  if (session.isPending || (session.data && redirectTarget)) {
    return <SessionLoading label={labels.loading} />;
  }

  if (session.isError) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircleIcon aria-hidden="true" />
          <AlertTitle>{labels.errorTitle}</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>{labels.errorDescription}</span>
            <Button type="button" variant="outline" onClick={() => void session.refetch()}>
              <RotateCwIcon data-icon="inline-start" />
              {labels.retry}
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return children;
}
