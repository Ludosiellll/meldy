/**
 * The shared art (components/live/art) memoised for the player's screens: every poll brings new objects (a look is a new
 * object each time), so a character re-renders only when what it shows changes — its parts, size, face, ice, move.
 */
import { memo, type CSSProperties } from 'react';
import { Boss, type BossProps } from '../art/Boss';
import { Character, type CharacterProps } from '../art/Character';
import type { Look } from '../../../lib/live/types';

const sameLook = (a: Look, b: Look) => a === b || (a.body === b.body && a.colour === b.colour && a.eyes === b.eyes && a.hat === b.hat);

const sameStyle = (a: CSSProperties | undefined, b: CSSProperties | undefined) => {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k]);
};

export const LiveChar = memo(
  Character,
  (a: CharacterProps, b: CharacterProps) =>
    sameLook(a.look, b.look) &&
    a.size === b.size &&
    a.face === b.face &&
    a.frozen === b.frozen &&
    a.move === b.move &&
    a.name === b.name &&
    a.me === b.me &&
    a.className === b.className &&
    a.phaseMs === b.phaseMs &&
    a.title === b.title &&
    sameStyle(a.style, b.style),
);

export const LiveBoss = memo(
  Boss,
  (a: BossProps, b: BossProps) =>
    a.size === b.size && a.phase === b.phase && a.hurt === b.hurt && a.move === b.move && a.flashKey === b.flashKey && a.className === b.className && sameStyle(a.style, b.style),
);

export function reducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
