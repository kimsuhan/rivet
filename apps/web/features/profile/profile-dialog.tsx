'use client';

import { useQueryClient } from '@tanstack/react-query';
import { CameraIcon, RotateCwIcon, Trash2Icon } from 'lucide-react';
import Image from 'next/image';
import { useRef, useState } from 'react';

import {
  type AuthenticatedSessionDto,
  avatarControllerClear,
  avatarControllerSet,
  getAuthControllerGetSessionQueryKey,
  type UnauthenticatedSessionDto,
} from '@rivet/api-client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress, ProgressLabel } from '@/components/ui/progress';
import { UserAvatar } from '@/components/user-avatar';
import {
  type DeleteUploadedFile,
  deleteUploadedFile,
  type UploadFile,
  uploadFile,
} from '@/features/files/file-api';
import { optimizeProfileImage } from '@/features/files/image-optimizer';

export type ProfileDialogLabels = {
  choose: string;
  close: string;
  description: string;
  discard: string;
  emptyFile: string;
  fileLimit: string;
  invalidType: string;
  optimizing: string;
  previewAlt: string;
  remove: string;
  removing: string;
  retry: string;
  save: string;
  saving: string;
  title: string;
  unexpectedError: string;
  uploading: string;
};

type ProfileUser = {
  avatarFileId: string | null;
  displayName: string;
  email: string;
  id: string;
};

