/**
 * Dev-only preview of the 3D kit (frontend/scripts/game-preview.html, served by `npm run dev` at
 * /scripts/game-preview.html; never imported by the app, so never in the build).
 *
 *   ?scene=lineup              8 characters and both bosses
 *   ?scene=arena&boss=clock    mode A: 30 players run to the zones, the stomp, the collapse, ghosts (a 9 s loop)
 *   ?scene=bench&players=40    the perf scene: players run about, the floor drops and comes back
 *     &grid                    on the server's map and floor grid (MODE_STAND §3) instead of the style board's
 *     &look=phone              the phone's arena: smaller signs, simpler tiles (stand/phone/scene3d.ts)
 *   ?scene=thumbs              renders the phone's pictures (scripts/game-thumbs.mjs drives it)
 *   ?scene=bossthumbs          renders the bosses' pictures for the game's setup (game-kit.mjs bosses)
 *   &capture                   no loop: window.__render(t) draws the state at t seconds (screenshots)
 *   &fps                       shows the frame rate (to check on a real projector laptop)
 */
import '@fontsource-variable/onest/wght.css';
import * as THREE from 'three';
import { KitImpl } from '../internal/game3d';
import { CrowdPlayer } from '../internal/crowd';
import { ACCESSORIES, BODY_OPTIONS, COLOUR_OPTIONS, HAT_OPTIONS, MODELS, PALETTE, type KitHatId, type PlayerLook } from '../look';
import { rng, type MoveMap } from '../arenaPlan';
import { toon, hullMaterial, FONT } from '../internal/materials';
import type { Boss, BossKind, Player, View } from '../types';
import type { ColourId } from '../../types';
import { paintThumb, thumbUrl } from '../thumbs';
import { STAGE_BOSS_HEIGHT } from '../constants';

const Q = new URLSearchParams(location.search);
const SCENE = Q.get('scene') ?? 'lineup';
const CAPTURE = Q.has('capture');
const W = Number(Q.get('w') ?? 1536);
const H = Number(Q.get('h') ?? 864);

declare global {
  interface Window {
    __ready?: boolean;
    __error?: string;
    __render?: (t: number) => void;
    __stats?: () => unknown;
    __resetStats?: () => void;
    __bench?: (frames: number) => unknown;
    __thumb?: (model: string, hat: string) => string;
    __bossThumb?: (kind: BossKind) => Promise<string>;
    __kit?: KitImpl;
  }
}

/** Mode A's map as the style board drew it: four answer zones in the corners, a corridor between them. */
export const MODE_A_MAP: MoveMap = {
  w: 1600,
  h: 900,
  zones: [
    { id: 'A', rect: [100, 100, 600, 300] },
    { id: 'B', rect: [900, 100, 600, 300] },
    { id: 'C', rect: [100, 500, 600, 300] },
    { id: 'D', rect: [900, 500, 600, 300] },
  ],
  solids: [],
  spawns: [[800, 450]],
};

/** The room's map of mode A and the hello's floor and stage (MODE_STAND.md §3): what the projector and phones draw. */
export const SERVER_MAP: MoveMap = {
  w: 1600,
  h: 900,
  solids: [{ rect: [0, 0, 1600, 160] }, { rect: [0, 160, 20, 740] }, { rect: [1580, 160, 20, 740] }, { rect: [0, 880, 1600, 20] }, { circle: [800, 520, 80] }],
  zones: [
    { id: 'A', rect: [80, 220, 600, 240] },
    { id: 'B', rect: [920, 220, 600, 240] },
    { id: 'C', rect: [80, 580, 600, 240] },
    { id: 'D', rect: [920, 580, 600, 240] },
  ],
  spawns: [[560, 520], [1040, 520], [800, 360], [800, 680]],
};
const SERVER_SHAPE = { floor: { x: 20, y: 160, tile: 60, cols: 26, rows: 12 }, stage: [800, 520, 80] };

