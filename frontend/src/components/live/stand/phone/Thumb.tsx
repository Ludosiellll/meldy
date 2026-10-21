/**
 * A character's picture on the phone: the kit's pre-rendered WebP (docs/live/KIT_3D.md §6), the clothes painted in
 * the player's colour through the picture's own mask in CSS (multiply). No canvas, no 3D; a picture is ~5 KB and
 * cached for good.
 */
import { memo, type CSSProperties } from 'react';
import { clothesHex, type KitHatId } from '../../../../lib/live/three/look';
import { thumbUrl } from '../../../../lib/live/three/thumbs';
import type { BodyId, ColourId } from '../../../../lib/live/types';

export interface ThumbProps {
  body: BodyId;
  colour: ColourId;
  hat: KitHatId;
  /** CSS px of the square. */
  size: number;
  className?: string;
  title?: string;
}

export const Thumb = memo(function Thumb({ body, colour, hat, size, className, title }: ThumbProps) {
  const style = {
    '--thumb': `url("${thumbUrl(body, hat)}")`,
    '--clothes': clothesHex(colour),
    width: size,
    height: size,
  } as CSSProperties;
  return <span className={`sp-thumb${className ? ` ${className}` : ''}`} style={style} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} />;
});
