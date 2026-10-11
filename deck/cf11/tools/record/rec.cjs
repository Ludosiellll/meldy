'use strict';
// Recording the live site for the deck's product slides (07–09): a take is one real session in Chromium, captured
// frame by frame through the DevTools screencast (every frame the page paints, at the device's pixels, with its time),
// plus a log of what the hand did (pointer path, presses, taps, key presses), named moments and the rectangle each beat
// shows (Take.box). edit.py turns a take into a master (the cuts as crossfades, the loop's seam, the camera's beats);
// fit.py frames it for a slide's screen (eased pans and zooms, a ring where the hand pressed, no pointer drawn).
//
// Sign-in goes only through the usability helpers (ulib.cjs: they read the test account from files and never print
// it). Set MELDY_ULIB to their path. Nothing here prints, logs or writes a password, token, cookie or e-mail: errors go
// out through ulib's redact(), and capture starts only after sign-in, on pages that show none of them.
const fs = require('fs');
const path = require('path');

const ULIB = process.env.MELDY_ULIB || '/tmp/claude-0/-home-user/bdd6a3db-98b1-55d9-a278-b6d3039b029b/scratchpad/container/usability/ulib.cjs';
if (!fs.existsSync(ULIB)) {
  console.error(`The sign-in helpers are not at ${ULIB}. Set MELDY_ULIB to ulib.cjs (it reads the test account from its own files).`);
  process.exit(2);
}
const u = require(ULIB);
const { chromium } = require('/opt/node-tools/node_modules/playwright');

const CHROME = '/opt/pw-browsers/chromium';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now() / 1000;

/**
 * Chromium as ulib.launch() starts it, plus extra switches (a fake microphone playing a file, for 08). LANGUAGE=ru
 * makes the browser itself Russian, as a student's is: without it a date field reads and shows mm/dd/yyyy.
 */
async function launch(extraArgs = []) {
  return chromium.launch({
    executablePath: CHROME,
    args: ['--disable-dev-shm-usage', '--lang=ru-RU', ...extraArgs],
    env: { ...process.env, LANGUAGE: 'ru' },
  });
}

/** A context like ulib.newContext(), with the device scale the take wants (laptop 1.75, phone 2: forced by launch). */
async function context(browser, { w, h, dpr, phone = false, init = [] }) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: dpr,
    isMobile: phone,
    hasTouch: phone,
    colorScheme: 'light',
    locale: 'ru-RU',
    timezoneId: 'Europe/Minsk',
    reducedMotion: 'no-preference',
  });
  for (const script of init) await ctx.addInitScript(script);
  return ctx;
}

/**
 * One take: the screencast of a page and the hand's log. Frames land in <dir>/raw/cNNNNN.jpg as the page paints them;
 * take.json keeps each frame's wall-clock time and the log (pointer moves, presses, taps, keys, marks).
 */
class Take {
  constructor(page, dir, { dpr, viewport, quality = 92 }) {
    this.page = page;
    this.dir = dir;
    this.raw = path.join(dir, 'raw');
    this.dpr = dpr;
    this.viewport = viewport;
    this.quality = quality;
    this.frames = [];
    this.events = [];
    this.pointer = null; // last pointer position, CSS px
    this.pending = 0;
  }

