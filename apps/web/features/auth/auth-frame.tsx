import type { ReactNode } from 'react';

import { RivetWordmark } from '@/components/layout/brand';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

export type AuthFrameLabels = {
  productName: string;
  title: string;
  description: string;
};

export function AuthFrame({ labels, children }: { labels: AuthFrameLabels; children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <RivetWordmark alt={labels.productName} className="h-6" />
        </div>
        <Card className="bg-surface-1 gap-6 py-8">
          <CardHeader className="gap-2 px-6">
            <h1 className="text-[1.75rem] leading-[2.375rem] font-semibold tracking-[-0.012em]">
              {labels.title}
            </h1>
            <CardDescription className="leading-6 whitespace-pre-line">
              {labels.description}
            </CardDescription>
          </CardHeader>
          <CardContent className="px-6">{children}</CardContent>
        </Card>
      </div>
    </main>
  );
}

export function AuthLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="text-primary focus-visible:outline-ring rounded-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {children}
    </Link>
  );
}
