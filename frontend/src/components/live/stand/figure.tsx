/**
 * A question's pictures on the projector's boards over the arena (a button question's and a movement round's): the
 * question's picture beside its text (a tap shows it large), large by itself during the 3-2-1, and an option's picture
 * in its row. The bytes come through useLivePictures (lib/live/pictures.ts).
 */
import type { ShownPicture } from '../../../lib/live/pictures';
import { BATTLE_3D } from './copy';

/** The question's picture beside its text; null while it loads, a line when it did not come. */
export function StemFigure({ stem, big, onToggle }: { stem: ShownPicture; big: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="lvbt-figure" onClick={onToggle} aria-label={BATTLE_3D.pictureBig} aria-pressed={big}>
      {typeof stem === 'string' ? <img src={stem} alt="" decoding="async" /> : stem === false ? <i>{BATTLE_3D.pictureFailed}</i> : null}
    </button>
  );
}

/** The question's picture over the arena; a tap puts it back. */
export function BigPicture({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <button type="button" className="lvbt-pic-big" onClick={onClose} aria-label={BATTLE_3D.picture}>
      <img src={src} alt={BATTLE_3D.picture} />
    </button>
  );
}

/** An option's picture in its row; nothing for an option without one. */
export function OptionPic({ pic }: { pic: ShownPicture | undefined }) {
  if (pic === undefined) return null;
  return <span className="lvbt-opt-pic">{pic ? <img src={pic} alt="" decoding="async" /> : null}</span>;
}
