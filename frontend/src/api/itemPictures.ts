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
import { bytesOf, EXTENSIONS, preparePictureHere, type PictureRefusal, type PictureStage, type PreparedPicture } from './pictureDraw';
import type { PictureAnswer, PictureAsk } from './pictureWorker';

export { isHeic, isPictureFile, MAX_PICTURE_BYTES, MAX_PICTURE_SIDE, PICTURE_QUALITY } from './pictureDraw';
export type { PictureRefusal, PictureStage, PreparedPicture } from './pictureDraw';

export const PICTURE_BUCKET = 'test-item-images';
/** Quiz covers (release 47): a public bucket, the author writes into their exam's folder. */
export const COVER_BUCKET = 'quiz-covers';

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
 * Puts one picture (the importer's base64, or a picture's bytes) at `path`. 'kept' — it is there now; 'refused' — storage turned this picture down (type, size,
 * rights): the question is saved without it. A network or server failure throws, so the save stops and goes on later.
 *
 * Quiz covers (the studio's pictures, a quiz's cover) are written over: the name is the hash of the bytes, so the same
 * picture again changes nothing, and the bucket lets the owner update their folder — no «already exists» 400 in the
 * console (live check of 47.4). test-item-images has no update policy: a picture already there still counts as kept.
 */
export async function uploadPicture(path: string, picture: BankPicture | Blob, bucket: string = PICTURE_BUCKET): Promise<'kept' | 'refused'> {
  // The bytes as they are (a picture the author adds: no base64 there and back), or the importer's base64.
  const body = picture instanceof Blob ? picture : pictureBlob(picture);
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, body, { contentType: picture.type, upsert: bucket === COVER_BUCKET, cacheControl: '31536000' });
  if (!error) return 'kept';
  const failure = error as StorageFailure;
  if (alreadyThere(failure)) return 'kept';
  if (typeof failure.status === 'number' && failure.status >= 400 && failure.status < 500 && failure.status !== 408 && failure.status !== 429) {
    return 'refused';
  }
  throw error;
}

/** Objects a page of a folder's listing holds (storage list); the listing goes on while a page is full. */
const LIST_PAGE = 100;
/** A folder of more than this many pages is not the folder of one exam: the listing stops. */
const LIST_PAGES_MAX = 100;

/** Every object in the exam's folder of `bucket` that the caller may read: «<container id>/<name>». */
async function folderPaths(bucket: string, containerId: string): Promise<string[]> {
  const paths: string[] = [];
  for (let page = 0; page < LIST_PAGES_MAX; page += 1) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(containerId, { limit: LIST_PAGE, offset: page * LIST_PAGE, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw error;
    const rows = data ?? [];
    // A sub-folder is listed with no id: the exam's pictures lie in its folder itself.
    for (const row of rows) if (row.id && row.name) paths.push(`${containerId}/${row.name}`);
    if (rows.length < LIST_PAGE) break;
  }
  return paths;
}

/**
 * The pictures of an exam or a test go with it (live check of 47.4: a deleted test's cover and page pictures kept
 * opening from the public bucket quiz-covers): its folder in quiz-covers and in test-item-images, through the author's
 * own session. The storage policies («Quiz covers: owner reads / deletes», «Test item images: read own or joined /
 * owner deletes») know the owner from the container's row, so this runs before the row is deleted. The number of
 * pictures removed; a failure throws (the caller goes on with the delete).
 */
export async function removeContainerPictures(containerId: string): Promise<number> {
  if (!UUID_RE.test(containerId)) return 0;
  let removed = 0;
  for (const bucket of [COVER_BUCKET, PICTURE_BUCKET]) {
    const paths = await folderPaths(bucket, containerId);
    for (let at = 0; at < paths.length; at += LIST_PAGE) {
      const { data, error } = await supabase.storage.from(bucket).remove(paths.slice(at, at + LIST_PAGE));
      if (error) throw error;
      removed += data?.length ?? 0;
    }
  }
  return removed;
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
  return cached(path, () => mediaFunction({ attempt_id: attemptId, token, path }));
}

/**
 * A picture of a live game's question (release 47.31): the same function, asked with the game and the host's or a
 * player's token; it answers once the question was shown (quiz_live_media_paths). Cached by path as the others.
 */
export function livePictureUrl(path: string, gameId: string, token: string): Promise<string> {
  return cached(path, () => mediaFunction({ game_id: gameId, token, path }));
}

async function mediaFunction(body: Record<string, string>): Promise<Blob> {
  const base = supabaseUrl.replace(/\/+$/, '');
  const response = await supabaseFetch(`${base}/functions/v1/${GUEST_PICTURE_FUNCTION}?forceFunctionRegion=${GUEST_PICTURE_REGION}`, {
    method: 'POST',
    headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`picture ${response.status}`);
  const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!type.startsWith('image/')) throw new Error('not a picture');
  return response.blob();
}

// ── a picture the author adds by hand (the question editor, the quiz cover, the studio: a file, a drop or Ctrl+V) ──

export interface PictureDeps {
  /** Told when the picture has to be redrawn, before the work starts. */
  onStage?: (stage: PictureStage) => void;
}

function base64Of(bytes: Uint8Array): string {
  let text = '';
  for (let start = 0; start < bytes.length; start += 0x8000) text += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return btoa(text);
}

/** The picture worker (pictureWorker.ts), made once; null where a browser has none (then the page draws). */
let worker: Worker | null | undefined;
let asks = 0;
const waiting = new Map<number, { onStage?: (stage: PictureStage) => void; settle: (done: PreparedPicture | PictureRefusal | null) => void }>();

function pictureWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    if (typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function') {
      worker = null;
      return worker;
    }
    const made = new Worker(new URL('./pictureWorker.ts', import.meta.url), { type: 'module' });
    made.onmessage = (event: MessageEvent<PictureAnswer>) => {
      const answer = event.data;
      const ask = waiting.get(answer.ask);
      if (!ask) return;
      if ('stage' in answer) ask.onStage?.(answer.stage);
      else {
        waiting.delete(answer.ask);
        ask.settle('done' in answer ? answer.done : null);
      }
    };
    // The worker could not start (or broke): what it was asked is done on the page, and so is all that follows.
    made.onerror = () => {
      worker = null;
      for (const [id, ask] of waiting) {
        waiting.delete(id);
        ask.settle(null);
      }
    };
    worker = made;
  } catch {
    worker = null;
  }
  return worker;
}

