#!/usr/bin/env node
/**
 * A whole battle with movement rounds on this machine with the real projector page and one real phone (LOCAL ONLY;
 * docs/live/MODE_MIXED.md), run from frontend/:
 *
 *   node scripts/mixed-local.mjs open                the game with bots; prints the projector's and the phone's
 *                                                   addresses, waits
 *   node scripts/mixed-local.mjs shots <dir>         plays the game in Chromium (the teacher on the projector, one
 *                                                   phone that answers, misses, runs and stands still) and saves key
 *                                                   frames of both, and what the screens said against the database
 *   node scripts/mixed-local.mjs video <dir>         the same, also recorded as two videos (projector and phone);
 *                                                   the 3D moments are frames cut from them (ffmpeg on PATH)
 *
 * It starts supabase/tests/local/live_mixed_local.sh (a seeded test, PostgREST and backend/scripts/live_mixed_local.py:
 * the real room with bots) against the rehearsal's database — the cluster of supabase/tests/local/live_game_run.sh,
 * which leaves the database with the mixed migration applied — then Vite with VITE_SUPABASE_URL pointing at the room's
 * server (it passes /rest/v1 on to PostgREST) and /api proxied with WebSockets. Env: PGRST (the postgrest binary),
 * PGHOST / PGPORT / PGUSER and DB (live) for the cluster, MELDY_PY (a Python with the backend's packages), BOTS=12,
 * EVERY=3, TIME=10, BOSS=skeleton, SKILL="0.3 0.6" (how often the bots are right), PORT=8418, W/H (the projector,
 * 1532 × 734), QUERY (more of the projector's address, e.g. &fps=1). Playwright: the project's own package
 * if installed, else one on NODE_PATH. Headless WebGL runs on SwiftShader: its frame rate says nothing about a GPU.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const require = createRequire(import.meta.url);
const env = (k, d) => process.env[k] ?? d;
const PORT = Number(env('PORT', 8418));
const BOTS = Number(env('BOTS', 12));
const W = Number(env('W', 1532));
const H = Number(env('H', 734));
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// the seed's right answers (live_mixed_local.sh)
const KEYS = [1, 2, 1, 0, 0, 3];

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    return require('playwright');
  }
}

/** The database, PostgREST, the room and the bots: resolves with the game, the host token and the PIN. */
function startRoom() {
  const args = [join(root, '..', 'supabase', 'tests', 'local', 'live_mixed_local.sh'), env('PGRST', 'postgrest'), env('DB', 'live'),
    '--bots', String(BOTS), '--every', env('EVERY', '3'), '--time', env('TIME', '10'), '--boss', env('BOSS', 'skeleton'), '--port', String(PORT),
    '--skill', ...env('SKILL', '0.3 0.6').split(/\s+/)];
  const child = spawn('bash', args, { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, LIVE_PY: env('MELDY_PY', 'python3') }, detached: true });
  return new Promise((ok, fail) => {
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      const line = buf.split('\n').find((l) => l.startsWith('{'));
      if (line) ok({ child, ...JSON.parse(line) });
    });
    child.on('exit', (code) => fail(new Error(`the room stopped (${code})`)));
  });
}

async function startVite() {
  process.env.VITE_SUPABASE_URL = `http://127.0.0.1:${PORT}`;
  const { createServer } = await import('vite');
  const server = await createServer({
    root,
    configFile: join(root, 'vite.config.ts'),
    cacheDir: env('VITE_CACHE', join(tmpdir(), 'meldy-mixed-vite')),
    logLevel: 'error',
    server: {
      host: '127.0.0.1',
      port: Number(env('VITE_PORT', 3100)),
      strictPort: false,
      proxy: { '/api': { target: `http://127.0.0.1:${PORT}`, ws: true } },
      fs: { allow: [root, realpathSync(join(root, 'node_modules'))] },
      hmr: false,
      watch: { ignored: ['**/*'] },
    },
  });
  await server.listen();
  return { server, base: `http://127.0.0.1:${server.httpServer.address().port}` };
}

function logConsole(page, who) {
  page.on('pageerror', (e) => console.log(`[${who} pageerror]`, e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/realtime\/v1\/websocket|Failed to load resource/.test(m.text())) console.log(`[${who}]`, m.text().slice(0, 240));
  });
  // a failed request: which one (the console says only its status)
  page.on('response', (r) => {
    if (r.status() >= 400) console.log(`[${who}] ${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 160)}`);
  });
}