const NAMES = [
  'Алина', 'Артём', 'Ева', 'Миша', 'Соня', 'Тимур', 'Вера', 'Глеб', 'Даша', 'Егор', 'Катя', 'Лёва', 'Маша', 'Никита', 'Оля',
  'Паша', 'Рита', 'Саша', 'Таня', 'Федя', 'Юля', 'Ярик', 'Лиза', 'Илья', 'Дима', 'Аня', 'Костя', 'Женя', 'Вика', 'Роман',
  'Полина', 'Стас', 'Ксюша', 'Денис', 'Настя', 'Гоша', 'Лена', 'Марк', 'Ира', 'Влад', 'Кира', 'Лёша', 'Зоя', 'Петя',
];

function lookFor(i: number): PlayerLook {
  const body = BODY_OPTIONS[i % BODY_OPTIONS.length].id;
  const colour = PALETTE[(i * 3 + 1) % PALETTE.length].id;
  const hat = HAT_OPTIONS[(i * 5 + 3) % HAT_OPTIONS.length].id;
  return { body, colour, hat };
}

const stage = document.getElementById('stage') as HTMLDivElement;
const hud = document.getElementById('hud') as HTMLDivElement;
const canvas = document.getElementById('c') as HTMLCanvasElement;
stage.style.width = `${W}px`;
stage.style.height = `${H}px`;

function fpsMeter(view: View): void {
  if (!Q.has('fps')) return;
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;right:12px;bottom:12px;background:#000c;color:#fff;font:700 16px ${FONT};padding:6px 10px;border-radius:8px;z-index:9`;
  document.body.appendChild(el);
  setInterval(() => {
    const s = view.stats();
    el.textContent = `${s.fps.toFixed(0)} кадр/с · ${s.frameMs.p95.toFixed(1)} мс p95 · JS ${s.cpuMs.mean.toFixed(2)} мс · ${s.drawCalls} вызовов · уровень ${s.quality}`;
  }, 500);
}

function easeOutBack(k: number): number {
  const x = Math.max(0, Math.min(1, k));
  const c1 = 1.70158;
  return 1 + (c1 + 1) * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

// ------------------------------------------------------------------ lineup
async function lineup(): Promise<void> {
  const kit = (await KitImpl.load({ boss: 'skeleton' })) as KitImpl;
  window.__kit = kit;
  const view = kit.mount(canvas, { preserveDrawingBuffer: CAPTURE, quality: 0 });
  const scene = kit.scene;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), toon('#2a2557', kit.ramp));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(16, 0, 9);
  scene.add(floor);
  scene.fog = null;
  const picks: { look: PlayerLook; name: string; pose: Parameters<Player['setPose']>[0] }[] = [
    { look: { body: 'square', colour: 'pink', hat: 'phones' }, name: 'Алина', pose: 'cheer' },
    { look: { body: 'drop', colour: 'blue', hat: 'flower' }, name: 'Артём', pose: 'idle' },
    { look: { body: 'round', colour: 'yellow', hat: 'party' }, name: 'Ева', pose: 'run' },
    { look: { body: 'bean', colour: 'green', hat: 'propeller' }, name: 'Миша', pose: 'wave' },
    { look: { body: 'cloud', colour: 'orange', hat: 'none' }, name: 'Соня', pose: 'idle' },
    { look: { body: 'square', colour: 'violet', hat: 'antenna' }, name: 'Вера', pose: 'cheer' },
    { look: { body: 'drop', colour: 'teal', hat: 'crown' }, name: 'Глеб', pose: 'idle' },
    { look: { body: 'round', colour: 'sky', hat: 'grad' }, name: 'Маша', pose: 'idle' },
  ];
  const n = picks.length;
  const spacing = 92;
  const cx = 800;
  const players = picks.map((p, k) => {
    const x = cx + (k - (n - 1) / 2) * spacing;
    const y = 520 - Math.pow((x - cx) / 330, 2) * 60;
    const pl = kit.createPlayer(p.look, p.name);
    pl.setPosition(x, y, 16);
    pl.setFacing(-(x - cx) * 0.0012, true);
    pl.setPose(p.pose);
    const hex = COLOUR_OPTIONS.find((c) => c.id === p.look.colour)?.hex ?? '#fff';
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.8, 0.3, 40), toon(hex, kit.ramp));
    ped.position.set(x / 50, 0.15, y / 50);
    const hull = new THREE.Mesh(ped.geometry, hullMaterial(kit.shared));
    ped.add(hull);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.66, 0.04, 40), toon('#ffffff', kit.ramp));
    top.position.set(x / 50, 0.31, y / 50);
    scene.add(ped, top);
    return pl;
  });
  const skel = kit.createBoss('skeleton');
  skel.setPosition(cx - 470, -40);
  skel.setFacing(0.4);
  const clock = kit.createBoss('clock');
  clock.setPosition(cx + 470, -60);
  clock.setFacing(-0.35);
  clock.setPhase('roar');
  view.setCamera({ eye: { x: cx, y: 1320, z: 260 }, target: { x: cx, y: 330, z: 140 }, fov: 32 });
  hud.innerHTML = `<div class="title"><h1>Персонажи и босс «Дедлайн»</h1><p>Герои KayKit: свой цвет одежды и аксессуар. Босса выбирает учитель: скелет или будильник.</p></div>`;
  const tagsHtml = () => '';
  void tagsHtml;
  void players;
  finish(kit, view, () => undefined);
}