/** The worker's answer, or null: it has none (no worker, a failure there). */
function askWorker(file: Blob, onStage?: (stage: PictureStage) => void): Promise<PreparedPicture | PictureRefusal | null> {
  const thread = pictureWorker();
  if (!thread) return Promise.resolve(null);
  return new Promise((settle) => {
    asks += 1;
    const ask: PictureAsk = { ask: asks, file };
    waiting.set(ask.ask, { onStage, settle });
    try {
      thread.postMessage(ask);
    } catch {
      waiting.delete(ask.ask);
      settle(null);
    }
  });
}

/**
 * A picture from a file, a drop or the clipboard, ready to upload: its id (sha256 of the bytes, so the same picture is
 * one object) and its bytes. Made in the picture worker, off the page's thread (pictureWorker.ts); where a browser has
 * no worker with a 2D OffscreenCanvas, on the page, the same way (pictureDraw.ts).
 *
 * - Kept as it is: a GIF up to 3 MB (redrawn, it would lose its motion); a PNG, JPEG or WebP up to 3 MB and 2400 px on
 *   its longer side; a PNG or WebP up to 3 MB with transparency, however large; a picture of the buckets' types up to
 *   3 MB the browser cannot draw (it cannot be measured; the bucket decides).
 * - Redrawn (turned upright by its EXIF orientation, no larger than 2400 px, then 1800 and 1280 while over 3 MB; with
 *   transparency as PNG or WebP, without it on white as JPEG or WebP 0.85 — the smaller): a phone's photo of 3–12 MB, a
 *   picture over 2400 px, a BMP, and the types the buckets do not take but the browser can draw (HEIC in Safari, AVIF…).
 * - 'heic' — a HEIC the browser cannot draw; 'type' — not a picture, or one the browser cannot draw; 'size' — over 3 MB
 *   even redrawn at 1280 px.
 */
export async function preparePicture(file: Blob, deps: PictureDeps = {}): Promise<PreparedPicture | PictureRefusal> {
  const done = await askWorker(file, deps.onStage);
  return done ?? preparePictureHere(file, deps.onStage);
}

/** preparePicture with the bytes as base64 (BankPicture: the question editor and the quiz cover keep it so). */
export async function pictureFromFile(file: Blob, deps: PictureDeps = {}): Promise<{ id: string; picture: BankPicture } | PictureRefusal> {
  const made = await preparePicture(file, deps);
  if (typeof made === 'string') return made;
  return { id: made.id, picture: { type: made.blob.type, data: base64Of(await bytesOf(made.blob)) } };
}