async function openProjector(browser, base, room, video) {
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, locale: 'ru-RU', ...(video ? { recordVideo: { dir: video, size: { width: W, height: H } } } : {}) });
  await context.addInitScript(
    ([g, t]) => {
      sessionStorage.setItem(`meldy.live.host.${g}`, t);
      sessionStorage.setItem(`meldy.live.hostinfo.${g}`, JSON.stringify({ title: 'Базы данных', joinUrl: `${location.origin}/play`, containerId: null, quizId: null, source: null, settings: null }));
      localStorage.setItem('meldy_supabase_route', JSON.stringify({ route: 'direct', until: Date.now() + 36e5 }));
    },
    [room.game, room.host_token],
  );
  const page = await context.newPage();
  const startedAt = Date.now();
  logConsole(page, 'projector');
  // the first visit lets Vite bundle the game's dependencies (it may reload the page once)
  await page.goto(`${base}/live/${room.game}?bench${env('QUERY', '')}`, { waitUntil: 'load' });
  return { context, page, startedAt };
}

async function openPhone(browser, base, room, video) {
  const viewport = { width: 390, height: 844 };
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ru-RU', ...(video ? { recordVideo: { dir: video, size: viewport } } : {}) });
  await context.addInitScript(() => {
    localStorage.setItem('meldy_supabase_route', JSON.stringify({ route: 'direct', until: Date.now() + 36e5 }));
    localStorage.setItem('meldy.live.view', '3d');
  });
  const page = await context.newPage();
  const startedAt = Date.now();
  logConsole(page, 'phone');
  await page.goto(`${base}/play?pin=${room.pin}`, { waitUntil: 'load' });
  return { context, page, startedAt };
}

/** What the projector shows now: the screen (lobby, battle, arena, podium), its phase and the numbers on it. */
const projector = (page) =>
  page
    .evaluate(() => {
      const vp = document.querySelector('.lvh-viewport');
      const arena = vp?.hasAttribute('data-arena') ?? false;
      const mx = document.querySelector('.lvmx');
      const hp = document.querySelector(arena ? '.lvmx .lvh-hp-num' : '.lvh-battle .lvh-hp-num')?.textContent ?? null;
      return {
        arena,
        phase: mx?.getAttribute('data-phase') ?? null,
        lobby: !!document.querySelector('.lvh-lobby'),
        podium: !!document.querySelector('.lvh-podium, .lvh-final'),
        hp,
        q: document.querySelector('.lvh-q-no')?.textContent ?? '',
        next: document.querySelector('.lvh-btn--next')?.textContent ?? null,
        players: Number(document.querySelector('.lvh-lobby-count b')?.textContent?.replace(/\s/g, '') ?? 0),
      };
    })
    .catch(() => null);

async function until(what, fn, ms = 60000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`waited for ${what}`);
    await sleep(150);
  }
}

/**
 * Walks the phone's character onto answer `zone` with its stick, from inside the page (a round trip to the page can
 * take a second here, longer than the walk across a zone): a press on the stick's field pushed a little towards
 * (dx, dy), released on the frame the phone says «Вы на ответе» there; if it slid past the far side, short steps back.
 * A gentle push walks slowly, so it stops inside the zone even at a few frames a second. Says whether it stands there.
 */
function runTo(page, zone, dx, dy, ms = 9000) {
  return page
    .evaluate(
      ([zone, dx, dy, ms]) =>
        new Promise((done) => {
          const field = document.querySelector('.sp-field');
          const here = document.querySelector('.sp-here');
          if (!field || !here) return done(false);
          const box = field.getBoundingClientRect();
          const x = box.left + 120;
          const y = box.top + box.height - 160;
          const ev = (type, px, py) =>
            field.dispatchEvent(new PointerEvent(type, { pointerId: 77, pointerType: 'touch', isPrimary: true, clientX: px, clientY: py, bubbles: true, cancelable: true }));
          const on = () => here.getAttribute('data-zone') === String(zone);
          let held = false;
          const press = (ddx, ddy) => {
            ev('pointerdown', x, y);
            ev('pointermove', x + ddx, y + ddy);
            held = true;
          };
          const release = () => {
            if (held) ev('pointerup', x, y);
            held = false;
          };
          const end = performance.now() + ms;
          let settle = 0;
          let back = 0;
          press(dx, dy);
          const tick = () => {
            const now = performance.now();
            if (held && on()) {
              release();
              settle = now + 800;
            } else if (!held && now > settle) {
              if (on()) return done(true);
              if (back++ >= 4 || now > end) return done(false);
              press(-dx, -dy);
              settle = now + 1300;
              setTimeout(release, 500);
            }
            if (now > end) {
              release();
              return done(on());
            }
            setTimeout(tick, 20);
          };
          tick();
        }),
      [zone, dx, dy, ms],
    )
    .catch(() => false);
}

