#!/usr/bin/env node
/**
 * The landing reel's pointer, checked in a real browser at the reel's sizes (owner, 21.10: «большинство нажатий на
 * кнопки кривые… перетаскивания в конструкторе тоже очень кривые»). jsdom has no layout, so this runs Chromium on the
 * landing page with the reel in its frame-exporter mode (window.__MELDY_REEL_EXPORT__: no autoplay, the clock stepped
 * by window.__meldyReel) and, for every key of every scene's pointer (Reel3 POINTER_KEYS3):
 *
 *   a press   the pointer's tip, at the press, is inside the target (elementFromPoint finds the target there), well off
 *             its edges; the pointer is fully shown; the target is not pressed 30 ms before and is pressed 20 ms after;
 *             a target with data-aim-on="<class>" (an option picked, a tab chosen) has that class 50 ms after, not before;
 *   a drag    the tip is on the handle when the button goes down; the carried block keeps the same point under the tip
 *             all the way (sampled through the drag); the drop target is lit just before the button comes up, and the
 *             tip is then inside the place the block lands;
 *   motion    no jump: stepped every 16 ms through each scene, the shown pointer never moves more than a hand can in a
 *             frame (STEP UI px); and no move squeezed below SQUEEZE of the time Fitts's law gives its distance.
 *
 * node scripts/reel3-pointer-check.mjs [--url http://127.0.0.1:5173/] [--sizes desktop,tablet,phone] [--frames dir]
 *   --url     a running dev or preview server (default: a vite dev server is started on a free port);
 *   --frames  also writes five frames around every press and drag, per size: <dir>/<size>/<scene>-<n>-<aim>-<i>.jpg.
 * Playwright: the project's own package if installed, else a global one; Chromium from PLAYWRIGHT_CHROMIUM, else
 * /opt/pw-browsers, else Playwright's own. Exit 1 on any failure.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const SIZES = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 820, height: 1180 },
  phone: { width: 390, height: 844 },
};
/** Off the target's edges by this share of its smaller side (at most 3 px). */
const EDGE = 0.15;
/** A shown pointer never moves more than this in 16 ms (UI px: the scene's product box is 380 wide at every size). */
const STEP = 36;
/** The carried block's point under the tip may drift this much (px). */
const FOLLOW = 1;
/** A move takes at least this share of the time Fitts's law gives it (pointer3.tsx moveTime). */
const SQUEEZE = 0.6;

const args = process.argv.slice(2);
const arg = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const sizes = (arg('sizes') ?? 'desktop,tablet,phone').split(',');
const framesDir = arg('frames');

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return createRequire(join(globalRoot, 'noop.js'))('playwright');
  }
}

function chromiumPath() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const base = '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  const dir = readdirSync(base).filter((name) => /^chromium-\d+$/.test(name)).sort().pop();
  const exe = dir ? join(base, dir, 'chrome-linux', 'chrome') : undefined;
  return exe && existsSync(exe) ? exe : undefined;
}

let server = null;
let url = arg('url');
if (!url) {
  const { createServer } = await import('vite');
  // Its own dependency cache: a dev server already running on this checkout keeps its own.
  server = await createServer({
    root,
    configFile: join(root, 'vite.config.ts'),
    cacheDir: join(tmpdir(), 'reel3-pointer-check-vite'),
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0 },
  });
  await server.listen();
  url = server.resolvedUrls.local[0];
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ executablePath: chromiumPath() });
const failures = [];
const fail = (size, what) => {
  failures.push(`${size}: ${what}`);
  console.log(`  FAIL ${what}`);
};

/** A fresh dev server finds the reel's dependencies as its scenes load and reloads the page once it has: every scene is
 * put on the stage once before the checks, and the page given time to settle. */
async function warmUp() {
  const page = await browser.newPage({ viewport: SIZES.desktop });
  await page.addInitScript(() => {
    window.__MELDY_REEL_EXPORT__ = true;
  });
  for (let round = 0; round < 2; round += 1) {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__meldyReel, null, { timeout: 120000 });
    const scenes = await page.evaluate(() => window.__meldyReel.scenes);
    for (const scene of scenes) {
      await page.evaluate((t) => window.__meldyReel?.seek(t), (scene.from + scene.to) / 2).catch(() => undefined);
    }
    await page.waitForTimeout(3000);
  }
  await page.close();
}
if (server) await warmUp();

/** Reads, in the page, the pointer's tip and the target of a key in one scene's gate (frame px). */
function probe({ scene, aim }) {
  const gate = document.querySelector(`.r3-gate[data-scene="${scene}"]`);
  const cursor = gate?.querySelector('.r3-cursor');
  const target = gate?.querySelector(`[data-aim="${aim}"]`);
  if (!gate || !cursor || !target) return { missing: true };
  const c = cursor.getBoundingClientRect();
  const tip = { x: c.left + (c.width * 5) / 24, y: c.top + (c.height * 3) / 24 };
  const r = target.getBoundingClientRect();
  const hit = document.elementFromPoint(tip.x, tip.y);
  const frame = document.querySelector('.r3-frame').getBoundingClientRect();
  return {
    tip,
    rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
    hit: !!hit && (hit === target || target.contains(hit)),
    shown: Number(getComputedStyle(cursor).opacity),
    classes: Array.from(target.classList),
    on: target.getAttribute('data-aim-on'),
    frame: { left: frame.left, top: frame.top, width: frame.width, height: frame.height },
  };
}

