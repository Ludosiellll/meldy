/**
 * How a player looks in the 3D movement games. Pure data, no three.js: the phone's picker imports it without the 3D chunk.
 *
 * The ids are the wardrobe's own (docs/live/CONTRACT.md §10, `live_wardrobe`), so a look chosen for «Битва с монстром»
 * carries over as is: `body` picks one of the five KayKit Adventurers, `colour` is the colour of the clothes, `hat` the
 * accessory on the head. The wardrobe's `eyes` has no 3D counterpart and is ignored.
 */
import type { BodyId, ColourId, HatId } from '../types';

/** The three accessories the 3D kit has beyond the wardrobe. The server refuses them until CONTRACT §10 lists them. */
export type ExtraHatId = 'party' | 'propeller' | 'tophat';
export type KitHatId = HatId | ExtraHatId;

/** A wardrobe `Look` fits here as it is (its `eyes` is ignored). */
export interface PlayerLook {
  body: BodyId;
  colour: ColourId;
  hat: KitHatId;
}

/** The KayKit characters, in the order the kit's files and the thumbnails use. */
export const MODELS = ['knight', 'mage', 'barbarian', 'rogue', 'hooded'] as const;
export type ModelId = (typeof MODELS)[number];

export interface BodyOption {
  id: BodyId;
  /** The name the picker shows. */
  name: string;
  model: ModelId;
}

/** The wardrobe's bodies, each standing for one KayKit character. */
export const BODY_OPTIONS: readonly BodyOption[] = [
  { id: 'square', name: 'Рыцарь', model: 'knight' },
  { id: 'drop', name: 'Маг', model: 'mage' },
  { id: 'round', name: 'Силач', model: 'barbarian' },
  { id: 'bean', name: 'Следопыт', model: 'rogue' },
  { id: 'cloud', name: 'В капюшоне', model: 'hooded' },
];

export interface ColourOption {
  id: ColourId;
  name: string;
  /** The clothes colour, chosen to stay apart on a washed-out projector (sRGB hex). */
  hex: string;
  /** How it opens; null: open from the start. */
  lock: string | null;
}

/** The clothes palette: the 8 free colours first, then the 2 the wardrobe opens by playing. */
export const COLOUR_OPTIONS: readonly ColourOption[] = [
  { id: 'blue', name: 'Синий', hex: '#2F6BFF', lock: null },
  { id: 'yellow', name: 'Жёлтый', hex: '#FFD21A', lock: null },
  { id: 'green', name: 'Зелёный', hex: '#36C03A', lock: null },
  { id: 'pink', name: 'Розовый', hex: '#FF5FB4', lock: null },
  { id: 'sky', name: 'Голубой', hex: '#3EC6FF', lock: null },
  { id: 'orange', name: 'Оранжевый', hex: '#FF6F00', lock: null },
  { id: 'violet', name: 'Фиолетовый', hex: '#8F5BFF', lock: null },
  { id: 'teal', name: 'Бирюзовый', hex: '#10B5A5', lock: null },
  { id: 'graphite', name: 'Графит', hex: '#3F4656', lock: 'серия из 5 верных ответов' },
  { id: 'snow', name: 'Белый', hex: '#F2F4FA', lock: '5 побед над монстром' },
];

/** The 8 colours everyone has from the start. */
export const PALETTE: readonly ColourOption[] = COLOUR_OPTIONS.filter((c) => c.lock === null);

export interface HatOption {
  id: KitHatId;
  name: string;
  lock: string | null;
  /** In the wardrobe of CONTRACT §10; false: the kit has it, the server does not accept it yet. */
  wardrobe: boolean;
}

export const HAT_OPTIONS: readonly HatOption[] = [
  { id: 'none', name: 'Без шапки', lock: null, wardrobe: true },
  { id: 'cap', name: 'Кепка', lock: null, wardrobe: true },
  { id: 'beanie', name: 'Шапка', lock: null, wardrobe: true },
  { id: 'phones', name: 'Наушники', lock: null, wardrobe: true },
  { id: 'flower', name: 'Цветок', lock: null, wardrobe: true },
  { id: 'antenna', name: 'Антенна', lock: null, wardrobe: true },
  { id: 'bow', name: 'Бант', lock: null, wardrobe: true },
  { id: 'crown', name: 'Корона', lock: 'место в тройке', wardrobe: true },
  { id: 'grad', name: 'Шапочка выпускника', lock: '10 игр', wardrobe: true },
  { id: 'horns', name: 'Рожки', lock: 'оттаять 3 раза за игру', wardrobe: true },
  { id: 'party', name: 'Колпак', lock: null, wardrobe: false },
  { id: 'propeller', name: 'Пропеллер', lock: null, wardrobe: false },
  { id: 'tophat', name: 'Цилиндр', lock: null, wardrobe: false },
];

/** Every accessory the kit draws, without `none`: the 9 of the wardrobe and the 3 extra ones. */
export const ACCESSORIES: readonly Exclude<KitHatId, 'none'>[] = HAT_OPTIONS.filter((h) => h.id !== 'none').map(
  (h) => h.id as Exclude<KitHatId, 'none'>,
);

const BODY_IDS = new Set<string>(BODY_OPTIONS.map((b) => b.id));
const COLOUR_IDS = new Set<string>(COLOUR_OPTIONS.map((c) => c.id));
const HAT_IDS = new Set<string>(HAT_OPTIONS.map((h) => h.id));

/** The look to draw for whatever came over the network: unknown parts fall back to the first option. */
export function toPlayerLook(raw: unknown): PlayerLook {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const body = typeof r.body === 'string' && BODY_IDS.has(r.body) ? (r.body as BodyId) : BODY_OPTIONS[0].id;
  const colour = typeof r.colour === 'string' && COLOUR_IDS.has(r.colour) ? (r.colour as ColourId) : PALETTE[0].id;
  const hat = typeof r.hat === 'string' && HAT_IDS.has(r.hat) ? (r.hat as KitHatId) : 'none';
  return { body, colour, hat };
}

/** Index of the body's KayKit character in MODELS. */
export function modelIndex(body: BodyId): number {
  const option = BODY_OPTIONS.find((b) => b.id === body) ?? BODY_OPTIONS[0];
  return MODELS.indexOf(option.model);
}

/** The clothes colour as sRGB hex. */
export function clothesHex(colour: ColourId): string {
  return (COLOUR_OPTIONS.find((c) => c.id === colour) ?? PALETTE[0]).hex;
}

/** Index of the accessory in ACCESSORIES, or -1 for `none`. */
export function accessoryIndex(hat: KitHatId): number {
  return ACCESSORIES.indexOf(hat as Exclude<KitHatId, 'none'>);
}

/** True when the server's wardrobe accepts every part of the look today. */
export function isWardrobeLook(look: PlayerLook): boolean {
  return HAT_OPTIONS.some((h) => h.id === look.hat && h.wardrobe);
}
