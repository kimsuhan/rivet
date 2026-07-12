'use client';

import './globals.css';

import { ContentError } from '@/components/states/content-error';
import messages from '@/messages/ko.json';

export default function GlobalError({
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="ko" className="dark">
      <body>
        <title>{`${messages.States.unexpectedTitle} · Rivet`}</title>
        <main className="flex min-h-dvh items-center justify-center px-5">
          <ContentError
            title={messages.States.unexpectedTitle}
            description={messages.States.unexpectedDescription}
            retryLabel={messages.States.retry}
            onRetry={unstable_retry}
            headingLevel={1}
          />
        </main>
      </body>
    </html>
  );
}
