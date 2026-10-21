import { describe, expect, it } from 'vitest';
import { BODIES, COLOURS, HATS, defaultLook } from '../rules';
import {
  ACCESSORIES,
  BODY_OPTIONS,
  COLOUR_OPTIONS,
  HAT_OPTIONS,
  MODELS,
  PALETTE,
  accessoryIndex,
  clothesHex,
  isWardrobeLook,
  modelIndex,
  toPlayerLook,
} from './look';

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

describe('the 3D look keeps the wardrobe (CONTRACT §10)', () => {
  it('has an option for every wardrobe body, colour and hat', () => {
    expect(BODY_OPTIONS.map((b) => b.id).sort()).toEqual([...BODIES].sort());
    expect(COLOUR_OPTIONS.map((c) => c.id).sort()).toEqual([...COLOURS].sort());
    for (const hat of HATS) expect(HAT_OPTIONS.find((h) => h.id === hat)?.wardrobe).toBe(true);
  });

  it('takes a wardrobe look as it is, without its eyes', () => {
    const look = { body: 'cloud', colour: 'teal', eyes: 'sleepy', hat: 'phones' } as const;
    expect(toPlayerLook(look)).toEqual({ body: 'cloud', colour: 'teal', hat: 'phones' });
    for (const name of ['Дима', 'Аня', 'Оля', 'Костя']) {
      const d = defaultLook(name);
      expect(toPlayerLook(d)).toEqual({ body: d.body, colour: d.colour, hat: d.hat });
    }
  });

  it('falls back to the first options for anything unknown', () => {
    expect(toPlayerLook(null)).toEqual({ body: 'square', colour: 'blue', hat: 'none' });
    expect(toPlayerLook({ body: 'blob', colour: 'gold', hat: 'wig' })).toEqual({ body: 'square', colour: 'blue', hat: 'none' });
    expect(toPlayerLook({ body: 'drop', colour: 'snow', hat: 'party' })).toEqual({ body: 'drop', colour: 'snow', hat: 'party' });
  });

  it('maps the five bodies onto the five KayKit characters, one each', () => {
    const models = BODIES.map(modelIndex);
    expect(new Set(models).size).toBe(5);
    for (const m of models) expect(m).toBeGreaterThanOrEqual(0);
    expect(MODELS).toHaveLength(5);
    expect(BODY_OPTIONS.every((b) => b.name.length > 0)).toBe(true);
  });
});

describe('the clothes palette', () => {
  it('has 8 free colours first, then the 2 locked ones', () => {
    expect(PALETTE).toHaveLength(8);
    expect(COLOUR_OPTIONS.slice(0, 8)).toEqual(PALETTE);
    expect(COLOUR_OPTIONS.slice(8).map((c) => c.id)).toEqual(['graphite', 'snow']);
    expect(COLOUR_OPTIONS.slice(8).every((c) => c.lock)).toBe(true);
  });

  it('keeps the 8 free colours far apart and saturated enough for a projector', () => {
    for (const c of PALETTE) {
      const [r, g, b] = rgb(c.hex);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      expect((max - min) / max, c.id).toBeGreaterThan(0.6);
    }
    for (let i = 0; i < PALETTE.length; i++) {
      for (let j = i + 1; j < PALETTE.length; j++) {
        const a = rgb(PALETTE[i].hex);
        const b = rgb(PALETTE[j].hex);
        const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        expect(d, `${PALETTE[i].id} vs ${PALETTE[j].id}`).toBeGreaterThan(90);
      }
    }
  });

  it('gives a hex for every colour', () => {
    for (const c of COLOURS) expect(clothesHex(c)).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe('the accessories', () => {
  it('are the 9 wardrobe hats and the 3 extra ones, without «none»', () => {
    expect(ACCESSORIES).toHaveLength(12);
    expect(new Set(ACCESSORIES).size).toBe(12);
    expect(ACCESSORIES).not.toContain('none');
    expect(HAT_OPTIONS.filter((h) => !h.wardrobe).map((h) => h.id)).toEqual(['party', 'propeller', 'tophat']);
  });

  it('index the batches; none has no accessory', () => {
    expect(accessoryIndex('none')).toBe(-1);
    ACCESSORIES.forEach((id, i) => expect(accessoryIndex(id)).toBe(i));
  });

  it('say which looks the server accepts today', () => {
    expect(isWardrobeLook({ body: 'round', colour: 'blue', hat: 'crown' })).toBe(true);
    expect(isWardrobeLook({ body: 'round', colour: 'blue', hat: 'tophat' })).toBe(false);
  });

  it('keep the locks of the wardrobe', () => {
    const locked = HAT_OPTIONS.filter((h) => h.lock).map((h) => h.id);
    expect(locked).toEqual(['crown', 'grad', 'horns']);
  });
});
