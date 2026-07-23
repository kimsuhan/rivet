'use client';

import { FolderKanban } from 'lucide-react';
import { useState } from 'react';

import { fileContentUrl } from '@/features/files/file-api';
import { cn } from '@/lib/utils';

const sizeClasses = {
  lg: 'size-10 rounded-lg',
  md: 'size-8 rounded-md',
  sm: 'size-6 rounded-md',
  xs: 'size-4 rounded-sm',
} as const;

export function ProjectLogo({
  className,
  logoFileId,
  name,
  size = 'sm',
}: {
  className?: string;
  logoFileId: string | null;
  name: string;
  size?: keyof typeof sizeClasses;
}) {
  const [failedFileId, setFailedFileId] = useState<string | null>(null);
  const failed = failedFileId === logoFileId;

  return (
    <span
      className={cn(
        'border-border bg-muted text-muted-foreground inline-flex shrink-0 items-center justify-center overflow-hidden border',
        sizeClasses[size],
        className,
      )}
      aria-hidden="true"
      title={name}
    >
      {logoFileId && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- 인증 쿠키가 필요한 파일 응답입니다.
        <img
          src={fileContentUrl(logoFileId)}
          alt=""
          className="size-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setFailedFileId(logoFileId)}
        />
      ) : (
        <FolderKanban className="size-1/2" />
      )}
    </span>
  );
}