  async start() {
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.raw, { recursive: true });
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.cdp.on('Page.screencastFrame', (ev) => {
      const k = this.frames.length;
      const file = `c${String(k).padStart(5, '0')}.jpg`;
      const m = ev.metadata || {};
      this.frames.push({ file, t: m.timestamp ?? now(), w: m.deviceWidth, h: m.deviceHeight, top: m.offsetTop || 0 });
      this.cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
      this.pending += 1;
      fs.writeFile(path.join(this.raw, file), Buffer.from(ev.data, 'base64'), () => { this.pending -= 1; });
    });
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: this.quality, everyNthFrame: 1 });
    this.t0 = now();
    if (this.pointer) {
      // Where the hand rests when the take begins (a real pointer is put there too, so hover states agree).
      await this.page.mouse.move(this.pointer.x, this.pointer.y).catch(() => {});
      this.events.push({ kind: 'pointer', x: this.pointer.x, y: this.pointer.y, t: now() });
    }
    this.mark('start');
    // The screencast sends a frame only when something paints: nudge one out at once.
    await this.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))).catch(() => {});
  }

  mark(name, extra = {}) {
    this.events.push({ kind: 'mark', name, t: now(), ...extra });
    console.log(`  · ${name} +${(now() - (this.t0 || now())).toFixed(1)} s`);
  }

  /**
   * A still of the page re-rendered at `scale` × its CSS pixels (the poster's sharp source), PNG, in <dir>/stills.
   * Taken while the page stands still: the re-render costs a quarter of a second, the screencast pauses meanwhile.
   */
  async still(name, scale = this.stillScale || 2) {
    const dir = path.join(this.dir, 'stills');
    fs.mkdirSync(dir, { recursive: true });
    const t = now();
    // The clip is in the document's coordinates: the window's own part of it is where the page is scrolled to.
    const m = await this.cdp.send('Page.getLayoutMetrics');
    const vv = m.cssVisualViewport || m.visualViewport;
    const r = await this.cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      clip: { x: vv.pageX, y: vv.pageY, width: this.viewport.width, height: this.viewport.height, scale },
    });
    fs.writeFileSync(path.join(dir, `${name}.png`), Buffer.from(r.data, 'base64'));
    // The re-render can leak one frame into the screencast (the page drawn at `scale`): edit.py drops what the
    // screencast sent from t to t_end + 0.3 s (stills are taken while the page stands still, so nothing is lost).
    this.events.push({ kind: 'still', name, t, t_end: now(), scale });
    console.log(`  · still ${name} (×${scale})`);
  }

  async stop() {
    if (this.stopped || !this.cdp) return null;
    this.stopped = true;
    this.mark('stop');
    await this.cdp.send('Page.stopScreencast').catch(() => {});
    for (let i = 0; i < 100 && this.pending > 0; i += 1) await sleep(50);
    const take = { dpr: this.dpr, viewport: this.viewport, t0: this.t0, frames: this.frames, events: this.events };
    fs.writeFileSync(path.join(this.dir, 'take.json'), JSON.stringify(take));
    const span = this.frames.length ? this.frames[this.frames.length - 1].t - this.frames[0].t : 0;
    console.log(`  take: ${this.frames.length} frames over ${span.toFixed(1)} s -> ${this.dir}`);
    return take;
  }

  // ─────────────── the hand (a mouse on the laptop, a finger on the phone) ───────────────

  /** Moves the pointer along an eased path, ~60 steps a second, logging every step. */
  async move(x, y, { ms = 650 } = {}) {
    const from = this.pointer || { x: this.viewport.width * 0.62, y: this.viewport.height * 0.72 };
    const steps = Math.max(2, Math.round(ms / 16));
    // A slight arc, as a hand moves: the midpoint is pushed sideways by a few percent of the distance.
    const dx = x - from.x, dy = y - from.y;
    const bend = 0.08;
    const cx = from.x + dx / 2 - dy * bend, cy = from.y + dy / 2 + dx * bend;
    const t0 = Date.now();
    for (let i = 1; i <= steps; i += 1) {
      const p = i / steps;
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; // ease in-out cubic
      const px = (1 - e) * (1 - e) * from.x + 2 * (1 - e) * e * cx + e * e * x;
      const py = (1 - e) * (1 - e) * from.y + 2 * (1 - e) * e * cy + e * e * y;
      await this.page.mouse.move(px, py);
      this.events.push({ kind: 'move', x: px, y: py, t: now() });
      const due = t0 + (ms * i) / steps;
      const wait = due - Date.now();
      if (wait > 0) await sleep(wait);
    }
    this.pointer = { x, y };
  }

  /** The point of a locator to aim at: its centre, or a fraction of its box. */
  async aim(locator, { fx = 0.5, fy = 0.5 } = {}) {
    await locator.waitFor({ state: 'visible', timeout: 60000 });
    const box = await locator.boundingBox();
    if (!box) throw new Error('no box to aim at');
    return { x: box.x + box.width * fx, y: box.y + box.height * fy };
  }

  /** Moves to a control and presses it (the press and release are logged for the click ring). */
  async click(locator, { ms = 650, fx, fy, hold = 90, settle = 140 } = {}) {
    const p = await this.aim(locator, { fx, fy });
    await this.move(p.x, p.y, { ms });
    await sleep(settle);
    this.events.push({ kind: 'down', x: p.x, y: p.y, t: now() });
    await this.page.mouse.down();
    await sleep(hold);
    await this.page.mouse.up();
    this.events.push({ kind: 'up', x: p.x, y: p.y, t: now() });
  }

  /** A finger tap on the phone (logged for the touch mark). */
  async tap(locator, { fx, fy, settle = 120 } = {}) {
    const p = await this.aim(locator, { fx, fy });
    await sleep(settle);
    this.events.push({ kind: 'tap', x: p.x, y: p.y, t: now() });
    await this.page.touchscreen.tap(p.x, p.y);
  }

  /**
   * A finger drags the page: touches (x, y0), slides to (x, y1), lifts. Real touch events (the page scrolls by
   * itself, as under a finger). `ease: 'inout'` starts and ends slowly and `rest` keeps the finger still before it
   * lifts, so the page stops where the finger stops (no fling). Every step is logged.
   */
  async drag(x, y0, y1, { ms = 650, ease = 'out', rest = 60 } = {}) {
    const steps = Math.max(6, Math.round(ms / 16));
    this.events.push({ kind: 'touchstart', x, y: y0, t: now() });
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
    const t0 = Date.now();
    for (let i = 1; i <= steps; i += 1) {
      const p = i / steps;
      const e = ease === 'inout' ? (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2) : 1 - (1 - p) * (1 - p);
      const y = y0 + (y1 - y0) * e;
      await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
      this.events.push({ kind: 'touchmove', x, y, t: now() });
      const wait = t0 + (ms * i) / steps - Date.now();
      if (wait > 0) await sleep(wait);
    }
    // The finger rests where it stopped (a few still moves: the page's velocity falls to nothing), then lifts.
    for (let i = 0; i < Math.max(1, Math.round(rest / 40)); i += 1) {
      await sleep(40);
      await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y1 }] });
    }
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    this.events.push({ kind: 'touchend', x, y: y1, t: now() });
  }

  /**
   * The rectangle a beat shows, in the window's CSS px at this moment, logged for the camera: edit.py and fit.py
   * frame each beat on what the page really drew there. Several targets give the rectangle around them all; a
   * target is a locator or a plain {x, y, width, height}.
   */
  async box(name, ...targets) {
    let rect = null;
    for (const target of targets.flat()) {
      let r = null;
      if (target && typeof target.boundingBox === 'function') r = await target.boundingBox({ timeout: 3000 }).catch(() => null);
      else if (target && typeof target.x === 'number') r = { x: target.x, y: target.y, width: target.width ?? target.w, height: target.height ?? target.h };
      if (!r) continue;
      const one = [r.x, r.y, r.x + r.width, r.y + r.height];
      rect = rect ? [Math.min(rect[0], one[0]), Math.min(rect[1], one[1]), Math.max(rect[2], one[2]), Math.max(rect[3], one[3])] : one;
    }
    if (!rect) {
      console.log(`  · box ${name}: nothing to measure`);
      return null;
    }
    rect = rect.map((v) => Math.round(v * 10) / 10);
    this.events.push({ kind: 'box', name, rect, t: now() });
    console.log(`  · box ${name} [${rect.join(', ')}]`);
    return rect;
  }

  /** Types like a person: a short pause per character, a little longer after a space. */
  async type(text, { delay = 75 } = {}) {
    for (const ch of text) {
      await this.page.keyboard.type(ch);
      this.events.push({ kind: 'key', t: now() });
      await sleep(ch === ' ' ? delay * 1.6 : delay * (0.75 + Math.random() * 0.5));
    }
  }

  /** Hides the pointer (it leaves the frame on the laptop; on the phone there is none between taps). */
  hide() {
    this.events.push({ kind: 'hide', t: now() });
  }
}

/**
 * The card around an element: its nearest ancestor drawn as a card (rounded, painted, wider than 160 px), as
 * {x, y, width, height} in the window's CSS px — or null. For Take.box(): a beat is framed on the card it lives in.
 */
async function cardOf(locator) {
  const el = locator.first();
  if (!(await el.count())) return null;
  return el.evaluate((node) => {
    for (let e = node; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      const radius = parseFloat(cs.borderTopLeftRadius) || 0;
      const bg = cs.backgroundColor;
      const painted = (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') || cs.boxShadow !== 'none' || cs.borderTopWidth !== '0px';
      if (radius >= 10 && painted && r.width > 160) return { x: r.x, y: r.y, width: r.width, height: r.height };
    }
    return null;
  }).catch(() => null);
}

/** Waits for the network to go quiet (realtime keeps sockets open: a timeout is fine), then a pause. */
async function settle(page, ms = 600) {
  try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch { /* realtime */ }
  await sleep(ms);
}

function fail(e) {
  console.log('ERROR', u.redact(String(e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)).slice(0, 800));
  process.exitCode = 1;
}

module.exports = { u, launch, context, Take, settle, sleep, fail, now, cardOf };
