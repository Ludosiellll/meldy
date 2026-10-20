/**
 * The picture worker: a picture the author adds is decoded, redrawn and named here, on a thread of its own with an
 * OffscreenCanvas (pictureDraw.ts preparePictureHere), so the page keeps answering while a phone's photo is made to fit
 * (the smoothness audit of 20.10). itemPictures.ts preparePicture asks; a failure here is answered as such, and the page
 * does the work itself.
 */
import { preparePictureHere, type PictureRefusal, type PictureStage, type PreparedPicture } from './pictureDraw';

export interface PictureAsk {
  ask: number;
  file: Blob;
}
export type PictureAnswer =
  | { ask: number; stage: PictureStage }
  | { ask: number; done: PreparedPicture | PictureRefusal }
  | { ask: number; failed: true };

// A worker's own scope (the project's types are the page's: only what is used here).
const scope = self as unknown as { onmessage: ((event: MessageEvent<PictureAsk>) => void) | null; postMessage: (answer: PictureAnswer) => void };

scope.onmessage = (event) => {
  const { ask, file } = event.data;
  void (async () => {
    try {
      // A worker's canvas that cannot draw in 2D (Safari before 16.4): the page does it.
      if (typeof OffscreenCanvas !== 'function' || !new OffscreenCanvas(1, 1).getContext('2d')) throw new Error('no 2D OffscreenCanvas');
      const done = await preparePictureHere(file, (stage) => scope.postMessage({ ask, stage }));
      scope.postMessage({ ask, done });
    } catch {
      scope.postMessage({ ask, failed: true });
    }
  })();
};
