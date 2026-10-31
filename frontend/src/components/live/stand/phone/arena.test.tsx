/**
 * The phone's arena (arena.ts) with the 3D scene and the flat view stubbed: a reconnect keeps the 3D (it used to be
 * built anew on the same canvas, whose context the old scene had lost, and the phone went flat for the rest of the
 * game), a failed first load plays the flat view and then the 3D, a 3D ready during a question comes in after it,
 * and a phone without WebGL 2 plays the flat view and says why.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STAND_ARENA } from '../../../../lib/live/move/protocol';
import { RETRY_MS } from './arenaLoader';
import { usePhoneArena, VIEW_KEY, type PhoneArena } from './arena';
import type { StandSession, StandView } from './session';

const stub = vi.hoisted(() => {
  class Scene {
    canvas: HTMLCanvasElement | null = null;
    disposed = false;
    map: unknown = null;
    mountError: string | null = null;
    mount(canvas: HTMLCanvasElement) {
      this.canvas = canvas;
      return true;
    }
    setMap(map: unknown) {
      this.map = map;
    }
    async warmUp() {}
    dispose() {
      this.disposed = true;
    }
    stats() {
      return null;
    }
  }
  return { Scene, loads: [] as Array<() => Promise<Scene>>, made: [] as Scene[], calls: 0 };
});

vi.mock('./scene3d', () => ({
  PhoneScene: {
    load: () => {
      const next = stub.loads[Math.min(stub.calls, stub.loads.length - 1)];
      stub.calls += 1;
      return next();
    },
  },
}));
vi.mock('./sprites', () => ({
  SpriteView: class {
    disposed = false;
    dispose() {
      this.disposed = true;
    }
  },
}));

const scene = () => {
  const s = new stub.Scene();
  stub.made.push(s);
  return Promise.resolve(s);
};

const hello = { t: 'stand', k: 'hello', v: 1, boss: 'skeleton', q_count: 6, time_s: 20, speed: true, stage: [800, 520, 80], floor: { x: 20, y: 160, tile: 60, cols: 26, rows: 12 }, letters: ['А', 'Б', 'В', 'Г'], alarm_ms: 3000, fall_ms: 900, floor_ms: 4000 };

function room(map: unknown = STAND_ARENA) {
  return { client: { welcome: { map } } } as unknown as StandSession;
}
const view = (): StandView => ({ status: 'open', code: null, lost: false, ready: true, you: 7, hello, state: null, me: null }) as unknown as StandView;

let arena: PhoneArena;
function Screen({ session, v, showing }: { session: StandSession; v: StandView; showing: boolean }) {
  arena = usePhoneArena(session, v, showing);
  return (
    <>
      <canvas key={arena.canvasKey} ref={arena.canvasRef} data-testid="arena3d" data-view3d={arena.view3d} data-why={arena.why ?? undefined} />
      <canvas ref={arena.spritesRef} />
    </>
  );
}

const settle = (ms = 0) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
  stub.loads = [scene];
  stub.made = [];
  stub.calls = 0;
  localStorage.removeItem(VIEW_KEY);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('usePhoneArena with WebGL 2', () => {
  beforeEach(() => {
    vi.stubGlobal('WebGL2RenderingContext', class {});
  });

  it('keeps the 3D through a reconnect: a new welcome with the same map loads nothing again', async () => {
    const session = room();
    const r = render(<Screen session={session} v={view()} showing={false} />);
    await settle();
    expect(arena.view3d).toBe('on');
    const first = arena.scene;
    expect(first).toBe(stub.made[0]);

    // the socket dropped and came back: a new welcome object, the same map, a new snapshot of the view
    (session.client as unknown as { welcome: unknown }).welcome = { map: JSON.parse(JSON.stringify(STAND_ARENA)) };
    r.rerender(<Screen session={session} v={view()} showing={false} />);
    await settle(10_000);
    expect(stub.calls).toBe(1);
    expect(arena.scene).toBe(first);
    expect(stub.made[0].disposed).toBe(false);
    expect(arena.flat).toBe(false);
    expect(r.getByTestId('arena3d').getAttribute('data-view3d')).toBe('on');
  });

  it('builds a different map anew on a new canvas element (never on the one the old scene lost)', async () => {
    const session = room();
    const r = render(<Screen session={session} v={view()} showing={false} />);
    await settle();
    const old = stub.made[0];
    const held = old.canvas;
    (session.client as unknown as { welcome: unknown }).welcome = { map: { ...STAND_ARENA, w: STAND_ARENA.w + 60 } };
    r.rerender(<Screen session={session} v={view()} showing={false} />);
    await settle(10);
    expect(old.disposed).toBe(true);
    expect(stub.calls).toBe(2);
    const fresh = stub.made[1];
    expect(fresh.canvas).not.toBeNull();
    expect(fresh.canvas).not.toBe(held);
    expect(fresh.canvas).toBe(r.getByTestId('arena3d'));
    expect(arena.scene).toBe(fresh);
  });

  it('a failed first load: the flat view with the reason, then the 3D after the next try', async () => {
    stub.loads = [() => Promise.reject(new TypeError('Failed to fetch')), scene];
    const r = render(<Screen session={room()} v={view()} showing={false} />);
    await settle();
    expect(arena.flat).toBe(true);
    expect(arena.sprites).not.toBeNull();
    expect(arena.backdrop).toBe(arena.sprites);
    const el = r.getByTestId('arena3d');
    expect(el.getAttribute('data-view3d')).toBe('retry');
    expect(el.getAttribute('data-why')).toBe('load: TypeError: Failed to fetch');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('live: phone 3D try 1 failed (load: TypeError: Failed to fetch)'));

    await settle(RETRY_MS[0]);
    expect(arena.view3d).toBe('on');
    expect(arena.flat).toBe(false);
    expect(arena.sprites).toBeNull();
    expect(arena.backdrop).toBe(stub.made[0]);
    expect(r.getByTestId('arena3d').hasAttribute('data-why')).toBe(false);
  });

  it('a 3D ready during a question comes in after it: the flat view to the end of the question', async () => {
    let arrive!: () => void;
    stub.loads = [() => new Promise((ok) => (arrive = () => void scene().then(ok)))];
    const session = room();
    const r = render(<Screen session={session} v={view()} showing />);
    await settle(30_000);
    expect(arena.view3d).toBe('loading');
    expect(arena.flat).toBe(true);
    expect(arena.backdrop).toBe(arena.sprites);

    arrive();
    await settle();
    expect(arena.view3d).toBe('ready');
    expect(arena.scene).toBeNull();
    expect(arena.backdrop).toBe(arena.sprites);

    r.rerender(<Screen session={session} v={view()} showing={false} />);
    await settle();
    expect(arena.view3d).toBe('on');
    expect(arena.scene).toBe(stub.made[0]);
    expect(arena.flat).toBe(false);
    expect(console.info).toHaveBeenCalledWith('live: phone 3D on');
  });

  it('a device that pinned the flat view plays it and says so', async () => {
    localStorage.setItem(VIEW_KEY, '2d');
    const r = render(<Screen session={room()} v={view()} showing={false} />);
    await settle(10_000);
    expect(stub.calls).toBe(0);
    expect(arena.flat).toBe(true);
    expect(r.getByTestId('arena3d').getAttribute('data-view3d')).toBe('off');
    expect(r.getByTestId('arena3d').getAttribute('data-why')).toBe('the device pinned the flat view (meldy.live.view = 2d)');
  });
});

describe('usePhoneArena without WebGL 2', () => {
  it('plays the flat view for good, loads no 3D, and says why', async () => {
    vi.stubGlobal('WebGL2RenderingContext', undefined);
    const r = render(<Screen session={room()} v={view()} showing={false} />);
    await settle(60_000);
    expect(stub.calls).toBe(0);
    expect(arena.flat).toBe(true);
    expect(arena.sprites).not.toBeNull();
    expect(r.getByTestId('arena3d').getAttribute('data-view3d')).toBe('off');
    expect(r.getByTestId('arena3d').getAttribute('data-why')).toBe('no WebGL 2');
    expect(console.warn).toHaveBeenCalledWith('live: phone 3D off (no WebGL 2): the flat view plays');
  });
});