/**
 * The teacher and the phone through the game. It follows the database's state (the server moves a reveal or a
 * leaderboard on by itself after 30 s, and a screenshot of a 3D page can take that long here), presses «Дальше» only
 * where the teacher would, and saves the 2D screens as screenshots. The 3D moments (the arena, its reveal) are marks in
 * the videos when recording (`started`: when each video began), cut into frames afterwards; else screenshots too.
 */
async function play(proj, phone, dir, db, started) {
  const notes = [];
  const marks = [];
  const shot = async (name, heavy = false) => {
    const t0 = Date.now();
    if (heavy && started) {
      marks.push({ name, projector: (t0 - started.projector) / 1000, phone: started.phone ? (t0 - started.phone) / 1000 : null });
    } else {
      await proj.screenshot({ path: join(dir, `${name}-projector.png`) }).catch((e) => console.log('shot failed', name, e.message));
      if (phone) await phone.screenshot({ path: join(dir, `${name}-phone.png`) }).catch((e) => console.log('shot failed', name, e.message));
    }
    const p = await projector(proj);
    notes.push({ name, at: new Date().toISOString(), projector: p, db: await db() });
    console.log(name, `${Date.now() - t0} ms`, JSON.stringify(p));
  };
  const at = (what, pred, ms = 40000) => until(what, async () => { const d = await db(); return d && pred(d) ? d : null; }, ms);
  const space = () => proj.keyboard.press('Space');
  // the phone joins: the PIN came in the link, a name, «Готово»
  if (phone) {
    await phone.getByPlaceholder('Как вас назвать').fill('Дима', { timeout: 60000 });
    await phone.getByRole('button', { name: 'Готово' }).click();
  }
  await until('the lobby with everyone', async () => {
    const p = await projector(proj);
    return p && p.lobby && p.players >= BOTS + (phone ? 1 : 0);
  }, 120000);
  await sleep(2500);
  await shot('01-lobby');
  // the plan of the phone: right, wrong (frozen), run to the right zone (the ice breaks), right, right, stand still
  for (let qi = 0; qi < 6; qi++) {
    const n = qi + 1;
    const d0 = await db();
    if (d0?.state === 'lobby' || d0?.state === 'leaderboard') await space();
    await at(`question ${n}`, (d) => d.qi === qi && ['countdown', 'open', 'reveal'].includes(d.state), 20000);
    if ((qi + 1) % 3 === 0) {
      await until('the arena', async () => (await projector(proj))?.arena, 15000);
      await sleep(800);
      await shot(`q${n}-1-arena`, true);
      if (phone && qi === 2) {
        // to the right answer, Б (top right): the ice breaks after the stomp
        await until('the round on the phone', async () => phone.evaluate(() => !!document.querySelector('.sp-here')).catch(() => false), 15000);
        if (!(await runTo(phone, KEYS[qi], 16, -16))) console.log('the phone did not reach its answer');
      }
      await sleep(1500);
      await shot(`q${n}-2-running`, true);
      await until('the reveal', async () => (await projector(proj))?.phase === 'reveal', 60000);
      await sleep(500);
      await shot(`q${n}-3-stomp`, true);
      await sleep(2200);
      await shot(`q${n}-4-hits`, true);
      await sleep(2800);
      await shot(`q${n}-5-after`, true);
    } else {
      const d = await at(`question ${n} open`, (d) => d.qi === qi && (d.state === 'open' || d.state === 'reveal'), 20000);
      await sleep(2000);
      if (phone && d.state === 'open') {
        const choice = qi === 1 ? (KEYS[qi] + 1) % 3 : KEYS[qi];
        await phone.locator(`.lp-ans--${choice}`).click({ timeout: 10000 }).catch((e) => console.log('tap failed', e.message));
      }
      await sleep(1000);
      await shot(`q${n}-1-open`);
      await at(`the reveal of ${n}`, (d) => d.qi === qi && d.state !== 'open' && d.state !== 'countdown');
      await sleep(3000);
      await shot(`q${n}-2-reveal`);
    }
    const d1 = await db();
    if (qi === 5 || (d1 && d1.hp <= 0) || d1?.state === 'ended') {
      if (d1?.state === 'reveal') await space();
      await until('the podium', async () => (await projector(proj))?.podium, 40000);
      await sleep(4500);
      await shot('99-podium');
      break;
    }
    if (d1?.state === 'reveal') await space();
    await at(`the leaderboard after ${n}`, (d) => d.state === 'leaderboard' || d.qi > qi);
    await sleep(2500);
    await shot(`q${n}-9-leaderboard`);
  }
  return { notes, marks };
}

