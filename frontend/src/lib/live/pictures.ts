/**
 * A live question's pictures on a screen (20261030090000_live_pictures.sql): the first picture of the question and of
 * each option, read as object URLs through LiveApi.picture once the question is there (its countdown), so they are in
 * before the answers open. The bytes are kept per path for the page's life (api/itemPictures.ts).
 */
import { useEffect, useState } from 'react';
import type { LivePictures } from './types';

/** A picture's URL; null while it loads; false when it did not come (the screen says so instead of an empty box). */
export type ShownPicture = string | null | false;

export interface ShownPictures {
  /** Undefined when the question has no picture of its own. */
  stem: ShownPicture | undefined;
  /** One per option in the shown order; undefined for an option without a picture. */
  options: Array<ShownPicture | undefined>;
  /** The question has pictures at all. */
  any: boolean;
}

const NONE: ShownPictures = { stem: undefined, options: [], any: false };

export function hasPictures(pictures: LivePictures | undefined): pictures is LivePictures {
  return !!pictures && (pictures.stem.length > 0 || pictures.options.some((o) => o.length > 0));
}

/** The question's pictures as they arrive; `read` should keep its identity (a bound method). */
export function useLivePictures(pictures: LivePictures | undefined, read: ((path: string) => Promise<string>) | null): ShownPictures {
  const key = pictures ? JSON.stringify(pictures) : '';
  const [shown, setShown] = useState<ShownPictures>(NONE);
  useEffect(() => {
    if (!hasPictures(pictures)) {
      setShown(NONE);
      return;
    }
    let alive = true;
    const stemPath = pictures.stem[0];
    const optionPaths = pictures.options.map((o) => o[0]);
    setShown({ stem: stemPath ? null : undefined, options: optionPaths.map((p) => (p ? null : undefined)), any: true });
    const load = (path: string, put: (prev: ShownPictures, value: ShownPicture) => ShownPictures) => {
      const done = (value: ShownPicture) => {
        if (alive) setShown((prev) => put(prev, value));
      };
      if (!read) {
        done(false);
        return;
      }
      read(path).then(done, () => done(false));
    };
    if (stemPath) load(stemPath, (prev, value) => ({ ...prev, stem: value }));
    optionPaths.forEach((path, i) => {
      if (path) load(path, (prev, value) => ({ ...prev, options: prev.options.map((o, k) => (k === i ? value : o)) }));
    });
    return () => {
      alive = false;
    };
    // `key` stands for `pictures` (a new object every poll with the same paths)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, read]);
  return shown;
}
