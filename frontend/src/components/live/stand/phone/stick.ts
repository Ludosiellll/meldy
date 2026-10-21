/**
 * The floating stick: press anywhere on the field, the stick appears under the finger and the character runs where
 * the finger pulls. Past the rim the stick follows the finger (no dead end at the edge). Pure DOM, no React:
 *
 * - the pointer's move gives the direction at once (`onMove`, which only stores two numbers in MoveClient: commands
 *   go out in its 15 Hz batches, never per event or per frame);
 * - the picture (two transforms) is written by `paint()` from the screen's animation frame, only when it changed;
 * - one layout read per press (the field's box at pointerdown), none while moving.
 *
 * The field has `touch-action: none` (no scroll, no zoom, no double-tap zoom under the stick).
 */
export interface StickOptions {
  /** The stick's reach in CSS px: a pull this long is full speed. */
  radius?: number;
  onMove: (x: number, y: number) => void;
  /** The first touch of a press (a haptic tick, the hint goes). */
  onPress?: () => void;
}

export class FloatingStick {
  private readonly radius: number;
  private field: HTMLElement | null = null;
  private base: HTMLElement | null = null;
  private knob: HTMLElement | null = null;
  private pointer: number | null = null;
  private left = 0;
  private top = 0;
  /** The stick's centre and the finger, in field px. */
  private bx = 0;
  private by = 0;
  private kx = 0;
  private ky = 0;
  private dirty = true;
  private enabled = true;
  /** Where the resting stick waits (field px), so a newcomer sees what to press. */
  private restX = 0;
  private restY = 0;

  constructor(private readonly o: StickOptions) {
    this.radius = o.radius ?? 56;
  }

  get active(): boolean {
    return this.pointer !== null;
  }

  attach(field: HTMLElement, base: HTMLElement, knob: HTMLElement): () => void {
    this.field = field;
    this.base = base;
    this.knob = knob;
    field.addEventListener('pointerdown', this.down);
    field.addEventListener('pointermove', this.move);
    field.addEventListener('pointerup', this.up);
    field.addEventListener('pointercancel', this.up);
    field.addEventListener('lostpointercapture', this.up);
    this.dirty = true;
    return () => {
      field.removeEventListener('pointerdown', this.down);
      field.removeEventListener('pointermove', this.move);
      field.removeEventListener('pointerup', this.up);
      field.removeEventListener('pointercancel', this.up);
      field.removeEventListener('lostpointercapture', this.up);
      this.field = this.base = this.knob = null;
    };
  }

  /** Where the stick rests when nobody holds it (field px). */
  rest(x: number, y: number): void {
    if (x === this.restX && y === this.restY) return;
    this.restX = x;
    this.restY = y;
    if (this.pointer === null) this.dirty = true;
  }

  /** Off while the room holds everyone still (zero, the reveal): the stick lets go and ignores the finger. */
  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (!on) this.release();
    this.dirty = true;
  }

  release(): void {
    if (this.pointer === null) return;
    const id = this.pointer;
    this.pointer = null;
    this.dirty = true;
    try {
      this.field?.releasePointerCapture?.(id);
    } catch {
      // Already released.
    }
    this.o.onMove(0, 0);
  }

  /** Called from the screen's animation frame: writes the two transforms when something moved. */
  paint(): void {
    if (!this.dirty || !this.base || !this.knob) return;
    this.dirty = false;
    const on = this.pointer !== null;
    const bx = on ? this.bx : this.restX;
    const by = on ? this.by : this.restY;
    const dx = on ? this.kx - this.bx : 0;
    const dy = on ? this.ky - this.by : 0;
    this.base.style.transform = `translate3d(${bx.toFixed(1)}px, ${by.toFixed(1)}px, 0)`;
    this.knob.style.transform = `translate3d(${(bx + dx).toFixed(1)}px, ${(by + dy).toFixed(1)}px, 0)`;
    const state = !this.enabled ? 'off' : on ? 'on' : 'rest';
    if (this.base.dataset.state !== state) {
      this.base.dataset.state = state;
      this.knob.dataset.state = state;
    }
  }

  private readonly down = (e: PointerEvent) => {
    if (!this.enabled || !this.field || this.pointer !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const box = this.field.getBoundingClientRect();
    this.left = box.left;
    this.top = box.top;
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    // The whole stick stays on the field.
    const r = this.radius;
    this.bx = Math.min(Math.max(x, r), Math.max(r, box.width - r));
    this.by = Math.min(Math.max(y, r), Math.max(r, box.height - r));
    this.kx = x;
    this.ky = y;
    this.pointer = e.pointerId;
    try {
      this.field.setPointerCapture(e.pointerId);
    } catch {
      // A synthetic event in tests.
    }
    this.dirty = true;
    this.o.onPress?.();
    this.emit();
  };

  private readonly move = (e: PointerEvent) => {
    if (e.pointerId !== this.pointer) return;
    e.preventDefault();
    this.kx = e.clientX - this.left;
    this.ky = e.clientY - this.top;
    // Past the rim the stick follows the finger.
    const dx = this.kx - this.bx;
    const dy = this.ky - this.by;
    const d = Math.hypot(dx, dy);
    if (d > this.radius) {
      const k = (d - this.radius) / d;
      this.bx += dx * k;
      this.by += dy * k;
    }
    this.dirty = true;
    this.emit();
  };

  private readonly up = (e: PointerEvent) => {
    if (e.pointerId !== this.pointer) return;
    this.pointer = null;
    this.dirty = true;
    this.o.onMove(0, 0);
  };

  private emit(): void {
    const dx = this.kx - this.bx;
    const dy = this.ky - this.by;
    const d = Math.hypot(dx, dy);
    const k = d > this.radius ? 1 / d : 1 / this.radius;
    this.o.onMove(dx * k, dy * k);
  }
}