/** The carried block under the tip (its corner minus the tip), or null. */
function carried({ scene }) {
  const gate = document.querySelector(`.r3-gate[data-scene="${scene}"]`);
  const cursor = gate?.querySelector('.r3-cursor');
  if (!cursor) return null;
  const c = cursor.getBoundingClientRect();
  const tip = { x: c.left + (c.width * 5) / 24, y: c.top + (c.height * 3) / 24 };
  for (const el of gate.querySelectorAll('.r3-carried')) {
    if (Number(getComputedStyle(el).opacity) < 0.5) continue;
    const r = el.getBoundingClientRect();
    if (tip.x >= r.left && tip.x <= r.right && tip.y >= r.top && tip.y <= r.bottom) return { dx: r.left - tip.x, dy: r.top - tip.y, w: r.width };
  }
  return null;
}

const inside = (p, r) => {
  const margin = Math.min(3, EDGE * Math.min(r.width, r.height));
  return p.tip.x >= r.left + margin && p.tip.x <= r.right - margin && p.tip.y >= r.top + margin && p.tip.y <= r.bottom - margin;
};

for (const size of sizes) {
  const viewport = SIZES[size];
  if (!viewport) throw new Error(`Unknown size ${size}`);
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    window.__MELDY_REEL_EXPORT__ = true;
  });
  page.on('pageerror', (error) => fail(size, `page error: ${error.message}`));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__meldyReel, null, { timeout: 90000 });
  await page.evaluate(() => document.fonts.ready);
  const frameEl = page.locator('.r3-frame');
  await frameEl.scrollIntoViewIfNeeded();
  const { scenes, pointers, layout } = await page.evaluate(() => ({
    scenes: window.__meldyReel.scenes,
    pointers: window.__meldyReel.pointers,
    layout: document.querySelector('.r3-frame').getAttribute('data-layout'),
  }));
  const frameBox = await frameEl.boundingBox();
  console.log(`\n${size} ${viewport.width}×${viewport.height}: the ${layout} stage in a ${Math.round(frameBox.width)} px frame`);
  const seek = (t) => page.evaluate((time) => window.__meldyReel.seek(time), t);
  const shoot = async (name) => {
    if (!framesDir) return;
    const dir = join(framesDir, size);
    mkdirSync(dir, { recursive: true });
    await frameEl.screenshot({ path: join(dir, `${name}.jpg`), type: 'jpeg', quality: 82 });
  };

  let presses = 0;
  let drags = 0;
  for (const [scene, keys] of Object.entries(pointers)) {
    const window3 = scenes.find((item) => item.id === scene);
    for (let n = 0; n < keys.length; n += 1) {
      const key = keys[n];
      if (!key.press && !key.down && !key.up) continue;
      const t = window3.from + key.t;
      const label = `${scene} ${key.press ? 'press' : key.down ? (key.outside ? 'down (from outside)' : 'down') : 'up'} ${key.aim} @${t}`;
      await seek(t - 30);
      const before = await page.evaluate(probe, { scene, aim: key.aim });
      await seek(t + 20);
      const now = await page.evaluate(probe, { scene, aim: key.aim });
      if (now.missing || before.missing) {
        fail(size, `${label}: the pointer or the target is not on the stage`);
        continue;
      }
      const offX = now.tip.x - now.rect.left;
      const offY = now.tip.y - now.rect.top;
      const where = `tip ${offX.toFixed(1)},${offY.toFixed(1)} in ${now.rect.width.toFixed(0)}×${now.rect.height.toFixed(0)}`;
      const problems = [];
      if (key.outside) {
        // A file brought from outside the page: the pointer comes in from off the frame, the file in hand.
        const f = now.frame;
        const off = now.tip.x < f.left || now.tip.x > f.left + f.width || now.tip.y < f.top || now.tip.y > f.top + f.height;
        if (!off) problems.push('a file from outside the page, yet the pointer starts inside the frame');
      } else {
        if (!inside(now, now.rect)) problems.push('tip outside the target');
        if (now.shown < 0.99) problems.push(`pointer at opacity ${now.shown}`);
      }
      if ((key.press || key.down) && !key.outside && !now.hit) problems.push('elementFromPoint at the tip is not the target');
      if (key.press) {
        presses += 1;
        if (before.classes.includes('is-pressed')) problems.push('pressed before the press');
        if (!now.classes.includes('is-pressed')) problems.push('not pressed 20 ms after the press');
        if (!before.classes.includes('is-hover')) problems.push('no hover as the pointer settles');
        if (now.on) {
          await seek(t + 50);
          const after = await page.evaluate(probe, { scene, aim: key.aim });
          if (before.classes.includes(now.on)) problems.push(`${now.on} before the press`);
          if (!after.classes.includes(now.on)) problems.push(`no ${now.on} 50 ms after the press`);
        }
      }
      if (key.down) {
        drags += 1;
        const up = keys.slice(n + 1).find((item) => item.up);
        const t1 = window3.from + up.t;
        if (!key.outside && !now.classes.includes('is-grabbed')) problems.push('the handle is not shown grabbed');
        const samples = [];
        for (const p of [0.15, 0.35, 0.55, 0.75, 0.95]) {
          await seek(t + 150 + (t1 - t - 150) * p);
          samples.push(await page.evaluate(carried, { scene }));
        }
        if (samples.some((s) => !s)) problems.push('the carried block is not under the tip all the way');
        else {
          const drift = Math.max(...samples.map((s) => Math.hypot(s.dx - samples[0].dx, s.dy - samples[0].dy)));
          if (drift > FOLLOW) problems.push(`the carried block drifts ${drift.toFixed(2)} px from the tip`);
          console.log(`  ok-follow ${scene} ${key.aim}: drift ${drift.toFixed(2)} px over ${samples.length} samples`);
        }
      }
      if (key.up && key.over) {
        await seek(t - 30);
        const lit = await page.evaluate(
          ({ scene: id, over }) => document.querySelector(`.r3-gate[data-scene="${id}"] [data-aim="${over}"]`)?.classList.contains('is-over'),
          { scene, over: key.over },
        );
        if (!lit) problems.push(`${key.over} not lit before the drop`);
      }
      if (problems.length) fail(size, `${label}: ${problems.join('; ')} (${where})`);
      else console.log(`  ok ${label}: ${where}`);

      if (framesDir) {
        const span = key.down ? keys.slice(n + 1).find((item) => item.up).t - key.t : 0;
        const at = key.down ? [-150, 80, span * 0.4, span * 0.75, span - 60] : [-400, -150, 80, 250, 600];
        for (let i = 0; i < at.length; i += 1) {
          await seek(t + at[i]);
          await shoot(`${scene}-${n}-${key.aim}-${i}`);
        }
      }
    }

    // No jump: the scene stepped every 16 ms (the clock moved at once, the tip read back).
    const steps = await page.evaluate(
      ({ id, from, to }) => {
        const gate = document.querySelector(`.r3-gate[data-scene="${id}"]`);
        const cursor = gate?.querySelector('.r3-cursor');
        const ui = gate.querySelector('.r3-ui');
        const out = [];
        for (let t = from; t < to; t += 16) {
          window.__meldyReel.seekNow(t);
          const c = cursor.getBoundingClientRect();
          // In UI px: the product box's own px, whatever the stage's scale.
          const per = ui.getBoundingClientRect().width / ui.offsetWidth;
          out.push([t, (c.left + (c.width * 5) / 24) / per, (c.top + (c.height * 3) / 24) / per, Number(cursor.style.opacity || 0)]);
        }
        return out;
      },
      { id: scene, from: window3.from + 250, to: window3.to - 450 },
    );
    let worst = 0;
    let worstAt = 0;
    for (let i = 1; i < steps.length; i += 1) {
      const [t, x, y, o] = steps[i];
      const [, x0, y0, o0] = steps[i - 1];
      if (o < 0.5 || o0 < 0.5) continue;
      const jump = Math.hypot(x - x0, y - y0);
      if (jump > worst) {
        worst = jump;
        worstAt = t;
      }
    }
    if (worst > STEP) fail(size, `${scene}: the pointer jumps ${worst.toFixed(1)} UI px in 16 ms at ${worstAt}`);
    else console.log(`  ok-motion ${scene}: at most ${worst.toFixed(1)} UI px in 16 ms`);

    // Fitts-like: no move squeezed far below the time its distance and target ask for.
    const moves = await page.evaluate(
      (id) =>
        window.__meldyPointers?.[id]?.plan.moves.map((m) => ({
          to: m.to.key.aim ?? 'a place',
          d: Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y),
          natural: m.natural,
          actual: m.end - m.start,
        })) ?? [],
      scene,
    );
    const tight = moves.map((m) => ({ ...m, ratio: m.actual / m.natural })).sort((a, b) => a.ratio - b.ratio)[0];
    if (!moves.length) fail(size, `${scene}: no plan to read`);
    else if (tight.ratio < SQUEEZE) fail(size, `${scene}: the move to ${tight.to} (${tight.d.toFixed(0)} UI px) takes ${tight.actual} ms of its ${tight.natural}`);
    else console.log(`  ok-fitts ${scene}: ${moves.length} moves, the tightest to ${tight.to} at ${Math.round(tight.ratio * 100)} % of its time`);
  }
  console.log(`  ${presses} presses, ${drags} drags`);
  await page.close();
}

await browser.close();
if (server) await server.close();
if (failures.length) {
  console.log(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log('\nevery press on its target, every drag held, no jump');
