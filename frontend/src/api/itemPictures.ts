/**
 * Pictures of test questions (owner, 2026-10-14: «а если вопрос является картинкой, что делать?»). The importer returns
 * a DOCX's pictures as base64 under their sha256 (BankParseResult.pictures); the import page puts each into the private
 * bucket test-item-images at «<container id>/<sha256>.<ext>» before it saves the items, and the study pages read them
 * back through the owner's or a member's session (storage policies of 20261014120000_test_item_images.sql). A quiz
 * taker without an account (release 47) reads the pictures of their attempt through the `quiz-media` function instead
 * (guestPictureUrl).
 */
import { supabase, supabaseAnonKey, supabaseFetch, supabaseUrl } from '../lib/supabase';
import type { BankPicture } from '../types/container';

export const PICTURE_BUCKET = 'test-item-images';
/** Quiz covers (release 47): a public bucket, the author writes into their exam's folder. */
export const COVER_BUCKET = 'quiz-covers';

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
};
const ID_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The storage path of a picture in a container's folder, or null for a type the bucket does not take. */
export function picturePath(containerId: string, id: string, type: string): string | null {
  const extension = EXTENSIONS[type];
  return extension && ID_RE.test(id) && UUID_RE.test(containerId) ? `${containerId}/${id}.${extension}` : null;
}

/** A picture as the browser shows it before saving (the import preview). */
export function pictureDataUrl(picture: BankPicture): string {
  return `data:${picture.type};base64,${picture.data}`;
}

function pictureBlob(picture: BankPicture): Blob {
  const text = atob(picture.data);
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
  return new Blob([bytes], { type: picture.type });
}

interface StorageFailure {
  status?: number;
  statusCode?: string;
  message?: string;
}

/** The name is the picture's hash: an object already there is this very picture (a resumed save, a second file). */
function alreadyThere(error: StorageFailure): boolean {
  return error.status === 409 || error.statusCode === '409' || /already exists|duplicate/i.test(error.message ?? '');
}

/**
 * Puts one picture at `path`. 'kept' — it is there now; 'refused' — storage turned this picture down (type, size,
 * rights): the question is saved without it. A network or server failure throws, so the save stops and goes on later.
 */
export async function uploadPicture(path: string, picture: BankPicture, bucket: string = PICTURE_BUCKET): Promise<'kept' | 'refused'> {
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, pictureBlob(picture), { contentType: picture.type, upsert: false, cacheControl: '31536000' });
  if (!error) return 'kept';
  const failure = error as StorageFailure;
  if (alreadyThere(failure)) return 'kept';
  if (typeof failure.status === 'number' && failure.status >= 400 && failure.status < 500 && failure.status !== 408 && failure.status !== 429) {
    return 'refused';
  }
  throw error;
}

/** The address anyone can open of a saved cover (the bucket is public). */
export function coverUrl(path: string): string {
  return supabase.storage.from(COVER_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Object URLs by storage path: a path names one picture (its sha256), however it was read. */
const shown = new Map<string, Promise<string>>();

/** The path's object URL, read by `read` once per page load; a failed read is forgotten, so the next showing tries again. */
function cached(path: string, read: () => Promise<Blob>): Promise<string> {
  let url = shown.get(path);
  if (!url) {
    url = read().then((blob) => URL.createObjectURL(blob));
    url.catch(() => shown.delete(path));
    shown.set(path, url);
  }
  return url;
}

/**
 * An object URL of a saved picture, read once per page load (a question comes back many times in a session). A failed
 * read is forgotten, so the next showing tries again.
 */
export function pictureUrl(path: string): Promise<string> {
  return cached(path, async () => {
    const { data, error } = await supabase.storage.from(PICTURE_BUCKET).download(path);
    if (error || !data) throw error ?? new Error('no picture');
    return data;
  });
}

/** The Edge Function that reads a guest's pictures (supabase/functions/_shared/quizMedia.ts). */
export const GUEST_PICTURE_FUNCTION = 'quiz-media';
/** Its region (lib/telegram/fileTicket.ts FUNCTION_REGION): Frankfurt, near the database. */
export const GUEST_PICTURE_REGION = 'eu-central-1';

/**
 * A picture of a quiz attempt written without an account (release 47): a guest has no session, and the bucket has no
 * policy for anon, so the `quiz-media` function reads it with the service key after the database checked that the
 * device's token is the attempt's and the picture is one of its questions. The call goes through the client's fetch
 * (lib/supabase supabaseFetch: direct or the site's /sb/, as lib/supabaseRoute chose) with the public anon key as
 * supabase-js sends it. Cached by path as pictureUrl; a failed read is forgotten.
 */
export function guestPictureUrl(path: string, attemptId: string, token: string): Promise<string> {
  return cached(path, async () => {
    const base = supabaseUrl.replace(/\/+$/, '');
    const response = await supabaseFetch(`${base}/functions/v1/${GUEST_PICTURE_FUNCTION}?forceFunctionRegion=${GUEST_PICTURE_REGION}`, {
      method: 'POST',
      headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ attempt_id: attemptId, token, path }),
    });
    if (!response.ok) throw new Error(`picture ${response.status}`);
    const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!type.startsWith('image/')) throw new Error('not a picture');
    return response.blob();
  });
}

