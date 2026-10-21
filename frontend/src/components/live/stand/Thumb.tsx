/**
 * A player's KayKit character as a picture (the kit's pre-rendered thumbnails, tinted by CSS): the leaderboard and the
 * podium show the same character the 3D scene draws, without a second 3D view.
 */
import { memo } from 'react';
import { clothesHex, thumbUrl, toPlayerLook } from '../../../lib/live/three';

export const Thumb = memo(function Thumb({ look, size }: { look: unknown; size: number }) {
  const l = toPlayerLook(look);
  const url = `url("${thumbUrl(l.body, l.hat)}")`;
  return (
    <span
      className="lvst-thumb"
      aria-hidden="true"
      style={{ width: size, height: size, ['--thumb' as string]: url, ['--clothes' as string]: clothesHex(l.colour) }}
    />
  );
});