/** A frame of a video at `t` seconds (ffmpeg on PATH), for the marks of `play`. */
function frame(video, t, out) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', Math.max(0, t).toFixed(2), '-i', video, '-frames:v', '1', '-y', out]);
  if (r.status !== 0) console.log('no frame', out, r.error?.message ?? String(r.stderr).slice(0, 200));
}

/** The game as the database has it (psql as postgres): the boss and every player's points, for the notes. */
function dbReader(game) {
  return () =>
    new Promise((ok) => {
      const sql = `select json_build_object('hp', hp, 'hp_max', hp_max, 'phase', phase, 'state', state, 'qi', qi, 'players', (select json_agg(json_build_object('name', name, 'dmg', dmg, 'frozen', frozen, 'right', right_n) order by dmg desc) from public.live_players p where p.game_id = g.id and kicked_at is null)) from public.live_games g where id = '${game}'`;
      const p = spawn('psql', ['-X', '-q', '-At', '-d', env('DB', 'live'), '-c', sql], { stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.on('exit', () => {
        try {
          ok(JSON.parse(out));
        } catch {
          ok(null);
        }
      });
    });
}

async function main() {
  const [cmd = 'open', dirArg = join(root, '..', 'qa-screens', 'mixed')] = process.argv.slice(2);
  const room = await startRoom();
  const { server, base } = await startVite();
  console.log(`room ${room.url}\nprojector ${base}/live/${room.game}?bench (host token ${room.host_token})\nphone ${base}/play?pin=${room.pin}`);
  const stop = async () => {
    try {
      process.kill(-room.child.pid, 'SIGTERM');
    } catch {
      room.child.kill('SIGTERM');
    }
    await server.close();
  };
  try {
    if (cmd === 'open') await new Promise(() => {});
    const dir = resolve(dirArg);
    mkdirSync(dir, { recursive: true });
    const { chromium } = await loadPlaywright();
    const browser = await chromium.launch({ args: ARGS });
    // the phone in a browser of its own: its own GPU process, so the two screens draw side by side
    const phoneBrowser = env('PHONE', '1') === '1' ? await chromium.launch({ args: ARGS }) : null;
    try {
      const video = cmd === 'video' ? dir : null;
      const proj = await openProjector(browser, base, room, video ? join(video, 'projector') : null);
      await sleep(3000);
      const phone = phoneBrowser ? await openPhone(phoneBrowser, base, room, video ? join(video, 'phone') : null) : null;
      const started = video ? { projector: proj.startedAt, phone: phone?.startedAt ?? null } : null;
      const { notes, marks } = await play(proj.page, phone?.page ?? null, dir, dbReader(room.game), started);
      writeFileSync(join(dir, 'notes.json'), JSON.stringify({ notes, marks }, null, 1));
      const pv = proj.page.video();
      const fv = phone?.page.video() ?? null;
      await proj.context.close();
      await phone?.context.close();
      if (pv) await pv.saveAs(join(dir, 'projector.webm'));
      if (fv) await fv.saveAs(join(dir, 'phone.webm'));
      for (const m of marks) {
        if (pv) frame(join(dir, 'projector.webm'), m.projector, join(dir, `${m.name}-projector.png`));
        if (fv && m.phone !== null) frame(join(dir, 'phone.webm'), m.phone, join(dir, `${m.name}-phone.png`));
      }
    } finally {
      await browser.close();
      await phoneBrowser?.close();
    }
  } finally {
    await stop();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
