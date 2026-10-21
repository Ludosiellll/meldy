#!/usr/bin/env node
/**
 * The 3D kit's dev tools, run from frontend/ (they start their own Vite server on the dev preview page,
 * scripts/game-preview.html, and drive it with Playwright's Chromium):
 *
 *   node scripts/game-kit.mjs shots <dir>          screenshots: the lineup, the arena (both bosses) at key moments
 *   node scripts/game-kit.mjs perf [players…]      the perf harness: draw calls and JS time per frame, also at 4× CPU slowdown
 *   node scripts/game-kit.mjs thumbs               the phone's pictures → public/game/thumbs/<hash>/ + thumbs.gen.ts
 *
 * Playwright: the project's own package if installed, else one on NODE_PATH (e.g. NODE_PATH=/opt/node-tools/node_modules).
 * Headless WebGL needs SwiftShader (the flags below); real GPUs are much faster, so read the numbers as relative.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const require = createRequire(import.meta.url);

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    return require('playwright');
  }
}

const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'];

async function withServer(run) {
  const { createServer } = await import('vite');
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false },
    optimizeDeps: { entries: ['scripts/game-preview.html'] },
  });
  await server.listen();
  const address = server.httpServer.address();
  const base = `http://127.0.0.1:${address.port}/scripts/game-preview.html`;
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ args: ARGS });
  try {
    return await run(browser, base);
  } finally {
    await browser.close();
    await server.close();
  }
}

async function open(browser, url, viewport) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.type(), m.text().slice(0, 300));
  });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 240000 });
  const err = await page.evaluate(() => window.__error);
  if (err) throw new Error(err);
  return { page, loadMs: Date.now() - t0 };
}

async function shots(dir) {
  mkdirSync(dir, { recursive: true });
  await withServer(async (browser, base) => {
    const list = [
      ['lineup.png', 'scene=lineup', [0.9]],
      ['hats.png', 'scene=hats', [0.5]],
      ['thumbs.png', 'scene=thumbsheet', [0]],
      ['arena-skeleton', 'scene=arena&boss=skeleton', [2.0, 3.3, 4.85, 6.4, 8.2]],
      ['arena-clock', 'scene=arena&boss=clock', [2.0, 3.3, 5.0, 6.4, 8.2]],
    ];
    for (const [name, query, times] of list) {
      const { page, loadMs } = await open(browser, `${base}?capture&${query}`, { width: 1536, height: 864 });
      console.log(name, 'loaded in', loadMs, 'ms');
      for (const t of times) {
        await page.evaluate((x) => window.__render(x), t);
        const file = name.endsWith('.png') ? join(dir, name) : join(dir, `${name}-${t.toFixed(2)}.png`);
        await page.locator('#stage').screenshot({ path: file });
        const s = await page.evaluate(() => window.__stats());
        console.log(' ', file, `draw calls ${s.drawCalls}, triangles ${s.triangles}`);
      }
      await page.close();
    }
  });
}

async function perf(counts) {
  const results = [];
  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +v.toFixed(2)]));
  await withServer(async (browser, base) => {
    for (const n of counts) {
      for (const boss of ['skeleton', 'clock']) {
        for (const throttle of [1, 4]) {
          // A small canvas: the JavaScript side of a frame does not depend on the canvas size, and SwiftShader (a GPU
          // emulated on the CPU) then finishes each frame quickly. Its own frame times say nothing about a real GPU.
          const { page, loadMs } = await open(browser, `${base}?capture&scene=bench&players=${n}&boss=${boss}&q=0&w=640&h=360`, { width: 640, height: 360 });
          const cdp = await page.context().newCDPSession(page);
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
          // JavaScript per frame: the game's script, the kit's update, handing the draw calls to the GPU
          await page.evaluate(() => window.__bench(20));
          const r = await page.evaluate(() => window.__bench(120));
          const row = {
            players: n,
            boss,
            cpuThrottle: throttle,
            loadMs,
            jsFrameMs: round(r.total),
            jsUpdateMs: round(r.update),
            jsDrawSubmitMs: round(r.draw),
            drawCalls: { max: r.drawCallsMax, mean: +r.drawCallsMean.toFixed(1) },
            triangles: r.triangles,
          };
          console.log(JSON.stringify(row));
          results.push(row);
          await page.close();
        }
      }
    }
  });
  return results;
}

const MODELS = ['knight', 'mage', 'barbarian', 'rogue', 'hooded'];
const HATS = ['none', 'cap', 'beanie', 'phones', 'flower', 'antenna', 'bow', 'crown', 'grad', 'horns', 'party', 'propeller', 'tophat'];

async function thumbs() {
  const out = new Map();
  await withServer(async (browser, base) => {
    const { page } = await open(browser, `${base}?scene=thumbs&size=160`, { width: 400, height: 400 });
    for (const model of MODELS) {
      for (const hat of HATS) {
        const url = await page.evaluate(([m, h]) => window.__thumb(m, h), [model, hat]);
        const data = Buffer.from(url.split(',')[1], 'base64');
        if (!url.startsWith('data:image/webp')) throw new Error('the browser did not make a WebP');
        out.set(`${model}-${hat}.webp`, data);
      }
    }
  });
  const hash = createHash('sha256');
  for (const [name, data] of [...out].sort()) hash.update(name).update(data);
  const dirName = hash.digest('hex').slice(0, 10);
  const thumbsRoot = join(root, 'public', 'game', 'thumbs');
  mkdirSync(thumbsRoot, { recursive: true });
  for (const old of readdirSync(thumbsRoot)) rmSync(join(thumbsRoot, old), { recursive: true, force: true });
  const dir = join(thumbsRoot, dirName);
  mkdirSync(dir);
  let total = 0;
  let biggest = 0;
  for (const [name, data] of out) {
    writeFileSync(join(dir, name), data);
    total += data.length;
    biggest = Math.max(biggest, data.length);
  }
  writeFileSync(
    join(root, 'src', 'lib', 'live', 'three', 'thumbs.gen.ts'),
    `// Generated by scripts/game-kit.mjs thumbs: do not edit. The folder's name is a hash of the pictures.\nexport const THUMBS_DIR = '${dirName}';\nexport const THUMB_PX = 160;\n`,
  );
  console.log(`${out.size} thumbnails in public/game/thumbs/${dirName}: ${(total / 1024).toFixed(1)} KB, the biggest ${(biggest / 1024).toFixed(1)} KB`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'shots') await shots(rest[0] ?? join(root, '..', 'qa-screens', 'game-kit'));
else if (cmd === 'perf') await perf(rest.length ? rest.map(Number) : [30, 40]);
else if (cmd === 'thumbs') await thumbs();
else {
  console.log('usage: node scripts/game-kit.mjs shots <dir> | perf [players…] | thumbs');
  process.exit(1);
}
