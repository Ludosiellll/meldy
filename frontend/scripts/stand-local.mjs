#!/usr/bin/env node
/**
 * A whole «Встань на ответ» game on this machine with the real projector page (LOCAL ONLY), run from frontend/:
 *
 *   node scripts/stand-local.mjs open                 the game with 30 bots; prints the page's address, waits
 *   node scripts/stand-local.mjs shots <dir>          plays a short game in Chromium and saves key frames
 *   node scripts/stand-local.mjs video <dir> [W H]    the same, recorded as a video (default 1920 × 1080)
 *   node scripts/stand-local.mjs perf                 JavaScript per frame with 40 bots, at CPU × 1 and × 4
 *   node scripts/stand-local.mjs replay <game.json> <dir> [W H]
 *                                                     a recorded game (live_stand_local.py --auto --record) drawn
 *                                                     frame by frame on a stopped clock into <dir>/stand-WxH.mp4
 *                                                     (25 fps, smooth however slow the machine) and key frames
 *
 * It starts backend/scripts/live_stand_local.py (the room with the database in memory and the bots; MELDY_PY names
 * the Python with the backend's packages), then Vite with VITE_SUPABASE_URL pointing at it and /api proxied with
 * WebSockets, and opens /live/<game> with the host token in sessionStorage. Options: BOTS=30, QUESTIONS=4, TIME=15,
 * BOSS=clock|skeleton, PORT=8000. Playwright: the project's own package if installed, else one on NODE_PATH.
 * Headless WebGL runs on SwiftShader (a GPU emulated on the CPU): its frame rate says nothing about a real GPU.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
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
    // its own bundle cache: node_modules may be shared with other checkouts' dev servers
    cacheDir: env('VITE_CACHE', join(tmpdir(), 'meldy-stand-vite')),
    logLevel: 'error',
    server: {
      host: '127.0.0.1',
      port: 3000,
      strictPort: false,
      proxy: { '/api': { target: `http://127.0.0.1:${PORT}`, ws: true } },
      // node_modules may be a link to another checkout
      fs: { allow: [root, realpathSync(join(root, 'node_modules'))] },
      // a long recording must not be reloaded by an edit meanwhile
      hmr: env('HMR', '') === '1',
      watch: env('HMR', '') === '1' ? {} : { ignored: ['**/*'] },
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

/** In the page, before anything else: the room's socket and the live RPCs answered from a recording, in page time. */
function replayScript(rec) {
  const b64 = (s) => {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  };
  const log = rec.ws.map(([t, k, d]) => [t, k, k === 'b' ? b64(d) : d]);
  const db = rec.db;
  let goAt = null;
  window.__replayGo = () => {
    goAt = performance.now();
  };
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/auth/v1/health')) return json({});
    const m = /\/rest\/v1\/rpc\/(\w+)/.exec(url);
    if (!m) return realFetch(input, init);
    const t = goAt === null ? -1 : performance.now() - goAt;
    let st = db[0][1];
    for (const [at, s] of db) {
      if (at <= t) st = s;
      else break;
    }
    return json(m[1] === 'live_host_state' || m[1] === 'live_next' ? st : { ok: true });
  };
  class FakeSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.binaryType = 'blob';
      this.onopen = this.onmessage = this.onclose = this.onerror = null;
      this.i = 0;
      if (!url.includes('/api/live/move/ws')) {
        setTimeout(() => this.close(1006), 20);
        return;
      }
      this.wait();
    }
    wait() {
      if (this.readyState === 3) return;
      if (goAt === null) {
        setTimeout(() => this.wait(), 20);
        return;
      }
      this.t0 = goAt;
      this.readyState = 1;
      this.onopen?.({});
      this.next();
    }
    next() {
      if (this.readyState !== 1 || this.i >= log.length) return;
      setTimeout(() => this.deliver(), Math.max(0, this.t0 + log[this.i][0] - performance.now()));
    }
    deliver() {
      if (this.readyState !== 1) return;
      const now = performance.now() - this.t0;
      while (this.i < log.length && log[this.i][0] <= now + 0.01) {
        const [, k, d] = log[this.i++];
        this.onmessage?.({ data: k === 'b' ? d.slice(0) : d });
      }
      this.next();
    }
    send() {}
    close(code = 1000) {
      if (this.readyState === 3) return;
      this.readyState = 3;
      setTimeout(() => this.onclose?.({ code, reason: '' }), 0);
    }
  }
  FakeSocket.CONNECTING = 0;
  FakeSocket.OPEN = 1;
  FakeSocket.CLOSING = 2;
  FakeSocket.CLOSED = 3;
  window.WebSocket = FakeSocket;
}

