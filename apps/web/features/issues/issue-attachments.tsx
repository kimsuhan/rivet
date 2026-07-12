'use client';

import { useQueryClient } from '@tanstack/react-query';
import { DownloadIcon, FileIcon, ImageIcon, PaperclipIcon, Trash2Icon } from 'lucide-react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useCallback, useRef, useState } from 'react';

import {
  ApiError,
  filesControllerDownload,
  getFilesControllerContentUrl,
  getIssueAttachmentsControllerListQueryKey,
  getIssuesControllerGetQueryKey,
  type IssueAttachmentListResponseDto,
  type IssueAttachmentResponseDto,
  issueAttachmentsControllerCreate,
  issueAttachmentsControllerDelete,
  type IssueDetailResponseDto,
  useIssueAttachmentsControllerDelete,
  useIssueAttachmentsControllerList,
} from '@rivet/api-client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { UserAvatar } from '@/components/user-avatar';
import { deleteUploadedFile, uploadFile } from '@/features/files/file-api';
import { FileUploadQueue } from '@/features/files/file-upload-queue';

import { fileUploadQueueLabels } from './issue-collaboration-labels';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

const ignoreFileIds = () => undefined;

export function IssueAttachments({ issue }: { issue: IssueDetailResponseDto }) {
  const t = useTranslations('IssueDetail');
  const filesT = useTranslations('Files');
  const queryClient = useQueryClient();
  const linkedAttachments = useRef(new Map<string, string>());
  const [removeTarget, setRemoveTarget] = useState<IssueAttachmentResponseDto | null>(null);
  const [uploadLinkError, setUploadLinkError] = useState(false);
  const [unavailableFileId, setUnavailableFileId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState(false);
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);
  const attachments = useIssueAttachmentsControllerList(issue.id, {
    query: {
      placeholderData: { items: issue.attachments, nextCursor: null },
      retry: false,
    },
  });
  const removeAttachment = useIssueAttachmentsControllerDelete();

  const cacheAttachment = useCallback(
    (attachment: IssueAttachmentResponseDto) => {
      const detailAttachment = {
        ...attachment,
        file: { ...attachment.file, scope: 'WORKSPACE' as const },
      };
      queryClient.setQueryData<IssueAttachmentListResponseDto>(
        getIssueAttachmentsControllerListQueryKey(issue.id),
        (current) => ({
          items: [
            ...(current?.items ?? []).filter((item) => item.id !== attachment.id),
            attachment,
          ],
          nextCursor: current?.nextCursor ?? null,
        }),
      );
      for (const issueRef of [issue.id, issue.identifier]) {
        queryClient.setQueryData<IssueDetailResponseDto>(
          getIssuesControllerGetQueryKey(issueRef),
          (current) =>
            current
              ? {
                  ...current,
                  attachments: [
                    ...current.attachments.filter((item) => item.id !== attachment.id),
                    detailAttachment,
                  ],
                }
              : current,
        );
      }
    },
    [issue.id, issue.identifier, queryClient],
  );

  const uncacheAttachment = useCallback(
    (attachmentId: string) => {
      queryClient.setQueryData<IssueAttachmentListResponseDto>(
        getIssueAttachmentsControllerListQueryKey(issue.id),
        (current) =>
          current
            ? { ...current, items: current.items.filter((item) => item.id !== attachmentId) }
            : current,
      );
      for (const issueRef of [issue.id, issue.identifier]) {
        queryClient.setQueryData<IssueDetailResponseDto>(
          getIssuesControllerGetQueryKey(issueRef),
          (current) =>
            current
              ? {
                  ...current,
                  attachments: current.attachments.filter((item) => item.id !== attachmentId),
                }
              : current,
        );
      }
    },
    [issue.id, issue.identifier, queryClient],
  );

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: getIssueAttachmentsControllerListQueryKey(issue.id),
      }),
      queryClient.invalidateQueries({ queryKey: getIssuesControllerGetQueryKey(issue.id) }),
      queryClient.invalidateQueries({
        queryKey: getIssuesControllerGetQueryKey(issue.identifier),
      }),
    ]);
  }, [issue.id, issue.identifier, queryClient]);

  const sendFile = useCallback(
    async (file: File, scope: 'USER_PROFILE' | 'WORKSPACE') => {
      const uploaded = await uploadFile(file, scope);
      let attachment: IssueAttachmentResponseDto;
      try {
        attachment = await issueAttachmentsControllerCreate(issue.id, {
          fileId: uploaded.id,
        });
      } catch (error) {
        void deleteUploadedFile(uploaded.id).catch(() => undefined);
        throw error;
      }

      linkedAttachments.current.set(uploaded.id, attachment.id);
      cacheAttachment(attachment);
      setUploadLinkError(false);
      void refresh().catch(() => undefined);
      return uploaded;
    },
    [cacheAttachment, issue.id, refresh],
  );

  const removeFile = useCallback(
    async (fileId: string) => {
      const attachmentId = linkedAttachments.current.get(fileId);
      if (!attachmentId) return deleteUploadedFile(fileId);

      try {
        await issueAttachmentsControllerDelete(issue.id, attachmentId);
        linkedAttachments.current.delete(fileId);
        uncacheAttachment(attachmentId);
        setUploadLinkError(false);
      } catch (error) {
        setUploadLinkError(true);
        void refresh().catch(() => undefined);
        throw error;
      }
      void refresh().catch(() => undefined);
    },
    [issue.id, refresh, uncacheAttachment],
  );

  async function download(attachment: IssueAttachmentResponseDto) {
    setDownloadingFileId(attachment.file.id);
    setUnavailableFileId(null);
    setDownloadError(false);
    try {
      const blob = await filesControllerDownload(attachment.file.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.file.originalName;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) {
        setUnavailableFileId(attachment.file.id);
      } else {
        setDownloadError(true);
      }
    } finally {
      setDownloadingFileId(null);
    }
  }

  const items = attachments.data?.items ?? [];

  return (
    <section aria-labelledby="issue-attachments-title" className="mt-8">
      <div className="flex items-center gap-2">
        <PaperclipIcon aria-hidden="true" className="text-muted-foreground size-4" />
        <h2 id="issue-attachments-title" className="text-base font-semibold">
          {t('attachments.title')}
        </h2>
      </div>
      <p className="text-muted-foreground mt-1 text-sm">{t('attachments.description')}</p>

      <div className="mt-3">
        <FileUploadQueue
          labels={fileUploadQueueLabels((key) => filesT(key as never))}
          onFileIdsChange={ignoreFileIds}
          removeFile={removeFile}
          sendFile={sendFile}
        />
      </div>

      {uploadLinkError ? (
        <Alert variant="destructive" className="mt-3">
          <AlertTitle>{t('attachments.removeErrorTitle')}</AlertTitle>
          <AlertDescription>{t('attachments.removeErrorDescription')}</AlertDescription>
        </Alert>
      ) : null}
      {attachments.isError ? (
        <Alert variant="destructive" className="mt-3">
          <AlertTitle>{t('attachments.loadErrorTitle')}</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{t('attachments.loadErrorDescription')}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void attachments.refetch()}
            >
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {downloadError ? (
        <p role="alert" className="text-destructive mt-3 text-sm">
          {t('attachments.downloadError')}
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="text-muted-foreground mt-3 border-y py-4 text-sm">{t('attachments.empty')}</p>
      ) : (
        <ul className="mt-3 flex min-w-0 flex-col divide-y border-y">
          {items.map((attachment) => {
            const unavailable = unavailableFileId === attachment.file.id;
            return (
              <li key={attachment.id} className="flex min-w-0 items-center gap-3 py-3">
                {attachment.file.inlineDisplayable ? (
                  <Image
                    src={getFilesControllerContentUrl(attachment.file.id)}
                    alt=""
                    width={48}
                    height={48}
                    unoptimized
                    className="bg-surface-1 size-12 shrink-0 rounded-lg border object-cover"
                    onError={() => setUnavailableFileId(attachment.file.id)}
                  />
                ) : (
                  <span className="bg-surface-1 text-muted-foreground flex size-12 shrink-0 items-center justify-center rounded-lg border">
                    {attachment.file.detectedMimeType.startsWith('image/') ? (
                      <ImageIcon aria-hidden="true" className="size-5" />
                    ) : (
                      <FileIcon aria-hidden="true" className="size-5" />
                    )}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={attachment.file.originalName}>
                    {attachment.file.originalName}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {attachment.file.detectedMimeType} · {formatBytes(attachment.file.sizeBytes)}
                  </p>
                  <div className="text-muted-foreground mt-1 flex min-w-0 items-center gap-1.5 text-xs">
                    <UserAvatar
                      avatarFileId={attachment.uploader.avatarFileId}
                      displayName={attachment.uploader.displayName}
                      size="sm"
                    />
                    <span className="truncate">{attachment.uploader.displayName}</span>
                    <span aria-hidden="true">·</span>
                    <time dateTime={attachment.createdAt}>{formatDate(attachment.createdAt)}</time>
                  </div>
                  {unavailable ? (
                    <p role="alert" className="text-destructive mt-1 text-xs">
                      {t('attachments.unavailable')}
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  title={t('attachments.download')}
                  aria-label={`${attachment.file.originalName} ${t('attachments.download')}`}
                  disabled={downloadingFileId === attachment.file.id}
                  onClick={() => void download(attachment)}
                >
                  {downloadingFileId === attachment.file.id ? (
                    <Spinner data-icon="inline-start" aria-hidden="true" />
                  ) : (
                    <DownloadIcon data-icon="inline-start" />
                  )}
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  title={t('attachments.remove')}
                  aria-label={`${attachment.file.originalName} ${t('attachments.remove')}`}
                  onClick={() => setRemoveTarget(attachment)}
                >
                  <Trash2Icon data-icon="inline-start" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <AlertDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !removeAttachment.isPending) setRemoveTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('attachments.removeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('attachments.removeDescription', { name: removeTarget?.file.originalName ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {removeAttachment.isError ? (
            <p role="alert" className="text-destructive text-sm">
              {t('attachments.removeErrorDescription')}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeAttachment.isPending}>
              {t('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              type="button"
              variant="destructive"
              disabled={removeAttachment.isPending || !removeTarget}
              onClick={(event) => {
                event.preventDefault();
                if (!removeTarget) return;
                const target = removeTarget;
                removeAttachment.mutate(
                  { attachmentId: target.id, issueId: issue.id },
                  {
                    onSuccess: () => {
                      uncacheAttachment(target.id);
                      setRemoveTarget(null);
                      void refresh().catch(() => undefined);
                    },
                  },
                );
              }}
            >
              {t('attachments.remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
