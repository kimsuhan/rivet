import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileUploadQueue } from './file-upload-queue';
import { optimizeWorkspaceImage } from './image-optimizer';

vi.mock('./image-optimizer', () => ({
  optimizeWorkspaceImage: vi.fn(async (file: File) => file),
}));

const labels = {
  chooseFiles: '파일 선택',
  emptyFile: '빈 파일',
  failed: '업로드 실패',
  fileLimit: '25MB 제한',
  remove: '제거',
  retry: '다시 시도',
  selectedFiles: '선택한 파일',
  succeeded: '업로드 완료',
  unknownType: '알 수 없는 형식',
  uploading: '업로드 중',
};

function uploaded(id: string, file: File) {
  return {
    createdAt: new Date(0).toISOString(),
    detectedMimeType: file.type,
    id,
    inlineDisplayable: false,
    linked: false,
    originalName: file.name,
    scope: 'WORKSPACE' as const,
    sizeBytes: file.size,
  };
}

describe('FileUploadQueue', () => {
  afterEach(cleanup);

  it('compact 모드는 기본 상태에서 아이콘 트리거만 보이고 파일 선택 뒤 큐를 펼친다', async () => {
    const user = userEvent.setup();
    const sendFile = vi.fn(async (file: File) => uploaded('compact-file', file));
    const { container } = render(
      <FileUploadQueue
        compactTrigger
        labels={labels}
        onFileIdsChange={() => undefined}
        sendFile={sendFile}
      />,
    );

    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (!input) return;
    const root = input.closest('div');
    expect(screen.getByRole('button', { name: labels.chooseFiles })).toBeVisible();
    expect(root).toHaveClass('w-fit');
    expect(screen.queryByRole('list', { name: labels.selectedFiles })).not.toBeInTheDocument();

    await user.upload(input, new File(['attached'], 'attached.txt', { type: 'text/plain' }));

    expect(await screen.findByRole('list', { name: labels.selectedFiles })).toBeVisible();
    expect(root).toHaveClass('w-full');
    await waitFor(() => expect(sendFile).toHaveBeenCalledTimes(1));
  });

  it('일부 실패가 성공 ID를 잃지 않으며 재시도와 제거 상태를 독립 처리한다', async () => {
    const user = userEvent.setup();
    const onFileIdsChange = vi.fn();
    const onReadyChange = vi.fn();
    const removeFile = vi.fn(async () => undefined);
    let secondAttempts = 0;
    const sendFile = vi.fn(async (file: File) => {
      if (file.name === 'second.txt' && secondAttempts++ === 0) throw new Error('failed');
      return uploaded(file.name === 'first.txt' ? 'file-1' : 'file-2', file);
    });

    render(
      <FileUploadQueue
        labels={labels}
        onFileIdsChange={onFileIdsChange}
        onReadyChange={onReadyChange}
        removeFile={removeFile}
        sendFile={sendFile}
      />,
    );

    const first = new File(['first'], 'first.txt', { type: 'text/plain' });
    const second = new File(['second'], 'second.txt', { type: 'text/plain' });
    await user.upload(screen.getByLabelText(labels.chooseFiles), [first, second]);

    await waitFor(() => {
      expect(screen.getByText(labels.failed)).toBeVisible();
      expect(onFileIdsChange).toHaveBeenLastCalledWith(['file-1']);
      expect(onReadyChange).toHaveBeenLastCalledWith(false);
    });

    await user.click(screen.getByRole('button', { name: `second.txt ${labels.retry}` }));
    await waitFor(() => {
      expect(onFileIdsChange).toHaveBeenLastCalledWith(['file-1', 'file-2']);
      expect(onReadyChange).toHaveBeenLastCalledWith(true);
    });

    await user.click(screen.getByRole('button', { name: `first.txt ${labels.remove}` }));
    expect(removeFile).toHaveBeenCalledWith('file-1');
    expect(onFileIdsChange).toHaveBeenLastCalledWith(['file-2']);
  });

  it('25MB 초과 파일은 행이나 요청을 만들지 않고 입력 가까이 거부한다', async () => {
    const user = userEvent.setup();
    const sendFile = vi.fn();
    const tooLarge = new File(['x'], 'too-large.bin');
    Object.defineProperty(tooLarge, 'size', { value: 25 * 1024 * 1024 + 1 });

    render(
      <FileUploadQueue labels={labels} onFileIdsChange={() => undefined} sendFile={sendFile} />,
    );
    await user.upload(screen.getByLabelText(labels.chooseFiles), tooLarge);

    expect(screen.getByRole('alert')).toHaveTextContent(labels.fileLimit);
    expect(screen.queryByRole('list', { name: labels.selectedFiles })).not.toBeInTheDocument();
    expect(sendFile).not.toHaveBeenCalled();
  });

  it('JPEG·PNG·WebP 일반 첨부도 클라이언트 최적화 결과를 업로드한다', async () => {
    const browser = userEvent.setup();
    const optimized = new File(['small'], 'screen.webp', { type: 'image/webp' });
    vi.mocked(optimizeWorkspaceImage).mockResolvedValueOnce(optimized);
    const sendFile = vi.fn(async (file: File) => uploaded('image-file', file));

    render(
      <FileUploadQueue
        labels={{ ...labels, optimizing: '이미지 최적화 중' }}
        onFileIdsChange={() => undefined}
        sendFile={sendFile}
      />,
    );
    const original = new File(['large'], 'screen.png', { type: 'image/png' });
    await browser.upload(screen.getByLabelText(labels.chooseFiles), original);

    await waitFor(() => expect(sendFile).toHaveBeenCalledWith(optimized, 'WORKSPACE'));
    expect(optimizeWorkspaceImage).toHaveBeenCalledWith(original);
  });
});
