import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IssueDetailResponseDto } from '@rivet/api-client';

import { IssueAttachments } from './issue-attachments';

const mocks = vi.hoisted(() => ({
  createAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
  deleteFile: vi.fn(),
  downloadFile: vi.fn(),
  items: [] as Array<ReturnType<typeof attachment>>,
  queueProps: null as null | {
    removeFile: (fileId: string) => Promise<void>;
    sendFile: (file: File, scope: 'USER_PROFILE' | 'WORKSPACE') => Promise<{ id: string }>;
  },
  uploadFile: vi.fn(),
}));

vi.mock('@rivet/api-client', () => ({
  ApiError: class ApiError extends Error {},
  filesControllerDelete: mocks.deleteFile,
  filesControllerDownload: mocks.downloadFile,
  filesControllerUpload: mocks.uploadFile,
  getFilesControllerContentUrl: (fileId: string) => `/api/v1/files/${fileId}/content`,
  getIssueAttachmentsControllerListQueryKey: (issueId: string) => [
    `/api/v1/issues/${issueId}/attachments`,
  ],
  getIssuesControllerGetQueryKey: (issueRef: string) => [`/api/v1/issues/${issueRef}`],
  issueAttachmentsControllerCreate: mocks.createAttachment,
  issueAttachmentsControllerDelete: mocks.deleteAttachment,
  useIssueAttachmentsControllerDelete: () => ({
    isError: false,
    isPending: false,
    mutate: vi.fn(),
  }),
  useIssueAttachmentsControllerList: () => ({
    data: { items: mocks.items, nextCursor: null },
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

vi.mock('@/features/files/file-upload-queue', () => ({
  FileUploadQueue: (props: typeof mocks.queueProps) => {
    mocks.queueProps = props;
    return <div data-testid="file-upload-queue" />;
  },
}));

const issue = {
  assignee: null,
  attachments: [],
  blocked: false,
  blockers: [],
  blocking: [],
  createdAt: '2026-07-01T00:00:00.000Z',
  createdBy: {
    id: 'membership-creator',
    role: 'MEMBER',
    status: 'ACTIVE',
    user: { avatarFileId: null, displayName: '작성자', id: 'user-creator' },
  },
  descriptionMarkdown: null,
  handoffSummary: null,
  id: '7c8fc5da-cccb-4478-b9b0-78ec539e9271',
  identifier: 'API-1',
  labels: [],
  parentIssue: null,
  priority: 'NONE',
  progress: null,
  project: null,
  projectRole: null,
  status: {
    category: 'UNSTARTED',
    featureStatus: null,
    workflowState: {
      category: 'UNSTARTED',
      id: '93331a10-3dc7-44cd-820c-33b74c63dc2f',
      isDefault: true,
      name: '할 일',
      position: 0,
      version: 1,
    },
  },
  team: { archived: false, id: 'team-id', key: 'API', name: 'API 팀' },
  title: '첫 이슈',
  type: 'TEAM_TASK',
  updatedAt: '2026-07-01T00:00:00.000Z',
  version: 1,
} satisfies IssueDetailResponseDto;

let queryClient: QueryClient;

function Wrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function uploaded(id: string) {
  return {
    createdAt: '2026-07-01T00:00:00.000Z',
    detectedMimeType: 'text/plain',
    id,
    inlineDisplayable: false,
    linked: false,
    originalName: `${id}.txt`,
    scope: 'WORKSPACE',
    sizeBytes: 4,
  };
}

function attachment(id: string, fileId: string) {
  return {
    createdAt: '2026-07-01T00:00:00.000Z',
    file: uploaded(fileId),
    id,
    kind: 'ISSUE_ATTACHMENT',
    uploader: { avatarFileId: null, displayName: '업로더', id: 'user-id' },
  };
}

describe('IssueAttachments', () => {
  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mocks.items = [];
    mocks.queueProps = null;
    mocks.deleteFile.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('일부 연결 실패를 성공 첨부와 분리하고 재시도할 수 있다', async () => {
    mocks.uploadFile
      .mockResolvedValueOnce(uploaded('file-1'))
      .mockResolvedValueOnce(uploaded('file-2'))
      .mockResolvedValueOnce(uploaded('file-3'));
    mocks.createAttachment
      .mockResolvedValueOnce(attachment('attachment-1', 'file-1'))
      .mockRejectedValueOnce(new Error('attach failed'))
      .mockResolvedValueOnce(attachment('attachment-3', 'file-3'));
    vi.spyOn(queryClient, 'invalidateQueries').mockRejectedValue(new Error('refetch failed'));
    render(<IssueAttachments issue={issue} />, { wrapper: Wrapper });

    const queue = mocks.queueProps;
    expect(queue).not.toBeNull();
    await expect(
      queue?.sendFile(new File(['one'], 'one.txt', { type: 'text/plain' }), 'WORKSPACE'),
    ).resolves.toMatchObject({ id: 'file-1' });
    await expect(
      queue?.sendFile(new File(['two'], 'two.txt', { type: 'text/plain' }), 'WORKSPACE'),
    ).rejects.toThrow('attach failed');
    await expect(
      queue?.sendFile(new File(['two'], 'two.txt', { type: 'text/plain' }), 'WORKSPACE'),
    ).resolves.toMatchObject({ id: 'file-3' });

    expect(mocks.deleteFile).toHaveBeenCalledWith('file-2');
    expect(mocks.createAttachment).toHaveBeenCalledTimes(3);
    await act(async () => undefined);
    expect(
      queryClient.getQueryData<{ items: Array<{ id: string }> }>([
        `/api/v1/issues/${issue.id}/attachments`,
      ])?.items,
    ).toEqual([
      expect.objectContaining({ id: 'attachment-1' }),
      expect.objectContaining({ id: 'attachment-3' }),
    ]);
  });

  it('첨부파일 다운로드 버튼을 누르면 받은 Blob을 원본 파일명으로 저장한다', async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => 'blob:rivet-attachment');
    const revokeObjectURL = vi.fn();
    let downloadedFilename = '';
    let downloadedUrl = '';
    mocks.items = [attachment('attachment-download', 'file-download')];
    mocks.downloadFile.mockResolvedValue(new Blob(['download']));
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadedFilename = this.download;
      downloadedUrl = this.href;
    });
    render(<IssueAttachments issue={issue} />, { wrapper: Wrapper });

    await user.click(
      screen.getByRole('button', { name: 'file-download.txt attachments.download' }),
    );

    await waitFor(() => expect(mocks.downloadFile).toHaveBeenCalledWith('file-download'));
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(downloadedFilename).toBe('file-download.txt');
    expect(downloadedUrl).toBe('blob:rivet-attachment');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:rivet-attachment');
  });
});
