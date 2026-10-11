'use strict';
// Slide 09, the laptop: the example exam /try (no account). Its sheet holds yesterday's answer to question 5 (the
// example seeds it a day back: named lines are half erased). The suggested answer to question 5 names them again
// (the app's own «Вставить ответ примера»), the AI checks it, the examiner asks about the point it missed; back on the
// sheet, the lines named on two different days are struck out and their squares on the map empty (the sheet's own replay).
//
//   MELDY_ULIB=<ulib.cjs> node deck/cf11/tools/record/take-09.cjs <take dir>
//
// The window: 1440 × 900 CSS px, device scale 2 (stills re-rendered at 2×).
const fs = require('fs');
const path = require('path');
const R = require('./rec.cjs');

const DIR = path.resolve(process.argv[2] || 'take-09');
const W = 1440, H = 900, DPR = 2;
const FOLLOWUP = true; // the follow-up is answered «Не знаю»

(async () => {
  const browser = await R.launch();
  const result = {};
  let take = null;
  try {
    const ctx = await R.context(browser, { w: W, h: H, dpr: DPR });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('[pageerror]', R.u.redact(e.message).slice(0, 200)));
    await page.goto(R.u.SITE + '/try', { waitUntil: 'load', timeout: 60000 });
    await page.getByRole('link', { name: 'Ответить на вопрос 5' }).first().waitFor({ timeout: 60000 });
    await R.settle(page, 1500);
    result.before = (await page.locator('.tx-shell').first().innerText()).replace(/\n+/g, ' / ').slice(0, 400);

    take = new R.Take(page, DIR, { dpr: DPR, viewport: { width: W, height: H } });
    take.pointer = { x: 760, y: 640 };
    await take.start();
    await take.still('sheet');
    await R.sleep(600);

    // «Ответить на вопрос 5»
    take.mark('answer');
    await take.click(page.getByRole('link', { name: 'Ответить на вопрос 5' }).first(), { ms: 650 });
    await page.getByRole('button', { name: 'Вставить ответ примера' }).first().waitFor({ timeout: 30000 });
    take.mark('ticket');
    await R.sleep(600);
    // The example's own answer to question 5 (a button of the page, as a guest would press it).
    await take.click(page.getByRole('button', { name: 'Вставить ответ примера' }).first(), { ms: 550 });
    take.mark('pasted');
    await take.move(1180, 560, { ms: 450 }); // aside, off the lines the answer opens
    await R.sleep(1450);
    await take.still('pasted');
    await R.sleep(300);
    await take.click(page.getByRole('button', { name: 'Готово' }).first(), { ms: 550 });
    take.mark('done');

    // The examiner asks about the point the answer missed (the clip leaves this to slide 08): «Не знаю».
    await page.getByText('Экзаменатор', { exact: false }).first().waitFor({ timeout: 60000 });
    take.mark('followup');
    result.followup = (await page.locator('.or-examiner, [class*="examiner"]').first().innerText().catch(() => '')).replace(/\n+/g, ' / ').slice(0, 300);
    await R.sleep(1500);
    if (FOLLOWUP) {
      await take.click(page.getByRole('button', { name: 'Не знаю' }).last(), { ms: 550 });
    }
    take.mark('sent');

    // The protocol, then back to the sheet.
    await page.locator('a, button').filter({ hasText: /^К шпаргалке$/ }).first().waitFor({ timeout: 120000 }).catch(() => {});
    take.mark('protocol');
    await R.sleep(1600);
    result.protocol = (await page.locator('.tx-shell').first().innerText()).replace(/\n+/g, ' / ').slice(0, 1500);
    await take.still('protocol');
    const links = await page.evaluate(() => [...document.querySelectorAll('a, button')].filter((e) => e.offsetParent).map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean));
    result.links = links.slice(0, 30);
    const toSheet = page.locator('a, button').filter({ hasText: /^К шпаргалке$/ }).first();
    const target = (await toSheet.count()) ? toSheet : page.locator('a, button').filter({ hasText: /Лист примера/ }).first();
    take.mark('back');
    await take.click(target, { ms: 550 });
    take.hide(); // the sheet plays by itself: the hand leaves the frame
    await page.waitForURL((url) => url.pathname === '/try' || url.pathname === '/try/', { timeout: 30000 });
    take.mark('sheet2');
    await R.sleep(9000);
    take.mark('replayed');
    await take.still('after');
    await R.sleep(1500);
    result.after = (await page.locator('.tx-shell').first().innerText()).replace(/\n+/g, ' / ').slice(0, 900);
    result.scrollY = await page.evaluate(() => scrollY);
  } catch (e) {
    R.fail(e);
  } finally {
    if (take) await take.stop();
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, 'result.json'), JSON.stringify(result, null, 1));
    console.log(JSON.stringify(result, null, 1).slice(0, 4000));
    await browser.close();
  }
})();
