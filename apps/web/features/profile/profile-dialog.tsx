'use client';

import { useQueryClient } from '@tanstack/react-query';
import { CameraIcon, RotateCwIcon, Trash2Icon } from 'lucide-react';
import Image from 'next/image';
import { useRef, useState } from 'react';

import {
  ApiError,
  authControllerUpdateMe,
  type AuthenticatedSessionDto,
  avatarControllerClear,
  avatarControllerSet,
  getAuthControllerGetSessionQueryKey,
  type UnauthenticatedSessionDto,
} from '@rivet/api-client';

import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Progress, ProgressLabel } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { UserAvatar } from '@/components/user-avatar';
import {
  type DeleteUploadedFile,
  deleteUploadedFile,
  type UploadFile,
  uploadFile,
} from '@/features/files/file-api';
import { optimizeProfileImage } from '@/features/files/image-optimizer';
import { cn } from '@/lib/utils';

export type ProfileDialogLabels = {
  cancel: string;
  choose: string;
  close: string;
  description: string;
  discard: string;
  emailDescription: string;
  emailLabel: string;
  emptyFile: string;
  fileLimit: string;
  invalidType: string;
  nameDescription: string;
  nameLabel: string;
  nameRequired: string;
  nameTooLong: string;
  optimizing: string;
  photoDescription: string;
  photoLabel: string;
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
  updateProfile = (displayName) => authControllerUpdateMe({ displayName }),
  user,
}: {
  clearAvatar?: () => Promise<unknown>;
  labels: ProfileDialogLabels;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  removeFile?: DeleteUploadedFile;
  sendFile?: UploadFile;
  setAvatar?: (fileId: string) => Promise<unknown>;
  updateProfile?: (displayName: string) => Promise<ProfileUser>;
  user: ProfileUser;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [pendingFileId, setPendingFileId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<
    'failed' | 'idle' | 'optimizing' | 'ready' | 'removing' | 'saving' | 'uploading'
  >('idle');
  const pendingFileIdRef = useRef<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const requestId = useRef(0);

  function validateDisplayName(value: string): string | null {
    const length = [...value.trim()].length;
    if (length < 1) return labels.nameRequired;
    if (length > 50) return labels.nameTooLong;
    return null;
  }

  function updateSessionUser(patch: Partial<Pick<ProfileUser, 'avatarFileId' | 'displayName'>>) {
    queryClient.setQueryData<AuthenticatedSessionDto | UnauthenticatedSessionDto>(
      getAuthControllerGetSessionQueryKey(),
      (session) =>
        session?.authenticated ? { ...session, user: { ...session.user, ...patch } } : session,
    );
    void queryClient
      .invalidateQueries({
        queryKey: getAuthControllerGetSessionQueryKey(),
        refetchType: 'active',
      })
      .catch(() => undefined);
  }

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
    const nextDisplayName = displayName.trim();
    const nextNameError = validateDisplayName(displayName);
    const nameChanged = nextDisplayName !== user.displayName;
    if (nextNameError) {
      setNameError(nextNameError);
      return;
    }
    if (!fileId && !nameChanged) return;

    setStatus('saving');
    setError(null);
    setNameError(null);

    let savedDisplayName: string | undefined;
    if (nameChanged) {
      try {
        savedDisplayName = (await updateProfile(nextDisplayName)).displayName;
      } catch (caught) {
        if (caught instanceof ApiError && caught.body && typeof caught.body === 'object') {
          const message = (caught.body as { fieldErrors?: Record<string, string[]> }).fieldErrors
            ?.displayName?.[0];
          if (message) setNameError(message);
          else setError(labels.unexpectedError);
        } else {
          setError(labels.unexpectedError);
        }
        setStatus(fileId ? 'ready' : 'idle');
        return;
      }
    }

    if (fileId) {
      try {
        await setAvatar(fileId);
      } catch {
        if (savedDisplayName) updateSessionUser({ displayName: savedDisplayName });
        setError(labels.unexpectedError);
        setStatus('ready');
        return;
      }
    }

    if (fileId) {
      replacePendingFile(null, false);
      replacePreview(null);
      setOriginalFile(null);
    }
    updateSessionUser({
      ...(fileId ? { avatarFileId: fileId } : {}),
      ...(savedDisplayName ? { displayName: savedDisplayName } : {}),
    });
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

    updateSessionUser({ avatarFileId: null });
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

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && !isBusy) resetSelection({ removePending: true });
    onOpenChange(nextOpen || isBusy);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:max-h-[calc(100dvh-1rem)] max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0 sm:max-w-lg"
        closeLabel={labels.close}
      >
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-0"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 py-2">
            <div className="relative size-24 shrink-0">
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
                  displayName={displayName.trim() || user.displayName}
                  className="size-24 text-2xl"
                />
              )}
              {statusLabel ? (
                <div className="bg-background/75 absolute inset-0 flex items-center justify-center rounded-full px-2 text-center text-xs backdrop-blur-sm">
                  {statusLabel}
                </div>
              ) : null}
            </div>

            <div className="flex min-w-0 flex-col items-start gap-3">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">{labels.photoLabel}</p>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {labels.photoDescription}
                </p>
              </div>

              {statusLabel ? (
                <Progress value={null} className="w-full gap-1.5" aria-label={statusLabel}>
                  <ProgressLabel className="text-muted-foreground text-xs font-normal">
                    {statusLabel}
                  </ProgressLabel>
                </Progress>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <label
                  aria-disabled={isBusy}
                  className={cn(
                    buttonVariants({ variant: 'outline' }),
                    'focus-within:border-ring focus-within:ring-ring/50 cursor-pointer focus-within:ring-2',
                    isBusy && 'pointer-events-none opacity-50',
                  )}
                >
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
                  <CameraIcon aria-hidden="true" data-icon="inline-start" />
                  {labels.choose}
                </label>
                {status === 'failed' && originalFile ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void prepare(originalFile)}
                  >
                    <RotateCwIcon data-icon="inline-start" />
                    {labels.retry}
                  </Button>
                ) : null}
                {pendingFileId || originalFile || user.avatarFileId ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={isBusy}
                    onClick={() => void remove()}
                  >
                    <Trash2Icon data-icon="inline-start" />
                    {pendingFileId || originalFile ? labels.discard : labels.remove}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>

          <Separator className="my-5" />

          <FieldGroup className="gap-4">
            <Field data-invalid={Boolean(nameError)}>
              <FieldLabel htmlFor="profile-display-name">{labels.nameLabel}</FieldLabel>
              <Input
                id="profile-display-name"
                autoComplete="name"
                aria-label={labels.nameLabel}
                aria-errormessage={nameError ? 'profile-display-name-error' : undefined}
                aria-invalid={Boolean(nameError)}
                disabled={isBusy}
                value={displayName}
                onBlur={() => setNameError(validateDisplayName(displayName))}
                onChange={(event) => {
                  setDisplayName(event.currentTarget.value);
                  setNameError(null);
                }}
              />
              <FieldDescription>{labels.nameDescription}</FieldDescription>
              <FieldError id="profile-display-name-error">{nameError}</FieldError>
            </Field>

            <Field className="bg-muted/40 rounded-lg p-3" orientation="responsive">
              <FieldContent>
                <FieldTitle>{labels.emailLabel}</FieldTitle>
                <FieldDescription>{labels.emailDescription}</FieldDescription>
              </FieldContent>
              <p className="text-muted-foreground min-w-0 text-sm break-all sm:text-right">
                {user.email}
              </p>
            </Field>
          </FieldGroup>

          {error ? (
            <p className="text-destructive mt-4 text-sm" role="alert">
              {error}
            </p>
          ) : null}

          <DialogFooter className="mt-5">
            <Button
              type="button"
              variant="outline"
              disabled={isBusy}
              onClick={() => handleOpenChange(false)}
            >
              {labels.cancel}
            </Button>
            <Button
              type="submit"
              disabled={
                isBusy ||
                (displayName.trim() === user.displayName && !(status === 'ready' && pendingFileId))
              }
            >
              {status === 'saving' ? labels.saving : labels.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