export function ProfileDialog({
  clearAvatar = avatarControllerClear,
  labels,
  onOpenChange,
  open,
  removeFile = deleteUploadedFile,
  sendFile = uploadFile,
  setAvatar = (fileId) => avatarControllerSet({ fileId }),
  user,
}: {
  clearAvatar?: () => Promise<unknown>;
  labels: ProfileDialogLabels;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  removeFile?: DeleteUploadedFile;
  sendFile?: UploadFile;
  setAvatar?: (fileId: string) => Promise<unknown>;
  user: ProfileUser;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [pendingFileId, setPendingFileId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<
    'failed' | 'idle' | 'optimizing' | 'ready' | 'removing' | 'saving' | 'uploading'
  >('idle');
  const pendingFileIdRef = useRef<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const requestId = useRef(0);

  function replacePreview(nextPreviewUrl: string | null) {
    const current = previewUrlRef.current;
    if (current && current !== nextPreviewUrl) URL.revokeObjectURL(current);
    previewUrlRef.current = nextPreviewUrl;
    setPreviewUrl(nextPreviewUrl);
  }

  function replacePendingFile(nextFileId: string | null, removeCurrent: boolean) {
    const current = pendingFileIdRef.current;
    pendingFileIdRef.current = nextFileId;
    setPendingFileId(nextFileId);
    if (removeCurrent && current && current !== nextFileId) {
      void removeFile(current).catch(() => undefined);
    }
  }

  function resetSelection({ removePending }: { removePending: boolean }) {
    requestId.current += 1;
    replacePreview(null);
    setOriginalFile(null);
    setError(null);
    setStatus('idle');
    replacePendingFile(null, removePending);
  }

  async function prepare(file: File) {
    const currentRequestId = requestId.current + 1;
    requestId.current = currentRequestId;
    setOriginalFile(file);
    setError(null);
    setStatus('optimizing');
    replacePendingFile(null, true);
    replacePreview(URL.createObjectURL(file));

    try {
      const optimized = await optimizeProfileImage(file);
      if (requestId.current !== currentRequestId) return;
      replacePreview(URL.createObjectURL(optimized));
      setStatus('uploading');
      const uploaded = await sendFile(optimized, 'USER_PROFILE');
      if (requestId.current !== currentRequestId) {
        void removeFile(uploaded.id).catch(() => undefined);
        return;
      }
      replacePendingFile(uploaded.id, false);
      setStatus('ready');
    } catch {
      if (requestId.current !== currentRequestId) return;
      setError(labels.unexpectedError);
      setStatus('failed');
    }
  }

  function selectFile(file: File | undefined) {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError(labels.invalidType);
      return;
    }
    if (file.size < 1) {
      setError(labels.emptyFile);
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setError(labels.fileLimit);
      return;
    }
    void prepare(file);
  }

  async function save() {
    const fileId = pendingFileIdRef.current;
    if (!fileId) return;
    setStatus('saving');
    setError(null);

    try {
      await setAvatar(fileId);
    } catch {
      setError(labels.unexpectedError);
      setStatus('ready');
      return;
    }

    replacePendingFile(null, false);
    replacePreview(null);
    setOriginalFile(null);
    queryClient.setQueryData<AuthenticatedSessionDto | UnauthenticatedSessionDto>(
      getAuthControllerGetSessionQueryKey(),
      (session) =>
        session?.authenticated
          ? { ...session, user: { ...session.user, avatarFileId: fileId } }
          : session,
    );
    void queryClient
      .invalidateQueries({
        queryKey: getAuthControllerGetSessionQueryKey(),
        refetchType: 'active',
      })
      .catch(() => undefined);
    setStatus('idle');
    onOpenChange(false);
  }

  async function remove() {
    if (pendingFileId || originalFile) {
      resetSelection({ removePending: true });
      return;
    }
    if (!user.avatarFileId) return;

    setStatus('removing');
    setError(null);
    try {
      await clearAvatar();
    } catch {
      setError(labels.unexpectedError);
      setStatus('idle');
      return;
    }

    queryClient.setQueryData<AuthenticatedSessionDto | UnauthenticatedSessionDto>(
      getAuthControllerGetSessionQueryKey(),
      (session) =>
        session?.authenticated
          ? { ...session, user: { ...session.user, avatarFileId: null } }
          : session,
    );
    void queryClient
      .invalidateQueries({
        queryKey: getAuthControllerGetSessionQueryKey(),
        refetchType: 'active',
      })
      .catch(() => undefined);
    setStatus('idle');
    onOpenChange(false);
  }

  const isBusy = ['optimizing', 'removing', 'saving', 'uploading'].includes(status);
  const statusLabel =
    status === 'optimizing'
      ? labels.optimizing
      : status === 'uploading'
        ? labels.uploading
        : status === 'saving'
          ? labels.saving
          : status === 'removing'
            ? labels.removing
            : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isBusy) resetSelection({ removePending: true });
        onOpenChange(nextOpen || isBusy);
      }}
    >
      <DialogContent className="sm:max-w-lg" closeLabel={labels.close}>
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          <div className="relative size-24">
            {previewUrl ? (
              <Image
                src={previewUrl}
                alt={labels.previewAlt}
                width={96}
                height={96}
                unoptimized
                className="size-24 rounded-full border object-cover"
              />
            ) : (
              <UserAvatar
                avatarFileId={user.avatarFileId}
                displayName={user.displayName}
                className="size-24 text-2xl"
              />
            )}
            {statusLabel ? (
              <div className="bg-background/75 absolute inset-0 flex items-center justify-center rounded-full px-2 text-center text-xs backdrop-blur-sm">
                {statusLabel}
              </div>
            ) : null}
          </div>

          <div className="text-center">
            <p className="font-medium">{user.displayName}</p>
            <p className="text-muted-foreground text-sm">{user.email}</p>
          </div>

          {statusLabel ? (
            <Progress value={null} className="w-full max-w-xs gap-1.5" aria-label={statusLabel}>
              <ProgressLabel className="text-muted-foreground text-xs font-normal">
                {statusLabel}
              </ProgressLabel>
            </Progress>
          ) : null}

          <div className="flex flex-wrap justify-center gap-2">
            <label>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                disabled={isBusy}
                onChange={(event) => {
                  selectFile(event.currentTarget.files?.[0]);
                  event.currentTarget.value = '';
                }}
              />
              <span className="border-input bg-background hover:bg-muted focus-within:ring-ring inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm font-medium focus-within:ring-2">
                <CameraIcon aria-hidden="true" className="size-4" />
                {labels.choose}
              </span>
            </label>
            {status === 'failed' && originalFile ? (
              <Button type="button" variant="outline" onClick={() => void prepare(originalFile)}>
                <RotateCwIcon data-icon="inline-start" />
                {labels.retry}
              </Button>
            ) : null}
            {pendingFileId || originalFile || user.avatarFileId ? (
              <Button type="button" variant="ghost" disabled={isBusy} onClick={() => void remove()}>
                <Trash2Icon data-icon="inline-start" />
                {pendingFileId || originalFile ? labels.discard : labels.remove}
              </Button>
            ) : null}
          </div>
        </div>

        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            disabled={status !== 'ready' || !pendingFileId}
            onClick={() => void save()}
          >
            {status === 'saving' ? labels.saving : labels.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
