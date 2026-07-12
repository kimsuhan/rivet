'use client';

import { useRef, useState } from 'react';

import { useAuthControllerGetSession } from '@rivet/api-client';

import { UserAvatar } from '@/components/user-avatar';

import { ProfileDialog, type ProfileDialogLabels } from './profile-dialog';

export function OnboardingProfile({
  labels,
}: {
  labels: { dialog: ProfileDialogLabels; open: string };
}) {
  const session = useAuthControllerGetSession({ query: { retry: false } });
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);

  if (!session.data?.authenticated) return null;

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={labels.open}
        aria-pressed={open}
        title={labels.dialog.title}
        className="app-floating-layer focus-visible:ring-ring fixed top-4 right-4 rounded-full outline-none focus-visible:ring-2"
        onClick={() => setOpen(true)}
      >
        <UserAvatar
          avatarFileId={session.data.user.avatarFileId}
          displayName={session.data.user.displayName}
        />
      </button>
      {open ? (
        <ProfileDialog
          open
          labels={labels.dialog}
          user={session.data.user}
          onOpenChange={(nextOpen) => {
            setOpen(nextOpen);
            if (!nextOpen) requestAnimationFrame(() => trigger.current?.focus());
          }}
        />
      ) : null}
    </>
  );
}
