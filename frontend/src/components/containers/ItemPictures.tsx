import { useEffect, useState } from 'react';
import { pictureDataUrl, pictureUrl } from '../../api/itemPictures';
import type { BankPicture } from '../../types/container';
import * as copy from './copy';
import './pictures.css';

/**
 * The pictures of a question or of one option (owner, 2026-10-14: «а если вопрос является картинкой, что делать?»):
 * a saved question reads them from the private bucket (api/itemPictures.ts), the import page shows the file's own
 * bytes. A picture is on white whatever the theme: a diagram drawn in black on a transparent page stays readable.
 */

export type PictureSource = { path: string } | { picture: BankPicture };

/** Saved paths → sources. */
export const storedPictures = (paths: readonly string[] | undefined): PictureSource[] => (paths ?? []).map((path) => ({ path }));

/** The file's picture ids → sources (an id the file did not bring is left out). */
export const filePictures = (ids: readonly string[] | undefined, pictures: Record<string, BankPicture> | undefined): PictureSource[] =>
  (ids ?? []).flatMap((id) => (pictures?.[id] ? [{ picture: pictures[id] }] : []));

function Picture({ source, kind }: { source: PictureSource; kind: 'stem' | 'option' }) {
  const path = 'path' in source ? source.path : null;
  const inline = 'picture' in source ? pictureDataUrl(source.picture) : null;
  const [loaded, setLoaded] = useState<{ path: string; url: string | null } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!path) return undefined;
    let live = true;
    pictureUrl(path).then(
      (url) => live && setLoaded({ path, url }),
      () => live && setLoaded({ path, url: null }),
    );
    return () => {
      live = false;
    };
  }, [path, attempt]);

  const url = inline ?? (loaded && loaded.path === path ? loaded.url : undefined);
  if (url === undefined) return <span className="ct-pic" data-kind={kind} data-wait="" aria-busy="true" />;
  if (url === null) {
    return (
      <span className="ct-pic" data-kind={kind} data-failed="">
        {copy.PICTURE_FAILED}
        {kind === 'stem' ? (
          <>
            {' '}
            <button type="button" className="sf-link" onClick={() => setAttempt((value) => value + 1)}>
              {copy.PICTURE_RETRY}
            </button>
          </>
        ) : null}
      </span>
    );
  }
  return (
    <span className="ct-pic" data-kind={kind}>
      <img src={url} alt="" decoding="async" draggable={false} />
    </span>
  );
}

/** The pictures in a row (several under a stem or in one option wrap). Nothing when there are none. */
export default function ItemPictures({ sources, kind }: { sources: readonly PictureSource[]; kind: 'stem' | 'option' }) {
  if (sources.length === 0) return null;
  return (
    <span className="ct-pics" data-kind={kind}>
      {sources.map((source, index) => (
        <Picture key={'path' in source ? source.path : `${index}`} source={source} kind={kind} />
      ))}
    </span>
  );
}
