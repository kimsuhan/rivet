'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { fileContentUrl } from '@/features/files/file-api';
import { cn } from '@/lib/utils';

export function userInitial(displayName: string): string {
  return Array.from(displayName.trim())[0]?.toLocaleUpperCase() ?? '?';
}

export function UserAvatar({
  avatarFileId,
  className,
  displayName,
  size = 'default',
}: {
  avatarFileId: string | null;
  className?: string;
  displayName: string;
  size?: 'default' | 'lg' | 'sm';
}) {
  return (
    <Avatar className={cn(className)} size={size}>
      {avatarFileId ? (
        <AvatarImage
          src={fileContentUrl(avatarFileId)}
          alt={displayName}
          referrerPolicy="no-referrer"
        />
      ) : null}
      <AvatarFallback aria-label={displayName}>{userInitial(displayName)}</AvatarFallback>
    </Avatar>
  );
}
