'use client';

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';

import { ApiError } from '@rivet/api-client';

export function getSessionRequiredRedirect(
  error: unknown,
  location: { pathname: string; search: string },
): string | null {
  if (
    !(error instanceof ApiError) ||
    error.status !== 401 ||
    typeof error.body !== 'object' ||
    error.body === null ||
    !('code' in error.body) ||
    error.body.code !== 'SESSION_REQUIRED'
  ) {
    return null;
  }

  const returnTo = `${location.pathname}${location.search}`;

  if (
    !location.pathname.startsWith('/') ||
    location.pathname.startsWith('//') ||
    (location.search !== '' && !location.search.startsWith('?')) ||
    returnTo.includes('\\')
  ) {
    return '/login';
  }

  return `/login?returnTo=${encodeURIComponent(returnTo)}`;
}

function handleGlobalError(error: unknown): void {
  const redirect = getSessionRequiredRedirect(error, window.location);

  if (redirect) {
    window.location.replace(redirect);
  }
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        mutationCache: new MutationCache({ onError: handleGlobalError }),
        queryCache: new QueryCache({ onError: handleGlobalError }),
        defaultOptions: {
          queries: {
            retry: 1,
            staleTime: 30_000,
          },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
