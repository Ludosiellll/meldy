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
 *
 * The keyboard drives the same stick (accessibility audit 07.11, A11Y-3: the round could only be played with a finger or
 * a mouse): the arrows and W A S D by their physical key (`code`, so Ц Ф Ы В on the Russian layout too), any two at
 * once for a diagonal at full speed; letting go of the last key stops the character, as letting go of the finger does.
 * A finger on the field wins over the keys; a key in a text field, or with Ctrl, Alt or ⌘, is not a move. Every key
 * is let go when the window loses the focus or the page is hidden, when a context menu opens, and when ⌘ goes down
 * (macOS sends no keyup for a key released while ⌘ is held: the character would run on by itself — review of 08.11).
 */
const KEY_DIRS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowUp: [0, -1],
  KeyW: [0, -1],
  ArrowDown: [0, 1],
  KeyS: [0, 1],
  ArrowLeft: [-1, 0],
  KeyA: [-1, 0],
  ArrowRight: [1, 0],
  KeyD: [1, 0],
};

function typingIn(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  const el = target as HTMLElement;
  return el.isContentEditable || el.closest('input, textarea, select, [contenteditable="true"]') !== null;
}
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
  /** The move keys held now (by `code`), and the direction they give (each axis in [-1, 1], length ≤ 1). */
  private readonly keys = new Set<string>();
  private keyX = 0;
  private keyY = 0;

  constructor(private readonly o: StickOptions) {
    this.radius = o.radius ?? 56;
  }

  get active(): boolean {
    return this.pointer !== null || this.keyX !== 0 || this.keyY !== 0;
  }

  /** Listens for the move keys on `target` (the window: the round has no text field to type in). */
  attachKeys(target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): () => void {
    target.addEventListener('keydown', this.keyDown as EventListener);
    target.addEventListener('keyup', this.keyUp as EventListener);
    target.addEventListener('blur', this.letGoKeys);
    target.addEventListener('contextmenu', this.letGoKeys);
    const doc = typeof document !== 'undefined' ? document : null;
    doc?.addEventListener('visibilitychange', this.hidden);
    return () => {
      target.removeEventListener('keydown', this.keyDown as EventListener);
      target.removeEventListener('keyup', this.keyUp as EventListener);
      target.removeEventListener('blur', this.letGoKeys);
      target.removeEventListener('contextmenu', this.letGoKeys);
      doc?.removeEventListener('visibilitychange', this.hidden);
      this.letGoKeys();
    };
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
    this.letGoKeys();
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
    const finger = this.pointer !== null;
    // Opposite keys held together stand still: the stick rests (review of 08.11).
    const keyed = !finger && (this.keyX !== 0 || this.keyY !== 0);
    const on = finger || keyed;
    const bx = finger ? this.bx : this.restX;
    const by = finger ? this.by : this.restY;
    // The keys show on the resting stick: its knob leans the way they go.
    const dx = finger ? this.kx - this.bx : keyed ? this.keyX * this.radius * 0.8 : 0;
    const dy = finger ? this.ky - this.by : keyed ? this.keyY * this.radius * 0.8 : 0;
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
    // Keys still held take over from the finger; else the character stops.
    if (this.keys.size > 0) this.emitKeys();
    else this.o.onMove(0, 0);
  };

  private readonly keyDown = (e: KeyboardEvent) => {
    if (e.key === 'Meta') {
      this.letGoKeys();
      return;
    }
    const dir = KEY_DIRS[e.code];
    if (!dir || e.ctrlKey || e.altKey || e.metaKey || typingIn(e.target)) return;
    e.preventDefault();
    if (!this.enabled || this.keys.has(e.code)) return;
    const first = this.keys.size === 0 && this.pointer === null;
    this.keys.add(e.code);
    if (first) this.o.onPress?.();
    this.emitKeys();
  };

  private readonly keyUp = (e: KeyboardEvent) => {
    if (!this.keys.delete(e.code)) return;
    this.emitKeys();
  };

  private readonly hidden = () => {
    if (typeof document !== 'undefined' && document.hidden) this.letGoKeys();
  };

  private readonly letGoKeys = () => {
    if (this.keys.size === 0) return;
    this.keys.clear();
    this.emitKeys();
  };

  /** The keys' direction: their sum, at full speed in any direction (a diagonal is not faster); a finger wins. */
  private emitKeys(): void {
    let x = 0;
    let y = 0;
    for (const code of this.keys) {
      const dir = KEY_DIRS[code];
      if (!dir) continue;
      x += dir[0];
      y += dir[1];
    }
    x = Math.max(-1, Math.min(1, x));
    y = Math.max(-1, Math.min(1, y));
    const d = Math.hypot(x, y);
    this.keyX = d > 0 ? x / d : 0;
    this.keyY = d > 0 ? y / d : 0;
    this.dirty = true;
    if (this.pointer !== null) return;
    this.o.onMove(this.keyX, this.keyY);
  }

  private emit(): void {
    const dx = this.kx - this.bx;
    const dy = this.ky - this.by;
    const d = Math.hypot(dx, dy);
    const k = d > this.radius ? 1 / d : 1 / this.radius;
    this.o.onMove(dx * k, dy * k);
  }
}