// ── a picture the author adds by hand (the question editor, the quiz cover, the studio: a file, a drop or Ctrl+V) ──

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

export interface PictureDeps {
  /** Told when the picture has to be redrawn, before the work starts. */
  onStage?: (stage: PictureStage) => void;
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

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

function base64Of(bytes: Uint8Array): string {
  let text = '';
  for (let start = 0; start < bytes.length; start += 0x8000) text += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return btoa(text);
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

function canvasOf(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } | null {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
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
function encode(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob && blob.type === type ? blob : null), type, quality);
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

async function made(blob: Blob): Promise<{ id: string; picture: BankPicture }> {
  const bytes = await bytesOf(blob);
  return { id: await sha256Of(bytes), picture: { type: blob.type, data: base64Of(bytes) } };
}

/**
 * A picture from a file, a drop or the clipboard, ready for uploadPicture: its id (sha256 of the bytes, so the same
 * picture is one object) and its bytes. The one helper of every picture the author adds: the question editor, the quiz
 * cover and the studio's pictures (cover, picture block, background, result message).
 *
 * - Kept as it is: a GIF up to 3 MB (redrawn, it would lose its motion); a PNG, JPEG or WebP up to 3 MB and 2400 px on
 *   its longer side; a PNG or WebP up to 3 MB with transparency, however large; a picture of the buckets' types up to
 *   3 MB the browser cannot draw (it cannot be measured; the bucket decides).
 * - Redrawn (redraw above, turned upright by its EXIF orientation): a phone's photo of 3–12 MB, a picture over 2400 px,
 *   a BMP, and the types the buckets do not take but the browser can draw (HEIC in Safari, AVIF, TIFF…).
 * - 'heic' — a HEIC the browser cannot draw; 'type' — not a picture, or one the browser cannot draw; 'size' — over 3 MB
 *   even redrawn at 1280 px.
 */
export async function pictureFromFile(file: Blob, deps: PictureDeps = {}): Promise<{ id: string; picture: BankPicture } | PictureRefusal> {
  if (!isPictureFile(file)) return 'type';
  const fits = file.size <= MAX_PICTURE_BYTES;
  if (file.type === 'image/gif' && fits) return made(file);
  const bitmap = await decodePicture(file);
  if (!bitmap) {
    if (TAKEN.has(file.type) && fits) return made(file);
    if (isHeic(file)) return 'heic';
    return TAKEN.has(file.type) ? 'size' : 'type';
  }
  try {
    const long = Math.max(bitmap.width, bitmap.height);
    const alpha = file.type !== 'image/jpeg' && transparent(bitmap);
    if (KEEPABLE.has(file.type) && fits && (long <= MAX_PICTURE_SIDE || alpha)) return made(file);
    deps.onStage?.('shrink');
    const out = await redraw(bitmap, alpha);
    return out ? made(out) : 'size';
  } finally {
    bitmap.close?.();
  }
}
