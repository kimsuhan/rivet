'use client';

import { ExternalLinkIcon, SendIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import type {
  IssueMemberSummaryResponseDto,
  IssueRelationIssueResponseDto,
} from '@rivet/api-client';

import { Badge } from '@/components/ui/badge';
import { UserAvatar } from '@/components/user-avatar';
import { MarkdownRenderer } from '@/features/collaboration/markdown-renderer';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

import { extractHandoffApiSpecificationUrl } from './issue-handoff-validation';

type Handoff = {
  author: IssueMemberSummaryResponseDto;
  bodyMarkdown: string;
  changeSummary?: string;
  createdAt: string;
  id: string;
  kind: 'FOLLOW_UP' | 'INITIAL';
  sequenceNumber: number;
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(new Date(value));
}

export function IssueHandoffCard({
  anchor = true,
  className,
  downstreamIssues = [],
  handoff,
  headingLevel = 3,
  parentIssue,
  sourceIssue,
}: {
  anchor?: boolean;
  className?: string;
  downstreamIssues?: IssueRelationIssueResponseDto[];
  handoff: Handoff;
  headingLevel?: 3 | 4;
  parentIssue?: { identifier: string; title: string } | null;
  sourceIssue?: IssueRelationIssueResponseDto;
}) {
  const t = useTranslations('IssueDetail');
  const markdownT = useTranslations('Markdown');
  const url = extractHandoffApiSpecificationUrl(handoff.bodyMarkdown);
  const Heading = headingLevel === 4 ? 'h4' : 'h3';

  useEffect(() => {
    if (!anchor) return;
    if (window.location.hash !== `#handoff-${handoff.id}`) return;

    requestAnimationFrame(() => {
      const target = document.getElementById(`handoff-${handoff.id}`);
      target?.querySelector('details')?.setAttribute('open', '');
      target?.scrollIntoView({ block: 'center' });
    });
  }, [anchor, handoff.id]);

  return (
    <article
      id={anchor ? `handoff-${handoff.id}` : undefined}
      className={cn(
        'bg-surface-1 focus-visible:ring-ring min-w-0 scroll-mt-20 rounded-xl border p-3 outline-none focus-visible:ring-2',
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <SendIcon aria-hidden="true" className="text-primary size-4" />
        <Heading className="text-sm font-semibold">
          {handoff.kind === 'INITIAL' ? t('handoff.initial') : t('handoff.followUp')}
        </Heading>
        <Badge variant="secondary">#{handoff.sequenceNumber}</Badge>
        <time dateTime={handoff.createdAt} className="text-muted-foreground ml-auto text-xs">
          {formatDate(handoff.createdAt)}
        </time>
      </div>
      <div className="text-muted-foreground mt-2 flex min-w-0 items-center gap-1.5 text-xs">
        <UserAvatar
          avatarFileId={handoff.author.user.avatarFileId}
          displayName={handoff.author.user.displayName}
          size="sm"
        />
        <span className="truncate">{handoff.author.user.displayName}</span>
      </div>

      {handoff.changeSummary ? (
        <p className="mt-3 text-sm break-words">{handoff.changeSummary}</p>
      ) : null}

      {sourceIssue || parentIssue || downstreamIssues.length > 0 ? (
        <dl className="text-muted-foreground mt-3 grid gap-2 text-xs sm:grid-cols-2">
          {sourceIssue ? (
            <div className="min-w-0">
              <dt>{t('handoff.sourceTask')}</dt>
              <dd>
                <Link
                  href={`/issues/${encodeURIComponent(sourceIssue.identifier)}`}
                  className="text-primary block truncate underline-offset-4 hover:underline"
                >
                  {sourceIssue.identifier} · {sourceIssue.title}
                </Link>
              </dd>
            </div>
          ) : null}
          {parentIssue ? (
            <div className="min-w-0">
              <dt>{t('handoff.parentIssue')}</dt>
              <dd>
                <Link
                  href={`/issues/${encodeURIComponent(parentIssue.identifier)}`}
                  className="text-primary block truncate underline-offset-4 hover:underline"
                >
                  {parentIssue.identifier} · {parentIssue.title}
                </Link>
              </dd>
            </div>
          ) : null}
          {downstreamIssues.length > 0 ? (
            <div className="min-w-0 sm:col-span-2">
              <dt>{t('handoff.downstreamTasks')}</dt>
              <dd className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-1">
                {downstreamIssues.map((issue) => (
                  <Link
                    key={issue.id}
                    href={`/issues/${encodeURIComponent(issue.identifier)}`}
                    className="text-primary min-w-0 truncate underline-offset-4 hover:underline"
                  >
                    {issue.identifier} · {issue.title}
                  </Link>
                ))}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary mt-3 inline-flex max-w-full items-center gap-1 truncate text-sm underline underline-offset-4"
        >
          <ExternalLinkIcon aria-hidden="true" className="size-3.5 shrink-0" />
          {url}
        </a>
      ) : null}
      <details className="mt-3">
        <summary className="text-muted-foreground cursor-pointer text-sm">
          {t('handoff.showBody')}
        </summary>
        <MarkdownRenderer
          className="mt-2"
          imageUnavailableLabel={markdownT('imageUnavailable')}
          markdown={handoff.bodyMarkdown}
        />
      </details>
    </article>
  );
}
