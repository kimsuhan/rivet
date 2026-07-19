'use client';

import {
  FileArchiveIcon,
  FileAudioIcon,
  FileCode2Icon,
  FileIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FileVideoIcon,
  type LucideIcon,
  PaperclipIcon,
  RotateCwIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Progress, ProgressLabel } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

import {
  type DeleteUploadedFile,
  deleteUploadedFile,
  type UploadFile,
  uploadFile,
} from './file-api';
import { optimizeWorkspaceImage } from './image-optimizer';

export type FileUploadQueueLabels = {
  chooseFiles: string;
  emptyFile: string;
  failed: string;
  fileLimit: string;
  optimizing?: string;
  remove: string;
  retry: string;
  selectedFiles: string;
  succeeded: string;
  unknownType: string;
  uploading: string;
};

type UploadTask = {
  error: string | null;
  file: File;
  fileId: string | null;
  id: string;
  previewUrl: string | null;
  status: 'failed' | 'optimizing' | 'succeeded' | 'uploading';
};

type FileKind = 'archive' | 'audio' | 'code' | 'file' | 'spreadsheet' | 'text' | 'video';

const FILE_KIND_ICONS: Record<FileKind, LucideIcon> = {
  archive: FileArchiveIcon,
  audio: FileAudioIcon,
  code: FileCode2Icon,
  file: FileIcon,
  spreadsheet: FileSpreadsheetIcon,
  text: FileTextIcon,
  video: FileVideoIcon,
};

function fileKind(file: File): FileKind {
  const mimeType = file.type.toLowerCase();
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';

  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  if (
    mimeType.includes('zip') ||
    mimeType.includes('compressed') ||
    ['7z', 'bz2', 'gz', 'rar', 'tar', 'zip'].includes(extension)
  ) {
    return 'archive';
  }
  if (
    mimeType.includes('spreadsheet') ||
    mimeType.includes('excel') ||
    ['csv', 'ods', 'tsv', 'xls', 'xlsx'].includes(extension)
  ) {
    return 'spreadsheet';
  }
  if (
    mimeType.includes('json') ||
    mimeType.includes('javascript') ||
    mimeType.includes('xml') ||
    ['css', 'html', 'java', 'js', 'jsx', 'json', 'md', 'py', 'sql', 'ts', 'tsx', 'xml'].includes(
      extension,
    )
  ) {
    return 'code';
  }
  if (mimeType.startsWith('text/') || mimeType === 'application/pdf') return 'text';
  return 'file';
}

