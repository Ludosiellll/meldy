'use strict';
// Slide 09, the laptop: the example exam /try (no account). Its sheet holds yesterday's answers to questions 1, 5
// and 9 (the example seeds them a day back: named lines are half erased). The example's own answer to question 5
// («Вставить ответ примера») names those lines again; the AI checks it; the examiner asks about the point it
// missed («Не знаю»); the protocol; back on the sheet the lines named on two different days are struck out, their
// squares on the map empty and the count goes 47 → 44 (the sheet's own replay).
//
//   node deck/cf11/tools/record/take-09.cjs <take dir>
//
// The window: 1024 × 800 CSS px — the site's own desktop layout at its narrowest (a 1440-wide laptop at 140 %),
// so each beat sits in a part of the screen the camera can frame — rendered at device scale 1.75 (frames
// 1792 × 1400; stills at 3×). Calm takes: every beat is held for real, the hand moves at a person's pace, and each
// beat's rectangle is logged for the camera (Take.box). No pointer is drawn in the clip, only a ring where it presses.
const fs = require('fs');
const path = require('path');
const R = require('./rec.cjs');

const DIR = path.resolve(process.argv[2] || 'take-09');
const W = 1024, H = 800, DPR = 1.75;

// The sheet's counter: «Весь лист на экране», «47 строк осталось из 47», the map down to its legend.
const counterBlock = (page) => [
  page.getByRole('button', { name: /Весь лист на экране/ }).locator('visible=true').first(),
  page.getByText(/строк\S* осталось из/).locator('visible=true').first(),
  page.getByText(/^стёрто$/).locator('visible=true').first(),
];

(async () => {
  const browser = await R.launch([`--force-device-scale-factor=${DPR}`]);
  const result = {};
  let take = null;
  try {
    const ctx = await R.context(browser, { w: W, h: H, dpr: DPR });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('[pageerror]', R.u.redact(e.message).slice(0, 200)));
    await page.goto(R.u.SITE + '/try', { waitUntil: 'load', timeout: 60000 });
    const answer5 = page.getByRole('link', { name: 'Ответить на вопрос 5' }).first();
    await answer5.waitFor({ timeout: 60000 });
    await R.settle(page, 1500);
    result.before = (await page.locator('body').innerText()).replace(/\n+/g, ' / ').slice(0, 500);

    take = new R.Take(page, DIR, { dpr: DPR, viewport: { width: W, height: H } });
    take.stillScale = 3 / DPR;
    take.pointer = { x: 520, y: 640 };
    await take.start();
    // The example: yesterday's answers, «47 строк осталось из 47», the button.
    await take.box('intro', page.getByText(/^Для примера считаем/).first(), answer5, counterBlock(page));
    await R.sleep(2600);

    // «Ответить на вопрос 5»
    take.mark('answer');
    await take.click(answer5, { ms: 800 });
    const paste = page.getByRole('button', { name: 'Вставить ответ примера' }).first();
    await paste.waitFor({ timeout: 30000 });
    take.mark('ticket');
    await R.sleep(500);
    await take.box('ticket', await R.cardOf(page.getByText(/^Ценовая эластичность спроса/)), paste, page.getByRole('button', { name: /Отвечать голосом/ }).first());
    await R.sleep(1500);

    // The example's own answer to question 5 (a button of the page, as a guest would press it): the points it
    // names open with the lecture's words, «По ключевым словам: 4 из 5».
    take.mark('paste');
    await take.click(paste, { ms: 700 });
    await page.getByText(/По ключевым словам/).locator('visible=true').first().waitFor({ timeout: 30000 });
    take.mark('pasted');
    await R.sleep(1300); // the page brings the answer into view
    const done = page.getByRole('button', { name: 'Готово' }).first();
    // The opened points in view (their lecture quotes start with «), the count and «Готово».
    const quotes = await page.evaluate(() => [...document.querySelectorAll('body *')]
      .filter((e) => /^«/.test((e.innerText || '').trim()) && !/^«/.test((e.parentElement.innerText || '').trim()))
      .map((e) => e.getBoundingClientRect())
      .filter((r) => r.top > 70 && r.bottom < innerHeight - 10 && r.width > 0)
      .map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height })));
    await take.box('pasted', page.getByText(/По ключевым словам/).locator('visible=true').first(), done, ...quotes.slice(-2));
    await R.sleep(2300);

    // «Готово»: the AI checks the answer (waiting, cut in the clip), the examiner asks about the point it missed.
    take.mark('done');
    await take.click(done, { ms: 700 });
    const dontKnow = page.getByRole('button', { name: 'Не знаю' }).last();
    await dontKnow.waitFor({ timeout: 120000 });
    take.mark('asked');
    await R.sleep(500);
    result.followup = (await page.getByText(/^«.*\?»$/).last().innerText().catch(() => '')).slice(0, 300);
    await take.box('examiner', await R.cardOf(page.getByText(/^Экзаменатор$/).last()), dontKnow);
    await R.sleep(2000);
    take.mark('dontknow');
    await take.click(dontKnow, { ms: 650 });

    // The protocol.
    const toSheet = page.locator('a, button').filter({ hasText: /^К шпаргалке$/ }).first();
    await toSheet.waitFor({ timeout: 120000 });
    take.mark('protocol');
    await R.sleep(500);
    result.protocol = (await page.locator('body').innerText()).replace(/\n+/g, ' / ').slice(0, 1500);
    await take.box('protocol', page.getByText(/^На шпаргалке:/).first(), page.getByText(/о нём спросил экзаменатор/).first(), await R.cardOf(page.getByText(/^Итог$/).first()));
    await R.sleep(2600);
    await take.still('protocol');

    // «К шпаргалке»: the sheet plays the answer back by itself (no input: any press would skip the show).
    take.mark('back');
    await take.click(toSheet, { ms: 700 });
    await page.waitForURL((url) => url.pathname === '/try' || url.pathname === '/try/', { timeout: 30000 });
    take.mark('sheet');
    await R.sleep(1400); // question 5 is brought into view
    const q5 = page.locator('[id^="cs-q-"]').filter({ hasText: /Ценовая эластичность спроса/ }).first();
    await take.box('q5', q5);
    await take.box('counter', counterBlock(page));
    await page.getByText(/^44$/).first().waitFor({ timeout: 20000 }).catch(() => {});
    take.mark('erased');
    await R.sleep(1200);
    await take.box('after', q5, counterBlock(page), page.getByText(/^После ответа/).locator('visible=true').first());
    await take.still('after');
    await R.sleep(2600);
    take.mark('end');
    result.after = (await page.locator('body').innerText()).replace(/\n+/g, ' / ').slice(0, 900);
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