/** Key frames of a replay, at ms of the recording (found from its room states). */
function keyFrames(rec) {
  const states = rec.ws.filter(([, k, d]) => k === 't' && d.includes('"k":"state"')).map(([t, , d]) => [t, JSON.parse(d)]);
  const first = (pred) => states.find(([, s]) => pred(s))?.[0] ?? null;
  const at = [];
  const add = (name, t) => t !== null && at.push([name, t]);
  const open0 = first((s) => s.phase === 'open' && s.qi === 0);
  const reveal0 = first((s) => s.phase === 'reveal' && s.qi === 0);
  add('01-lobby', (first((s) => s.phase === 'countdown') ?? 12000) - 1500);
  add('02-countdown', (first((s) => s.phase === 'countdown') ?? 0) + 1200);
  add('03-crowd-runs', open0 !== null ? open0 + 5000 : null);
  if (reveal0 !== null) {
    add('04-last-seconds', reveal0 - 2200);
    add('05-stomp', reveal0 + 700);
    add('06-floor-drops', reveal0 + 1500);
    add('07-ghosts', reveal0 + 2600);
    add('08-floor-back', reveal0 + 4700);
  }
  add('09-leaderboard', (first((s) => s.phase === 'leaderboard') ?? -1e9) + 2500);
  add('10-podium', (first((s) => s.phase === 'podium') ?? -1e9) + 4500);
  return at.filter(([, t]) => t > 0).sort((a, b) => a[1] - b[1]);
}

async function replay(recPath, dir, W, H) {
  const rec = JSON.parse(readFileSync(recPath, 'utf8'));
  process.env.VITE_SUPABASE_URL = 'http://127.0.0.1:8999';
  const { server, base } = await startVite();
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ args: ARGS, headless: !MESA });
  const fps = Number(env('FPS', 25));
  const step = 1000 / fps;
  mkdirSync(dir, { recursive: true });
  try {
    const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, locale: 'ru-RU' });
    await context.addInitScript(
      ([g, t]) => {
        sessionStorage.setItem(`meldy.live.host.${g}`, t);
        sessionStorage.setItem(`meldy.live.hostinfo.${g}`, JSON.stringify({ title: 'Повторение', joinUrl: 'https://meldy.ru/play?pin=123456', containerId: null, quizId: null, source: null, settings: null }));
      },
      [rec.game, rec.host_token],
    );
    await context.addInitScript(replayScript, rec);
    const page = await context.newPage();
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    await page.clock.install();
    // the first visit lets Vite bundle the dependencies (it may reload the page once)
    await page.goto(`${base}/live/${rec.game}?bench${env('QUERY', '')}`, { waitUntil: 'load' });
    if (env('DEBUG', '')) {
      for (let i = 0; i < 6; i++) {
        await sleep(5000);
        console.log(await page.evaluate(() => JSON.stringify({ phase: document.querySelector('.lvst')?.getAttribute('data-phase'), body: document.body.innerText.slice(0, 120), stand: !!window.__stand, stats: window.__stand?.stats?.() ?? null, now: performance.now() })).catch((e) => e.message));
      }
      await page.screenshot({ path: join(dir, 'debug.png') });
    }
    // (a page-side wait would poll on the page's faked clock: poll from here)
    for (let i = 0; ; i++) {
      const frames = await page.evaluate(() => window.__stand?.stats?.()?.frames ?? 0).catch(() => 0);
      if (frames > 3) break;
      if (i > 600) throw new Error('the projector did not start drawing');
      await sleep(300);
    }
    console.log('the projector draws; recording');
    await page.addStyleTag({ content: '[class*="tsqd"]{display:none!important}' });
    const now = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(now + 200);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Animation.enable');
    await cdp.send('Animation.setPlaybackRate', { playbackRate: Number(env('CSS_RATE', 0.12)) });
    await page.evaluate(() => {
      window.__standManual(true);
      window.__replayGo();
    });
    const end = Math.min(rec.ws[rec.ws.length - 1][0] + 1500, Number(env('END_MS', Infinity)));
    const startAt = Number(env('START_MS', 0));
    const keys = keyFrames(rec);
    const out = join(dir, `stand-${W}x${H}.mp4`);
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', out], { stdio: ['pipe', 'inherit', 'inherit'] });
    const t0 = Date.now();
    let k = 0;
    if (startAt > 0) await page.clock.runFor(startAt);
    while (k < keys.length && keys[k][1] < startAt) k++;
    for (let t = startAt, f = 0; t <= end; t += step, f++) {
      await page.clock.runFor(step);
      await page.evaluate((dt) => window.__standStep(dt), step / 1000);
      const jpg = await page.screenshot({ type: 'jpeg', quality: 90 });
      if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r));
      while (k < keys.length && keys[k][1] <= t) {
        await page.screenshot({ path: join(dir, `${keys[k][0]}-${W}x${H}.png`) });
        k++;
      }
      if (f % 250 === 0) console.log(`${(t / 1000).toFixed(1)} s of ${(end / 1000).toFixed(0)} s, ${((Date.now() - t0) / 1000).toFixed(0)} s so far`);
    }
    ff.stdin.end();
    await new Promise((r) => ff.on('exit', r));
    console.log('video', out);
  } finally {
    await browser.close();
    await server.close();
  }
}

