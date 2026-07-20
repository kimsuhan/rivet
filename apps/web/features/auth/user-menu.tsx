'use client';

import { useQueryClient } from '@tanstack/react-query';
import { LogOutIcon, MessageSquarePlusIcon, UserRoundIcon } from 'lucide-react';
import { type ReactNode, type RefObject, useState } from 'react';

import { setCsrfToken, useAuthControllerLogout } from '@rivet/api-client';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { useRouter } from '@/i18n/navigation';

export type UserMenuLabels = {
  feedback: string;
  loggingOut: string;
  logout: string;
  logoutError: string;
  open: string;
  profile: string;
};

export function UserMenu({
  align = 'start',
  children,
  className,
  labels,
  onOpenChange,
  onOpenFeedback,
  onOpenProfile,
  open,
  side = 'top',
  triggerRef,
  user,
}: {
  align?: 'center' | 'end' | 'start';
  children: ReactNode;
  className?: string;
  labels: UserMenuLabels;
  onOpenChange: (open: boolean) => void;
  onOpenFeedback: () => void;
  onOpenProfile: () => void;
  open: boolean;
  side?: 'bottom' | 'top';
  triggerRef?: RefObject<HTMLButtonElement | null>;
  user: { displayName: string; email: string };
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [failed, setFailed] = useState(false);
  const logout = useAuthControllerLogout({
    mutation: {
      onSuccess: () => {
        setCsrfToken(null);
        onOpenChange(false);
        router.replace('/login');
        queryClient.clear();
      },
      onError: () => setFailed(true),
    },
  });

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (logout.isPending) return;
        if (!nextOpen) setFailed(false);
        onOpenChange(nextOpen);
      }}
    >
      <PopoverTrigger
        ref={triggerRef}
        type="button"
        aria-label={labels.open}
        className={className}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent align={align} side={side} className="w-60 gap-1 p-1">
        <div className="px-2 py-1.5">
          <PopoverTitle className="truncate text-sm">{user.displayName}</PopoverTitle>
          <p className="text-muted-foreground truncate text-xs">{user.email}</p>
        </div>
        <Separator />
        <Button
          className="w-full justify-start"
          size="sm"
          variant="ghost"
          disabled={logout.isPending}
          onClick={() => {
            onOpenChange(false);
            onOpenProfile();
          }}
        >
          <UserRoundIcon data-icon="inline-start" />
          {labels.profile}
        </Button>
        <Button
          className="w-full justify-start"
          size="sm"
          variant="ghost"
          disabled={logout.isPending}
          onClick={() => {
            onOpenChange(false);
            onOpenFeedback();
          }}
        >
          <MessageSquarePlusIcon data-icon="inline-start" />
          {labels.feedback}
        </Button>
        <Button
          className="text-destructive hover:text-destructive w-full justify-start"
          size="sm"
          variant="ghost"
          disabled={logout.isPending}
          onClick={() => {
            setFailed(false);
            logout.mutate();
          }}
        >
          <LogOutIcon data-icon="inline-start" />
          {logout.isPending ? labels.loggingOut : labels.logout}
        </Button>
        {failed ? (
          <p className="text-destructive px-2 py-1 text-xs" role="alert">
            {labels.logoutError}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
