#!/usr/bin/env node
/**
 * A whole «Встань на ответ» game on this machine with the real projector page (LOCAL ONLY), run from frontend/:
 *
 *   node scripts/stand-local.mjs open                 the game with 30 bots; prints the page's address, waits
 *   node scripts/stand-local.mjs shots <dir>          plays a short game in Chromium and saves key frames
 *   node scripts/stand-local.mjs video <dir> [W H]    the same, recorded as a video (default 1920 × 1080)
 *   node scripts/stand-local.mjs perf                 JavaScript per frame with 40 bots, at CPU × 1 and × 4
 *
 * It starts backend/scripts/live_stand_local.py (the room with the database in memory and the bots; MELDY_PY names
 * the Python with the backend's packages), then Vite with VITE_SUPABASE_URL pointing at it and /api proxied with
 * WebSockets, and opens /live/<game> with the host token in sessionStorage. Options: BOTS=30, QUESTIONS=4, TIME=15,
 * BOSS=clock|skeleton, PORT=8000. Playwright: the project's own package if installed, else one on NODE_PATH.
 * Headless WebGL runs on SwiftShader (a GPU emulated on the CPU): its frame rate says nothing about a real GPU.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const require = createRequire(import.meta.url);
const env = (k, d) => process.env[k] ?? d;
const PORT = Number(env('PORT', 8000));
const BOTS = Number(env('BOTS', 30));
// GL=mesa: a headed Chromium on Mesa's llvmpipe (run under xvfb-run), usually several times faster than SwiftShader
const MESA = env('GL', '') === 'mesa';
const ARGS = MESA
  ? ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required', '--disable-gpu-vsync']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    return require('playwright');
  }
}

/** The room and the bots: resolves with the game id and the host token once it listens. */
function startRoom() {
  const py = env('MELDY_PY', 'python3');
  const args = [
    join(root, '..', 'backend', 'scripts', 'live_stand_local.py'),
    '--local',
    '--port', String(PORT),
    '--bots', String(BOTS),
    '--questions', env('QUESTIONS', '4'),
    '--time', env('TIME', '15'),
    '--boss', env('BOSS', 'clock'),
  ];
  const child = spawn(py, args, { stdio: ['ignore', 'pipe', 'inherit'] });
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
    logLevel: 'error',
    server: {
      host: '127.0.0.1',
      port: 3000,
      strictPort: false,
      proxy: { '/api': { target: `http://127.0.0.1:${PORT}`, ws: true } },
      // node_modules may be a link to another checkout
      fs: { allow: [root, realpathSync(join(root, 'node_modules'))] },
    },
  });
  await server.listen();
  return { server, base: `http://127.0.0.1:${server.httpServer.address().port}` };
}

async function openPage(browser, base, game, token, viewport, extra = {}) {
  const { query, ...options } = extra;
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'ru-RU', ...options });
  await context.addInitScript(
    ([g, t]) => {
      sessionStorage.setItem(`meldy.live.host.${g}`, t);
      sessionStorage.setItem(`meldy.live.hostinfo.${g}`, JSON.stringify({ title: 'Повторение', joinUrl: `${location.origin}/play?pin=123456`, containerId: null, quizId: null, source: null, settings: null }));
      localStorage.setItem('meldy_supabase_route', JSON.stringify({ route: 'direct', until: Date.now() + 36e5 }));
    },
    [game, token],
  );
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('[page]', m.text().slice(0, 240));
  });
  // the first visit lets Vite bundle the game's dependencies (it reloads the page once when it does)
  await page.goto(`${base}/live/${game}${query ?? ''}`, { waitUntil: 'load' });
  await waitPhase(page, ['lobby', 'countdown', 'open', 'reveal', 'leaderboard', 'podium', 'ended'], 120000);
  await sleep(4000);
  await page.reload({ waitUntil: 'load' });
  return { context, page };
}

const phaseOf = (page) => page.evaluate(() => document.querySelector('.lvst')?.getAttribute('data-phase') ?? null).catch(() => null);

async function waitPhase(page, want, ms = 60000) {
  const end = Date.now() + ms;
  for (;;) {
    const p = await phaseOf(page);
    if (want.includes(p)) return p;
    if (Date.now() > end) throw new Error(`waited for ${want} but the screen is at ${p}`);
    await sleep(100);
  }
}

/**
 * Plays the whole game as the teacher: Space to start, after each reveal, after each top five, at the podium. Key
 * frames are taken by the time spent in each phase (a screenshot under SwiftShader can take a second or two).
 */
