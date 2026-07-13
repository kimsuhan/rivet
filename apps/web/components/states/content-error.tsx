'use client';

import { CircleAlert } from 'lucide-react';

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export function ContentError({
  title,
  description,
  retryLabel,
  retryButtonClassName,
  onRetry,
  headingLevel = 2,
}: {
  title: string;
  description: string;
  retryLabel: string;
  retryButtonClassName?: string;
  onRetry: () => void;
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
}) {
  return (
    <Alert
      variant="destructive"
      className="border-destructive/35 bg-destructive/10 max-w-2xl px-4 py-3 pr-32"
    >
      <CircleAlert aria-hidden="true" data-icon="inline-start" strokeWidth={1.75} />
      <AlertTitle role="heading" aria-level={headingLevel}>
        {title}
      </AlertTitle>
      <AlertDescription>{description}</AlertDescription>
      <AlertAction className="top-3 right-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={retryButtonClassName}
          onClick={onRetry}
        >
          {retryLabel}
        </Button>
      </AlertAction>
    </Alert>
  );
}
