import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { cn } from '@/lib/utils';

export function ContentEmpty({
  align = 'start',
  icon: Icon,
  title,
  description,
  headingLevel = 2,
  children,
}: {
  align?: 'center' | 'start';
  icon: LucideIcon;
  title: string;
  description: string;
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  children?: ReactNode;
}) {
  const isCentered = align === 'center';

  return (
    <Empty
      className={cn(
        'min-h-72 rounded-none px-0 py-16',
        isCentered
          ? 'items-center justify-center text-center'
          : 'items-start justify-start text-left',
      )}
    >
      <EmptyHeader className={isCentered ? 'items-center' : 'items-start'}>
        <EmptyMedia variant="icon" className="bg-surface-2 text-muted-foreground size-10">
          <Icon aria-hidden="true" className="size-6" strokeWidth={1.75} />
        </EmptyMedia>
        <EmptyTitle role="heading" aria-level={headingLevel} className="text-base">
          {title}
        </EmptyTitle>
        <EmptyDescription className="max-w-md">{description}</EmptyDescription>
      </EmptyHeader>
      {children ? (
        <EmptyContent className={isCentered ? 'items-center' : 'items-start'}>
          {children}
        </EmptyContent>
      ) : null}
    </Empty>
  );
}
