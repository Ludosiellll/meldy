/**
 * Pictures of test questions (owner, 2026-10-14: «а если вопрос является картинкой, что делать?»). The importer returns
 * a DOCX's pictures as base64 under their sha256 (BankParseResult.pictures); the import page puts each into the private
 * bucket test-item-images at «<container id>/<sha256>.<ext>» before it saves the items, and the study pages read them
 * back through the owner's or a member's session (storage policies of 20261014120000_test_item_images.sql).
 */
import { supabase } from '../lib/supabase';
import type { BankPicture } from '../types/container';

export const PICTURE_BUCKET = 'test-item-images';

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
export async function uploadPicture(path: string, picture: BankPicture): Promise<'kept' | 'refused'> {
  const { error } = await supabase.storage
    .from(PICTURE_BUCKET)
    .upload(path, pictureBlob(picture), { contentType: picture.type, upsert: false, cacheControl: '31536000' });
  if (!error) return 'kept';
  const failure = error as StorageFailure;
  if (alreadyThere(failure)) return 'kept';
  if (typeof failure.status === 'number' && failure.status >= 400 && failure.status < 500 && failure.status !== 408 && failure.status !== 429) {
    return 'refused';
  }
  throw error;
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
