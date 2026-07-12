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

export function ContentEmpty({
  icon: Icon,
  title,
  description,
  headingLevel = 2,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  children?: ReactNode;
}) {
  return (
    <Empty className="min-h-72 items-start justify-start rounded-none px-0 py-16 text-left">
      <EmptyHeader className="items-start">
        <EmptyMedia variant="icon" className="bg-surface-2 text-muted-foreground size-10">
          <Icon aria-hidden="true" className="size-6" strokeWidth={1.75} />
        </EmptyMedia>
        <EmptyTitle role="heading" aria-level={headingLevel} className="text-base">
          {title}
        </EmptyTitle>
        <EmptyDescription className="max-w-md">{description}</EmptyDescription>
      </EmptyHeader>
      {children ? <EmptyContent className="items-start">{children}</EmptyContent> : null}
    </Empty>
  );
}