function FileVisual({ file, previewUrl }: { file: File; previewUrl: string | null }) {
  if (previewUrl) {
    return (
      <Image
        src={previewUrl}
        alt=""
        width={48}
        height={48}
        unoptimized
        data-file-kind="image"
        className="bg-surface-1 size-12 shrink-0 rounded-lg border object-cover"
      />
    );
  }

  const kind = fileKind(file);
  const Icon = FILE_KIND_ICONS[kind];
  return (
    <span
      aria-hidden="true"
      data-file-kind={kind}
      className="bg-surface-1 text-muted-foreground flex size-12 shrink-0 items-center justify-center rounded-lg border"
    >
      <Icon className="size-5" />
    </span>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileUploadQueue({
  accept,
  compactTrigger = false,
  disabled = false,
  labels,
  onFileIdsChange,
  onReadyChange,
  removeFile = deleteUploadedFile,
  sendFile = uploadFile,
}: {
  accept?: string;
  compactTrigger?: boolean;
  disabled?: boolean;
  labels: FileUploadQueueLabels;
  onFileIdsChange: (fileIds: string[]) => void;
  onReadyChange?: (isReady: boolean) => void;
  removeFile?: DeleteUploadedFile;
  sendFile?: UploadFile;
}) {
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const removedTaskIds = useRef(new Set<string>());
  const compactInputRef = useRef<HTMLInputElement>(null);
  const previewUrls = useRef(new Map<string, string>());

  useEffect(() => {
    const urls = previewUrls.current;
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  useEffect(() => {
    onFileIdsChange(
      tasks.flatMap((task) => (task.status === 'succeeded' && task.fileId ? [task.fileId] : [])),
    );
  }, [onFileIdsChange, tasks]);

  useEffect(() => {
    onReadyChange?.(tasks.every((task) => task.status === 'succeeded'));
  }, [onReadyChange, tasks]);

  async function beginUpload(id: string, file: File) {
    setTasks((current) =>
      current.map((task) =>
        task.id === id ? { ...task, error: null, status: 'uploading' } : task,
      ),
    );

    try {
      const shouldOptimize = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type);
      if (shouldOptimize) {
        setTasks((current) =>
          current.map((task) => (task.id === id ? { ...task, status: 'optimizing' } : task)),
        );
      }
      const uploaded = await sendFile(
        shouldOptimize ? await optimizeWorkspaceImage(file) : file,
        'WORKSPACE',
      );
      if (removedTaskIds.current.has(id)) {
        void removeFile(uploaded.id).catch(() => undefined);
        return;
      }

      setTasks((current) =>
        current.map((task) =>
          task.id === id
            ? { ...task, error: null, fileId: uploaded.id, status: 'succeeded' }
            : task,
        ),
      );
    } catch {
      if (removedTaskIds.current.has(id)) return;
      setTasks((current) =>
        current.map((task) =>
          task.id === id ? { ...task, error: labels.failed, status: 'failed' } : task,
        ),
      );
    }
  }

  function selectFiles(files: FileList | null) {
    if (!files?.length) return;

    const maxBytes = 25 * 1024 * 1024;
    let nextError: string | null = null;
    const nextTasks: UploadTask[] = [];

    for (const file of Array.from(files)) {
      if (file.size < 1) {
        nextError = labels.emptyFile;
        continue;
      }
      if (file.size > maxBytes) {
        nextError = labels.fileLimit;
        continue;
      }

      const id = crypto.randomUUID();
      const previewUrl =
        file.type.startsWith('image/') && typeof URL.createObjectURL === 'function'
          ? URL.createObjectURL(file)
          : null;
      if (previewUrl) previewUrls.current.set(id, previewUrl);
      nextTasks.push({
        error: null,
        file,
        fileId: null,
        id,
        previewUrl,
        status: 'uploading',
      });
    }

    setSelectionError(nextError);
    if (!nextTasks.length) return;
    setTasks((current) => [...current, ...nextTasks]);
    for (const task of nextTasks) void beginUpload(task.id, task.file);
  }

  function retryTask(task: UploadTask) {
    void beginUpload(task.id, task.file);
  }

  function removeTask(task: UploadTask) {
    removedTaskIds.current.add(task.id);
    const previewUrl = previewUrls.current.get(task.id);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrls.current.delete(task.id);
    setTasks((current) => current.filter((currentTask) => currentTask.id !== task.id));
    if (task.fileId) void removeFile(task.fileId).catch(() => undefined);
  }

  return (
    <div className={cn(compactTrigger ? 'contents' : 'flex flex-col gap-3')}>
      {compactTrigger ? (
        <>
          <input
            ref={compactInputRef}
            type="file"
            multiple
            accept={accept}
            aria-hidden="true"
            className="sr-only"
            data-slot="file-upload-input"
            disabled={disabled}
            tabIndex={-1}
            onChange={(event) => {
              selectFiles(event.currentTarget.files);
              event.currentTarget.value = '';
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit px-2"
            aria-label={labels.chooseFiles}
            title={labels.chooseFiles}
            disabled={disabled}
            onClick={() => compactInputRef.current?.click()}
          >
            <PaperclipIcon data-icon="inline-start" />
          </Button>
        </>
      ) : (
        <label className="w-fit">
          <input
            type="file"
            multiple
            accept={accept}
            className="sr-only"
            data-slot="file-upload-input"
            disabled={disabled}
            onChange={(event) => {
              selectFiles(event.currentTarget.files);
              event.currentTarget.value = '';
            }}
          />
          <span className="border-border bg-background hover:bg-muted focus-within:ring-ring inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm font-medium focus-within:ring-2">
            <UploadIcon aria-hidden="true" className="size-4" />
            <span>{labels.chooseFiles}</span>
          </span>
        </label>
      )}

      {selectionError ? (
        <p className={cn('text-destructive text-sm', compactTrigger && 'basis-full')} role="alert">
          {selectionError}
        </p>
      ) : null}

      {tasks.length ? (
        <ul
          aria-label={labels.selectedFiles}
          className={cn('flex flex-col gap-2', compactTrigger && 'basis-full')}
        >
          {tasks.map((task) => (
            <li
              key={task.id}
              className="bg-surface-1 flex min-w-0 items-center gap-3 rounded-lg border p-3"
            >
              <FileVisual file={task.file} previewUrl={task.previewUrl} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" title={task.file.name}>
                  {task.file.name}
                </p>
                <p className="text-muted-foreground text-xs">
                  {task.file.type || labels.unknownType} · {formatBytes(task.file.size)}
                </p>
                {task.status === 'optimizing' || task.status === 'uploading' ? (
                  <Progress
                    value={null}
                    className="mt-2 gap-1.5"
                    aria-label={
                      task.status === 'optimizing'
                        ? (labels.optimizing ?? labels.uploading)
                        : labels.uploading
                    }
                  >
                    <ProgressLabel className="text-muted-foreground text-xs font-normal">
                      {task.status === 'optimizing'
                        ? (labels.optimizing ?? labels.uploading)
                        : labels.uploading}
                    </ProgressLabel>
                  </Progress>
                ) : null}
                {task.status === 'succeeded' ? (
                  <p className="text-muted-foreground mt-1 text-xs" role="status">
                    {labels.succeeded}
                  </p>
                ) : null}
                {task.status === 'failed' ? (
                  <p className="text-destructive mt-1 text-xs" role="alert">
                    {task.error}
                  </p>
                ) : null}
              </div>
              {task.status === 'failed' ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label={`${task.file.name} ${labels.retry}`}
                  title={labels.retry}
                  disabled={disabled}
                  onClick={() => retryTask(task)}
                >
                  <RotateCwIcon data-icon="inline-start" />
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`${task.file.name} ${labels.remove}`}
                title={labels.remove}
                disabled={disabled}
                onClick={() => removeTask(task)}
              >
                <Trash2Icon data-icon="inline-start" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
