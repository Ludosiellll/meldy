import { COVER_BUCKET, isPictureFile, picturePath, preparePicture, uploadPicture } from '../../api/itemPictures';
import { STUDIO } from './copyStudio';
import { presetBlob, type PresetId, type PresetUse } from './presets';

/**
 * Pictures of a studio page (a cover, a picture block, the background, a result message): uploaded at once into the
 * exam's folder of the public bucket quiz-covers, named by their sha256 — exactly as the release-47 quiz cover
 * (pages/quiz/QuizSetupPage.tsx), so the path is one DOC_IMAGE_RE takes. The file goes through the one helper of
 * every picture the author adds (api/itemPictures.ts preparePicture, in its own worker: a phone's photo redrawn to
 * 2400 px and under 3 MB, turned upright, a HEIC said in words), and its bytes go up as they are. A ready preset is drawn
 * first (presets.ts).
 */

/** Where a chosen picture goes. */
export type PictureTarget = { kind: 'image'; blockId: string } | { kind: 'cover'; blockId: string } | { kind: 'background' } | { kind: 'band'; index: number };

export const targetKey = (target: PictureTarget) =>
  target.kind === 'background' ? 'background' : target.kind === 'band' ? `band:${target.index}` : `${target.kind}:${target.blockId}`;

/**
 * What a picture's upload is doing, in this order: reading the file, redrawing a big photo smaller (when it has to), and
 * sending it (live check of 47.4: «Загружаю картинку…» flashed before «Уменьшаю фото…»).
 */
export type UploadStage = 'read' | 'shrink' | 'upload';

/** The pictures among files of a drop or the clipboard (not SVG; a HEIC counts — the helper says if it cannot draw it). */
export function pictureFiles(list: FileList | readonly File[] | null | undefined): File[] {
  return Array.from(list ?? []).filter(isPictureFile);
}

/** The paste keys as this computer names them. */
export function pasteKeys(): string {
  const platform = typeof navigator === 'undefined' ? '' : `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`;
  return /Mac|iPhone|iPad/.test(platform) ? '⌘V' : 'Ctrl+V';
}

/** A drag carries files (a drag of words, a link or a block of the page does not). */
export function draggingFiles(transfer: DataTransfer | null): boolean {
  return Boolean(transfer && Array.from(transfer.types ?? []).includes('Files'));
}

/** The stored path, or the words why not. `onStage` hears the work as it goes. */
export async function uploadDocPicture(containerId: string, file: Blob, onStage?: (stage: UploadStage) => void): Promise<{ path: string } | { note: string }> {
  try {
    const made = await preparePicture(file, { onStage });
    if (made === 'type') return { note: STUDIO.pictureType };
    if (made === 'size') return { note: STUDIO.pictureSize };
    if (made === 'heic') return { note: STUDIO.pictureHeic };
    // quiz-covers takes PNG, JPEG, GIF and WebP (a BMP the browser cannot redraw stays BMP).
    const path = made.blob.type === 'image/bmp' ? null : picturePath(containerId.toLowerCase(), made.id, made.blob.type);
    if (!path) return { note: STUDIO.pictureType };
    onStage?.('upload');
    // The bytes themselves go up (no base64 there and back on the page's thread).
    if ((await uploadPicture(path, made.blob, COVER_BUCKET)) === 'refused') return { note: STUDIO.pictureFailed };
    return { path };
  } catch {
    return { note: STUDIO.pictureFailed };
  }
}

const PRESET_PATHS = 'meldy_studio_preset_paths';
const PRESETS_KEPT = 60;

function presetPaths(): string[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(PRESET_PATHS) ?? '[]') as unknown;
    return Array.isArray(stored) ? stored.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

/** A ready picture's stored path, kept on this device: its field then offers «Заменить своей». */
export function rememberPreset(path: string): void {
  try {
    window.localStorage.setItem(PRESET_PATHS, JSON.stringify([path, ...presetPaths().filter((entry) => entry !== path)].slice(0, PRESETS_KEPT)));
  } catch {
    // Private mode: the field says «Загрузить другую», which is true of a ready picture too.
  }
}

/**
 * The picture at `path` is one of the ready ones (put here on this device). A stored picture is only a hash of its
 * bytes, so an unknown one counts as the author's own (live check of 47.4: «Заменить своей» was offered over the
 * author's own upload).
 */
export function isPresetPath(path: string | null): boolean {
  return path !== null && presetPaths().includes(path);
}

/** A ready preset drawn and uploaded like a picture of the author's. */
export async function uploadPreset(containerId: string, id: PresetId, use: PresetUse): Promise<{ path: string } | { note: string }> {
  try {
    const result = await uploadDocPicture(containerId, await presetBlob(id, use));
    if ('path' in result) rememberPreset(result.path);
    return result;
  } catch {
    return { note: STUDIO.pictureFailed };
  }
}