async function play(page, { shot = null } = {}) {
  const snap = async (name) => shot && (await shot(name).catch((e) => console.log('shot failed', name, e.message)));
  const read = () =>
    page
      .evaluate(() => ({
        phase: document.querySelector('.lvst')?.getAttribute('data-phase') ?? null,
        pill: Number(document.querySelector('.lvst-pill b')?.textContent?.replace(/\s/g, '') ?? 0),
        timer: document.querySelector('.lvst-timer b')?.textContent ?? '',
        ready: document.querySelector('.lvst-timer')?.hasAttribute('data-ready') ?? false,
        q: document.querySelector('.lvst-brand span:last-child')?.textContent ?? '',
      }))
      .catch(() => ({ phase: null, pill: 0, timer: '', ready: false, q: '' }));
  let phase = null;
  let lastStats = 0;
  let since = Date.now();
  let qn = 0;
  const done = new Set();
  const once = async (key, fn) => {
    if (done.has(key)) return;
    done.add(key);
    await fn();
  };
  const t0 = Date.now();
  for (;;) {
    const r = await read();
    if (r.phase !== phase) {
      console.log(`${((Date.now() - t0) / 1000).toFixed(1)} s ${r.phase} ${r.q}`);
      phase = r.phase;
      since = Date.now();
      if (phase === 'countdown' || (phase === 'open' && !done.has(`q${qn}`))) qn += 1;
    }
    const t = Date.now() - since;
    const first = qn === 1;
    if (Date.now() - lastStats > 5000) {
      lastStats = Date.now();
      const st = await page.evaluate(() => window.__stand?.stats?.() ?? null).catch(() => null);
      if (st) console.log(`fps ${st.fps.toFixed(1)} js ${st.cpuMs.mean.toFixed(2)}/${st.cpuMs.p95.toFixed(2)} ms level ${st.quality} ratio ${st.pixelRatio.toFixed(2)} calls ${st.drawCalls}`);
    }
    if (phase === 'lobby') {
      if ((r.pill >= BOTS && t > 2500) || t > 45000) {
        await once('lobby', () => snap('01-lobby'));
        if (process.env.PROBE) console.log(await page.evaluate(() => { const e = document.elementFromPoint(innerWidth - 30, innerHeight - 30); return e ? e.outerHTML.slice(0, 300) + ' | ' + (e.parentElement?.outerHTML.slice(0, 200) ?? '') : 'none'; }));
        await once('start', () => page.keyboard.press('Space'));
      }
    } else if (phase === 'countdown') {
      done.add(`q${qn}`);
      if (first && t > 1000) await once('countdown', () => snap('02-countdown'));
    } else if (phase === 'open') {
      done.add(`q${qn}`);
      const left = Number(r.timer || 99);
      if (first && left <= 9 && left > 4) await once('running', () => snap('03-open-running'));
      if (first && left <= 2 && left > 0) await once('alarm', () => snap('04-last-seconds'));
    } else if (phase === 'reveal') {
      if (first && t > 900) await once('stomp', () => snap('05-stomp'));
      if (first && t > 1900) await once('down', () => snap('06-floor-down-ghosts'));
      if (first && t > 4800) await once('back', () => snap('07-floor-back'));
      if (qn === 2 && t > 2400) await once('reveal2', () => snap('08-reveal-q2'));
      if (t > 7000) await once(`next${qn}`, () => page.keyboard.press('Space'));
    } else if (phase === 'leaderboard') {
      if (first && t > 2200) await once('top', () => snap('09-leaderboard'));
      if (t > 4000) await once(`go${qn}`, () => page.keyboard.press('Space'));
    } else if (phase === 'podium') {
      if (t > 3500) await once('podium', () => snap('10-podium'));
      if (t > 6500) return;
    }
    if (Date.now() - t0 > 20 * 60 * 1000) throw new Error('the game took too long');
    await sleep(120);
  }
}

async function main() {
  const [cmd = 'open', dir = join(root, '..', 'qa-screens', 'stand'), W = '1920', H = '1080'] = process.argv.slice(2);
  const room = await startRoom();
  const { server, base } = await startVite();
  console.log(`room ${room.url}\npage ${base}/live/${room.game}\nhost token ${room.host_token}`);
  const stop = async () => {
    room.child.kill('SIGTERM');
    await server.close();
  };
  try {
    if (cmd === 'open') {
      await new Promise(() => {});
    }
    const { chromium } = await loadPlaywright();
    const browser = await chromium.launch({ args: ARGS, headless: !MESA });
    const viewport = { width: Number(W), height: Number(H) };
    try {
      if (cmd === 'shots') {
        mkdirSync(dir, { recursive: true });
        const { page } = await openPage(browser, base, room.game, room.host_token, viewport, { query: `?bench${env('QUERY', '')}` });
        await play(page, { shot: (name) => page.screenshot({ path: join(dir, `${name}-${W}x${H}.png`) }) });
      } else if (cmd === 'video') {
        mkdirSync(dir, { recursive: true });
        const { context, page } = await openPage(browser, base, room.game, room.host_token, viewport, { query: `?bench${env('QUERY', '')}`, recordVideo: { dir, size: viewport } });
        await play(page, { shot: (name) => page.screenshot({ path: join(dir, `${name}-${W}x${H}.png`) }) });
        await context.close();
        console.log('video saved in', dir);
      } else if (cmd === 'perf') {
        const { page } = await openPage(browser, base, room.game, room.host_token, { width: 960, height: 540 }, { query: '?bench' });
        await perf(page);
      }
    } finally {
      await browser.close();
    }
  } finally {
    await stop();
  }
}

/** JavaScript per frame of the projector during a question with every bot running, at CPU × 1 and × 4. */
async function perf(page) {
  await waitPhase(page, ['lobby']);
  for (let i = 0; i < 150; i++) {
    const n = await page.evaluate(() => Number(document.querySelector('.lvst-pill b')?.textContent?.replace(/\s/g, '') ?? 0));
    if (n >= BOTS) break;
    await sleep(300);
  }
  await page.keyboard.press('Space');
  await waitPhase(page, ['open']);
  const cdp = await page.context().newCDPSession(page);
  for (const rate of [1, 4]) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await sleep(1500);
    const r = await page.evaluate(() => window.__standBench?.(150));
    console.log(JSON.stringify({ cpu: rate, ...r }));
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
