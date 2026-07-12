import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fitWithin, optimizeProfileImage, optimizeWorkspaceImage } from './image-optimizer';

describe('image optimizer', () => {
  const close = vi.fn();
  const drawImage = vi.fn();
  const clearRect = vi.fn();
  let encodedSize = 128 * 1024;

  beforeEach(() => {
    encodedSize = 128 * 1024;
    close.mockClear();
    drawImage.mockClear();
    clearRect.mockClear();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ close, height: 2000, width: 4000 })),
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect,
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type) => {
      callback(new Blob([new Uint8Array(encodedSize)], { type: type ?? 'image/jpeg' }));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('긴 변을 2560px 이하로 줄이고 EXIF orientation 적용 디코딩을 요청한다', async () => {
    const file = new File([new Uint8Array(3 * 1024 * 1024)], 'photo.jpg', {
      type: 'image/jpeg',
    });
    const optimized = await optimizeWorkspaceImage(file);

    expect(fitWithin(4000, 2000, 2560)).toEqual({ height: 1280, width: 2560 });
    expect(createImageBitmap).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' });
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2560, 1280);
    expect(optimized.size).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(close).toHaveBeenCalledOnce();
  });

  it('움직이는 GIF는 2MB 이하면 원본을 유지하고 초과하면 명확히 실패한다', async () => {
    const small = new File([new Uint8Array(10)], 'small.gif', { type: 'image/gif' });
    await expect(optimizeWorkspaceImage(small)).resolves.toBe(small);

    const large = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.gif', {
      type: 'image/gif',
    });
    await expect(optimizeWorkspaceImage(large)).rejects.toMatchObject({ code: 'GIF_TOO_LARGE' });
  });

  it('프로필 이미지를 가운데 정사각형으로 잘라 512px WebP로 만든다', async () => {
    vi.mocked(createImageBitmap).mockResolvedValueOnce({
      close,
      height: 800,
      width: 1200,
    } as unknown as ImageBitmap);
    const file = new File([new Uint8Array(10)], 'avatar.png', { type: 'image/png' });
    const optimized = await optimizeProfileImage(file);

    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 200, 0, 800, 800, 0, 0, 512, 512);
    expect(optimized.type).toBe('image/webp');
    expect(optimized.name).toBe('avatar.webp');
  });
});
