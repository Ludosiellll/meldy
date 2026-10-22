#!/usr/bin/env node
/**
 * The phone's side of a recorded «Встань на ответ» game, frame by frame in the real phone page (/play, 390 × 844,
 * the 3D view pinned), following one player. Adapted from frontend/scripts/stand-local.mjs `replay` (the projector).
 *
 *   cd frontend && GL=mesa LIBGL_ALWAYS_SOFTWARE=1 xvfb-run -a -s "-screen 0 1280x1024x24" \
 *     node ../deck/cf11/tools/record/stand_phone_replay.mjs <game-rec.json> <out dir> --follow <entity id> \
 *     --windows 13400-22200,28400-35800 [--end 36000] [--dpr 2] [--fps 25]
 *
 * Slide 12 (tools/record/cut-12.json): --follow 23 (Лиза) --end 35800 --windows 13400-22200,28400-35800. Run from
 * frontend/ (Tailwind reads its content paths from there). Environment: FRONT (the frontend folder, default this
 * checkout's), VITE_CACHE (Vite's bundle cache, default a temporary folder), PLAYWRIGHT (a folder whose
 * node_modules has playwright, default /opt/node-tools/node_modules/).
 *
 * The recording (live_stand_local.py --record) is what the projector's socket received. The phone gets the same
 * room as a player would: the welcome as role «player» with `you` = the followed character, the same hello and
 * states (without the host-only points), the same snapshots, and after the reveal the player's own `me` (built from
 * the reveal's result, as live_move_stand.py builds it from the database's rows). The room sends snapshots at 10 Hz;
 * a player's own character moves by its own stick (prediction) on a real phone, so here every snapshot pair gets four
 * in-between snapshots (linear, 20 ms apart: as if the room sent every tick at 50 Hz): the own character then moves
 * as smoothly as under a finger, and everyone else is interpolated as the page does anyway.
 *
 * The page's clock is Playwright's (paused, advanced 1000/fps ms per frame); requestAnimationFrame is run once per
 * frame by this script, and CSS animations are paused and stepped by the same 1000/fps ms, so a frame shows the
 * page exactly at that time however slow the machine is (Mesa llvmpipe under xvfb: GL=mesa).
 * Frames inside the windows are saved as <out>/p-<ms>.jpg (ms of the recording).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FRONT = process.env.FRONT || join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..', 'frontend');
const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i < 0 ? d : argv[i + 1];
};
const [recPath, outDir] = argv;
const FOLLOW = Number(opt('follow', 23));
const FPS = Number(opt('fps', 25));
const STEP = 1000 / FPS;
const DPR = Number(opt('dpr', 2));
const END = Number(opt('end', 36000));
const WINDOWS = opt('windows', '13400-22200,28400-35800')
  .split(',')
  .map((w) => w.split('-').map(Number));
const MESA = (process.env.GL || '') === 'mesa';
const ARGS = MESA
  ? ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-gpu-vsync']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inWindow = (t) => WINDOWS.some(([a, b]) => t >= a && t <= b);

// ── the player's log from the host's ──
const rec = JSON.parse(readFileSync(recPath, 'utf8'));
const Q = 10;
const decode = (b64) => {
  const b = Buffer.from(b64, 'base64');
  const n = b.readUInt16LE(2);
  const ents = [];
  for (let i = 0; i < n; i++) {
    const o = 16 + 8 * i;
    ents.push([b.readUInt16LE(o), b.readUInt16LE(o + 2), b.readUInt16LE(o + 4), b.readUInt16LE(o + 6)]);
  }
  return { tick: b.readUInt32LE(4), t: b.readUInt32LE(8), ents };
};
const encode = ({ tick, t, ents }) => {
  const b = Buffer.alloc(16 + 8 * ents.length);
  b.writeUInt8(1, 0);
  b.writeUInt8(1, 1);
  b.writeUInt16LE(ents.length, 2);
  b.writeUInt32LE(tick, 4);
  b.writeUInt32LE(t, 8);
  b.writeUInt32LE(0, 12);
  ents.forEach(([id, x, y, f], i) => {
    const o = 16 + 8 * i;
    b.writeUInt16LE(id, o);
    b.writeUInt16LE(x, o + 2);
    b.writeUInt16LE(y, o + 4);
    b.writeUInt16LE(f, o + 6);
  });
  return b.toString('base64');
};

const roster = new Map();
let welcome = null;
for (const [, k, d] of rec.ws) {
  if (k !== 't') continue;
  const m = JSON.parse(d);
  if (m.t === 'welcome') {
    welcome = m;
    for (const e of m.roster) roster.set(e[0], e);
  } else if (m.t === 'add') roster.set(m.e[0], m.e);
}
const me = roster.get(FOLLOW);
if (!me) throw new Error(`no character ${FOLLOW} in the recording`);
const [, , PID, NAME, LOOK] = me;
console.log(`following #${FOLLOW} ${NAME} (${PID})`, JSON.stringify(LOOK));

const log = [];
let prev = null;
let lastState = null;
const meMsgs = [];
// the player's own numbers after each reveal, as live_move_stand.apply builds them (from the result and the flags)
const totals = new Map();
const streaks = new Map();
const rights = new Map();
const bests = new Map();
const zoneAt = new Map(); // id -> zone (1-based) in the latest snapshot
for (const [t, k, d] of rec.ws) {
  if (k === 'b') {
    const s = decode(d);
    for (const [id, , , f] of s.ents) zoneAt.set(id, f >> 8);
    if (prev) {
      for (let j = 1; j <= 4; j++) {
        const a = j / 5;
        const ents = prev.s.ents.map((e) => {
          const nb = s.ents.find((x) => x[0] === e[0]);
          if (!nb) return e;
          const jump = Math.hypot(nb[1] - e[1], nb[2] - e[2]) / Q;
          if (jump > 80) return e;
          return [e[0], Math.round(e[1] + (nb[1] - e[1]) * a), Math.round(e[2] + (nb[2] - e[2]) * a), e[3]];
        });
        log.push([prev.t + (t - prev.t) * a, 'b', encode({ tick: prev.s.tick * 10 + j * 4, t: Math.round(prev.s.t + (s.t - prev.s.t) * a), ents })]);
      }
    }
    log.push([t, 'b', encode({ tick: s.tick * 10, t: s.t, ents: s.ents })]);
    prev = { t, s };
    continue;
  }
  const m = JSON.parse(d);
  if (m.t === 'welcome') {
    log.push([t, 't', JSON.stringify({ ...m, role: 'player', you: FOLLOW, pid: PID, resumed: false })]);
    continue;
  }
  if (m.t === 'stats' || m.t === 'zones') continue;
  if (m.t === 'stand' && m.k === 'state') {
    const fresh = m.phase === 'reveal' && m.res && (!lastState || lastState.phase !== 'reveal' || lastState.qi !== m.qi);
    const out = m.res ? { ...m, res: Object.fromEntries(Object.entries(m.res).filter(([kk]) => kk !== 'pts')) } : m;
    log.push([t, 't', JSON.stringify(out)]);
    if (fresh) {
      const res = m.res;
      const pts = new Map(res.pts ?? []);
      for (const [id] of roster) {
        const got = pts.get(id) ?? 0;
        totals.set(id, (totals.get(id) ?? 0) + got);
        const ok = got > 0;
        streaks.set(id, ok ? (streaks.get(id) ?? 0) + 1 : 0);
        bests.set(id, Math.max(bests.get(id) ?? 0, streaks.get(id)));
        rights.set(id, (rights.get(id) ?? 0) + (ok ? 1 : 0));
      }
      const order = [...roster.keys()].sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0) || a - b);
      const z = zoneAt.get(FOLLOW) ?? 0;
      const fell = res.fell.includes(FOLLOW);
      const got = pts.get(FOLLOW) ?? 0;
      const msg = {
        t: 'stand',
        k: 'me',
        ghost: fell || (lastMe()?.ghost ?? false) && !res.back.includes(FOLLOW),
        pts: totals.get(FOLLOW) ?? 0,
        streak: streaks.get(FOLLOW) ?? 0,
        best: bests.get(FOLLOW) ?? 0,
        right: rights.get(FOLLOW) ?? 0,
        place: order.indexOf(FOLLOW) + 1,
        of: res.of,
        last: { qi: res.qi, choice: z > 0 ? z - 1 : null, ok: got > 0, pts: got, ms: null, fell, revived: res.back.includes(FOLLOW), late: false },
      };
      meMsgs.push(msg);
      log.push([t + 0.05, 't', JSON.stringify(msg)]);
      console.log(`me after q${res.qi + 1} at ${t.toFixed(0)} ms:`, JSON.stringify(msg));
    }
    lastState = m;
    continue;
  }
  log.push([t, 't', d]);
}
function lastMe() {
  return meMsgs[meMsgs.length - 1] ?? null;
}
log.sort((a, b) => a[0] - b[0]);

// the database's answers for the phone (live_state), from the host's states
const db = rec.db.map(([at, h]) => [
  at,
  {
    rev: h.rev, now: h.now, state: h.state, mode: 'stand', qi: h.qi, q_count: h.q_count, time_s: h.time_s, speed: h.speed,
    players: h.players, answered: 0, question: h.question, boss: h.boss, top: h.top,
    me: { player_id: PID, name: NAME, look: LOOK, dmg: 0, streak: 0, best: 0, frozen: false, place: null, choice: null },
    result: null, final: null,
    crowd: h.state === 'lobby' ? (h.roster ?? []).filter((r) => r.player_id !== PID).map((r) => r.look).slice(0, 40) : null,
  },
]);

function pageScript(arg) {
  const { log, db, game, pid, name, look } = arg;
  const TOKEN = 'P'.repeat(43);
  sessionStorage.setItem('meldy.live.pin.123456', game);
  sessionStorage.setItem(`meldy.live.game.${game}`, JSON.stringify({ topic: 't'.repeat(22), playerId: pid, guest: true, joinedAt: null }));
  sessionStorage.setItem(`meldy.live.player.${game}`, TOKEN);
  sessionStorage.setItem('meldy.live.mode.123456', 'stand');
  localStorage.setItem('meldy.live.view', '3d');
  localStorage.setItem('meldy_supabase_route', JSON.stringify({ route: 'direct', until: Date.now() + 36e5 }));
  const b64 = (s) => {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  };
  const msgs = log.map(([t, k, d]) => [t, k, k === 'b' ? b64(d) : d]);
  let goAt = null;
  window.__replayGo = () => {
    goAt = performance.now();
  };
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/auth/v1/health') || url.includes('/api/telemetry')) return json({});
    const m = /\/rest\/v1\/rpc\/(\w+)/.exec(url);
    if (!m) return realFetch(input, init);
    const t = goAt === null ? -1 : performance.now() - goAt;
    let st = db[0][1];
    for (const [at, s] of db) {
      if (at <= t) st = s;
      else break;
    }
    if (m[1] === 'live_state') return json(st);
    if (m[1] === 'live_join') return json({ game_id: game, player_id: pid, topic: 't'.repeat(22), state: st.state, rev: st.rev, now: st.now, name, look, wardrobe: null });
    if (m[1] === 'live_pin') return json({ status: 'joined', game_id: game, player_id: pid, topic: 't'.repeat(22), state: st.state, rev: st.rev, now: st.now, name, look, wardrobe: null });
    if (m[1] === 'live_set_look') return json({ look });
    if (m[1] === 'live_review') return json({ items: [] });
    return json({ ok: true });
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
      window.__phoneSocket = this;
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
      if (this.readyState !== 1 || this.i >= msgs.length) return;
      setTimeout(() => this.deliver(), Math.max(0, this.t0 + msgs[this.i][0] - performance.now()));
    }
    deliver() {
      if (this.readyState !== 1) return;
      const now = performance.now() - this.t0;
      while (this.i < msgs.length && msgs[this.i][0] <= now + 0.01) {
        const [, k, d] = msgs[this.i++];
        this.onmessage?.({ data: k === 'b' ? d.slice(0) : d });
      }
      this.next();
    }
    addEventListener(type, fn) {
      this[`on${type}`] = fn;
    }
    removeEventListener() {}
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

// one requestAnimationFrame per frame, run by the script; CSS animations stepped with the page's clock
function frameScript() {
  const queue = new Map();
  let next = 1;
  window.requestAnimationFrame = (cb) => {
    const id = next++;
    queue.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    queue.delete(id);
  };
  const seen = new WeakSet();
  // the dev server's query devtools button (never in a release) stays out of the picture, as in the projector's replay
  const hideDev = () => {
    const s = document.createElement('style');
    s.textContent = '[class*="tsqd"]{display:none!important}';
    document.head.appendChild(s);
  };
  if (document.head) hideDev();
  else document.addEventListener('DOMContentLoaded', hideDev);
  window.__frame = (stepMs) => {
    const ts = performance.now();
    const cbs = [...queue.values()];
    queue.clear();
    for (const cb of cbs) {
      try {
        cb(ts);
      } catch (e) {
        console.error('raf', e && e.message);
      }
    }
    for (const a of document.getAnimations()) {
      if (!seen.has(a)) {
        seen.add(a);
        a.pause();
        a.currentTime = 0;
      } else {
        a.pause();
        a.currentTime = (a.currentTime ?? 0) + stepMs;
      }
    }
    return cbs.length;
  };
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  process.env.VITE_SUPABASE_URL = 'http://127.0.0.1:8999';
  const viteEntry = join(realpathSync(join(FRONT, 'node_modules')), 'vite', 'dist', 'node', 'index.js');
  const { createServer } = await import(pathToFileURL(viteEntry).href);
  const server = await createServer({
    root: FRONT,
    configFile: join(FRONT, 'vite.config.ts'),
    cacheDir: process.env.VITE_CACHE || join(tmpdir(), 'meldy-phone-replay-vite'),
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 3300, strictPort: false, fs: { allow: [FRONT, realpathSync(join(FRONT, 'node_modules'))] }, hmr: false, watch: { ignored: ['**/*'] } },
  });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const pw = createRequire(process.env.PLAYWRIGHT || '/opt/node-tools/node_modules/')('playwright');
  const browser = await pw.chromium.launch({ args: ARGS, headless: !MESA });
  const t0 = Date.now();
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: DPR,
      isMobile: true,
      hasTouch: true,
      colorScheme: 'light',
      locale: 'ru-RU',
      serviceWorkers: 'block',
    });
    await context.addInitScript(pageScript, { log, db, game: rec.game, pid: PID, name: NAME, look: LOOK });
    const page = await context.newPage();
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') console.log('[page]', m.text().slice(0, 240));
    });
    await page.clock.install();
    await context.addInitScript(frameScript);
    // the first visit lets Vite bundle the dependencies (it may reload the page once)
    await page.goto(`${base}/play?pin=123456&mode=stand`, { waitUntil: 'load' });
    for (let i = 0; ; i++) {
      const ok = await page.evaluate(() => typeof window.__frame === 'function' && !!document.querySelector('.sp-play')).catch(() => false);
      if (ok) break;
      if (i % 20 === 0) {
        const txt = await page.evaluate(() => document.body.innerText.slice(0, 160)).catch((e) => e.message);
        console.log('waiting for the play screen:', JSON.stringify(txt));
      }
      if (i > 400) {
        await page.screenshot({ path: join(outDir, 'debug-start.png') });
        throw new Error('the phone did not reach the game');
      }
      // the page's own timers (vite's reload, the controller) run on the installed clock: let it run
      await page.clock.runFor(100).catch(() => {});
      await page.evaluate(() => window.__frame?.(100)).catch(() => {});
      await sleep(150);
    }
    console.log('the phone is in the game; replaying');
    await page.addStyleTag({ content: '[class*="tsqd"]{display:none!important}' });
    const now = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(now + 200);
    await page.evaluate(() => {
      window.__replayGo();
    });
    let f = 0;
    let saved = 0;
    let hintGone = false;
    for (let t = STEP; t <= END; t += STEP, f++) {
      await page.clock.runFor(STEP);
      await page.evaluate((s) => window.__frame(s), STEP);
      if (!hintGone && t > 12000) {
        // a real player has touched the stick by now: its first press hides the hint (FloatingStick onPress)
        hintGone = await page.evaluate(() => {
          const h = document.querySelector('.sp-hint');
          if (!h) return false;
          h.setAttribute('data-gone', 'true');
          return true;
        });
      }
      const ms = Math.round(t);
      if (inWindow(ms)) {
        await page.screenshot({ path: join(outDir, `p-${String(ms).padStart(6, '0')}.jpg`), type: 'jpeg', quality: 93 });
        saved++;
      }
      if (f % 100 === 0) {
        const info = await page.evaluate(() => ({ phase: document.querySelector('.sp-play')?.getAttribute('data-phase'), view: document.querySelector('.sp-play')?.getAttribute('data-view'), status: document.querySelector('.sp-status')?.textContent })).catch((e) => ({ e: e.message }));
        console.log(`${(t / 1000).toFixed(1)} s of ${(END / 1000).toFixed(1)} s, ${saved} frames saved, ${((Date.now() - t0) / 1000).toFixed(0)} s so far`, JSON.stringify(info));
      }
    }
    writeFileSync(join(outDir, 'phone-replay.json'), JSON.stringify({ rec: recPath, follow: FOLLOW, name: NAME, pid: PID, look: LOOK, fps: FPS, dpr: DPR, windows: WINDOWS, me: meMsgs }, null, 1));
    console.log('done', saved, 'frames in', outDir);
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
