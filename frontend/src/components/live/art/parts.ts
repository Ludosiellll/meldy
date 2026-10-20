/**
 * The parts of a player's character (docs/live/CONTRACT.md §10): ids are the contract's, names are the builder's words.
 * Geometry is in a 100×100 box: `top` — where a hat sits, `fy` — the eyes' line, `hw` — half the width at the head,
 * `feet` — x of the two feet. Drawn in-house (prototype art.js, 20.10), no outside art.
 */
import type { BodyId, ColourId, EyesId, HatId } from '../../../lib/live/types';

export const OUTLINE = '#1B2230';

export interface BodyPart {
  name: string;
  d: string;
  top: number;
  fy: number;
  hw: number;
  feet: readonly [number, number];
}

export const BODY_PARTS: Record<BodyId, BodyPart> = {
  round: { name: 'Круглый', d: 'M50 22C71 22 86 37 86 56C86 75 71 88 50 88C29 88 14 75 14 56C14 37 29 22 50 22Z', top: 22, fy: 52, hw: 33, feet: [38, 62] },
  square: { name: 'Кубик', d: 'M36 24H64Q84 24 84 44V68Q84 88 64 88H36Q16 88 16 68V44Q16 24 36 24Z', top: 24, fy: 52, hw: 33, feet: [36, 64] },
  drop: { name: 'Капля', d: 'M50 12C60 28 84 42 84 61C84 77 69 88 50 88C31 88 16 77 16 61C16 42 40 28 50 12Z', top: 21, fy: 59, hw: 26, feet: [38, 62] },
  bean: { name: 'Боб', d: 'M50 12C66 12 76 24 76 40V70C76 82 66 88 50 88C34 88 24 82 24 70V40C24 24 34 12 50 12Z', top: 12, fy: 40, hw: 25, feet: [40, 60] },
  cloud: { name: 'Облачко', d: 'M26 88C15 88 9 79 13 70C6 64 9 51 20 49C19 37 31 29 42 33C47 22 61 21 67 31C79 29 88 39 85 50C93 56 91 70 83 74C85 83 78 89 70 88Z', top: 26, fy: 58, hw: 32, feet: [36, 64] },
};

export interface ColourPart {
  name: string;
  value: string;
  /** How the part opens, for the builder's note (null: open from the start). */
  lock: string | null;
}

export const COLOUR_PARTS: Record<ColourId, ColourPart> = {
  blue: { name: 'Синий', value: '#2869DD', lock: null },
  yellow: { name: 'Жёлтый', value: '#F4C45B', lock: null },
  green: { name: 'Зелёный', value: '#6CC38A', lock: null },
  pink: { name: 'Розовый', value: '#F29BBE', lock: null },
  sky: { name: 'Голубой', value: '#8DB8F7', lock: null },
  orange: { name: 'Оранжевый', value: '#F59A4C', lock: null },
  violet: { name: 'Фиолетовый', value: '#9B87F0', lock: null },
  teal: { name: 'Бирюзовый', value: '#4FC7B8', lock: null },
  graphite: { name: 'Графит', value: '#4A5262', lock: 'серия из 5 верных ответов' },
  snow: { name: 'Белый', value: '#F7F7F3', lock: '5 побед над монстром' },
};

export const EYE_PARTS: Record<EyesId, { name: string }> = {
  round: { name: 'Круглые' },
  dots: { name: 'Точки' },
  one: { name: 'Один глаз' },
  sleepy: { name: 'Сонные' },
  glasses: { name: 'В очках' },
};

export const HAT_PARTS: Record<HatId, { name: string; lock: string | null }> = {
  none: { name: 'Без шапки', lock: null },
  cap: { name: 'Кепка', lock: null },
  beanie: { name: 'Шапка', lock: null },
  phones: { name: 'Наушники', lock: null },
  flower: { name: 'Цветок', lock: null },
  antenna: { name: 'Антенна', lock: null },
  bow: { name: 'Бант', lock: null },
  crown: { name: 'Корона', lock: 'место в тройке' },
  grad: { name: 'Шапочка выпускника', lock: '10 игр' },
  horns: { name: 'Рожки', lock: 'оттаять 3 раза за игру' },
};

/** A darker shade of a colour (k < 1). */
export function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c * k)));
  const r = f(n >> 16);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

export const BOSS_COLOURS = ['#EF6A4C', '#E0472F', '#C2302A'] as const;
