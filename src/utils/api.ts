export function withBookId(url: string, bookId?: string): string {
  if (!bookId) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}bookId=${encodeURIComponent(bookId)}`;
}

export async function parseJsonResponse<T>(
  response: Response,
  fallbackError: string
): Promise<T> {
  const rawText = await response.text();
  let parsed: unknown = null;

  if (rawText.trim()) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    if (
      parsed &&
      typeof parsed === 'object' &&
      'error' in parsed &&
      typeof (parsed as { error?: unknown }).error === 'string'
    ) {
      throw new Error((parsed as { error: string }).error);
    }
    if (response.status === 413) {
      throw new Error(
        'The uploaded recording or image is too large for a single request. Please try a shorter clip or smaller file.'
      );
    }
    if (response.status >= 502 && response.status <= 504) {
      throw new Error(
        'The studio server is busy or timed out while processing. Please try again in a moment.'
      );
    }
    throw new Error(`${fallbackError} (HTTP ${response.status})`);
  }

  if (parsed === null) {
    throw new Error(
      'Received an unexpected non-JSON response from the server. Please refresh and try again.'
    );
  }

  return parsed as T;
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Could not read audio or image data.'));
      }
    };
    reader.onerror = () => reject(new Error('Failed while reading selected file.'));
    reader.readAsDataURL(blob);
  });
}

export async function ensureImageDataUrl(
  src: string,
  fallbackMime = 'image/jpeg'
): Promise<{ dataUrl: string; mimeType: string }> {
  if (!src) {
    throw new Error('No photograph selected.');
  }
  if (src.startsWith('data:')) {
    const match = src.match(/^data:([^;]+);base64,/);
    return { dataUrl: src, mimeType: match?.[1] || fallbackMime };
  }
  const resp = await fetch(src);
  if (!resp.ok) {
    throw new Error('Could not load the selected photograph for analysis.');
  }
  const blob = await resp.blob();
  const dataUrl = await blobToBase64(blob);
  return { dataUrl, mimeType: blob.type || fallbackMime };
}

export function compressImageFile(
  file: File,
  maxDimension = 1600
): Promise<{ dataUrl: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected image file.'));
    reader.onload = () => {
      const originalDataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!originalDataUrl) {
        reject(new Error('Empty image data.'));
        return;
      }

      const img = new Image();
      img.onerror = () => {
        resolve({ dataUrl: originalDataUrl, mimeType: file.type || 'image/jpeg' });
      };
      img.onload = () => {
        const { naturalWidth, naturalHeight } = img;
        if (!naturalWidth || !naturalHeight) {
          resolve({ dataUrl: originalDataUrl, mimeType: file.type || 'image/jpeg' });
          return;
        }
        const scale = Math.min(1, maxDimension / Math.max(naturalWidth, naturalHeight));
        const targetW = Math.round(naturalWidth * scale);
        const targetH = Math.round(naturalHeight * scale);

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({ dataUrl: originalDataUrl, mimeType: file.type || 'image/jpeg' });
          return;
        }
        ctx.drawImage(img, 0, 0, targetW, targetH);
        const compressedUrl = canvas.toDataURL('image/jpeg', 0.86);
        resolve({ dataUrl: compressedUrl, mimeType: 'image/jpeg' });
      };
      img.src = originalDataUrl;
    };
    reader.readAsDataURL(file);
  });
}

export function pickAudioRecorderMime(): string {
  const supportsType = (mime: string) =>
    typeof MediaRecorder !== 'undefined' &&
    typeof MediaRecorder.isTypeSupported === 'function' &&
    MediaRecorder.isTypeSupported(mime);

  if (supportsType('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  if (supportsType('audio/webm')) return 'audio/webm';
  if (supportsType('audio/mp4')) return 'audio/mp4';
  return '';
}

export function pickVideoRecorderMime(): string {
  const supportsType = (mime: string) =>
    typeof MediaRecorder !== 'undefined' &&
    typeof MediaRecorder.isTypeSupported === 'function' &&
    MediaRecorder.isTypeSupported(mime);

  if (supportsType('video/webm;codecs=vp9,opus')) return 'video/webm;codecs=vp9,opus';
  if (supportsType('video/webm;codecs=vp8,opus')) return 'video/webm;codecs=vp8,opus';
  if (supportsType('video/webm')) return 'video/webm';
  if (supportsType('video/mp4')) return 'video/mp4';
  return '';
}
