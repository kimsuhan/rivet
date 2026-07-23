const ALLOWED_IMAGE_TYPES = new Set(['image/gif', 'image/jpeg', 'image/png', 'image/webp']);

export class ImageOptimizationError extends Error {
  constructor(readonly code: 'GIF_TOO_LARGE' | 'INVALID_IMAGE' | 'OUTPUT_TOO_LARGE') {
    super(code);
    this.name = ImageOptimizationError.name;
  }
}

function extensionFor(type: string): string {
  if (type === 'image/jpeg') return 'jpg';
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  return 'gif';
}

function replaceExtension(name: string, type: string): string {
  const baseName = name.replace(/\.[^.]+$/, '') || 'image';
  return `${baseName}.${extensionFor(type)}`;
}

async function decodeImage(file: File): Promise<{
  close: () => void;
  height: number;
  source: CanvasImageSource;
  width: number;
}> {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new ImageOptimizationError('INVALID_IMAGE');
  }

  if (typeof createImageBitmap !== 'function') {
    const sourceUrl = URL.createObjectURL(file);
    return new Promise((resolve, reject) => {
      const image = new window.Image();
      image.onload = () =>
        resolve({
          close: () => URL.revokeObjectURL(sourceUrl),
          height: image.naturalHeight,
          source: image,
          width: image.naturalWidth,
        });
      image.onerror = () => {
        URL.revokeObjectURL(sourceUrl);
        reject(new ImageOptimizationError('INVALID_IMAGE'));
      };
      image.src = sourceUrl;
    });
  }

  try {
    const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return {
      close: () => image.close(),
      height: image.height,
      source: image,
      width: image.width,
    };
  } catch {
    throw new ImageOptimizationError('INVALID_IMAGE');
  }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new ImageOptimizationError('INVALID_IMAGE'));
      },
      type,
      quality,
    );
  });
}

export function fitWithin(
  width: number,
  height: number,
  maxLongEdge: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxLongEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function optimizeWorkspaceImage(file: File): Promise<File> {
  const maxBytes = 2 * 1024 * 1024;
  if (file.type === 'image/gif') {
    if (file.size <= maxBytes) return file;
    throw new ImageOptimizationError('GIF_TOO_LARGE');
  }

  const image = await decodeImage(file);

  try {
    let dimensions = fitWithin(image.width, image.height, 2560);
    if (
      file.size <= maxBytes &&
      dimensions.width === image.width &&
      dimensions.height === image.height
    ) {
      return file;
    }

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new ImageOptimizationError('INVALID_IMAGE');

    const qualities = file.type === 'image/png' ? [1] : [0.9, 0.82, 0.72, 0.62];
    let lastBlob: Blob | null = null;

    for (let resizeAttempt = 0; resizeAttempt < 5; resizeAttempt += 1) {
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image.source, 0, 0, canvas.width, canvas.height);

      for (const quality of qualities) {
        lastBlob = await canvasBlob(canvas, file.type, quality);
        if (lastBlob.size <= maxBytes) {
          return new File([lastBlob], replaceExtension(file.name, lastBlob.type), {
            lastModified: file.lastModified,
            type: lastBlob.type,
          });
        }
      }

      const scale = Math.min(0.85, Math.sqrt(maxBytes / (lastBlob?.size ?? maxBytes)) * 0.9);
      dimensions = {
        width: Math.max(1, Math.round(dimensions.width * scale)),
        height: Math.max(1, Math.round(dimensions.height * scale)),
      };
    }

    throw new ImageOptimizationError('OUTPUT_TOO_LARGE');
  } finally {
    image.close();
  }
}

async function optimizeSquareImage(file: File): Promise<File> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new ImageOptimizationError('INVALID_IMAGE');
  }

  const image = await decodeImage(file);

  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new ImageOptimizationError('INVALID_IMAGE');

    const side = Math.min(image.width, image.height);
    const outputSide = Math.min(512, side);
    canvas.width = outputSide;
    canvas.height = outputSide;
    context.drawImage(
      image.source,
      Math.round((image.width - side) / 2),
      Math.round((image.height - side) / 2),
      side,
      side,
      0,
      0,
      outputSide,
      outputSide,
    );

    const blob = await canvasBlob(canvas, 'image/webp', 0.86);
    if (blob.size > 2 * 1024 * 1024) {
      throw new ImageOptimizationError('OUTPUT_TOO_LARGE');
    }

    return new File([blob], replaceExtension(file.name, 'image/webp'), {
      lastModified: file.lastModified,
      type: 'image/webp',
    });
  } finally {
    image.close();
  }
}

export const optimizeProfileImage = optimizeSquareImage;
export const optimizeProjectLogo = optimizeSquareImage;