// ------------------------------------------------------------------ every body with every hat (QA)
async function hats(): Promise<void> {
  const kit = (await KitImpl.load()) as KitImpl;
  window.__kit = kit;
  const view = kit.mount(canvas, { preserveDrawingBuffer: CAPTURE, quality: 0 });
  kit.scene.fog = null;
  const hatIds = HAT_OPTIONS.map((h) => h.id);
  BODY_OPTIONS.forEach((b, row) => {
    hatIds.forEach((hat, col) => {
      const p = kit.createPlayer({ body: b.id, colour: PALETTE[(row + col) % PALETTE.length].id, hat }, hat);
      p.setPosition(160 + col * 110, 200 + row * 150, 0);
      p.setFacing(0.25, true);
    });
  });
  kit.tags.enabled = false;
  view.setCamera({ eye: { x: 820, y: 1500, z: 700 }, target: { x: 820, y: 470, z: 60 }, fov: 34 });
  finish(kit, view, () => undefined);
}

// ------------------------------------------------------------------ arena (mode A)
interface Plan {
  player: Player;
  zone: number;
  start: THREE.Vector2;
  ctrl: THREE.Vector2;
  target: THREE.Vector2;
  delay: number;
  arrive: number;
  face: number;
  cheerDelay: number;
  ghostLag: number;
  fellAt: number;
}

const T_WARN = 2.6;
const T_STOMP = 4.1;
const T_END = 9.2;

