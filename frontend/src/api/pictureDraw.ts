/**
 * A picture the author adds, made ready to upload: decoded, turned upright, measured, redrawn smaller when it must be,
 * named by the sha256 of its bytes. No network and no page here: the same code runs in the picture worker
 * (pictureWorker.ts: its own thread, an OffscreenCanvas) and, where a browser has no such worker, on the page
 * (itemPictures.ts preparePicture). The smoothness audit of 20.10: a phone's 12 MP photo was decoded, redrawn, encoded
 * twice and turned into base64 on the page's own thread, a long freeze of the studio.
 */

/** The types the buckets take, with their extensions (test-item-images also BMP; quiz-covers not). */
export const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
};

export const MAX_PICTURE_BYTES = 3 * 1024 * 1024; // the buckets' limit
/** A picture is redrawn no larger than this on its longer side (a phone's 4000 × 3000 photo becomes 2400 × 1800). */
export const MAX_PICTURE_SIDE = 2400;
/** JPEG and WebP quality of a redrawn picture. */
export const PICTURE_QUALITY = 0.85;
/** The types the buckets take (test-item-images also BMP; quiz-covers not — the studio and the cover refuse a BMP path). */
const TAKEN = new Set(Object.keys(EXTENSIONS));
/** Kept as they are when they fit: the four every bucket takes. */
const KEEPABLE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
/** Smaller and smaller sides to try while a redrawn picture is still over 3 MB. */
const SIDES = [MAX_PICTURE_SIDE, 1800, 1280];

/**
 * Why a file did not become a picture: 'type' — not a picture (or one the browser cannot draw); 'size' — over 3 MB even
 * redrawn smaller; 'heic' — an iPhone's HEIC / HEIF photo the browser cannot draw (most browsers on a computer).
 */
export type PictureRefusal = 'type' | 'size' | 'heic';
/** 'shrink' — the picture is being redrawn smaller (a phone's photo takes a moment). */
export type PictureStage = 'shrink';
/** A picture ready to upload: its id (sha256 of the bytes, so the same picture is one object) and its bytes. */
export interface PreparedPicture {
  id: string;
  blob: Blob;
}

/** HEIC / HEIF: by its type, or by its name when the system gave it no type (Windows, an older Android). */
export function isHeic(file: Blob): boolean {
  if (/^image\/hei[cf](-sequence)?$/i.test(file.type)) return true;
  const name = typeof (file as File).name === 'string' ? (file as File).name : '';
  return (!file.type || file.type === 'application/octet-stream') && /\.hei[cf]$/i.test(name);
}

/** A file worth trying: a picture of any type but SVG (a page of code, not pixels), or a HEIC by its name. */
export function isPictureFile(file: Blob): boolean {
  return isHeic(file) || (file.type.startsWith('image/') && !/svg/i.test(file.type));
}

export async function bytesOf(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

async function sha256Of(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The picture as the browser draws it, turned upright by its EXIF orientation (a phone's photo taken sideways), or null
 * when the browser cannot draw it (HEIC on most computers, a broken file, no createImageBitmap). A browser that does not
 * know the option is asked again without it (it then turns the photo by itself, or not at all).
 */
async function decodePicture(blob: Blob): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    try {
      return await createImageBitmap(blob);
    } catch {
      return null;
    }
  }
}

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type AnyContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A canvas of the page's, or — in the worker, which has no page — an OffscreenCanvas. */
function canvasOf(width: number, height: number): { canvas: AnyCanvas; context: AnyContext } | null {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (typeof document === 'undefined') {
    if (typeof OffscreenCanvas !== 'function') return null;
    const canvas = new OffscreenCanvas(w, h);
    const context = canvas.getContext('2d');
    return context ? { canvas, context } : null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext('2d');
  return context ? { canvas, context } : null;
}

/** Some pixel is not fully opaque (looked at on a copy at most 256 px across: cheap, and a transparent edge stays). */
function transparent(bitmap: ImageBitmap): boolean {
  const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
  const probe = canvasOf(bitmap.width * scale, bitmap.height * scale);
  if (!probe) return false;
  try {
    probe.context.drawImage(bitmap, 0, 0, probe.canvas.width, probe.canvas.height);
    const { data } = probe.context.getImageData(0, 0, probe.canvas.width, probe.canvas.height);
    for (let at = 3; at < data.length; at += 4) if (data[at] < 255) return true;
    return false;
  } catch {
    return false;
  }
}

/** The canvas as `type`; null when the browser writes another type instead (Safari gives PNG for WebP) or fails. */
function encode(canvas: AnyCanvas, type: string, quality?: number): Promise<Blob | null> {
  if (typeof OffscreenCanvas === 'function' && canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type, quality }).then(
      (blob) => (blob.type === type ? blob : null),
      () => null,
    );
  }
  return new Promise((resolve) => {
    try {
      (canvas as HTMLCanvasElement).toBlob((blob) => resolve(blob && blob.type === type ? blob : null), type, quality);
    } catch {
      resolve(null);
    }
  });
}

