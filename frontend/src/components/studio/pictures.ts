import { COVER_BUCKET, isPictureFile, pictureFromFile, picturePath, uploadPicture } from '../../api/itemPictures';
import { STUDIO } from './copyStudio';
import { presetBlob, type PresetId, type PresetUse } from './presets';

/**
 * Pictures of a studio page (a cover, a picture block, the background, a result message): uploaded at once into the
 * exam's folder of the public bucket quiz-covers, named by their sha256 — exactly as the release-47 quiz cover
 * (pages/quiz/QuizSetupPage.tsx), so the path is one DOC_IMAGE_RE takes. The file goes through the one helper of
 * every picture the author adds (api/itemPictures.ts pictureFromFile: a phone's photo redrawn to 2400 px and under
 * 3 MB, turned upright, a HEIC said in words). A ready preset is drawn first (presets.ts).
 */

/** Where a chosen picture goes. */
export type PictureTarget = { kind: 'image'; blockId: string } | { kind: 'cover'; blockId: string } | { kind: 'background' } | { kind: 'band'; index: number };

export const targetKey = (target: PictureTarget) =>
  target.kind === 'background' ? 'background' : target.kind === 'band' ? `band:${target.index}` : `${target.kind}:${target.blockId}`;

/** What a picture's upload is doing: redrawing a big photo smaller, or sending it. */
export type UploadStage = 'shrink' | 'upload';

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
    const made = await pictureFromFile(file, { onStage });
    if (made === 'type') return { note: STUDIO.pictureType };
    if (made === 'size') return { note: STUDIO.pictureSize };
    if (made === 'heic') return { note: STUDIO.pictureHeic };
    // quiz-covers takes PNG, JPEG, GIF and WebP (a BMP the browser cannot redraw stays BMP).
    const path = made.picture.type === 'image/bmp' ? null : picturePath(containerId.toLowerCase(), made.id, made.picture.type);
    if (!path) return { note: STUDIO.pictureType };
    onStage?.('upload');
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