async function arena(count: number, bench: boolean): Promise<void> {
  const bossKind = (Q.get('boss') ?? 'skeleton') as BossKind;
  const kit = (await KitImpl.load({ boss: bossKind })) as KitImpl;
  window.__kit = kit;
  const view = kit.mount(canvas, { preserveDrawingBuffer: CAPTURE, quality: Q.has('q') ? Number(Q.get('q')) : 'auto' });
  const grid = Q.has('grid');
  const map = grid ? SERVER_MAP : MODE_A_MAP;
  const ar = kit.createArena(map, grid ? SERVER_SHAPE : undefined, Q.get('look') === 'phone' ? { signScale: 0.7, tileSegments: 1 } : undefined);
  ar.setZoneLabels({ A: 'Меркурий', B: 'Венера', C: 'Марс', D: 'Земля' });
  const boss: Boss = kit.createBoss(bossKind, grid ? { height: STAGE_BOSS_HEIGHT[bossKind] } : {});
  view.setCamera({ arena: map, margins: { top: bench ? 0 : 0.11 } });
  const r = rng(42);
  const zones = map.zones ?? [];
  // how many run to each zone
  const shares = [0.4, 0.25, 0.2, 0.15];
  const zoneFor: number[] = [];
  shares.forEach((s, zi) => {
    for (let k = 0; k < Math.round(s * count); k++) zoneFor.push(zi);
  });
  while (zoneFor.length < count) zoneFor.push(0);
  for (let i = zoneFor.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [zoneFor[i], zoneFor[j]] = [zoneFor[j], zoneFor[i]];
  }
  const used = [0, 0, 0, 0];
  const per = shares.map((s) => Math.max(1, Math.round(s * count)));
  const plans: Plan[] = [];
  for (let i = 0; i < count; i++) {
    const zi = zoneFor[i];
    const [zx, zy, zw, zh] = zones[zi].rect;
    const k = used[zi]++;
    const cols = Math.ceil(Math.sqrt(per[zi] * (zw / zh)));
    const rows = Math.ceil(per[zi] / cols);
    const cx = zx + 50 + ((k % cols) + 0.5) * ((zw - 100) / cols) + (r() - 0.5) * 30;
    const cy = zy + 70 + (Math.floor(k / cols) + 0.5) * ((zh - 140) / rows) + (r() - 0.5) * 24;
    const a = r() * Math.PI * 2;
    const rad = 30 + r() * 160;
    const start = new THREE.Vector2(800 + Math.cos(a) * rad * 1.6, 470 + Math.sin(a) * rad * 0.5);
    const target = new THREE.Vector2(cx, cy);
    const late = i % 13 === 5;
    const delay = late ? 1.4 + r() * 0.3 : 0.1 + r() * 0.6;
    const speed = late ? 120 : 230 + r() * 50;
    const ctrl = start.clone().lerp(target, 0.5);
    const dir = target.clone().sub(start).normalize();
    const side = (r() - 0.5) * 140;
    ctrl.x += -dir.y * side;
    ctrl.y += dir.x * side;
    const player = kit.createPlayer(lookFor(i), NAMES[i % NAMES.length]);
    plans.push({ player, zone: zi, start, ctrl, target, delay, arrive: delay + start.distanceTo(target) / speed, face: (r() - 0.5) * 1.2, cheerDelay: r() * 0.5, ghostLag: 0.42 + r() * 0.3, fellAt: Infinity });
  }
  const bez = (p: Plan, k: number, out: THREE.Vector2) => {
    const a = (1 - k) * (1 - k);
    const b = 2 * (1 - k) * k;
    const c = k * k;
    return out.set(a * p.start.x + b * p.ctrl.x + c * p.target.x, a * p.start.y + b * p.ctrl.y + c * p.target.y);
  };
  const pos = new THREE.Vector2();
  const ahead = new THREE.Vector2();
  let impactAt = Infinity;
  let phase = 0;
  let lastLoop = 0;
  let stomped = false;
  const correct = 'A';
  const correctIndex = 0;

  // the scripted round
  const script = (_dt: number, now: number) => {
    let T = now - lastLoop;
    if (!bench && T > T_END) {
      lastLoop = now;
      T = 0;
      ar.restore();
      stomped = false;
      impactAt = Infinity;
      boss.setPhase('idle');
      for (const p of plans) {
        p.fellAt = Infinity;
        p.player.setGhost(false);
      }
      phase = 0;
    }
    if (bench) {
      // keep everyone moving; a collapse every 6 s, back 3 s later
      const cycle = now % 6;
      if (cycle < phase) {
        boss.setPhase('stomp');
        impactAt = now + boss.stompImpactS;
        ar.collapse(['A', 'B', 'C', 'D'][Math.floor(now / 6) % 4], impactAt);
      }
      if (cycle >= 3 && phase < 3) ar.restore();
      phase = cycle;
      for (let i = 0; i < plans.length; i++) {
        const p = plans[i];
        const a = now * (0.35 + (i % 7) * 0.05) + i;
        const x = 800 + Math.cos(a) * (200 + (i % 9) * 60);
        const y = 450 + Math.sin(a * 1.3) * (120 + (i % 5) * 50);
        p.player.setPosition(x, y, 0);
        p.player.setFacing(Math.atan2(-Math.sin(a), Math.cos(a) * 1.3));
        p.player.setPose(i % 11 === 0 ? 'cheer' : 'run');
      }
      return;
    }
    if (T >= T_WARN && phase < 1) {
      phase = 1;
      boss.setPhase('warn');
    }
    if (T >= T_STOMP && !stomped) {
      stomped = true;
      boss.setPhase('stomp');
      impactAt = now + boss.stompImpactS;
      ar.collapse(correct, impactAt);
    }
    for (const p of plans) {
      let z = 0;
      let pose: Parameters<Player['setPose']>[0] = 'idle';
      if (T < p.delay) {
        pos.copy(p.start);
        p.player.setFacing(Math.atan2(p.target.x - p.start.x, p.target.y - p.start.y) * 0.3);
      } else if (T < p.arrive) {
        const k = (T - p.delay) / (p.arrive - p.delay);
        bez(p, k, pos);
        bez(p, Math.min(1, k + 0.02), ahead);
        p.player.setFacing(Math.atan2(ahead.x - pos.x, ahead.y - pos.y));
        pose = 'run';
      } else {
        pos.copy(p.target);
        p.player.setFacing(p.face);
      }
      const floor = ar.floorAt(pos.x, pos.y);
      if (floor < 0 && p.fellAt === Infinity) p.fellAt = now;
      if (p.fellAt !== Infinity) {
        const u = now - p.fellAt;
        if (u < p.ghostLag) {
          pose = 'fall';
          z = floor;
        } else {
          p.player.setGhost(true);
          z = -130 + 185 * easeOutBack((u - p.ghostLag) / 1.2);
          pose = 'idle';
          p.player.setFacing(0.3 * Math.sin(now * 1.3 + p.cheerDelay * 10));
        }
      } else if (p.zone === correctIndex && now > impactAt - 0.1) {
        pose = now < impactAt + 0.45 ? 'hit' : now > impactAt + 0.6 + p.cheerDelay ? 'cheer' : 'idle';
        if (pose === 'cheer') p.player.setFacing(0, false);
      }
      p.player.setPosition(pos.x, pos.y, z);
      p.player.setPose(pose);
    }
    if (!bench) drawHud(T, now >= impactAt + 0.3, plans);
  };
  const drawHud = (T: number, after: boolean, list: Plan[]) => {
    const alive = list.filter((p) => p.fellAt === Infinity).length;
    const ghosts = list.length - alive;
    const sec = Math.max(0, Math.ceil(12 * (1 - T / (T_STOMP + 0.3))));
    hud.innerHTML = `
      <div class="brand"><b>Meldy<span>.</span></b><div class="mode">Встань на ответ</div><div class="sub">Вопрос 3 из 10</div></div>
      <div class="q">${after
        ? `<div class="hint">Верный ответ</div><div class="ans"><em style="background:#ff6f61">А</em>Меркурий</div>`
        : `<div class="hint">Беги на верный ответ. Остальной пол провалится</div><div class="text">Какая планета ближе всего к Солнцу?</div>`}</div>
      <div class="right"><div class="pills"><div class="pill"><span class="dot"></span>Живы <b>${alive}</b></div>${ghosts ? `<div class="pill"><span class="dot g"></span>Призраки <b>${ghosts}</b></div>` : ''}</div>
      ${after ? '' : `<div class="timer ${sec <= 3 ? 'hot' : ''}">${sec}</div>`}</div>`;
  };
  void lastLoop;
  finish(kit, view, script);
  window.__bench = (frames: number) => {
    view.stop();
    const v = view as unknown as { renderOnce(dt: number): void; renderer: THREE.WebGLRenderer };
    const gl = v.renderer.getContext();
    const total: number[] = [];
    const update: number[] = [];
    const draw: number[] = [];
    const calls: number[] = [];
    let tris = 0;
    const dt = 1 / 60;
    for (let i = 0; i < frames; i++) {
      // wait for the GPU first, so the time below is JavaScript and handing the calls over, never a full queue
      gl.finish();
      const t0 = performance.now();
      script(dt, kit.now());
      kit.update(dt);
      const t1 = performance.now();
      v.renderOnce(dt);
      const t2 = performance.now();
      total.push(t2 - t0);
      update.push(t1 - t0);
      draw.push(t2 - t1);
      calls.push(v.renderer.info.render.calls);
      tris = Math.max(tris, v.renderer.info.render.triangles);
    }
    const stat = (list: number[]) => {
      const sorted = list.slice().sort((a, b) => a - b);
      return { mean: list.reduce((a, b) => a + b, 0) / list.length, p50: sorted[Math.floor(list.length * 0.5)], p95: sorted[Math.floor(list.length * 0.95)], max: sorted[list.length - 1] };
    };
    return { frames, players: count, total: stat(total), update: stat(update), draw: stat(draw), drawCallsMax: Math.max(...calls), drawCallsMean: calls.reduce((a, b) => a + b, 0) / frames, triangles: tris };
  };
}