/**
 * The picture redrawn no larger than 2400 px on its longer side (then 1800, then 1280 while it is over 3 MB): with
 * transparency as PNG or WebP, whichever is smaller; without it — or when a transparent one does not fit — on white as
 * JPEG 0.85 or WebP 0.85, whichever is smaller. Null: nothing fits.
 */
async function redraw(bitmap: ImageBitmap, alpha: boolean): Promise<Blob | null> {
  const long = Math.max(bitmap.width, bitmap.height);
  for (const side of SIDES) {
    if (side < MAX_PICTURE_SIDE && long <= side) break;
    const scale = Math.min(1, side / long);
    for (const clear of alpha ? [true, false] : [false]) {
      const made = canvasOf(bitmap.width * scale, bitmap.height * scale);
      if (!made) return null;
      const { canvas, context } = made;
      if (!clear) {
        // JPEG has no transparency, and the pages show pictures on white anyway.
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const tries = clear
        ? [encode(canvas, 'image/png'), encode(canvas, 'image/webp', PICTURE_QUALITY)]
        : [encode(canvas, 'image/jpeg', PICTURE_QUALITY), encode(canvas, 'image/webp', PICTURE_QUALITY)];
      const fitting = (await Promise.all(tries)).filter((blob): blob is Blob => blob !== null && blob.size <= MAX_PICTURE_BYTES);
      if (fitting.length > 0) return fitting.reduce((best, blob) => (blob.size < best.size ? blob : best));
    }
  }
  return null;
}

async function named(blob: Blob): Promise<PreparedPicture> {
  return { id: await sha256Of(await bytesOf(blob)), blob };
}

/**
 * A picture from a file, a drop or the clipboard, ready to upload (itemPictures.ts preparePicture / pictureFromFile say
 * which pictures are kept as they are and which are redrawn). `onStage` hears 'shrink' before a redraw starts.
 */
export async function preparePictureHere(file: Blob, onStage?: (stage: PictureStage) => void): Promise<PreparedPicture | PictureRefusal> {
  if (!isPictureFile(file)) return 'type';
  const fits = file.size <= MAX_PICTURE_BYTES;
  if (file.type === 'image/gif' && fits) return named(file);
  const bitmap = await decodePicture(file);
  if (!bitmap) {
    if (TAKEN.has(file.type) && fits) return named(file);
    if (isHeic(file)) return 'heic';
    return TAKEN.has(file.type) ? 'size' : 'type';
  }
  try {
    const long = Math.max(bitmap.width, bitmap.height);
    const alpha = file.type !== 'image/jpeg' && transparent(bitmap);
    if (KEEPABLE.has(file.type) && fits && (long <= MAX_PICTURE_SIDE || alpha)) return named(file);
    onStage?.('shrink');
    const out = await redraw(bitmap, alpha);
    return out ? named(out) : 'size';
  } finally {
    bitmap.close?.();
  }
}
