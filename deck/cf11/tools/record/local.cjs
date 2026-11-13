'use strict';
// Recording the local copy of today's app for the stage deck's films (13.11): the dev server of frontend/.shots
// (vite --config .shots/vite.config.mjs), where Supabase and the backend are answered by a mock on the same origin.
// The take itself is rec.cjs's Take (the screencast, the hand's log, marks and boxes); this file only opens the
// browser the way the harness does: a persona cookie instead of a sign-in, every request off 127.0.0.1 refused.
//
//   const { open, Take, sleep } = require('<repo>/deck/cf11/tools/record/local.cjs');
//   const { browser, page } = await open({ base: 'http://127.0.0.1:5199', w: 1840, h: 728, dpr: 1.5, persona: 'owner' });
//   const take = new Take(page, dir, { dpr: 1.5, viewport: { width: 1840, height: 728 } }); await take.start(); …
const path = require('path');
process.env.MELDY_ULIB = path.join(__dirname, 'ulib-local.cjs');
const rec = require('./rec.cjs');

async function open({ base = 'http://127.0.0.1:5199', w = 1840, h = 728, dpr = 1.5, phone = false, persona = 'owner', scene = '', fresh = false, args = [], init = [] } = {}) {
  process.env.LANG = 'ru_RU.UTF-8';
  // the screencast paints at the device's pixels only when the browser itself is forced to that scale
  const browser = await rec.launch([`--force-device-scale-factor=${dpr}`, ...args]);
  const ctx = await rec.context(browser, { w, h, dpr, phone, init });
  const refused = [];
  await ctx.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
    refused.push(url.href.slice(0, 120));
    return route.abort();
  });
  await ctx.addCookies([
    { name: 'shots_persona', value: persona, url: base },
    { name: 'shots_fresh', value: fresh ? '1' : '0', url: base },
    { name: 'shots_scene', value: scene, url: base },
  ]);
  const page = await ctx.newPage();
  return { browser, ctx, page, refused, base };
}

module.exports = { ...rec, open };