// ------------------------------------------------------------------ the phone's pictures, tinted (QA of thumbs.ts)
async function thumbSheet(): Promise<void> {
  canvas.style.display = 'none';
  stage.style.background = '#f3f3f0';
  stage.style.display = 'grid';
  stage.style.gridTemplateColumns = `repeat(${HAT_OPTIONS.length}, 1fr)`;
  stage.style.alignContent = 'start';
  const jobs: Promise<void>[] = [];
  BODY_OPTIONS.forEach((b, row) => {
    HAT_OPTIONS.forEach((h, col) => {
      const img = new Image();
      const out = document.createElement('canvas');
      out.style.width = '100%';
      stage.appendChild(out);
      const colour = PALETTE[(row * 3 + col) % PALETTE.length].id;
      jobs.push(
        new Promise<void>((done) => {
          img.onload = () => {
            paintThumb(out, img, colour);
            done();
          };
          img.onerror = () => done();
          img.src = thumbUrl(b.id, h.id);
        }),
      );
    });
  });
  await Promise.all(jobs);
  window.__render = () => undefined;
  window.__stats = () => ({ drawCalls: 0, triangles: 0 });
  window.__ready = true;
}

// ------------------------------------------------------------------ the bosses' pictures (the setup's choice)
async function bossThumbs(): Promise<void> {
  const size = Number(Q.get('size') ?? 420);
  canvas.width = size;
  canvas.height = size;
  stage.style.width = `${size}px`;
  stage.style.height = `${size}px`;
  const kit = (await KitImpl.load({ boss: 'skeleton' })) as KitImpl;
  window.__kit = kit;
  const view = kit.mount(canvas, { transparent: true, preserveDrawingBuffer: true, quality: 0, maxPixelRatio: 1 });
  kit.blobs.enabled = false;
  kit.tags.enabled = false;
  view.setCamera({ eye: { x: 0, y: 760, z: 330 }, target: { x: 0, y: 0, z: 150 }, fov: 30 });
  let current: Boss | null = null;
  window.__bossThumb = async (kind: BossKind) => {
    current?.dispose();
    if (kind === 'skeleton') await kit.loadBoss('skeleton');
    current = kit.createBoss(kind, { height: 5.4 });
    current.setPosition(0, 0);
    current.setFacing(kind === 'skeleton' ? 0.35 : -0.3);
    for (let i = 0; i < 40; i++) kit.update(1 / 30);
    (view as unknown as { renderOnce(): void }).renderOnce();
    // crop to the drawn pixels, square, a little air round them
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const cg = copy.getContext('2d') as CanvasRenderingContext2D;
    cg.drawImage(canvas, 0, 0);
    const px = cg.getImageData(0, 0, copy.width, copy.height).data;
    let x0 = copy.width, y0 = copy.height, x1 = 0, y1 = 0;
    for (let y = 0; y < copy.height; y++)
      for (let x = 0; x < copy.width; x++)
        if (px[(y * copy.width + x) * 4 + 3] > 8) {
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
    const side = Math.max(x1 - x0, y1 - y0) * 1.08;
    const out = document.createElement('canvas');
    out.width = 200;
    out.height = 200;
    const og = out.getContext('2d') as CanvasRenderingContext2D;
    const k = 200 / side;
    og.drawImage(copy, x0, y0, x1 - x0, y1 - y0, (200 - (x1 - x0) * k) / 2, 200 - (y1 - y0) * k - 4, (x1 - x0) * k, (y1 - y0) * k);
    return out.toDataURL('image/webp', Number(Q.get('quality') ?? 0.86));
  };
  window.__ready = true;
}

// ------------------------------------------------------------------ thumbnails
async function thumbs(): Promise<void> {
  const size = Number(Q.get('size') ?? 160);
  canvas.width = size;
  canvas.height = size;
  stage.style.width = `${size}px`;
  stage.style.height = `${size}px`;
  const kit = (await KitImpl.load()) as KitImpl;
  window.__kit = kit;
  const view = kit.mount(canvas, { transparent: true, preserveDrawingBuffer: true, quality: 0, maxPixelRatio: 1 });
  kit.blobs.enabled = false;
  kit.tags.enabled = false;
  view.setCamera({ eye: { x: 0, y: 300, z: 92 }, target: { x: 0, y: 0, z: 62 }, fov: 30 });
  const out = document.createElement('canvas');
  out.width = size * 2;
  out.height = size;
  const g = out.getContext('2d') as CanvasRenderingContext2D;
  window.__thumb = (model: string, hat: string) => {
    const body = BODY_OPTIONS[MODELS.indexOf(model as (typeof MODELS)[number])].id;
    const player = kit.createPlayer({ body, colour: 'blue' as ColourId, hat: hat as KitHatId }, '') as CrowdPlayer;
    player.overrideTint('#ffffff');
    player.setPosition(0, 0, 0);
    player.setFacing(0.32, true);
    // a moment of the idle clip with the arms down
    player.update(0.5);
    kit.update(0);
    kit.shared.kitMask.value = 0;
    (view as unknown as { renderOnce(): void }).renderOnce();
    g.clearRect(0, 0, size * 2, size);
    g.drawImage(canvas, 0, 0);
    kit.shared.kitMask.value = 1;
    (view as unknown as { renderOnce(): void }).renderOnce();
    g.drawImage(canvas, size, 0);
    kit.shared.kitMask.value = 0;
    player.dispose();
    return out.toDataURL('image/webp', Number(Q.get('quality') ?? 0.82));
  };
  window.__ready = true;
}

function finish(kit: KitImpl, view: View, onFrame: (dt: number, now: number) => void): void {
  fpsMeter(view);
  window.__stats = () => view.stats();
  window.__resetStats = () => (view as unknown as { resetStats(): void }).resetStats();
  if (CAPTURE) {
    let now = 0;
    window.__render = (t: number) => {
      // step the whole simulation to t, then draw once
      const dt = 1 / 60;
      while (now + dt <= t + 1e-9) {
        onFrame(dt, kit.now());
        kit.update(dt);
        now += dt;
      }
      (view as unknown as { renderOnce(): void }).renderOnce();
    };
    view.warmUp().then(() => {
      window.__ready = true;
    });
  } else {
    view.warmUp().then(() => {
      view.start(onFrame);
      window.__ready = true;
    });
  }
}

(async () => {
  try {
    await document.fonts.ready;
    if (SCENE === 'lineup') await lineup();
    else if (SCENE === 'arena') await arena(Number(Q.get('players') ?? 30), false);
    else if (SCENE === 'bench') await arena(Number(Q.get('players') ?? 40), true);
    else if (SCENE === 'thumbs') await thumbs();
    else if (SCENE === 'bossthumbs') await bossThumbs();
    else if (SCENE === 'hats') await hats();
    else if (SCENE === 'thumbsheet') await thumbSheet();
    void ACCESSORIES;
  } catch (e) {
    console.error(e);
    window.__error = String((e as Error)?.stack ?? e);
  }
})();
