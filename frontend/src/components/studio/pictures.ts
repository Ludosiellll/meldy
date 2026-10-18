import { COVER_BUCKET, pictureFromFile, picturePath, uploadPicture } from '../../api/itemPictures';
import { STUDIO } from './copyStudio';
import { presetBlob, type PresetId, type PresetUse } from './presets';

/**
 * Pictures of a studio page (a cover, a picture block, the background, a result message): uploaded at once into the
 * exam's folder of the public bucket quiz-covers, named by their sha256 — exactly as the release-47 quiz cover
 * (pages/quiz/QuizSetupPage.tsx), so the path is one DOC_IMAGE_RE takes. A ready preset is drawn first (presets.ts).
 */

/** Where a chosen picture goes. */
export type PictureTarget = { kind: 'image'; blockId: string } | { kind: 'cover'; blockId: string } | { kind: 'background' } | { kind: 'band'; index: number };

export const targetKey = (target: PictureTarget) =>
  target.kind === 'background' ? 'background' : target.kind === 'band' ? `band:${target.index}` : `${target.kind}:${target.blockId}`;

/** The stored path, or the words why not. */
export async function uploadDocPicture(containerId: string, file: Blob): Promise<{ path: string } | { note: string }> {
  try {
    const made = await pictureFromFile(file);
    if (made === 'type') return { note: STUDIO.pictureType };
    if (made === 'size') return { note: STUDIO.pictureSize };
    // quiz-covers takes PNG, JPEG, GIF and WebP (a small BMP stays BMP).
    const path = made.picture.type === 'image/bmp' ? null : picturePath(containerId.toLowerCase(), made.id, made.picture.type);
    if (!path) return { note: STUDIO.pictureType };
    if ((await uploadPicture(path, made.picture, COVER_BUCKET)) === 'refused') return { note: STUDIO.pictureFailed };
    return { path };
  } catch {
    return { note: STUDIO.pictureFailed };
  }
}

/** A ready preset drawn and uploaded like a picture of the author's. */
export async function uploadPreset(containerId: string, id: PresetId, use: PresetUse): Promise<{ path: string } | { note: string }> {
  try {
    return await uploadDocPicture(containerId, await presetBlob(id, use));
  } catch {
    return { note: STUDIO.pictureFailed };
  }
}
