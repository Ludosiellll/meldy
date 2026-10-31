/** The hunters' copies of the boss (mode B): a skeleton copy needs a loaded skeleton of its own; a clock does not. */
import { describe, expect, it } from 'vitest';
import type { Boss, BossKind } from '../../../lib/live/three';
import { BossCopies, type CopyKit } from './bossCopies';

/** The kit's rule: one loaded skeleton per boss; createBoss of a skeleton with none loaded throws. */
function fakeKit() {
  const k = { loaded: true, loads: 0, made: 0, pending: [] as Array<() => void> };
  const kit: CopyKit = {
    createBoss(kind: BossKind) {
      if (kind === 'skeleton') {
        if (!k.loaded) throw new Error('the skeleton is not loaded');
        k.loaded = false;
      }
      k.made++;
      return {} as Boss;
    },
    loadBoss() {
      k.loads++;
      return new Promise<void>((ok) => k.pending.push(() => {
        k.loaded = true;
        ok();
      }));
    },
  };
  return { k, kit };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('the hunters\' copies of the boss', () => {
  it('a skeleton copy waits for its own load and never throws; the next one is loaded at once', async () => {
    const { k, kit } = fakeKit();
    kit.createBoss('skeleton');                       // the main boss takes the loaded one
    const copies = new BossCopies(() => kit, 'skeleton', 3);
    copies.taken();
    expect(k.loads).toBe(1);
    expect(copies.make()).toBeNull();                 // not loaded yet: the hunter is not drawn this frame
    expect(k.loads).toBe(1);                          // one load at a time
    k.pending.shift()!();
    await flush();
    expect(copies.make()).not.toBeNull();
    expect(k.made).toBe(2);
    expect(k.loads).toBe(2);                          // the spare for the third hunter is on its way
    expect(copies.make()).toBeNull();
    k.pending.shift()!();
    await flush();
    expect(copies.make()).not.toBeNull();
  });

  it('a clock copy needs no load', () => {
    const { k, kit } = fakeKit();
    const copies = new BossCopies(() => kit, 'clock', 3);
    copies.taken();
    expect(copies.make()).not.toBeNull();
    expect(copies.make()).not.toBeNull();
    expect(k.loads).toBe(0);
  });

  it('no kit yet: nothing', () => {
    expect(new BossCopies(() => null, 'skeleton', 3).make()).toBeNull();
  });
});
