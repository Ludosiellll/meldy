/**
 * Smaller copies of the boss for the second and third hunters of mode B (docs/live/MODE_RUN.md §3), shared by the
 * projector's scene and the phone's. The kit hands one loaded skeleton to one boss only («a second skeleton needs a
 * fresh load»), so a skeleton copy is loaded in advance: one spare waits, the next is loaded as soon as it is taken,
 * and until a spare is there the hunter is simply not drawn. (Before: kit.createBoss threw every frame for the second
 * hunter — 13 players or more with the skeleton — which stopped the frame and froze the chase on both screens.)
 */
import type { Boss, BossKind } from '../../../lib/live/three';

export interface CopyKit {
  createBoss(kind: BossKind, options?: { height?: number }): Boss;
  loadBoss(kind: BossKind): Promise<void>;
}

export class BossCopies {
  private spare = false;
  private loading = false;

  constructor(
    private readonly kit: () => CopyKit | null,
    private readonly kind: BossKind,
    private readonly height: number,
  ) {}

  /** Load a spare now (call after the main boss took the loaded skeleton). */
  prepare(): void {
    const kit = this.kit();
    if (!kit || this.kind !== 'skeleton' || this.spare || this.loading) return;
    this.loading = true;
    kit.loadBoss('skeleton').then(
      () => {
        this.loading = false;
        this.spare = true;
      },
      () => {
        this.loading = false;
      },
    );
  }

  /** The main boss took the loaded skeleton (a rebuilt arena): the spare is gone, load another. */
  taken(): void {
    this.spare = false;
    this.prepare();
  }

  /** A copy, or null while no skeleton is loaded for it (the hunter waits a frame or two). */
  make(): Boss | null {
    const kit = this.kit();
    if (!kit) return null;
    if (this.kind === 'skeleton') {
      if (!this.spare) {
        this.prepare();
        return null;
      }
      this.spare = false;
    }
    const model = kit.createBoss(this.kind, { height: this.height });
    this.prepare();
    return model;
  }
}
