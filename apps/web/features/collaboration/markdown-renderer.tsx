'use client';

import { defaultSchema, type Schema } from 'hast-util-sanitize';
import { ImageOffIcon } from 'lucide-react';
import Image from 'next/image';
import { useState } from 'react';
import ReactMarkdown, { type Components, type UrlTransform } from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

import { fileContentUrl } from '@/features/files/file-api';
import { cn } from '@/lib/utils';

const UUID_V4 = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const FILE_REFERENCE = new RegExp(`^/files/(${UUID_V4})$`, 'i');
const MEMBER_REFERENCE = new RegExp(`^rivet-member:(${UUID_V4})$`, 'i');

const MARKDOWN_SCHEMA: Schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: ['href'],
    img: ['alt', 'src', 'title'],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'rivet-member'],
  },
  tagNames: [
    'a',
    'blockquote',
    'br',
    'code',
    'del',
    'em',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'img',
    'li',
    'ol',
    'p',
    'pre',
    'strong',
    'ul',
  ],
};

export const safeMarkdownUrl: UrlTransform = (url, key) => {
  if (key === 'src') return FILE_REFERENCE.test(url) ? url : null;
  if (MEMBER_REFERENCE.test(url)) return url;

  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      !parsed.username &&
      !parsed.password
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
};

function MarkdownImage({
  alt,
  unavailableLabel,
  src,
}: {
  alt: string;
  unavailableLabel: string;
  src: string | undefined;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{
    height: number;
    source: string;
    width: number;
  } | null>(null);
  const match = src?.match(FILE_REFERENCE);
  const source = match?.[1] ? fileContentUrl(match[1]) : null;

  if (!source || failedSource === source) {
    return (
      <span
        role="img"
        aria-label={alt || unavailableLabel}
        className="bg-surface-1 text-muted-foreground my-3 flex min-h-24 w-full items-center justify-center gap-2 rounded-lg border px-4 py-6 text-sm"
      >
        <ImageOffIcon aria-hidden="true" className="size-4" />
        {unavailableLabel}
      </span>
    );
  }

  return (
    <Image
      src={source}
      alt={alt}
      width={naturalSize?.source === source ? naturalSize.width : 1520}
      height={naturalSize?.source === source ? naturalSize.height : 855}
      unoptimized
      className="my-3 h-auto w-auto max-w-full rounded-lg border object-contain"
      loading="lazy"
      referrerPolicy="no-referrer"
      onLoad={(event) =>
        setNaturalSize({
          height: event.currentTarget.naturalHeight || 1,
          source,
          width: event.currentTarget.naturalWidth || 1,
        })
      }
      onError={() => setFailedSource(source)}
    />
  );
}

export function MarkdownRenderer({
  className,
  imageUnavailableLabel,
  markdown,
}: {
  className?: string;
  imageUnavailableLabel: string;
  markdown: string;
}) {
  const components: Components = {
    a: ({ children, href }) => {
      const mention = href?.match(MEMBER_REFERENCE);
      if (mention?.[1]) {
        return (
          <span
            className="bg-primary/10 text-primary rounded px-1 py-0.5 font-medium"
            data-mention-membership-id={mention[1]}
          >
            {children}
          </span>
        );
      }

      if (!href) return <span>{children}</span>;

      return (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    },
    img: ({ alt = '', src }) => (
      <MarkdownImage
        alt={alt}
        src={typeof src === 'string' ? src : undefined}
        unavailableLabel={imageUnavailableLabel}
      />
    ),
  };

  return (
    <div
      className={cn(
        'text-foreground max-w-[760px] min-w-0 text-[15px] leading-6 break-words',
        '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4',
        '[&_blockquote]:border-primary/40 [&_blockquote]:text-muted-foreground [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:pl-4',
        '[&_h1]:mt-6 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:font-semibold',
        '[&_li]:my-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5',
        '[&_h1:first-child]:mt-0 [&_h2:first-child]:mt-0 [&_h3:first-child]:mt-0 [&_p:first-child]:mt-0',
        '[&_:not(pre)>code]:bg-surface-2 [&_:not(pre)>code]:rounded [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-xs',
        '[&_pre]:bg-surface-1 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-xs',
        className,
      )}
    >
      <ReactMarkdown
        components={components}
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, MARKDOWN_SCHEMA]]}
        skipHtml
        urlTransform={safeMarkdownUrl}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
