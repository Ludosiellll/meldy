/**
 * Pictures of test questions (owner, 2026-10-14: «а если вопрос является картинкой, что делать?»). The importer returns
 * a DOCX's pictures as base64 under their sha256 (BankParseResult.pictures); the import page puts each into the private
 * bucket test-item-images at «<container id>/<sha256>.<ext>» before it saves the items, and the study pages read them
 * back through the owner's or a member's session (storage policies of 20261014120000_test_item_images.sql).
 */
import { supabase } from '../lib/supabase';
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

const shown = new Map<string, Promise<string>>();

/**
 * An object URL of a saved picture, read once per page load (a question comes back many times in a session). A failed
 * read is forgotten, so the next showing tries again.
 */
export function pictureUrl(path: string): Promise<string> {
  let url = shown.get(path);
  if (!url) {
    url = supabase.storage
      .from(PICTURE_BUCKET)
      .download(path)
      .then(({ data, error }) => {
        if (error || !data) throw error ?? new Error('no picture');
        return URL.createObjectURL(data);
      });
    url.catch(() => shown.delete(path));
    shown.set(path, url);
  }
  return url;
}

// ── a picture the author adds by hand (the question editor: a file or Ctrl+V) ──

export const MAX_PICTURE_BYTES = 3 * 1024 * 1024; // the bucket's limit
export const MAX_PICTURE_SIDE = 2000;
const TAKEN = new Set(Object.keys(EXTENSIONS));

export interface PictureDeps {
  /** The picture's size in pixels; null when the browser cannot say (it is then kept as it is, if small enough). */
  measure?: (blob: Blob) => Promise<{ width: number; height: number } | null>;
  /** The picture redrawn no larger than `side` px on its longer side, as JPEG. */
  shrink?: (blob: Blob, side: number) => Promise<Blob>;
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

async function measureInBrowser(blob: Blob): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return size;
  } catch {
    return null;
  }
}

async function shrinkInBrowser(blob: Blob, side: number): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no canvas');
  // White under a transparent picture: JPEG has no transparency, and the pages show pictures on white anyway.
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve, reject) => canvas.toBlob((out) => (out ? resolve(out) : reject(new Error('no picture'))), 'image/jpeg', 0.85));
}

/**
 * A picture from a file or the clipboard, ready for uploadPicture: its id (sha256 of the bytes, so the same picture is
 * one object) and its bytes. A picture over 3 MB, or wider or taller than 2000 px (not a GIF, which would lose its
 * motion), is redrawn as JPEG first; 'type' — not a picture the bucket takes; 'size' — still over 3 MB.
 */
export async function pictureFromFile(file: Blob, deps: PictureDeps = {}): Promise<{ id: string; picture: BankPicture } | 'type' | 'size'> {
  if (!TAKEN.has(file.type)) return 'type';
  const measure = deps.measure ?? measureInBrowser;
  const shrink = deps.shrink ?? shrinkInBrowser;
  let blob: Blob = file;
  let big = blob.size > MAX_PICTURE_BYTES;
  if (!big && file.type !== 'image/gif') {
    const size = await measure(blob);
    big = Boolean(size && Math.max(size.width, size.height) > MAX_PICTURE_SIDE);
  }
  if (big) {
    try {
      blob = await shrink(blob, MAX_PICTURE_SIDE);
    } catch {
      return 'size';
    }
  }
  if (blob.size > MAX_PICTURE_BYTES || !TAKEN.has(blob.type)) return 'size';
  const bytes = await bytesOf(blob);
  return { id: await sha256Of(bytes), picture: { type: blob.type, data: base64Of(bytes) } };
}
