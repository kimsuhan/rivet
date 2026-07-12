'use client';

import { Download, FileSpreadsheet, ShieldAlert } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

import {
  exportsControllerIssues,
  exportsControllerProjects,
  getExportsControllerIssuesUrl,
  getExportsControllerProjectsUrl,
} from '@rivet/api-client';

import { PageHeading } from '@/components/layout/page-heading';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

type ExportKind = 'issues' | 'projects';
type ExportResult =
  { status: 'idle' } | { status: 'error' } | { completedAt: Date; status: 'success' };

function fileDate(date: Date): string {
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
    .map((part) => String(part).padStart(2, '0'))
    .join('');
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function ExportCard({
  disabled,
  kind,
  onExport,
  pending,
  result,
}: {
  disabled: boolean;
  kind: ExportKind;
  onExport: (kind: ExportKind) => void;
  pending: boolean;
  result: ExportResult;
}) {
  const t = useTranslations('Settings.export');
  const format = useFormatter();
  const href =
    kind === 'issues' ? getExportsControllerIssuesUrl() : getExportsControllerProjectsUrl();

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet aria-hidden="true" />
          {t(`${kind}.title`)}
        </CardTitle>
        <CardDescription>{t(`${kind}.description`)}</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">{t('includedFields')}</p>
          <p className="text-muted-foreground text-sm leading-6">{t(`${kind}.fields`)}</p>
        </div>

        <p className="text-muted-foreground flex items-start gap-2 text-xs leading-5">
          <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{t(`${kind}.sensitive`)}</span>
        </p>

        {result.status === 'error' ? (
          <Alert variant="destructive">
            <AlertTitle>{t('failureTitle')}</AlertTitle>
            <AlertDescription>{t('failureDescription')}</AlertDescription>
          </Alert>
        ) : result.status === 'success' ? (
          <p role="status" className="text-muted-foreground text-sm">
            {t('success', {
              time: format.dateTime(result.completedAt, {
                dateStyle: 'medium',
                timeStyle: 'short',
              }),
            })}
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">{t('ready')}</p>
        )}
      </CardContent>

      <CardFooter className="justify-end">
        <a
          href={href}
          download
          aria-disabled={disabled || undefined}
          tabIndex={disabled ? -1 : undefined}
          className={cn(buttonVariants(), disabled && 'pointer-events-none opacity-50')}
          onClick={(event) => {
            event.preventDefault();
            if (!disabled) onExport(kind);
          }}
        >
          {pending ? (
            <Spinner data-icon="inline-start" aria-hidden="true" />
          ) : (
            <Download data-icon="inline-start" aria-hidden="true" />
          )}
          {pending
            ? t('generating')
            : result.status === 'error'
              ? t('retry')
              : result.status === 'success'
                ? t('exportAgain')
                : t('export')}
        </a>
        {pending ? (
          <span role="status" className="sr-only">
            {t('generatingStatus', { resource: t(`${kind}.title`) })}
          </span>
        ) : null}
      </CardFooter>
    </Card>
  );
}

export function ExportSettingsScreen() {
  const t = useTranslations('Settings.export');
  const [activeExport, setActiveExport] = useState<ExportKind | null>(null);
  const [results, setResults] = useState<Record<ExportKind, ExportResult>>({
    issues: { status: 'idle' },
    projects: { status: 'idle' },
  });

  async function runExport(kind: ExportKind): Promise<void> {
    if (activeExport) return;

    setActiveExport(kind);
    setResults((current) => ({ ...current, [kind]: { status: 'idle' } }));

    try {
      const blob = await (kind === 'issues'
        ? exportsControllerIssues({ headers: { Accept: 'text/csv' } })
        : exportsControllerProjects({ headers: { Accept: 'text/csv' } }));
      const completedAt = new Date();
      download(blob, `rivet-${kind}-${fileDate(completedAt)}.csv`);
      setResults((current) => ({
        ...current,
        [kind]: { completedAt, status: 'success' },
      }));
    } catch {
      setResults((current) => ({ ...current, [kind]: { status: 'error' } }));
    } finally {
      setActiveExport(null);
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeading title={t('title')} description={t('description')} />

      <Alert>
        <ShieldAlert aria-hidden="true" />
        <AlertTitle>{t('warningTitle')}</AlertTitle>
        <AlertDescription>{t('warningDescription')}</AlertDescription>
      </Alert>

      <div className="grid gap-4 xl:grid-cols-2">
        {(['issues', 'projects'] as const).map((kind) => (
          <ExportCard
            key={kind}
            kind={kind}
            disabled={activeExport !== null}
            pending={activeExport === kind}
            result={results[kind]}
            onExport={(nextKind) => void runExport(nextKind)}
          />
        ))}
      </div>

      <p className="text-muted-foreground text-sm">{t('noImport')}</p>
    </section>
  );
}