async function main() {
  const [cmd = 'open', dir = join(root, '..', 'qa-screens', 'stand'), W = '1920', H = '1080'] = process.argv.slice(2);
  if (cmd === 'replay') {
    const [, recPath, outDir, rw = '1920', rh = '1080'] = process.argv.slice(2);
    await replay(recPath, outDir, Number(rw), Number(rh));
    return;
  }
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
        const { page } = await openPage(browser, base, room.game, room.host_token, { width: Number(env('PERF_W', 960)), height: Number(env('PERF_H', 540)) }, { query: `?bench${env('QUERY', '')}` });
        await perf(page);
      }
    } finally {
      await browser.close();
    }
  } finally {
    await stop();
  }
}

/**
 * JavaScript per frame of the projector during a question with every bot running, at CPU × 1 and × 4, and what the
 * page spends on style and layout (the DOM overlay) per second of normal running.
 */
async function perf(page) {
  await waitPhase(page, ['lobby']);
  for (let i = 0; i < 200; i++) {
    const n = await page.evaluate(() => Number(document.querySelector('.lvst-pill b')?.textContent?.replace(/\s/g, '') ?? 0)).catch(() => 0);
    if (n >= BOTS) break;
    await sleep(300);
  }
  await page.keyboard.press('Space');
  await waitPhase(page, ['open']);
  await sleep(2500);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  // the overlay: style and layout over a stretch of normal running (the loop, the timer, the counts)
  const a = await metrics();
  const wall0 = Date.now();
  await sleep(5000);
  const b = await metrics();
  const secs = (Date.now() - wall0) / 1000;
  const st = await page.evaluate(() => window.__stand?.stats?.() ?? null);
  const per = (k) => (1000 * (b[k] - a[k])) / secs;
  console.log(JSON.stringify({ overlay: { styleMsPerS: +per('RecalcStyleDuration').toFixed(2), layoutMsPerS: +per('LayoutDuration').toFixed(2), scriptMsPerS: +per('ScriptDuration').toFixed(1), fps: st ? +st.fps.toFixed(1) : null, quality: st?.quality ?? null } }));
  for (const rate of [1, 4]) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await sleep(1000);
    await page.evaluate(() => window.__standBench?.(20));
    const r = await page.evaluate(() => window.__standBench?.(150));
    const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +v.toFixed(2)]));
    console.log(JSON.stringify({ cpu: rate, players: BOTS, total: round(r.total), scene: round(r.scene), kitAndDraw: round(r.kitAndDraw), kitUpdate: round(r.update), drawSubmit: round(r.draw), hudCallsPerFrame: +(r.hudCalls / r.frames).toFixed(2), drawCalls: r.drawCalls }));
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
